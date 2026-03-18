import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

function sanitizeTableName(name) {
  return 'ds_' + name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 40) + '_' + Date.now();
}

// Common date patterns: ISO, US, EU formats
const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,           // 2024-01-15
  /^\d{4}-\d{2}-\d{2}T/,           // 2024-01-15T10:30:00
  /^\d{4}\/\d{2}\/\d{2}$/,         // 2024/01/15
  /^\d{2}\/\d{2}\/\d{4}$/,         // 01/15/2024
  /^\d{2}-\d{2}-\d{4}$/,           // 15-01-2024
  /^\d{4}-\d{2}$/,                  // 2024-01 (year-month)
  /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/, // Jan 15, 2024
];

function looksLikeDate(val) {
  const s = String(val).trim();
  if (!s || !isNaN(Number(s))) return false; // pure number is not a date
  if (DATE_PATTERNS.some(p => p.test(s))) return true;
  // Last resort: Date.parse — but must parse to a sane year (1900-2100)
  const d = new Date(s);
  return !isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100;
}

function inferType(values) {
  const nonNull = values.filter(v => v !== null && v !== '' && v !== undefined);
  if (nonNull.length === 0) return 'text';
  const nums = nonNull.filter(v => !isNaN(Number(v)) && v !== '');
  if (nums.length === nonNull.length) {
    const floats = nums.filter(v => String(v).includes('.'));
    return floats.length > 0 ? 'real' : 'integer';
  }
  // FIX: detect date columns — return 'date' type (stored as TEXT in SQLite but tagged)
  const dateMatches = nonNull.filter(v => looksLikeDate(v));
  if (dateMatches.length / nonNull.length >= 0.8) return 'date';
  return 'text';
}

function computeColumnStats(db, tableName, colName, colType) {
  const stats = { name: colName, type: colType };
  try {
    const total = db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get().c;
    const nullCount = db.prepare(`SELECT COUNT(*) as c FROM "${tableName}" WHERE "${colName}" IS NULL OR "${colName}" = ''`).get().c;
    stats.totalCount = total;
    stats.missingCount = nullCount;
    stats.missingPct = total > 0 ? ((nullCount / total) * 100).toFixed(1) : 0;

    const uniqueCount = db.prepare(`SELECT COUNT(DISTINCT "${colName}") as c FROM "${tableName}"`).get().c;
    stats.uniqueCount = uniqueCount;

    if (colType === 'integer' || colType === 'real') {
      const agg = db.prepare(`SELECT MIN(CAST("${colName}" AS REAL)) as mn, MAX(CAST("${colName}" AS REAL)) as mx, AVG(CAST("${colName}" AS REAL)) as avg FROM "${tableName}" WHERE "${colName}" != ''`).get();
      stats.min = agg.mn;
      stats.max = agg.mx;
      stats.mean = agg.avg ? parseFloat(agg.avg.toFixed(4)) : null;
    } else {
      const topVals = db.prepare(`SELECT "${colName}" as val, COUNT(*) as cnt FROM "${tableName}" WHERE "${colName}" != '' GROUP BY "${colName}" ORDER BY cnt DESC LIMIT 5`).all();
      stats.topValues = topVals;
    }
  } catch (e) {
    stats.error = e.message;
  }
  return stats;
}

function importRecords(db, tableName, columns, records) {
  const colDefs = columns.map(c => `"${c.name}" ${c.type}`).join(', ');
  db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`);

  const placeholders = columns.map(() => '?').join(', ');
  const colNames = columns.map(c => `"${c.name}"`).join(', ');
  const stmt = db.prepare(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const vals = columns.map(c => {
        const v = row[c.name];
        if (v === null || v === undefined || v === '') return null;
        return v;
      });
      stmt.run(vals);
    }
  });
  insertMany(records);
}

// GET /api/datasets
router.get('/', (req, res) => {
  const db = getDb();
  const datasets = db.prepare(`
    SELECT d.*, p.name as project_name 
    FROM datasets d 
    LEFT JOIN projects p ON d.project_id = p.id 
    ORDER BY d.created_at DESC
  `).all();
  res.json({ datasets });
});

// GET /api/datasets/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Dataset not found' });
  dataset.schema = JSON.parse(dataset.schema_json || '[]');
  dataset.stats = JSON.parse(dataset.stats_json || '{}');
  res.json({ dataset });
});

// GET /api/datasets/:id/rows
router.get('/:id/rows', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Dataset not found' });

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  const offset = (page - 1) * limit;
  const sortCol = req.query.sort;
  const sortDir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const filterCol = req.query.filterCol;
  const filterVal = req.query.filterVal;

  let whereClause = '';
  let params = [];
  if (filterCol && filterVal) {
    whereClause = `WHERE "${filterCol}" LIKE ?`;
    params.push(`%${filterVal}%`);
  }

  let orderClause = sortCol ? `ORDER BY "${sortCol}" ${sortDir}` : '';
  const rows = db.prepare(`SELECT rowid as __rowid, * FROM "${dataset.table_name}" ${whereClause} ${orderClause} LIMIT ? OFFSET ?`).all([...params, limit, offset]);
  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM "${dataset.table_name}" ${whereClause}`).get(params);

  res.json({ rows, total: totalRow.c, page, limit });
});

