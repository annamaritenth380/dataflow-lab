import express from 'express';
import * as XLSX from 'xlsx';
import { getDb } from '../db/database.js';

const router = express.Router();

// Export dataset as CSV
router.get('/dataset/:id/csv', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Not found' });

  const rows = db.prepare(`SELECT * FROM "${dataset.table_name}"`).all();
  if (!rows.length) return res.status(400).json({ error: 'No data' });

  const headers = Object.keys(rows[0]).join(',');
  const csvRows = rows.map(r => Object.values(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  const csv = [headers, ...csvRows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${dataset.name}.csv"`);
  res.send(csv);
});

// Export dataset as Excel
router.get('/dataset/:id/xlsx', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Not found' });

  const rows = db.prepare(`SELECT * FROM "${dataset.table_name}"`).all();
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${dataset.name}.xlsx"`);
  res.send(buf);
});

// Export dataset as JSON
router.get('/dataset/:id/json', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Not found' });

  const rows = db.prepare(`SELECT * FROM "${dataset.table_name}"`).all();
  res.setHeader('Content-Disposition', `attachment; filename="${dataset.name}.json"`);
  res.json(rows);
});

// Export SQL script for all operations on a dataset
router.get('/dataset/:id/sql-script', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Not found' });

  const ops = db.prepare('SELECT * FROM operations WHERE dataset_id = ? AND applied = 1 ORDER BY created_at ASC').all(req.params.id);
  const lines = [`-- DataFlow Lab SQL Export`, `-- Dataset: ${dataset.name}`, `-- Generated: ${new Date().toISOString()}`, ''];
  ops.forEach(op => lines.push(`-- Operation: ${op.operation_type}`, op.sql_generated, ''));

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${dataset.name}_operations.sql"`);
  res.send(lines.join('\n'));
});

// Export Python script
router.get('/dataset/:id/python-script', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Not found' });

  const ops = db.prepare('SELECT * FROM operations WHERE dataset_id = ? AND applied = 1 ORDER BY created_at ASC').all(req.params.id);
  const lines = [
    `# DataFlow Lab Python Export`,
    `# Dataset: ${dataset.name}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    `import pandas as pd`,
    '',
    `# Load your dataset`,
    `df = pd.read_csv("${dataset.original_filename || dataset.name + '.csv'}")`,
    '',
    `# Applied Transformations:`
  ];
  ops.forEach(op => {
    lines.push(`# ${op.operation_type}`);
    lines.push(op.python_generated || `# (no python equivalent)`);
    lines.push('');
  });
  lines.push(`# Save result`);
  lines.push(`df.to_csv("${dataset.name}_cleaned.csv", index=False)`);

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${dataset.name}_pipeline.py"`);
  res.send(lines.join('\n'));
});

export default router;
