import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';

const router = express.Router();
const q  = c   => `"${c}"`;
const qt = tbl => `"${tbl}"`;

/* ── Schema reader ──────────────────────────────────────────── */
function readSchema(db, tbl) {
  return db.prepare(`PRAGMA table_info(${qt(tbl)})`).all().map(col => {
    const t = (col.type ?? '').toLowerCase();
    let type = 'text';
    if (t.includes('int')) type = 'integer';
    else if (t.includes('real')||t.includes('float')||t.includes('double')||t.includes('numeric')||t.includes('decimal')) type = 'real';
    return { name: col.name, type };
  });
}
function allColList(db, tbl) {
  return db.prepare(`PRAGMA table_info(${qt(tbl)})`).all().map(c => q(c.name)).join(', ');
}

/* ── execSQL ────────────────────────────────────────────────── */
// FIX: Smart split that respects single-quoted strings.
// Naive split(';') breaks when ';' appears inside a string literal like ';'.
function execSQL(db, sql) {
  if (!sql || typeof sql !== 'string') return;
  const stripped = sql.split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
    .trim();
  if (!stripped) return;

  // Parse char-by-char to split on ';' only outside string literals
  const stmts = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "'" && !inString) {
      inString = true;
      current += ch;
    } else if (ch === "'" && inString) {
      // SQLite escapes single quote as '' (two single quotes)
      if (stripped[i + 1] === "'") {
        current += "''";
        i++;
      } else {
        inString = false;
        current += ch;
      }
    } else if (ch === ';' && !inString) {
      const trimmed = current.trim();
      if (trimmed) stmts.push(trimmed);
      current = '';
    } else {
      current += ch;
    }
  }
  const last = current.trim();
  if (last) stmts.push(last);

  for (const stmt of stmts) {
    db.exec(stmt);
  }
}

/* ── Resolve __REMOVE_DUPLICATES__ ──────────────────────────── */
function resolveRemoveDuplicates(db, sql, tbl) {
  if (!sql.includes('__REMOVE_DUPLICATES__')) return sql;
  const allCols = readSchema(db, tbl).map(c => q(c.name)).join(', ');
  return `DELETE FROM ${qt(tbl)} WHERE rowid NOT IN (\n  SELECT MIN(rowid) FROM ${qt(tbl)} GROUP BY ${allCols}\n);`;
}