// GET /api/datasets/:id/column-stats/:col
router.get('/:id/column-stats/:col', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Dataset not found' });
  const schema = JSON.parse(dataset.schema_json || '[]');
  const col = schema.find(c => c.name === req.params.col);
  if (!col) return res.status(404).json({ error: 'Column not found' });
  const stats = computeColumnStats(db, dataset.table_name, col.name, col.type);
  res.json({ stats });
});

// POST /api/datasets/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const db = getDb();
  const { originalname, path: filePath, mimetype } = req.file;
  const ext = path.extname(originalname).toLowerCase();
  const dsName = req.body.name || path.basename(originalname, ext);

  let records = [];
  let headers = [];

  try {
    if (ext === '.csv' || mimetype === 'text/csv') {
      const content = readFileSync(filePath, 'utf8');
      records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
      headers = records.length > 0 ? Object.keys(records[0]) : [];
    } else if (ext === '.xlsx' || ext === '.xls') {
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      records = XLSX.utils.sheet_to_json(ws, { defval: null });
      headers = records.length > 0 ? Object.keys(records[0]) : [];
    } else if (ext === '.json') {
      const content = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      records = Array.isArray(parsed) ? parsed : parsed.data || [parsed];
      headers = records.length > 0 ? Object.keys(records[0]) : [];
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use CSV, Excel, or JSON.' });
    }

    if (records.length === 0) return res.status(400).json({ error: 'File is empty or has no rows.' });

    // Detect column types
    const sampleSize = Math.min(records.length, 500);
    const columns = headers.map(h => {
      const vals = records.slice(0, sampleSize).map(r => r[h]);
      return { name: h, type: inferType(vals) };
    });

    const id = uuidv4();
    const tableName = sanitizeTableName(dsName);
    importRecords(db, tableName, columns, records);

    // Compute summary stats
    const columnStats = columns.map(c => computeColumnStats(db, tableName, c.name, c.type));
    const missingTotal = columnStats.reduce((s, c) => s + (c.missingCount || 0), 0);
    const numericCols = columns.filter(c => c.type === 'integer' || c.type === 'real').length;
    const categoricalCols = columns.filter(c => c.type === 'text').length;

    const statsJson = JSON.stringify({
      missingValues: missingTotal,
      numericColumns: numericCols,
      categoricalColumns: categoricalCols,
      columnStats
    });

    db.prepare(`
      INSERT INTO datasets (id, name, original_filename, file_type, row_count, column_count, table_name, original_table_name, schema_json, stats_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, dsName, originalname, ext.replace('.', ''), records.length, columns.length, tableName, tableName + '_orig', JSON.stringify(columns), statsJson);

    // Create original snapshot immediately on import
    db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}_orig" AS SELECT * FROM "${tableName}"`);

    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id);
    dataset.schema = columns;
    dataset.stats = JSON.parse(statsJson);

    res.json({ success: true, dataset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/datasets/url
router.post('/url', async (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    let records = [];
    const parsedUrl = new URL(url);
    const ext = path.extname(parsedUrl.pathname).toLowerCase();

    if (ext === '.json' || response.headers.get('content-type')?.includes('json')) {
      const json = JSON.parse(content);
      records = Array.isArray(json) ? json : json.data || [json];
    } else {
      records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    }

    if (!records.length) return res.status(400).json({ error: 'No data found at URL' });

    const db = getDb();
    const headers = Object.keys(records[0]);
    const sampleSize = Math.min(records.length, 500);
    const columns = headers.map(h => ({
      name: h,
      type: inferType(records.slice(0, sampleSize).map(r => r[h]))
    }));

    const dsName = name || parsedUrl.pathname.split('/').pop() || 'url-dataset';
    const id = uuidv4();
    const tableName = sanitizeTableName(dsName);
    importRecords(db, tableName, columns, records);

    const columnStats = columns.map(c => computeColumnStats(db, tableName, c.name, c.type));
    const statsJson = JSON.stringify({
      missingValues: columnStats.reduce((s, c) => s + (c.missingCount || 0), 0),
      numericColumns: columns.filter(c => c.type !== 'text').length,
      categoricalColumns: columns.filter(c => c.type === 'text').length,
      columnStats
    });

    db.prepare(`
      INSERT INTO datasets (id, name, original_filename, file_type, row_count, column_count, table_name, original_table_name, schema_json, stats_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, dsName, url, 'url', records.length, columns.length, tableName, tableName + '_orig', JSON.stringify(columns), statsJson);

    // Create original snapshot immediately on import
    db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}_orig" AS SELECT * FROM "${tableName}"`);

    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id);
    dataset.schema = columns;
    dataset.stats = JSON.parse(statsJson);
    res.json({ success: true, dataset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/datasets/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Not found' });
  try { db.exec(`DROP TABLE IF EXISTS "${dataset.table_name}"`); } catch (e) {}
  db.prepare('DELETE FROM datasets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;