/* ── Resolve __ONE_HOT__ ────────────────────────────────────── */
function resolveOneHot(db, sql) {
  if (!sql.includes('__ONE_HOT__')) return sql;
  const lines = sql.split('\n').filter(Boolean);
  const resolved = [];
  for (const line of lines) {
    const m = line.match(/^__ONE_HOT__(.+?)__(.+?)__$/);
    if (!m) { resolved.push(line); continue; }
    const [, tblName, colName] = m;
    let vals = [];
    try {
      vals = db.prepare(
        `SELECT DISTINCT CAST(${q(colName)} AS TEXT) as v FROM ${qt(tblName)} WHERE ${q(colName)} IS NOT NULL AND TRIM(CAST(${q(colName)} AS TEXT)) != '' ORDER BY v`
      ).all().map(r => r.v);
    } catch { continue; }
    for (const val of vals) {
      const safeVal = String(val).replace(/[^a-z0-9]/gi, '_').replace(/^_+|_+$/g, '') || 'val';
      const newCol  = `${colName}_${safeVal}`;
      const escaped = String(val).replace(/'/g, "''");
      resolved.push(`ALTER TABLE ${qt(tblName)} ADD COLUMN ${q(newCol)} INTEGER DEFAULT 0`);
      resolved.push(`UPDATE ${qt(tblName)} SET ${q(newCol)} = CASE WHEN CAST(${q(colName)} AS TEXT) = '${escaped}' THEN 1 ELSE 0 END`);
    }
  }
  if (!resolved.length) return '';
  return resolved.join(';\n') + ';';
}

/* ── Register custom SQLite math functions ──────────────────── */
let _fnRegistered = false;
function ensureSQLiteFunctions(db) {
  if (_fnRegistered) return;
  try {
    db.function('LOG',   { deterministic: true }, x => { const n=parseFloat(x); return (!isFinite(n)||n<=0)?null:Math.log(n); });
    db.function('LN',    { deterministic: true }, x => { const n=parseFloat(x); return (!isFinite(n)||n<=0)?null:Math.log(n); });
    db.function('LOG10', { deterministic: true }, x => { const n=parseFloat(x); return (!isFinite(n)||n<=0)?null:Math.log10(n); });
    db.function('LOG2',  { deterministic: true }, x => { const n=parseFloat(x); return (!isFinite(n)||n<=0)?null:Math.log2(n); });
    db.function('FLOOR', { deterministic: true }, x => { const n=parseFloat(x); return !isFinite(n)?null:Math.floor(n); });
    db.function('CEIL',  { deterministic: true }, x => { const n=parseFloat(x); return !isFinite(n)?null:Math.ceil(n); });
    db.function('SQRT',  { deterministic: true }, x => { const n=parseFloat(x); return (!isFinite(n)||n<0)?null:Math.sqrt(n); });
    db.function('POW',   { deterministic: true }, (b,e) => Math.pow(parseFloat(b),parseFloat(e)));
    _fnRegistered = true;
  } catch { _fnRegistered = true; }
}

/* ══════════════════════════════════════════════════════════════
   SQL GENERATOR
   ══════════════════════════════════════════════════════════════ */
export function generateSQL(tbl, opId, params) {
  const cols = params.columns?.length ? params.columns : (params.column ? [params.column] : []);
  const col  = cols[0] || '';

  switch (opId) {

    /* ── Column ──────────────────────────────────────────────── */
    case 'select_columns': {
      if (!cols.length) return `-- select_columns: no columns specified`;
      const selTmp = `__sel_${tbl.replace(/[^a-z0-9]/gi,'').slice(0,20)}_${Date.now()}`;
      return `CREATE TABLE "${selTmp}" AS SELECT ${cols.map(c=>q(c)).join(', ')} FROM ${qt(tbl)};\nDROP TABLE ${qt(tbl)};\nALTER TABLE "${selTmp}" RENAME TO ${qt(tbl)};`;
    }

    case 'duplicate_column':
      if (!col) return `-- duplicate_column: no column specified`;
      return `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(col+'_copy')} TEXT;\nUPDATE ${qt(tbl)} SET ${q(col+'_copy')} = ${q(col)};`;

    case 'merge_columns': {
      if (cols.length < 2) return `-- merge_columns: need at least 2 columns`;
      const sep     = (params.separator ?? ' ').replace(/'/g, "''");
      const newName = params.newName || 'merged';
      const parts   = cols.map(c => `COALESCE(CAST(${q(c)} AS TEXT), '')`).join(` || '${sep}' || `);
      return `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(newName)} TEXT;\nUPDATE ${qt(tbl)} SET ${q(newName)} = TRIM(${parts});`;
    }

    case 'split_column': {
      if (!col) return `-- split_column: no column specified`;
      const sep     = params.separator ?? ' ';
      const safeSep = sep.replace(/'/g, "''");
      const nA      = params.nameLeft  || col+'_1';
      const nB      = params.nameRight || col+'_2';
      return `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(nA)} TEXT;\nALTER TABLE ${qt(tbl)} ADD COLUMN ${q(nB)} TEXT;\nUPDATE ${qt(tbl)} SET ${q(nA)} = SUBSTR(${q(col)},1,INSTR(${q(col)},'${safeSep}')-1) WHERE INSTR(${q(col)},'${safeSep}')>0;\nUPDATE ${qt(tbl)} SET ${q(nB)} = SUBSTR(${q(col)},INSTR(${q(col)},'${safeSep}')+${sep.length}) WHERE INSTR(${q(col)},'${safeSep}')>0;\nUPDATE ${qt(tbl)} SET ${q(nA)} = ${q(col)} WHERE INSTR(${q(col)},'${safeSep}')=0;`;
    }

    case 'add_column_formula': {
      const f = params.formula || '1';
      return `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(params.newName||'new_col')} REAL;\nUPDATE ${qt(tbl)} SET ${q(params.newName||'new_col')} = ${f};`;
    }

    case 'rename_multiple': {
      const renames = (params.renames||[]).filter(r => r.from && r.to && r.from !== r.to);
      if (!renames.length) return `-- rename_multiple: no renames configured`;
      return renames.map(r => `ALTER TABLE ${qt(tbl)} RENAME COLUMN ${q(r.from)} TO ${q(r.to)};`).join('\n');
    }

    case 'rename_column':
      if (!col || !params.newName) return `-- rename_column: missing column or new name`;
      return `ALTER TABLE ${qt(tbl)} RENAME COLUMN ${q(col)} TO ${q(params.newName)};`;

    case 'drop_column':
      if (!cols.length) return `-- drop_column: no columns specified`;
      return cols.map(c => `ALTER TABLE ${qt(tbl)} DROP COLUMN ${q(c)};`).join('\n');

    case 'change_type_numeric': {
      if (!cols.length) return `-- change_type_numeric: no columns specified`;
      const ts = Date.now();
      return cols.map(c => {
        const tmp = `__n_${c.replace(/[^a-z0-9]/gi,'').slice(0,15)}_${ts}`;
        return `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(tmp)} REAL;\nUPDATE ${qt(tbl)} SET ${q(tmp)}=CAST(${q(c)} AS REAL);\nALTER TABLE ${qt(tbl)} DROP COLUMN ${q(c)};\nALTER TABLE ${qt(tbl)} RENAME COLUMN ${q(tmp)} TO ${q(c)};`;
      }).join('\n\n');
    }

    case 'change_type_text': {
      if (!cols.length) return `-- change_type_text: no columns specified`;
      const ts = Date.now();
      return cols.map(c => {
        const tmp = `__t_${c.replace(/[^a-z0-9]/gi,'').slice(0,15)}_${ts}`;
        return `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(tmp)} TEXT;\nUPDATE ${qt(tbl)} SET ${q(tmp)}=CAST(${q(c)} AS TEXT);\nALTER TABLE ${qt(tbl)} DROP COLUMN ${q(c)};\nALTER TABLE ${qt(tbl)} RENAME COLUMN ${q(tmp)} TO ${q(c)};`;
      }).join('\n\n');
    }

    /* ── Rows ────────────────────────────────────────────────── */
    case 'filter_rows': {
      if (!col) return `-- filter_rows: no column specified`;
      const op  = params.operator || '=';
      const val = String(params.value ?? '').replace(/'/g, "''");
      const opMap = { '=':'=','!=':'!=','>':'>','<':'<','>=':'>=','<=':'<=','contains':'LIKE','not_contains':'NOT LIKE','starts_with':'LIKE','ends_with':'LIKE' };
      let ve;
      if (op==='contains'||op==='not_contains') ve = `'%${val}%'`;
      else if (op==='starts_with') ve = `'${val}%'`;
      else if (op==='ends_with')   ve = `'%${val}'`;
      else ve = `'${val}'`;
      return `DELETE FROM ${qt(tbl)} WHERE NOT (${q(col)} ${opMap[op]||'='} ${ve});`;
    }

    case 'remove_rows_condition': {
      if (!col) return `-- remove_rows_condition: no column specified`;
      const op  = ['=','!=','>','<','>=','<=','LIKE','NOT LIKE'].includes(params.operator) ? params.operator : '=';
      const val = String(params.value ?? '').replace(/'/g, "''");
      return `DELETE FROM ${qt(tbl)} WHERE ${q(col)} ${op} '${val}';`;
    }

    case 'sort_rows': {
      if (!cols.length) return `-- sort_rows: no columns specified`;
      const dir     = params.direction === 'DESC' ? 'DESC' : 'ASC';
      const sortTmp = `__sort_${tbl.replace(/[^a-z0-9]/gi,'').slice(0,20)}_${Date.now()}`;
      return `CREATE TABLE "${sortTmp}" AS SELECT * FROM ${qt(tbl)} ORDER BY ${cols.map(c=>q(c)).join(', ')} ${dir};\nDROP TABLE ${qt(tbl)};\nALTER TABLE "${sortTmp}" RENAME TO ${qt(tbl)};`;
    }

    case 'limit_rows':
      return `DELETE FROM ${qt(tbl)} WHERE rowid NOT IN (SELECT rowid FROM ${qt(tbl)} LIMIT ${Math.max(1,parseInt(params.n)||100)});`;

    case 'sample_rows':
      return `DELETE FROM ${qt(tbl)} WHERE rowid NOT IN (SELECT rowid FROM ${qt(tbl)} ORDER BY RANDOM() LIMIT ${Math.max(1,parseInt(params.n)||100)});`;

    case 'remove_duplicates':
      return `__REMOVE_DUPLICATES__${tbl}__`;

    case 'remove_duplicates_by_col': {
      if (!cols.length) return `-- remove_duplicates_by_col: no columns specified`;
      const kp = params.keep === 'last' ? 'MAX' : 'MIN';
      return `DELETE FROM ${qt(tbl)} WHERE rowid NOT IN (\n  SELECT ${kp}(rowid) FROM ${qt(tbl)} GROUP BY ${cols.map(c=>q(c)).join(', ')}\n);`;
    }

    /* ── Missing Data ────────────────────────────────────────── */
    case 'remove_nulls':
      if (!cols.length) return `-- remove_nulls: no columns specified`;
      return cols.map(c => `DELETE FROM ${qt(tbl)} WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))='';`).join('\n\n');

    case 'fill_mean':
      if (!cols.length) return `-- fill_mean: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=(SELECT ROUND(AVG(CAST(${q(c)} AS REAL)),10) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND TRIM(CAST(${q(c)} AS TEXT))!='') WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))='';`).join('\n\n');

    case 'fill_median':
      if (!cols.length) return `-- fill_median: no columns specified`;
      // FIX: true median = average of the two middle values.
      // OFFSET (COUNT-1)/2 → lower-middle index (floor)
      // OFFSET COUNT/2     → upper-middle index (ceil)
      // Odd n:  both offsets are identical → avg = the single middle value ✓
      // Even n: they differ by 1 → avg of the two middle values = true median ✓
      return cols.map(c => {
        const nonNull = `FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND TRIM(CAST(${q(c)} AS TEXT))!=''`;
        const cntSub  = `(SELECT COUNT(*) ${nonNull})`;
        const loSub   = `(SELECT CAST(${q(c)} AS REAL) ${nonNull} ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET (${cntSub}-1)/2)`;
        const hiSub   = `(SELECT CAST(${q(c)} AS REAL) ${nonNull} ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET ${cntSub}/2)`;
        return `UPDATE ${qt(tbl)} SET ${q(c)}=((${loSub})+(${hiSub}))/2.0 WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))='';`;
      }).join('\n\n');

    case 'fill_value': {
      if (!cols.length) return `-- fill_value: no columns specified`;
      return cols.map(c => { const v=String(params.value??'').replace(/'/g,"''"); return `UPDATE ${qt(tbl)} SET ${q(c)}='${v}' WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))='';`; }).join('\n\n');
    }

    case 'fill_mode':
      if (!cols.length) return `-- fill_mode: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=(SELECT ${q(c)} FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='' GROUP BY ${q(c)} ORDER BY COUNT(*) DESC LIMIT 1) WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))='';`).join('\n\n');

    case 'fill_forward':
      if (!cols.length) return `-- fill_forward: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=(SELECT t2.${q(c)} FROM ${qt(tbl)} t2 WHERE t2.rowid<${qt(tbl)}.rowid AND t2.${q(c)} IS NOT NULL AND t2.${q(c)}!='' ORDER BY t2.rowid DESC LIMIT 1) WHERE ${q(c)} IS NULL OR ${q(c)}='';`).join('\n\n');

    case 'fill_backward':
      if (!cols.length) return `-- fill_backward: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=(SELECT t2.${q(c)} FROM ${qt(tbl)} t2 WHERE t2.rowid>${qt(tbl)}.rowid AND t2.${q(c)} IS NOT NULL AND t2.${q(c)}!='' ORDER BY t2.rowid ASC LIMIT 1) WHERE ${q(c)} IS NULL OR ${q(c)}='';`).join('\n\n');

    case 'fill_constant_numeric': {
      if (!cols.length) return `-- fill_constant_numeric: no columns specified`;
      const cv = isNaN(parseFloat(params.constant)) ? 0 : parseFloat(params.constant);
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=${cv} WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))='';`).join('\n\n');
    }

    case 'fill_by_group': {
      if (!cols.length) return `-- fill_by_group: no columns specified`;
      const gc = params.groupColumn;
      if (!gc) return `-- fill_by_group: no groupColumn specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=(SELECT AVG(CAST(t2.${q(c)} AS REAL)) FROM ${qt(tbl)} t2 WHERE t2.${q(gc)}=${qt(tbl)}.${q(gc)} AND t2.${q(c)} IS NOT NULL AND TRIM(CAST(t2.${q(c)} AS TEXT))!='') WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))='';`).join('\n\n');
    }

    /* ── Encoding ────────────────────────────────────────────── */
    case 'label_encoding':
      if (!cols.length) return `-- label_encoding: no columns specified`;
      return cols.map(c =>
        `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_encoded')} INTEGER;\n` +
        `UPDATE ${qt(tbl)} SET ${q(c+'_encoded')}=(\n` +
        `  SELECT COUNT(DISTINCT t2.${q(c)}) FROM ${qt(tbl)} t2\n` +
        `  WHERE t2.${q(c)} < ${qt(tbl)}.${q(c)} AND t2.${q(c)} IS NOT NULL\n` +
        `);`
      ).join('\n\n');

    case 'one_hot_encoding':
      if (!cols.length) return `-- one_hot_encoding: no columns specified`;
      return cols.map(c => `__ONE_HOT__${tbl}__${c}__`).join('\n');

    case 'binary_encoding':
      if (!cols.length) return `-- binary_encoding: no columns specified`;
      return cols.map(c =>
        `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_is_mode')} INTEGER DEFAULT 0;\n` +
        `UPDATE ${qt(tbl)} SET ${q(c+'_is_mode')}=CASE\n` +
        `  WHEN ${q(c)}=(SELECT ${q(c)} FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='' GROUP BY ${q(c)} ORDER BY COUNT(*) DESC LIMIT 1)\n` +
        `  THEN 1 ELSE 0 END;`
      ).join('\n\n');

    /* ── Text ────────────────────────────────────────────────── */
    case 'lowercase':
      if (!cols.length) return `-- lowercase: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=LOWER(${q(c)}) WHERE ${q(c)} IS NOT NULL;`).join('\n\n');

    case 'uppercase':
      if (!cols.length) return `-- uppercase: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=UPPER(${q(c)}) WHERE ${q(c)} IS NOT NULL;`).join('\n\n');

    case 'trim':
      if (!cols.length) return `-- trim: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=TRIM(${q(c)}) WHERE ${q(c)} IS NOT NULL;`).join('\n\n');

    case 'capitalize':
      if (!cols.length) return `-- capitalize: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=UPPER(SUBSTR(${q(c)},1,1))||LOWER(SUBSTR(${q(c)},2)) WHERE ${q(c)} IS NOT NULL AND LENGTH(${q(c)})>0;`).join('\n\n');

    case 'replace_text': {
      if (!cols.length) return `-- replace_text: no columns specified`;
      const f = String(params.find??'').replace(/'/g,"''");
      const r = String(params.replace??'').replace(/'/g,"''");
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=REPLACE(${q(c)},'${f}','${r}') WHERE ${q(c)} IS NOT NULL;`).join('\n\n');
    }

    case 'remove_special_chars':
      if (!cols.length) return `-- remove_special_chars: no columns specified`;
      return cols.map(c => {
        // FIX: use char() for both single quote AND backslash to avoid SQL string issues
        const sqlChar = (ch) => {
          if (ch === "'")  return `char(39)`;  // single quote
          if (ch === "\\") return `char(92)`;  // backslash — '\\' in JS = one \ char
          return `'${ch}'`;
        };
        const buildGroup = (base, group) => {
          let expr = base;
          for (const ch of group) {
            expr = `REPLACE(${expr},${sqlChar(ch)},'')`;
          }
          return expr;
        };
        const groups = [
          ['!','@','#','$','%','^','&','*'],
          ['(',')','-','_','+','=','[',']'],
          ['{','}','\\',':',';','<','>','|'],  // backslash uses char(92), '|' moved here, no duplicate
          ['"','`','~',',','.','?','/'],         // removed duplicate '|'
        ];
        const stmts = groups.map(group => {
          const expr = buildGroup(q(c), group);
          return `UPDATE ${qt(tbl)} SET ${q(c)}=TRIM(${expr}) WHERE ${q(c)} IS NOT NULL`;
        });
        // Single quote gets its own dedicated pass
        stmts.push(`UPDATE ${qt(tbl)} SET ${q(c)}=TRIM(REPLACE(${q(c)},char(39),'')) WHERE ${q(c)} IS NOT NULL`);
        return stmts.join(';\n') + ';';
      }).join('\n\n');

    case 'remove_numbers':
      if (!cols.length) return `-- remove_numbers: no columns specified`;
      return cols.map(c => {
        let expr = q(c);
        for (const d of ['0','1','2','3','4','5','6','7','8','9']) {
          expr = `REPLACE(${expr},'${d}','')`;
        }
        return `UPDATE ${qt(tbl)} SET ${q(c)}=TRIM(${expr}) WHERE ${q(c)} IS NOT NULL;`;
      }).join('\n\n');

    case 'string_length':
      if (!cols.length) return `-- string_length: no columns specified`;
      return cols.map(c => `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_len')} INTEGER;\nUPDATE ${qt(tbl)} SET ${q(c+'_len')}=LENGTH(CAST(${q(c)} AS TEXT));`).join('\n\n');

    case 'string_replace_condition': {
      if (!cols.length) return `-- string_replace_condition: no columns specified`;
      const cond = String(params.condition??'').replace(/'/g,"''");
      const rep  = String(params.replacement??'').replace(/'/g,"''");
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}='${rep}' WHERE ${q(c)} LIKE '${cond}';`).join('\n\n');
    }

    /* ── Numeric ─────────────────────────────────────────────── */
    case 'normalize':
      if (!cols.length) return `-- normalize: no columns specified`;
      return cols.map(c =>
        `UPDATE ${qt(tbl)} SET ${q(c)}=(\n` +
        `  CAST(${q(c)} AS REAL) - (SELECT MIN(CAST(${q(c)} AS REAL)) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='')\n` +
        `) / NULLIF(\n` +
        `  (SELECT MAX(CAST(${q(c)} AS REAL)) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='') -\n` +
        `  (SELECT MIN(CAST(${q(c)} AS REAL)) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!=''),\n` +
        `0) WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='';`
      ).join('\n\n');

    case 'normalize_range': {
      if (!cols.length) return `-- normalize_range: no columns specified`;
      const lo = parseFloat(params.rangeMin ?? 0);
      const hi = parseFloat(params.rangeMax ?? 1);
      if (lo >= hi) return `-- normalize_range: rangeMin must be less than rangeMax`;
      return cols.map(c =>
        `UPDATE ${qt(tbl)} SET ${q(c)}=${lo} + (${hi} - ${lo}) * (\n` +
        `  CAST(${q(c)} AS REAL) - (SELECT MIN(CAST(${q(c)} AS REAL)) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='')\n` +
        `) / NULLIF(\n` +
        `  (SELECT MAX(CAST(${q(c)} AS REAL)) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='') -\n` +
        `  (SELECT MIN(CAST(${q(c)} AS REAL)) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!=''),\n` +
        `0) WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='';`
      ).join('\n\n');
    }

    // FIX: standardize using derived table subquery to avoid "misuse of aggregate function AVG()"
    // SQLite disallows AVG() in correlated scalar subqueries (even inside CTE).
    // Solution: wrap stats in a derived table so SQLite evaluates it non-correlated.
    case 'standardize':
      if (!cols.length) return `-- standardize: no columns specified`;
      return cols.map(c => {
        const meanSub = `(SELECT AVG(CAST(${q(c)} AS REAL)) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)} != '')`;
        const stdSub  =
          `(SELECT SQRT(AVG((v - m) * (v - m))) FROM (` +
            `SELECT CAST(${q(c)} AS REAL) AS v, ${meanSub} AS m ` +
            `FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)} != ''` +
          `))`;
        return (
          `UPDATE ${qt(tbl)} SET ${q(c)} =\n` +
          `  CASE\n` +
          `    WHEN ${stdSub} = 0 OR ${stdSub} IS NULL THEN 0\n` +
          `    ELSE (CAST(${q(c)} AS REAL) - ${meanSub}) / ${stdSub}\n` +
          `  END\n` +
          `WHERE ${q(c)} IS NOT NULL AND ${q(c)} != '';`
        );
      }).join('\n\n');

    case 'log_transform':
      if (!cols.length) return `-- log_transform: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=LOG(CAST(${q(c)} AS REAL)) WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='' AND CAST(${q(c)} AS REAL)>0;`).join('\n\n');

    case 'clip_values': {
      if (!cols.length) return `-- clip_values: no columns specified`;
      const lo    = params.clipMin, hi = params.clipMax;
      const hasLo = lo !== undefined && lo !== '' && lo !== null && !isNaN(parseFloat(lo));
      const hasHi = hi !== undefined && hi !== '' && hi !== null && !isNaN(parseFloat(hi));
      if (!hasLo && !hasHi) return `-- clip_values: specify at least clipMin or clipMax`;
      return cols.map(c => {
        const parts = [];
        if (hasLo) parts.push(`UPDATE ${qt(tbl)} SET ${q(c)}=${parseFloat(lo)} WHERE ${q(c)} IS NOT NULL AND CAST(${q(c)} AS REAL)<${parseFloat(lo)};`);
        if (hasHi) parts.push(`UPDATE ${qt(tbl)} SET ${q(c)}=${parseFloat(hi)} WHERE ${q(c)} IS NOT NULL AND CAST(${q(c)} AS REAL)>${parseFloat(hi)};`);
        return parts.join('\n');
      }).join('\n\n');
    }

    case 'absolute_value':
      if (!cols.length) return `-- absolute_value: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=ABS(CAST(${q(c)} AS REAL)) WHERE ${q(c)} IS NOT NULL;`).join('\n\n');

    case 'round_values':
      if (!cols.length) return `-- round_values: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=ROUND(CAST(${q(c)} AS REAL),${Math.max(0,parseInt(params.decimals??2)||0)}) WHERE ${q(c)} IS NOT NULL;`).join('\n\n');

    case 'floor_values':
      if (!cols.length) return `-- floor_values: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=FLOOR(CAST(${q(c)} AS REAL)) WHERE ${q(c)} IS NOT NULL;`).join('\n\n');

    // FIX: Added ceil_values (was missing entirely)
    case 'ceil_values':
      if (!cols.length) return `-- ceil_values: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=CEIL(CAST(${q(c)} AS REAL)) WHERE ${q(c)} IS NOT NULL;`).join('\n\n');

    case 'rank_column':
      if (!cols.length) return `-- rank_column: no columns specified`;
      return cols.map(c =>
        `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_rank')} INTEGER;\n` +
        `UPDATE ${qt(tbl)} SET ${q(c+'_rank')}=(\n` +
        `  SELECT COUNT(DISTINCT t2.${q(c)}) FROM ${qt(tbl)} t2\n` +
        `  WHERE CAST(t2.${q(c)} AS REAL) <= CAST(${qt(tbl)}.${q(c)} AS REAL)\n` +
        `);`
      ).join('\n\n');

    case 'percentile_column':
      if (!cols.length) return `-- percentile_column: no columns specified`;
      return cols.map(c =>
        `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_pct')} REAL;\n` +
        `UPDATE ${qt(tbl)} SET ${q(c+'_pct')}=ROUND(\n` +
        `  100.0 * (SELECT COUNT(*) FROM ${qt(tbl)} t2 WHERE CAST(t2.${q(c)} AS REAL) <= CAST(${qt(tbl)}.${q(c)} AS REAL))\n` +
        `  / (SELECT COUNT(*) FROM ${qt(tbl)}),\n` +
        `2);`
      ).join('\n\n');

    /* ── Outlier ─────────────────────────────────────────────── */
    case 'remove_outliers_iqr':
      if (!cols.length) return `-- remove_outliers_iqr: no columns specified`;
      // FIX: use OFFSET CAST((n-1)*p AS INT) instead of CAST(n*p AS INT).
      // n*0.75 systematically picks a value one position too high (overestimates Q3),
      // making the upper fence too wide and missing real outliers.
      // (n-1)*p is the standard nearest-rank formula for quartiles.
      return cols.map(c => {
        const cnt  = `(SELECT COUNT(*) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL)`;
        const q1   = `(SELECT CAST(${q(c)} AS REAL) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET CAST((${cnt}-1)*0.25 AS INT))`;
        const q3   = `(SELECT CAST(${q(c)} AS REAL) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET CAST((${cnt}-1)*0.75 AS INT))`;
        const bnds = `(SELECT ${q1} AS q1, ${q3} AS q3)`;
        return (
          `DELETE FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND (\n` +
          `  CAST(${q(c)} AS REAL) < (SELECT q1-1.5*(q3-q1) FROM ${bnds})\n` +
          `  OR CAST(${q(c)} AS REAL) > (SELECT q3+1.5*(q3-q1) FROM ${bnds})\n` +
          `);`
        );
      }).join('\n\n');

    case 'cap_outliers_iqr':
      if (!cols.length) return `-- cap_outliers_iqr: no columns specified`;
      return cols.map(c => {
        const cnt  = `(SELECT COUNT(*) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL)`;
        const q1   = `(SELECT CAST(${q(c)} AS REAL) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET CAST((${cnt}-1)*0.25 AS INT))`;
        const q3   = `(SELECT CAST(${q(c)} AS REAL) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET CAST((${cnt}-1)*0.75 AS INT))`;
        const bnds = `(SELECT ${q1} AS q1, ${q3} AS q3)`;
        return (
          `UPDATE ${qt(tbl)} SET ${q(c)}=(SELECT q1-1.5*(q3-q1) FROM ${bnds})\n` +
          `  WHERE ${q(c)} IS NOT NULL AND CAST(${q(c)} AS REAL)<(SELECT q1-1.5*(q3-q1) FROM ${bnds});\n` +
          `UPDATE ${qt(tbl)} SET ${q(c)}=(SELECT q3+1.5*(q3-q1) FROM ${bnds})\n` +
          `  WHERE ${q(c)} IS NOT NULL AND CAST(${q(c)} AS REAL)>(SELECT q3+1.5*(q3-q1) FROM ${bnds});`
        );
      }).join('\n\n');

    case 'detect_outliers_iqr':
      if (!cols.length) return `-- detect_outliers_iqr: no columns specified`;
      return cols.map(c => {
        const cnt  = `(SELECT COUNT(*) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL)`;
        const q1   = `(SELECT CAST(${q(c)} AS REAL) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET CAST((${cnt}-1)*0.25 AS INT))`;
        const q3   = `(SELECT CAST(${q(c)} AS REAL) FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET CAST((${cnt}-1)*0.75 AS INT))`;
        const bnds = `(SELECT ${q1} AS q1, ${q3} AS q3)`;
        return (
          `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_outlier')} INTEGER DEFAULT 0;\n` +
          `UPDATE ${qt(tbl)} SET ${q(c+'_outlier')}=1 WHERE ${q(c)} IS NOT NULL AND (\n` +
          `  CAST(${q(c)} AS REAL) < (SELECT q1-1.5*(q3-q1) FROM ${bnds})\n` +
          `  OR CAST(${q(c)} AS REAL) > (SELECT q3+1.5*(q3-q1) FROM ${bnds})\n` +
          `);`
        );
      }).join('\n\n');

    /* ── Binning ─────────────────────────────────────────────── */
    case 'bin_equal_width': {
      if (!col) return `-- bin_equal_width: no column specified`;
      const n   = Math.max(2, parseInt(params.bins) || 5);
      const out = params.outputCol || col+'_bin';
      return (
        `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(out)} INTEGER;\n` +
        `UPDATE ${qt(tbl)} SET ${q(out)} = CAST(\n` +
        `  CASE WHEN CAST(${q(col)} AS REAL) = (SELECT MAX(CAST(${q(col)} AS REAL)) FROM ${qt(tbl)})\n` +
        `    THEN ${n} - 1\n` +
        `    ELSE FLOOR(${n} * (\n` +
        `      CAST(${q(col)} AS REAL) - (SELECT MIN(CAST(${q(col)} AS REAL)) FROM ${qt(tbl)})\n` +
        `    ) / NULLIF(\n` +
        `      (SELECT MAX(CAST(${q(col)} AS REAL)) FROM ${qt(tbl)}) - (SELECT MIN(CAST(${q(col)} AS REAL)) FROM ${qt(tbl)}),\n` +
        `    0))\n` +
        `  END\n` +
        `AS INTEGER) WHERE ${q(col)} IS NOT NULL AND ${q(col)} != '';`
      );
    }

    // FIX: bin_custom
    // - defensively parses edges (string or array)
    // - supports optional labels for each bin
    // - last bin is open-ended (>= lo) so values at/above last edge don't become NULL
    // - output column type TEXT when labels given, INTEGER otherwise
    case 'bin_custom': {
      if (!col) return `-- bin_custom: no column specified`;
      let rawEdges = params.edges ?? [];
      if (typeof rawEdges === 'string') {
        rawEdges = rawEdges.split(',').map(s => s.trim()).filter(Boolean);
      }
      const edges = rawEdges.map(Number).filter(e => isFinite(e));
      if (edges.length < 2) return `-- bin_custom: need at least 2 edge values`;

      // Optional labels — one per bin (edges.length - 1 bins)
      let rawLabels = params.labels ?? [];
      if (typeof rawLabels === 'string') {
        rawLabels = rawLabels.split(',').map(s => s.trim()).filter(Boolean);
      }
      const hasLabels = rawLabels.length > 0;

      const out  = params.outputCol || col + '_bin';
      const type = hasLabels ? 'TEXT' : 'INTEGER';

      const cases = edges.slice(0, -1).map((e, i) => {
        const isLast = i === edges.length - 2;
        const value  = hasLabels
          ? (rawLabels[i] != null ? `'${String(rawLabels[i]).replace(/'/g, "''")}'` : `'bin_${i}'`)
          : String(i);
        // Last bin: open-ended (>= lo) so values above the last edge aren't NULL
        const cond = isLast
          ? `CAST(${q(col)} AS REAL) >= ${e}`
          : `CAST(${q(col)} AS REAL) >= ${e} AND CAST(${q(col)} AS REAL) < ${edges[i + 1]}`;
        return `    WHEN ${cond} THEN ${value}`;
      }).join('\n');

      return (
        `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(out)} ${type};\n` +
        `UPDATE ${qt(tbl)} SET ${q(out)} = CASE\n${cases}\n    ELSE NULL\n  END ` +
        `WHERE ${q(col)} IS NOT NULL AND ${q(col)} != '';`
      );
    }

    /* ── Aggregation ─────────────────────────────────────────── */
    case 'group_agg': {
      const gc     = params.groupColumn || col;
      const vc     = params.valueColumn || '';
      const aggFn  = ['AVG','SUM','COUNT','MIN','MAX'].includes((params.aggFunction||'').toUpperCase()) ? params.aggFunction.toUpperCase() : 'AVG';
      if (!gc) return `-- group_agg: no groupColumn specified`;
      const aggTmp  = `__agg_${tbl.replace(/[^a-z0-9]/gi,'').slice(0,20)}_${Date.now()}`;
      const valExpr = vc
        ? `${aggFn}(CAST(${q(vc)} AS REAL)) AS "${vc}_${aggFn.toLowerCase()}", COUNT(*) AS row_count`
        : `COUNT(*) AS row_count`;
      return `CREATE TABLE "${aggTmp}" AS\n  SELECT ${q(gc)}, ${valExpr}\n  FROM ${qt(tbl)} WHERE ${q(gc)} IS NOT NULL GROUP BY ${q(gc)} ORDER BY 2 DESC;\nDROP TABLE ${qt(tbl)};\nALTER TABLE "${aggTmp}" RENAME TO ${qt(tbl)};`;
    }

    /* ── Boolean / Condition ─────────────────────────────────── */
    case 'create_flag': {
      if (!col) return `-- create_flag: no column specified`;
      const op  = ['=','!=','>','<','>=','<='].includes(params.operator) ? params.operator : '=';
      const val = String(params.value??'').replace(/'/g,"''");
      const out = params.flagName || col+'_flag';
      return `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(out)} INTEGER DEFAULT 0;\nUPDATE ${qt(tbl)} SET ${q(out)}=1 WHERE ${q(col)} ${op} '${val}';`;
    }

    case 'conditional_replace': {
      if (!col) return `-- conditional_replace: no column specified`;
      const op   = ['=','!=','LIKE','NOT LIKE'].includes(params.condOp) ? params.condOp : '=';
      const cond = String(params.condition??'').replace(/'/g,"''");
      const rep  = String(params.replacement??'').replace(/'/g,"''");
      return `UPDATE ${qt(tbl)} SET ${q(col)}='${rep}' WHERE ${q(col)} ${op} '${cond}';`;
    }

    /* ── Date ────────────────────────────────────────────────── */
    case 'extract_year':
      if (!cols.length) return `-- extract_year: no columns specified`;
      return cols.map(c => `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_year')} INTEGER;\nUPDATE ${qt(tbl)} SET ${q(c+'_year')}=CAST(strftime('%Y',${q(c)}) AS INTEGER) WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='';`).join('\n\n');

    case 'extract_month':
      if (!cols.length) return `-- extract_month: no columns specified`;
      return cols.map(c => `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_month')} INTEGER;\nUPDATE ${qt(tbl)} SET ${q(c+'_month')}=CAST(strftime('%m',${q(c)}) AS INTEGER) WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='';`).join('\n\n');

    case 'extract_day':
      if (!cols.length) return `-- extract_day: no columns specified`;
      return cols.map(c => `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_day')} INTEGER;\nUPDATE ${qt(tbl)} SET ${q(c+'_day')}=CAST(strftime('%d',${q(c)}) AS INTEGER) WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='';`).join('\n\n');

    case 'extract_weekday':
      if (!cols.length) return `-- extract_weekday: no columns specified`;
      return cols.map(c => `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_weekday')} INTEGER;\nUPDATE ${qt(tbl)} SET ${q(c+'_weekday')}=CAST(strftime('%w',${q(c)}) AS INTEGER) WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='';`).join('\n\n');

    case 'extract_hour':
      if (!cols.length) return `-- extract_hour: no columns specified`;
      return cols.map(c => `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_hour')} INTEGER;\nUPDATE ${qt(tbl)} SET ${q(c+'_hour')}=CAST(strftime('%H',${q(c)}) AS INTEGER) WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='';`).join('\n\n');

    case 'extract_quarter':
      if (!cols.length) return `-- extract_quarter: no columns specified`;
      return cols.map(c =>
        `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(c+'_quarter')} INTEGER;\n` +
        `UPDATE ${qt(tbl)} SET ${q(c+'_quarter')}=\n` +
        `  (CAST(strftime('%m',${q(c)}) AS INTEGER) + 2) / 3\n` +
        `  WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='';`
      ).join('\n\n');

    case 'convert_to_date':
      if (!cols.length) return `-- convert_to_date: no columns specified`;
      return cols.map(c => `UPDATE ${qt(tbl)} SET ${q(c)}=DATE(${q(c)}) WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='';`).join('\n\n');

    case 'date_diff': {
      if (!col) return `-- date_diff: no column specified`;
      const cB  = params.columnB;
      if (!cB)  return `-- date_diff: no columnB specified`;
      const out = params.outputCol || 'date_diff';
      return `ALTER TABLE ${qt(tbl)} ADD COLUMN ${q(out)} INTEGER;\nUPDATE ${qt(tbl)} SET ${q(out)}=CAST(julianday(${q(col)})-julianday(${q(cB)}) AS INTEGER) WHERE ${q(col)} IS NOT NULL AND ${q(col)}!='' AND ${q(cB)} IS NOT NULL AND ${q(cB)}!='';`;
    }

    default: return `-- Unsupported: ${opId}`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   PYTHON GENERATOR
   ═══════════════════════════════════════════════════════════════ */
export function generatePython(opId, params) {
  const cols = params.columns?.length ? params.columns : (params.column ? [params.column] : []);
  const col  = cols[0] || '';
  const df   = 'df';
  const cs   = JSON.stringify(cols);

  const py = {
    // ── Column ───────────────────────────────────────────────
    select_columns:    () =>
      `# Keep only specified columns, drop the rest\n${df} = ${df}[${cs}]`,

    duplicate_column:  () =>
      `# Create a copy of column "${col}"\n${df}["${col}_copy"] = ${df}["${col}"]`,

    merge_columns:     () =>
      `# Merge columns into one, separated by "${params.separator||' '}", ignore nulls\n` +
      `${df}["${params.newName||'merged'}"] = ${cols.map(c=>`${df}["${c}"].fillna('').astype(str)`).join(`.str.cat(sep="${(params.separator||' ').replace(/"/g,'\\"')}")`)}` +
      `\n${df}["${params.newName||'merged'}"] = ${df}["${params.newName||'merged'}"].str.strip()`,

    split_column:      () =>
      `# Split "${col}" on "${params.separator||' '}" into two new columns (first occurrence only)\n` +
      `${df}[["${params.nameLeft||col+'_1'}","${params.nameRight||col+'_2'}"]] = ` +
      `${df}["${col}"].str.split("${(params.separator||' ').replace(/"/g,'\\"')}", n=1, expand=True)`,

    add_column_formula:() =>
      `# Add new column "${params.newName||'new_col'}" computed from formula\n` +
      `# Note: formula uses Python/pandas syntax, not SQL syntax\n` +
      `${df}["${params.newName||'new_col'}"] = ${params.formula||'1'}`,

    rename_multiple:   () => {
      const renames = (params.renames||[]).filter(r=>r.from&&r.to&&r.from!==r.to);
      const mapping = renames.map(r=>`"${r.from}":"${r.to}"`).join(', ');
      return `# Rename multiple columns at once\n${df} = ${df}.rename(columns={${mapping}})`;
    },

    rename_column:     () =>
      `# Rename column "${col}" to "${params.newName}"\n` +
      `${df} = ${df}.rename(columns={"${col}": "${params.newName}"})`,

    drop_column:       () =>
      `# Drop column(s): ${cols.join(', ')}\n${df} = ${df}.drop(columns=${cs})`,

    change_type_numeric: () =>
      `# Convert columns to numeric; non-numeric values become NaN\n` +
      cols.map(c=>`${df}["${c}"] = pd.to_numeric(${df}["${c}"], errors="coerce")`).join('\n'),

    change_type_text:  () =>
      `# Convert columns to string type\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].astype(str)`).join('\n'),

    // ── Rows ─────────────────────────────────────────────────
    filter_rows: () => {
      const op = params.operator||'=';
      const v  = JSON.stringify(params.value||'');
      let expr;
      if (op==='contains')     expr = `${df}["${col}"].astype(str).str.contains(${v}, na=False)`;
      else if (op==='not_contains') expr = `~${df}["${col}"].astype(str).str.contains(${v}, na=False)`;
      else if (op==='starts_with')  expr = `${df}["${col}"].astype(str).str.startswith(${v})`;
      else if (op==='ends_with')    expr = `${df}["${col}"].astype(str).str.endswith(${v})`;
      else expr = `${df}["${col}"] ${op==='='?'==':op} ${v}`;
      return `# Keep only rows where ${col} ${op} ${params.value}\n${df} = ${df}[${expr}]`;
    },

    remove_rows_condition: () =>
      `# Remove rows where "${col}" equals "${params.value}"\n` +
      `${df} = ${df}[~(${df}["${col}"].astype(str) == ${JSON.stringify(String(params.value??''))})]`,

    sort_rows:         () =>
      `# Sort by [${cols.join(', ')}] ${params.direction==='DESC'?'descending':'ascending'}\n` +
      `${df} = ${df}.sort_values(by=${cs}, ascending=${params.direction==='DESC'?'False':'True'}).reset_index(drop=True)`,

    limit_rows:        () =>
      `# Keep only the first ${params.n||100} rows\n${df} = ${df}.head(${params.n||100})`,

    sample_rows:       () =>
      `# Random sample of ${params.n||100} rows (reproducible with random_state=42)\n` +
      `${df} = ${df}.sample(n=min(${params.n||100}, len(${df})), random_state=42).reset_index(drop=True)`,

    remove_duplicates: () =>
      `# Remove all fully duplicate rows (all columns must match)\n${df} = ${df}.drop_duplicates()`,

    remove_duplicates_by_col: () =>
      `# Remove duplicates based on [${cols.join(', ')}], keep "${params.keep||'first'}"\n` +
      `${df} = ${df}.drop_duplicates(subset=${cs}, keep="${params.keep||'first'}")`,

    // ── Missing Data ──────────────────────────────────────────
    remove_nulls: () =>
      `# Remove rows where any of [${cols.join(', ')}] is null/empty\n` +
      `${df} = ${df}.dropna(subset=${cs})`,

    fill_mean: () =>
      `# Fill missing values in [${cols.join(', ')}] with column mean\n` +
      cols.map(c =>
        `${df}["${c}"] = pd.to_numeric(${df}["${c}"], errors="coerce")\n` +
        `${df}["${c}"] = ${df}["${c}"].fillna(${df}["${c}"].mean())`
      ).join('\n'),

    fill_median: () =>
      `# Fill missing values in [${cols.join(', ')}] with column median\n` +
      cols.map(c =>
        `${df}["${c}"] = pd.to_numeric(${df}["${c}"], errors="coerce")\n` +
        `${df}["${c}"] = ${df}["${c}"].fillna(${df}["${c}"].median())`
      ).join('\n'),

    fill_value: () =>
      `# Fill missing values in [${cols.join(', ')}] with constant "${params.value}"\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].fillna(${JSON.stringify(params.value??'')})`).join('\n'),

    fill_mode: () =>
      `# Fill missing values in [${cols.join(', ')}] with column mode (most frequent)\n` +
      cols.map(c =>
        `_mode_${c.replace(/\W/g,'_')} = ${df}["${c}"].mode()\n` +
        `${df}["${c}"] = ${df}["${c}"].fillna(_mode_${c.replace(/\W/g,'_')}.iloc[0] if not _mode_${c.replace(/\W/g,'_')}.empty else ${df}["${c}"])`
      ).join('\n'),

    fill_forward: () =>
      `# Forward fill: propagate last valid value downward\n` +
      `# NOTE: order matters — sort the dataframe first if needed\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].ffill()`).join('\n'),

    fill_backward: () =>
      `# Backward fill: propagate next valid value upward\n` +
      `# NOTE: order matters — sort the dataframe first if needed\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].bfill()`).join('\n'),

    fill_constant_numeric: () =>
      `# Fill missing numeric values in [${cols.join(', ')}] with ${isNaN(parseFloat(params.constant))?0:parseFloat(params.constant)}\n` +
      cols.map(c =>
        `${df}["${c}"] = pd.to_numeric(${df}["${c}"], errors="coerce").fillna(${isNaN(parseFloat(params.constant))?0:parseFloat(params.constant)})`
      ).join('\n'),

    fill_by_group: () =>
      `# Fill missing values using the mean of each group in "${params.groupColumn}"\n` +
      cols.map(c =>
        `${df}["${c}"] = ${df}.groupby("${params.groupColumn}")["${c}"].transform(lambda x: x.fillna(x.mean()))`
      ).join('\n'),

    // ── Encoding ─────────────────────────────────────────────
    label_encoding: () =>
      `# Label encoding: assigns integer based on alphabetical order of distinct values\n` +
      `from sklearn.preprocessing import LabelEncoder\n` +
      cols.map(c=>`${df}["${c}_encoded"] = LabelEncoder().fit_transform(${df}["${c}"].astype(str))`).join('\n'),

    one_hot_encoding: () =>
      `# One-hot encoding: create binary column per category\n` +
      `${df} = pd.get_dummies(${df}, columns=${cs}, prefix=${cs}, dtype=int)`,

    binary_encoding: () =>
      `# Binary flag: 1 if value equals the most frequent category (mode), else 0\n` +
      cols.map(c =>
        `_mode_val_${c.replace(/\W/g,'_')} = ${df}["${c}"].mode().iloc[0]\n` +
        `${df}["${c}_is_mode"] = (${df}["${c}"] == _mode_val_${c.replace(/\W/g,'_')}).astype(int)`
      ).join('\n'),

    // ── Text ─────────────────────────────────────────────────
    lowercase: () =>
      `# Convert text to lowercase\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].astype(str).str.lower()`).join('\n'),

    uppercase: () =>
      `# Convert text to uppercase\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].astype(str).str.upper()`).join('\n'),

    capitalize: () =>
      `# Capitalize first letter of each value\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].astype(str).str.capitalize()`).join('\n'),

    trim: () =>
      `# Remove leading and trailing whitespace\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].astype(str).str.strip()`).join('\n'),

    replace_text: () =>
      `# Find "${params.find}" and replace with "${params.replace}" (exact match, not regex)\n` +
      cols.map(c=>
        `${df}["${c}"] = ${df}["${c}"].astype(str).str.replace(${JSON.stringify(params.find||'')}, ${JSON.stringify(params.replace||'')}, regex=False)`
      ).join('\n'),

    remove_special_chars: () =>
      `# Remove special characters, keep only alphanumeric and whitespace\n` +
      cols.map(c=>
        `${df}["${c}"] = ${df}["${c}"].astype(str).str.replace(r'[^\\w\\s]', '', regex=True).str.strip()`
      ).join('\n'),

    remove_numbers: () =>
      `# Remove all digit characters from text\n` +
      cols.map(c=>
        `${df}["${c}"] = ${df}["${c}"].astype(str).str.replace(r'\\d', '', regex=True).str.strip()`
      ).join('\n'),

    string_length: () =>
      `# Compute string length of each value, store in new column\n` +
      cols.map(c=>`${df}["${c}_len"] = ${df}["${c}"].astype(str).str.len()`).join('\n'),

    string_replace_condition: () =>
      `# Replace value in column if it contains the condition pattern\n` +
      cols.map(c=>
        `${df}.loc[${df}["${c}"].astype(str).str.contains(${JSON.stringify(params.condition||'')}, na=False), "${c}"] = ${JSON.stringify(params.replacement||'')}`
      ).join('\n'),

    // ── Numeric ───────────────────────────────────────────────
    normalize: () =>
      `# Min-max normalize to [0, 1]\n` +
      `from sklearn.preprocessing import MinMaxScaler\n` +
      `_scaler = MinMaxScaler()\n` +
      cols.map(c=>
        `${df}["${c}"] = _scaler.fit_transform(${df}[["${c}"]]).flatten()`
      ).join('\n'),

    normalize_range: () =>
      `# Scale values to [${params.rangeMin??0}, ${params.rangeMax??1}]\n` +
      cols.map(c=>
        `_mn, _mx = ${df}["${c}"].min(), ${df}["${c}"].max()\n` +
        `${df}["${c}"] = ${params.rangeMin??0} + (${params.rangeMax??1} - ${params.rangeMin??0}) * (${df}["${c}"] - _mn) / (_mx - _mn + 1e-9)`
      ).join('\n'),

    standardize: () =>
      `# Z-score standardize: subtract mean, divide by std dev\n` +
      `from sklearn.preprocessing import StandardScaler\n` +
      `_scaler = StandardScaler()\n` +
      cols.map(c=>
        `${df}["${c}"] = _scaler.fit_transform(${df}[["${c}"]]).flatten()`
      ).join('\n'),

    log_transform: () =>
      `# Natural log (ln) transform — clips values to 1e-9 minimum to avoid log(0)\n` +
      `import numpy as np\n` +
      cols.map(c=>
        `${df}["${c}"] = np.log(pd.to_numeric(${df}["${c}"], errors="coerce").clip(lower=1e-9))`
      ).join('\n'),

    clip_values: () =>
      `# Clip values to [${params.clipMin??'-inf'}, ${params.clipMax??'+inf'}] range\n` +
      cols.map(c=>
        `${df}["${c}"] = ${df}["${c}"].clip(${params.clipMin!==undefined&&params.clipMin!==''?params.clipMin:'None'}, ${params.clipMax!==undefined&&params.clipMax!==''?params.clipMax:'None'})`
      ).join('\n'),

    absolute_value: () =>
      `# Replace values with their absolute value\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].abs()`).join('\n'),

    round_values: () =>
      `# Round to ${params.decimals??2} decimal places\n` +
      cols.map(c=>`${df}["${c}"] = ${df}["${c}"].round(${params.decimals??2})`).join('\n'),

    floor_values: () =>
      `# Floor: round down to nearest integer\n` +
      `import numpy as np\n` +
      cols.map(c=>
        `${df}["${c}"] = np.floor(pd.to_numeric(${df}["${c}"], errors="coerce"))`
      ).join('\n'),

    // FIX: Added ceil_values (was missing entirely)
    ceil_values: () =>
      `# Ceil: round up to nearest integer\n` +
      `import numpy as np\n` +
      cols.map(c=>
        `${df}["${c}"] = np.ceil(pd.to_numeric(${df}["${c}"], errors="coerce"))`
      ).join('\n'),

    rank_column: () =>
      `# Dense rank: ties get the same rank, no gaps in ranking\n` +
      cols.map(c=>
        `${df}["${c}_rank"] = ${df}["${c}"].rank(method="dense").astype(int)`
      ).join('\n'),

    percentile_column: () =>
      `# Compute percentile rank (0–100) for each value\n` +
      cols.map(c=>
        `${df}["${c}_pct"] = ${df}["${c}"].rank(pct=True).mul(100).round(2)`
      ).join('\n'),

    // ── Outlier ───────────────────────────────────────────────
    remove_outliers_iqr: () =>
      `# Remove rows with outliers using IQR method (Q1-1.5*IQR to Q3+1.5*IQR)\n` +
      cols.map(c=>
        `_Q1, _Q3 = ${df}["${c}"].quantile(0.25), ${df}["${c}"].quantile(0.75)\n` +
        `_IQR = _Q3 - _Q1\n` +
        `${df} = ${df}[(${df}["${c}"] >= _Q1 - 1.5*_IQR) & (${df}["${c}"] <= _Q3 + 1.5*_IQR)]`
      ).join('\n'),

    cap_outliers_iqr: () =>
      `# Winsorize (cap) outliers at IQR fences — values beyond fences are clipped\n` +
      cols.map(c=>
        `_Q1, _Q3 = ${df}["${c}"].quantile(0.25), ${df}["${c}"].quantile(0.75)\n` +
        `_IQR = _Q3 - _Q1\n` +
        `${df}["${c}"] = ${df}["${c}"].clip(_Q1 - 1.5*_IQR, _Q3 + 1.5*_IQR)`
      ).join('\n'),

    detect_outliers_iqr: () =>
      `# Flag outliers: 1 if value is outside IQR fences, 0 otherwise\n` +
      cols.map(c=>
        `_Q1, _Q3 = ${df}["${c}"].quantile(0.25), ${df}["${c}"].quantile(0.75)\n` +
        `_IQR = _Q3 - _Q1\n` +
        `${df}["${c}_outlier"] = (~${df}["${c}"].between(_Q1 - 1.5*_IQR, _Q3 + 1.5*_IQR)).astype(int)`
      ).join('\n'),

    // ── Binning ───────────────────────────────────────────────
    bin_equal_width: () =>
      `# Equal-width binning into ${params.bins||5} bins; result stored in new column\n` +
      `${df}["${params.outputCol||col+'_bin'}"] = pd.cut(\n` +
      `  pd.to_numeric(${df}["${col}"], errors="coerce"),\n` +
      `  bins=${Math.max(2,parseInt(params.bins)||5)},\n` +
      `  labels=False\n` +
      `)`,

    bin_custom: () => {
      let rawEdges = params.edges ?? [];
      if (typeof rawEdges === 'string') {
        rawEdges = rawEdges.split(',').map(s => s.trim()).filter(Boolean);
      }
      const edges = rawEdges.map(Number).filter(e => isFinite(e));

      let rawLabels = params.labels ?? [];
      if (typeof rawLabels === 'string') {
        rawLabels = rawLabels.split(',').map(s => s.trim()).filter(Boolean);
      }
      const hasLabels = rawLabels.length > 0;
      const labelsArg = hasLabels ? JSON.stringify(rawLabels) : 'False';

      const out = params.outputCol || col + '_bin';
      return (
        `# Custom binning: edges ${JSON.stringify(edges)}${hasLabels ? ', labels: ' + JSON.stringify(rawLabels) : ''}\n` +
        `${df}["${out}"] = pd.cut(\n` +
        `  pd.to_numeric(${df}["${col}"], errors="coerce"),\n` +
        `  bins=${JSON.stringify(edges)},\n` +
        `  labels=${labelsArg},\n` +
        `  include_lowest=True,  # last bin is inclusive on both ends\n` +
        `  right=True\n` +
        `)`
      );
    },

    // ── Aggregation ───────────────────────────────────────────
    group_agg: () => {
      const fn = (params.aggFunction||'mean').toLowerCase();
      const vc = params.valueColumn;
      if (vc) return (
        `# Group by "${params.groupColumn||col}", compute ${fn.toUpperCase()} of "${vc}"\n` +
        `result = ${df}.groupby("${params.groupColumn||col}")["${vc}"].${fn}().reset_index()\n` +
        `result.columns = ["${params.groupColumn||col}", "${vc}_${fn}"]\n` +
        `print(result)`
      );
      return (
        `# Count rows per group in "${params.groupColumn||col}"\n` +
        `result = ${df}.groupby("${params.groupColumn||col}").size().reset_index(name="count")\n` +
        `print(result)`
      );
    },

    // ── Boolean / Condition ───────────────────────────────────
    create_flag: () =>
      `# Create binary flag column: 1 where ${col} ${params.operator||'='} "${params.value}", else 0\n` +
      `${df}["${params.flagName||col+'_flag'}"] = (${df}["${col}"].astype(str) == ${JSON.stringify(String(params.value??''))}).astype(int)`,

    conditional_replace: () =>
      `# Replace value in "${col}" where it ${params.condOp||'='} "${params.condition}"\n` +
      `${df}.loc[${df}["${col}"].astype(str) == ${JSON.stringify(String(params.condition??''))}, "${col}"] = ${JSON.stringify(params.replacement??'')}`,

    // ── Date ──────────────────────────────────────────────────
    extract_year: () =>
      `# Extract year from date column(s) into new column(s)\n` +
      cols.map(c=>`${df}["${c}_year"] = pd.to_datetime(${df}["${c}"], errors="coerce").dt.year`).join('\n'),

    extract_month: () =>
      `# Extract month (1–12) from date column(s) into new column(s)\n` +
      cols.map(c=>`${df}["${c}_month"] = pd.to_datetime(${df}["${c}"], errors="coerce").dt.month`).join('\n'),

    extract_day: () =>
      `# Extract day of month (1–31) from date column(s) into new column(s)\n` +
      cols.map(c=>`${df}["${c}_day"] = pd.to_datetime(${df}["${c}"], errors="coerce").dt.day`).join('\n'),

    extract_weekday: () =>
      `# Extract weekday (0=Monday, 6=Sunday) from date column(s) into new column(s)\n` +
      cols.map(c=>`${df}["${c}_weekday"] = pd.to_datetime(${df}["${c}"], errors="coerce").dt.weekday`).join('\n'),

    extract_hour: () =>
      `# Extract hour (0–23) from datetime column(s) into new column(s)\n` +
      cols.map(c=>`${df}["${c}_hour"] = pd.to_datetime(${df}["${c}"], errors="coerce").dt.hour`).join('\n'),

    extract_quarter: () =>
      `# Extract quarter (1–4) from date column(s) into new column(s)\n` +
      cols.map(c=>`${df}["${c}_quarter"] = pd.to_datetime(${df}["${c}"], errors="coerce").dt.quarter`).join('\n'),

    convert_to_date: () =>
      `# Parse column(s) as datetime (invalid values become NaT)\n` +
      cols.map(c=>`${df}["${c}"] = pd.to_datetime(${df}["${c}"], errors="coerce")`).join('\n'),

    date_diff: () =>
      `# Compute difference in days between "${col}" and "${params.columnB||''}"\n` +
      `${df}["${params.outputCol||'date_diff'}"] = (\n` +
      `  pd.to_datetime(${df}["${col}"], errors="coerce") -\n` +
      `  pd.to_datetime(${df}["${params.columnB||''}"], errors="coerce")\n` +
      `).dt.days`,
  };

  return py[opId] ? py[opId]() : `# ${opId}: not implemented`;
}

/* ── Op info ─────────────────────────────────────────────────── */
export function getOpInfo(db, tbl, opId, params) {
  const cols = params.columns?.length ? params.columns : (params.column ? [params.column] : []);
  try {
    const total = db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)}`).get().c;
    if (opId === 'remove_nulls' && cols.length) {
      const parts = cols.map(c => { const n=db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)} WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))=''`).get().c; return `${c}: ${n} nulls`; });
      return `Remove nulls — ${parts.join(' | ')}`;
    }
    if (opId === 'fill_mean' && cols.length) {
      const parts = cols.map(c => { const n=db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)} WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))=''`).get().c; const avg=db.prepare(`SELECT ROUND(AVG(CAST(${q(c)} AS REAL)),4) as a FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!=''`).get().a; return `${c}: fill ${n} → mean=${avg}`; });
      return parts.join(' | ');
    }
    if (opId === 'fill_median' && cols.length) {
      const parts = cols.map(c => {
        const nullCount = db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)} WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))=''`).get().c;
        const cnt = db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!=''`).get().c;
        const loVal = db.prepare(`SELECT CAST(${q(c)} AS REAL) as v FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='' ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET ${Math.floor((cnt-1)/2)}`).get()?.v;
        const hiVal = db.prepare(`SELECT CAST(${q(c)} AS REAL) as v FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND ${q(c)}!='' ORDER BY CAST(${q(c)} AS REAL) LIMIT 1 OFFSET ${Math.floor(cnt/2)}`).get()?.v;
        const med = (loVal != null && hiVal != null) ? parseFloat(((loVal + hiVal) / 2).toFixed(4)) : null;
        return `${c}: fill ${nullCount} → median=${med ?? 'N/A'}`;
      });
      return parts.join(' | ');
    }
    if (opId === 'fill_value' && cols.length) {
      const parts = cols.map(c => { const n=db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)} WHERE ${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS TEXT))=''`).get().c; return `${c}: fill ${n} → "${params.value}"`; });
      return parts.join(' | ');
    }
    if (opId === 'remove_duplicates') {
      const ac=allColList(db,tbl), uniq=db.prepare(`SELECT COUNT(*) as c FROM (SELECT MIN(rowid) FROM ${qt(tbl)} GROUP BY ${ac})`).get().c;
      return `Remove ${total-uniq} duplicate rows (keep ${uniq} of ${total})`;
    }
    if (opId === 'remove_duplicates_by_col' && cols.length) {
      const sc=cols.map(c=>q(c)).join(','), uniq=db.prepare(`SELECT COUNT(*) as c FROM (SELECT MIN(rowid) FROM ${qt(tbl)} GROUP BY ${sc})`).get().c;
      return `Remove ${total-uniq} dupes by [${cols.join(', ')}]`;
    }
    if (opId === 'one_hot_encoding' && cols.length) {
      const parts = cols.map(c => { const cnt=db.prepare(`SELECT COUNT(DISTINCT CAST(${q(c)} AS TEXT)) as c FROM ${qt(tbl)} WHERE ${q(c)} IS NOT NULL AND TRIM(CAST(${q(c)} AS TEXT))!=''`).get().c; return `${c}: ${cnt} categories → ${cnt} new columns`; });
      return parts.join(' | ');
    }
    if (opId === 'rename_multiple') {
      const renames=(params.renames||[]).filter(r=>r.from&&r.to&&r.from!==r.to);
      return renames.length ? `Rename ${renames.length} column(s): ${renames.map(r=>`${r.from}→${r.to}`).join(', ')}` : 'No renames configured';
    }
    if (opId === 'clip_values' && cols.length) return `Clip [${cols.join(', ')}] → [${params.clipMin??'-∞'}, ${params.clipMax??'+∞'}]`;
    if (opId === 'filter_rows' && cols.length) return `Filter: ${cols[0]} ${params.operator||'='} "${params.value}" (${total} rows before)`;
    if (opId === 'limit_rows')  return `Keep first ${params.n||100} of ${total} rows`;
    if (opId === 'sample_rows') return `Sample ${params.n||100} from ${total} rows`;
    return cols.length ? `Apply ${opId} to [${cols.join(', ')}]` : `Apply ${opId}`;
  } catch { return `Apply ${opId}`; }
}

/* ── Profiling ───────────────────────────────────────────────── */
function profileColumn(db, tbl, col, type) {
  const total = db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)}`).get().c;
  if (!total) return null;
  const nulls = db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)} WHERE ${q(col)} IS NULL OR TRIM(CAST(${q(col)} AS TEXT))=''`).get().c;
  const uniq  = db.prepare(`SELECT COUNT(DISTINCT ${q(col)}) as c FROM ${qt(tbl)} WHERE ${q(col)} IS NOT NULL AND ${q(col)}!=''`).get().c;
  const p = { name:col, type, totalRows:total, nullCount:nulls, nullPct:parseFloat(((nulls/total)*100).toFixed(1)), uniqueCount:uniq, uniqueRatio:parseFloat((uniq/Math.max(total-nulls,1)).toFixed(3)) };
  if (type==='integer'||type==='real') {
    try {
      const st=db.prepare(`SELECT MIN(CAST(${q(col)} AS REAL)) as mn,MAX(CAST(${q(col)} AS REAL)) as mx,AVG(CAST(${q(col)} AS REAL)) as avg,COUNT(*) as cnt FROM ${qt(tbl)} WHERE ${q(col)} IS NOT NULL AND ${q(col)}!=''`).get();
      p.min=st.mn; p.max=st.mx; p.mean=parseFloat((st.avg||0).toFixed(4));
      const q1r=db.prepare(`SELECT CAST(${q(col)} AS REAL) as v FROM ${qt(tbl)} WHERE ${q(col)} IS NOT NULL ORDER BY CAST(${q(col)} AS REAL) LIMIT 1 OFFSET ${Math.floor(st.cnt*0.25)}`).get();
      const q3r=db.prepare(`SELECT CAST(${q(col)} AS REAL) as v FROM ${qt(tbl)} WHERE ${q(col)} IS NOT NULL ORDER BY CAST(${q(col)} AS REAL) LIMIT 1 OFFSET ${Math.floor(st.cnt*0.75)}`).get();
      if (q1r&&q3r) { const iqr=q3r.v-q1r.v; p.q1=q1r.v; p.q3=q3r.v; const out=db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)} WHERE CAST(${q(col)} AS REAL)<${q1r.v-1.5*iqr} OR CAST(${q(col)} AS REAL)>${q3r.v+1.5*iqr}`).get().c; p.outlierCount=out; p.outlierPct=parseFloat(((out/st.cnt)*100).toFixed(1)); }
      const mr=db.prepare(`SELECT CAST(${q(col)} AS REAL) as v FROM ${qt(tbl)} WHERE ${q(col)} IS NOT NULL ORDER BY CAST(${q(col)} AS REAL) LIMIT 1 OFFSET ${Math.floor(st.cnt/2)}`).get();
      if (mr&&p.mean) { const std=Math.sqrt(db.prepare(`SELECT AVG((CAST(${q(col)} AS REAL)-${p.mean})*(CAST(${q(col)} AS REAL)-${p.mean})) as v FROM ${qt(tbl)} WHERE ${q(col)} IS NOT NULL`).get().v||0); p.std=parseFloat(std.toFixed(4)); p.median=mr.v; p.skewness=std>0?parseFloat(((3*(p.mean-mr.v))/std).toFixed(2)):0; }
    } catch {}
  } else {
    try {
      const ws=db.prepare(`SELECT COUNT(*) as c FROM ${qt(tbl)} WHERE ${q(col)}!=TRIM(${q(col)}) AND ${q(col)} IS NOT NULL`).get().c;
      const cv=db.prepare(`SELECT COUNT(DISTINCT LOWER(${q(col)})) as lo,COUNT(DISTINCT ${q(col)}) as orig FROM ${qt(tbl)} WHERE ${q(col)} IS NOT NULL AND ${q(col)}!=''`).get();
      p.hasLeadingTrailingSpaces=ws>0; p.spacesCount=ws; p.hasCaseInconsistency=cv&&cv.lo<cv.orig; p.caseVariantCount=cv?cv.orig-cv.lo:0;
      const sr=db.prepare(`SELECT ${q(col)} as v FROM ${qt(tbl)} WHERE ${q(col)} IS NOT NULL AND ${q(col)}!='' LIMIT 1`).get();
      if (sr?.v) p.looksLikeDate=/^\d{4}[-/]\d{2}[-/]\d{2}/.test(sr.v)||/^\d{2}[-/]\d{2}[-/]\d{4}/.test(sr.v);
    } catch {}
  }
  return p;
}

function runRuleEngine(profiles) {
  const recs = [];
  for (const p of profiles) {
    if (!p) continue;
    if (p.nullPct>30) recs.push({column:p.name,severity:'warning',category:'missing',title:`High nulls in "${p.name}"`,description:`${p.nullPct}% missing. Consider dropping.`,suggestedOps:[{opId:'drop_column',params:{columns:[p.name]},label:'Delete column'}]});
    else if (p.nullPct>0) {
      if (p.type==='integer'||p.type==='real') {
        const op=Math.abs(p.skewness||0)>1?'fill_median':'fill_mean';
        recs.push({column:p.name,severity:'info',category:'missing',title:`${p.nullCount} missing in "${p.name}"`,description:`${p.nullPct}% nulls.`,suggestedOps:[{opId:op,params:{columns:[p.name]},label:op==='fill_median'?'Fill median':'Fill mean'},{opId:'fill_constant_numeric',params:{columns:[p.name],constant:0},label:'Fill 0'}]});
      } else {
        recs.push({column:p.name,severity:'info',category:'missing',title:`${p.nullCount} missing in "${p.name}"`,description:`${p.nullPct}% nulls in text.`,suggestedOps:[{opId:'fill_mode',params:{columns:[p.name]},label:'Fill mode'},{opId:'fill_value',params:{columns:[p.name],value:'Unknown'},label:'Fill "Unknown"'}]});
      }
    }
    if (p.outlierPct>5) recs.push({column:p.name,severity:'warning',category:'outliers',title:`Outliers in "${p.name}"`,description:`${p.outlierCount} outliers (${p.outlierPct}%).`,suggestedOps:[{opId:'remove_outliers_iqr',params:{columns:[p.name]},label:'Remove'},{opId:'cap_outliers_iqr',params:{columns:[p.name]},label:'Cap'}]});
    if (p.skewness!==undefined&&Math.abs(p.skewness)>2) recs.push({column:p.name,severity:'info',category:'distribution',title:`Skewed "${p.name}" (${p.skewness})`,description:'Log transform may help.',suggestedOps:[{opId:'log_transform',params:{columns:[p.name]},label:'Log transform'}]});
    if (p.hasLeadingTrailingSpaces&&p.spacesCount>0) recs.push({column:p.name,severity:'info',category:'text',title:`Whitespace in "${p.name}"`,description:`${p.spacesCount} values have leading/trailing spaces.`,suggestedOps:[{opId:'trim',params:{columns:[p.name]},label:'Trim whitespace'}]});
    if (p.hasCaseInconsistency&&p.caseVariantCount>0) recs.push({column:p.name,severity:'info',category:'text',title:`Mixed case in "${p.name}"`,description:`${p.caseVariantCount} case variants (e.g. "Cat" vs "cat").`,suggestedOps:[{opId:'lowercase',params:{columns:[p.name]},label:'Lowercase all'}]});
    if (p.type==='text'&&p.looksLikeDate) recs.push({column:p.name,severity:'info',category:'type',title:`"${p.name}" looks like a date`,description:'Consider extracting date parts or converting.',suggestedOps:[{opId:'extract_year',params:{columns:[p.name]},label:'Extract year'},{opId:'convert_to_date',params:{columns:[p.name]},label:'Convert to date'}]});
    if (p.type==='text'&&p.uniqueRatio>0.8&&p.uniqueCount>10) recs.push({column:p.name,severity:'info',category:'cardinality',title:`High cardinality "${p.name}"`,description:`${p.uniqueCount} unique values (${(p.uniqueRatio*100).toFixed(0)}% of non-null).`,suggestedOps:[]});
  }
  return recs;
}

/* ── Replay engine ───────────────────────────────────────────── */
function replayOnTemp(db, source, steps, limit=50) {
  ensureSQLiteFunctions(db);
  const tmp = `tmp_${Date.now()}_${Math.floor(Math.random()*99999)}`;
  try {
    db.exec(`DROP TABLE IF EXISTS ${qt(tmp)}`);
    db.exec(`CREATE TABLE ${qt(tmp)} AS SELECT * FROM ${qt(source)}`);
    const stepResults = []; let stopped = false;
    for (let i=0; i<steps.length; i++) {
      const step = steps[i];
      if (step.enabled===false) { stepResults.push({stepId:step.id,skipped:true}); continue; }
      const cols = step.params?.columns?.length ? step.params.columns : (step.params?.column ? [step.params.column] : []);
      const cs   = readSchema(db, tmp);
      const noColOps = ['remove_duplicates','limit_rows','sample_rows','add_column_formula','rename_multiple','group_agg'];
      if (!noColOps.includes(step.opId) && cols.length === 0) {
        stepResults.push({stepId:step.id, skipped:true, needsConfig:true});
        continue;
      }
      let colErr = null;
      for (const c of cols) { if (!cs.some(s=>s.name===c)) { colErr=c; break; } }
      if (colErr) {
        stepResults.push({stepId:step.id,success:false,stopped:true,error:`Kolom "${colErr}" tidak ditemukan. Tersedia: [${cs.map(s=>s.name).join(', ')}]`,schemaAtStep:cs});
        for (let j=i+1;j<steps.length;j++) { if (steps[j].enabled!==false) stepResults.push({stepId:steps[j].id,blocked:true}); }
        stopped=true; break;
      }
      let opInfo=''; try { opInfo=getOpInfo(db,tmp,step.opId,step.params); } catch {}
      let sql    = generateSQL(tmp, step.opId, step.params);
      const python = generatePython(step.opId, step.params);
      if (sql.includes('__REMOVE_DUPLICATES__')) sql = resolveRemoveDuplicates(db, sql, tmp);
      if (sql.includes('__ONE_HOT__'))           sql = resolveOneHot(db, sql);
      try {
        execSQL(db, sql);
        const sa=readSchema(db,tmp), rc=db.prepare(`SELECT COUNT(*) as c FROM ${qt(tmp)}`).get().c;
        stepResults.push({stepId:step.id,success:true,sql,python,rowCount:rc,schemaAfter:sa,opInfo});
      } catch(err) {
        stepResults.push({stepId:step.id,success:false,error:err.message,schemaAtStep:cs,sql});
        for (let j=i+1;j<steps.length;j++) { if (steps[j].enabled!==false) stepResults.push({stepId:steps[j].id,blocked:true}); }
        stopped=true; break;
      }
    }
    const fs=readSchema(db,tmp), rc=db.prepare(`SELECT COUNT(*) as c FROM ${qt(tmp)}`).get().c;
    return {rows:db.prepare(`SELECT * FROM ${qt(tmp)} LIMIT ${limit}`).all(),schema:fs,rowCount:rc,stepResults,stopped};
  } finally { try { db.exec(`DROP TABLE IF EXISTS ${qt(tmp)}`); } catch {} }
}

function applyToLive(db, dataset, steps) {
  ensureSQLiteFunctions(db);
  const undo = `undo_${dataset.id.replace(/-/g,'').slice(0,12)}_${Date.now()}`;
  db.exec(`DROP TABLE IF EXISTS ${qt(undo)}`);
  db.exec(`CREATE TABLE ${qt(undo)} AS SELECT * FROM ${qt(dataset.table_name)}`);
  try {
    const applied=[]; let fs=readSchema(db,dataset.table_name), fc=db.prepare(`SELECT COUNT(*) as c FROM ${qt(dataset.table_name)}`).get().c;
    for (const step of steps) {
      if (step.enabled===false) continue;
      const cols = step.params?.columns?.length ? step.params.columns : (step.params?.column ? [step.params.column] : []);
      const cs   = readSchema(db, dataset.table_name);
      for (const c of cols) {
        if (!cs.some(s=>s.name===c)) {
          db.exec(`DROP TABLE IF EXISTS ${qt(dataset.table_name)}`);
          db.exec(`CREATE TABLE ${qt(dataset.table_name)} AS SELECT * FROM ${qt(undo)}`);
          throw new Error(`Step "${step.label}": kolom "${c}" tidak ada. Tersedia: [${cs.map(s=>s.name).join(', ')}]`);
        }
      }
      let sql    = generateSQL(dataset.table_name, step.opId, step.params);
      const python = generatePython(step.opId, step.params);
      if (sql.includes('__REMOVE_DUPLICATES__')) sql = resolveRemoveDuplicates(db, sql, dataset.table_name);
      if (sql.includes('__ONE_HOT__'))           sql = resolveOneHot(db, sql);
      try {
        execSQL(db, sql);
        fs=readSchema(db,dataset.table_name); fc=db.prepare(`SELECT COUNT(*) as c FROM ${qt(dataset.table_name)}`).get().c;
        const oid=uuidv4();
        db.prepare(`INSERT INTO operations (id,dataset_id,operation_type,operation_params,sql_generated,python_generated,applied) VALUES (?,?,?,?,?,?,1)`).run(oid,dataset.id,step.opId,JSON.stringify(step.params),sql,python);
        applied.push({stepId:step.id,opId:oid,sql,python});
      } catch(err) {
        db.exec(`DROP TABLE IF EXISTS ${qt(dataset.table_name)}`);
        db.exec(`CREATE TABLE ${qt(dataset.table_name)} AS SELECT * FROM ${qt(undo)}`);
        throw new Error(`Step "${step.label}": ${err.message}`);
      }
    }
    db.prepare(`UPDATE datasets SET row_count=?,schema_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(fc,JSON.stringify(fs),dataset.id);
    return {appliedOps:applied,schema:fs,rowCount:fc,undoName:undo};
  } catch(err) { throw err; }
}

/* ═══════════════════════════════════════════════════════════════
   ROUTES
   ═══════════════════════════════════════════════════════════════ */
router.post('/:id/preview', (req,res) => {
  const db=getDb(), ds=db.prepare('SELECT * FROM datasets WHERE id=?').get(req.params.id);
  if (!ds) return res.status(404).json({error:'Not found'});
  const {steps=[],limit=50}=req.body;
  try { res.json({success:true,...replayOnTemp(db,ds.table_name,steps.filter(s=>s.type==='clean'||!s.type),Math.min(500,Math.max(1,parseInt(limit)||50)))}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/:id/apply', (req,res) => {
  const db=getDb(), ds=db.prepare('SELECT * FROM datasets WHERE id=?').get(req.params.id);
  if (!ds) return res.status(404).json({error:'Not found'});
  const {steps=[]}=req.body;
  if (!steps.filter(s=>s.enabled!==false&&(s.type==='clean'||!s.type)).length) return res.status(400).json({error:'No enabled operations.'});
  try { res.json({success:true,...applyToLive(db,ds,steps.filter(s=>s.type==='clean'||!s.type))}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/:id/undo-apply', (req,res) => {
  const db=getDb(), ds=db.prepare('SELECT * FROM datasets WHERE id=?').get(req.params.id);
  if (!ds) return res.status(404).json({error:'Not found'});
  const {undoName}=req.body;
  if (!undoName) return res.status(400).json({error:'undoName required'});
  if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(undoName)) return res.status(404).json({error:'Snapshot not found'});
  try {
    db.exec(`DROP TABLE IF EXISTS ${qt(ds.table_name)}`);
    db.exec(`CREATE TABLE ${qt(ds.table_name)} AS SELECT * FROM ${qt(undoName)}`);
    db.prepare(`DELETE FROM operations WHERE dataset_id=?`).run(ds.id);
    const s=readSchema(db,ds.table_name), rc=db.prepare(`SELECT COUNT(*) as c FROM ${qt(ds.table_name)}`).get().c;
    db.prepare(`UPDATE datasets SET row_count=?,schema_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(rc,JSON.stringify(s),ds.id);
    res.json({success:true,schema:s,rowCount:rc});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/:id/op-info', (req,res) => {
  const db=getDb(), ds=db.prepare('SELECT * FROM datasets WHERE id=?').get(req.params.id);
  if (!ds) return res.status(404).json({error:'Not found'});
  try { res.json({info:getOpInfo(db,ds.table_name,req.body.opId,req.body.params||{})}); }
  catch { res.json({info:`Apply ${req.body.opId}`}); }
});

router.get('/:id/profile', (req,res) => {
  const db=getDb(), ds=db.prepare('SELECT * FROM datasets WHERE id=?').get(req.params.id);
  if (!ds) return res.status(404).json({error:'Not found'});
  try {
    const schema=readSchema(db,ds.table_name);
    const profiles=schema.map(c=>profileColumn(db,ds.table_name,c.name,c.type));
    const total=db.prepare(`SELECT COUNT(*) as c FROM ${qt(ds.table_name)}`).get().c;
    const cols=schema.map(c=>q(c.name)).join(',');
    const uniq=db.prepare(`SELECT COUNT(*) as c FROM (SELECT MIN(rowid) FROM ${qt(ds.table_name)} GROUP BY ${cols})`).get().c;
    const recs=runRuleEngine(profiles);
    if (total-uniq>0) recs.unshift({column:null,severity:'warning',category:'duplicates',title:`${total-uniq} duplicate rows`,description:`${((total-uniq)/total*100).toFixed(1)}% duplicates.`,suggestedOps:[{opId:'remove_duplicates',params:{},label:'Remove duplicates'}]});
    res.json({profiles,recommendations:recs,totalRows:total});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/:id/history', (req,res) => {
  const db=getDb(), ops=db.prepare('SELECT * FROM operations WHERE dataset_id=? ORDER BY created_at ASC').all(req.params.id);
  res.json({operations:ops.map(o=>({...o,params:JSON.parse(o.operation_params||'{}')}))});
});

router.post('/:id/custom-sql', (req,res) => {
  const db=getDb(), ds=db.prepare('SELECT * FROM datasets WHERE id=?').get(req.params.id);
  if (!ds) return res.status(404).json({error:'Not found'});
  try {
    ensureSQLiteFunctions(db);
    let results=null;
    let hasMutation=false;
    const MUTATION_KEYWORDS=new Set(['UPDATE','DELETE','DROP','ALTER','INSERT','CREATE','REPLACE','TRUNCATE']);

    req.body.sql.split(';').map(s=>s.trim()).filter(Boolean).forEach(s=>{
      const firstWord=s.trimStart().split(/\s+/)[0].toUpperCase();
      if (firstWord==='SELECT') {
        results=db.prepare(s).all();
      } else {
        db.exec(s);
        if (MUTATION_KEYWORDS.has(firstWord)) hasMutation=true;
      }
    });

    // If any mutation ran, refresh dataset metadata (row_count + schema_json)
    // so Studio preview and Explorer both see the updated state
    let updatedDataset=null;
    if (hasMutation) {
      try {
        const tableExists=db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(ds.table_name);
        if (tableExists) {
          const newSchema=readSchema(db,ds.table_name);
          const newCount=db.prepare(`SELECT COUNT(*) as c FROM "${ds.table_name}"`).get().c;
          db.prepare(`UPDATE datasets SET row_count=?,schema_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(newCount,JSON.stringify(newSchema),ds.id);
          updatedDataset={...ds,row_count:newCount,schema_json:JSON.stringify(newSchema),schema:newSchema};
        }
      } catch(e) { /* table may have been dropped — ignore */ }
    }

    res.json({success:true, results, hasMutation, updatedDataset});
  } catch(e) { res.status(400).json({error:e.message}); }
});

router.get('/:id/saved-pipeline', (req,res) => {
  const db=getDb(), row=db.prepare('SELECT * FROM saved_pipelines WHERE dataset_id=?').get(req.params.id);
  res.json({steps:row?JSON.parse(row.steps_json):[]});
});

router.put('/:id/saved-pipeline', (req,res) => {
  const db=getDb(), json=JSON.stringify(Array.isArray(req.body.steps)?req.body.steps:[]);
  const ex=db.prepare('SELECT id FROM saved_pipelines WHERE dataset_id=?').get(req.params.id);
  if (ex) db.prepare(`UPDATE saved_pipelines SET steps_json=?,updated_at=CURRENT_TIMESTAMP WHERE dataset_id=?`).run(json,req.params.id);
  else    db.prepare(`INSERT INTO saved_pipelines (id,dataset_id,steps_json) VALUES (?,?,?)`).run(uuidv4(),req.params.id,json);
  res.json({success:true});
});

router.post('/:id/reset-original', (req,res) => {
  const db=getDb(), ds=db.prepare('SELECT * FROM datasets WHERE id=?').get(req.params.id);
  if (!ds) return res.status(404).json({error:'Not found'});
  const orig=ds.original_table_name||(ds.table_name+'_orig');
  try {
    db.exec(`DROP TABLE IF EXISTS ${qt(orig)}`);
    db.exec(`CREATE TABLE ${qt(orig)} AS SELECT * FROM ${qt(ds.table_name)}`);
    db.prepare(`UPDATE datasets SET original_table_name=? WHERE id=?`).run(orig,ds.id);
    const s=readSchema(db,orig), rc=db.prepare(`SELECT COUNT(*) as c FROM ${qt(orig)}`).get().c;
    res.json({success:true,message:`Reset OK (${rc} rows)`,schema:s,rowCount:rc});
  } catch(e) { res.status(500).json({error:e.message}); }
});

export default router;