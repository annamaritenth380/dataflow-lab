import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';

const router = express.Router();

/* ══════════════════════════════════════════════════════════════
   buildVizQuery
   ══════════════════════════════════════════════════════════════ */
function buildVizQuery(db, tableName, config) {
  const {
    chartType,
    xCol,
    yCols   = [],
    yCol    = yCols?.[0] || '',
    aggregation = 'COUNT',
    limit   = 200,
    // histogram-specific
    binSize,
    binCount,
    // timeseries-specific
    timeGranularity = 'auto',
    // rolling avg window
    rollingWindow = 3,
    // boxplot grouping
    groupBy,
    // top-n
    topN,
  } = config;

  if (!xCol) throw new Error('X column is required');

  const q  = c => `"${c}"`;
  const qt = t => `"${t}"`;
  const agg = aggregation.toUpperCase();
  const lim = Math.min(Number(limit) || 200, 5000);

  let sql = '';

  /* ── Pie / Donut ──────────────────────────────────────────── */
  if (chartType === 'pie' || chartType === 'donut') {
    sql = yCol
      ? `SELECT ${q(xCol)} as label, ${agg}(CAST(${q(yCol)} AS REAL)) as value
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY value DESC LIMIT 20`
      : `SELECT ${q(xCol)} as label, COUNT(*) as value
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY value DESC LIMIT 20`;
  }

  /* ── Histogram (real binning) ────────────────────────────── */
  // FIX: was GROUP BY xCol — that's a bar chart, not a histogram.
  // Real histogram = numeric binning. We compute bin_size from data range.
  else if (chartType === 'histogram') {
    // Compute range, then bin
    const stats = db.prepare(`
      SELECT MIN(CAST(${q(xCol)} AS REAL)) as mn, MAX(CAST(${q(xCol)} AS REAL)) as mx
      FROM ${qt(tableName)}
      WHERE ${q(xCol)} IS NOT NULL AND ${q(xCol)} != ''
        AND CAST(${q(xCol)} AS REAL) = CAST(${q(xCol)} AS REAL)
    `).get();

    if (!stats || stats.mn === null) {
      sql = `SELECT ${q(xCol)} as x, COUNT(*) as y FROM ${qt(tableName)}
             WHERE ${q(xCol)} IS NOT NULL GROUP BY ${q(xCol)} ORDER BY CAST(${q(xCol)} AS REAL) LIMIT ${lim}`;
    } else {
      const range  = stats.mx - stats.mn;
      const bins   = Math.max(2, parseInt(binCount) || 20);
      const bsize  = binSize ? parseFloat(binSize) : (range > 0 ? range / bins : 1);
      sql = `
        SELECT
          ROUND(CAST(${q(xCol)} AS REAL) / ${bsize}, 0) * ${bsize} AS x,
          COUNT(*) AS y
        FROM ${qt(tableName)}
        WHERE ${q(xCol)} IS NOT NULL AND ${q(xCol)} != ''
          AND CAST(${q(xCol)} AS REAL) = CAST(${q(xCol)} AS REAL)
        GROUP BY x
        ORDER BY x
        LIMIT ${lim}`;
    }
  }

  /* ── Density (normalized histogram) ─────────────────────── */
  // FIX: was same as histogram (GROUP BY value), now normalized count = count/total
  else if (chartType === 'density') {
    const stats = db.prepare(`
      SELECT MIN(CAST(${q(xCol)} AS REAL)) as mn, MAX(CAST(${q(xCol)} AS REAL)) as mx,
             COUNT(*) as total
      FROM ${qt(tableName)}
      WHERE ${q(xCol)} IS NOT NULL AND ${q(xCol)} != ''
        AND CAST(${q(xCol)} AS REAL) = CAST(${q(xCol)} AS REAL)
    `).get();

    if (!stats || stats.mn === null || stats.total === 0) {
      sql = `SELECT ${q(xCol)} as x, COUNT(*) as y FROM ${qt(tableName)}
             WHERE ${q(xCol)} IS NOT NULL GROUP BY ${q(xCol)} ORDER BY CAST(${q(xCol)} AS REAL) LIMIT ${lim}`;
    } else {
      const bins  = Math.max(2, parseInt(binCount) || 20);
      const bsize = binSize ? parseFloat(binSize) : Math.max((stats.mx - stats.mn) / bins, 1e-9);
      sql = `
        SELECT
          ROUND(CAST(${q(xCol)} AS REAL) / ${bsize}, 0) * ${bsize} AS x,
          CAST(COUNT(*) AS REAL) / ${stats.total} AS y
        FROM ${qt(tableName)}
        WHERE ${q(xCol)} IS NOT NULL AND ${q(xCol)} != ''
          AND CAST(${q(xCol)} AS REAL) = CAST(${q(xCol)} AS REAL)
        GROUP BY x
        ORDER BY x
        LIMIT ${lim}`;
    }
  }

  /* ── Cumulative Distribution ─────────────────────────────── */
  // FIX: was same as histogram. Now uses window SUM for true CDF.
  else if (chartType === 'cumulative') {
    const stats = db.prepare(`
      SELECT MIN(CAST(${q(xCol)} AS REAL)) as mn, MAX(CAST(${q(xCol)} AS REAL)) as mx,
             COUNT(*) as total
      FROM ${qt(tableName)}
      WHERE ${q(xCol)} IS NOT NULL AND ${q(xCol)} != ''
        AND CAST(${q(xCol)} AS REAL) = CAST(${q(xCol)} AS REAL)
    `).get();

    if (!stats || stats.mn === null || stats.total === 0) {
      sql = `SELECT ${q(xCol)} as x, COUNT(*) as y FROM ${qt(tableName)}
             WHERE ${q(xCol)} IS NOT NULL GROUP BY ${q(xCol)} LIMIT ${lim}`;
    } else {
      const bins  = Math.max(2, parseInt(binCount) || 20);
      const bsize = binSize ? parseFloat(binSize) : Math.max((stats.mx - stats.mn) / bins, 1e-9);
      const total = stats.total;
      sql = `
        WITH buckets AS (
          SELECT
            ROUND(CAST(${q(xCol)} AS REAL) / ${bsize}, 0) * ${bsize} AS x,
            COUNT(*) AS cnt
          FROM ${qt(tableName)}
          WHERE ${q(xCol)} IS NOT NULL AND ${q(xCol)} != ''
            AND CAST(${q(xCol)} AS REAL) = CAST(${q(xCol)} AS REAL)
          GROUP BY x ORDER BY x
        )
        SELECT x, CAST(SUM(cnt) OVER (ORDER BY x) AS REAL) / ${total} AS y
        FROM buckets
        LIMIT ${lim}`;
    }
  }

  /* ── Box Plot — with optional grouping ──────────────────── */
  // FIX: now supports GROUP BY xCol (e.g. salary by department).
  // xCol = category column (group), yCol = numeric value column.
  else if (chartType === 'boxplot' || chartType === 'violin') {
    const valueCol = yCol || xCol;
    const catCol   = yCol ? xCol : null;  // if yCol given, xCol is the grouping axis

    if (catCol) {
      // Grouped boxplot: one box per category
      const groups = db.prepare(
        `SELECT DISTINCT ${q(catCol)} as g FROM ${qt(tableName)} WHERE ${q(catCol)} IS NOT NULL ORDER BY g LIMIT 30`
      ).all().map(r => r.g);

      const rows = [];
      for (const grp of groups) {
        const safeGrp = String(grp).replace(/'/g, "''");
        const cnt = db.prepare(
          `SELECT COUNT(*) as c FROM ${qt(tableName)} WHERE ${q(catCol)}='${safeGrp}' AND ${q(valueCol)} IS NOT NULL`
        ).get().c;
        if (cnt === 0) continue;
        const getVal = (offset) => db.prepare(
          `SELECT CAST(${q(valueCol)} AS REAL) as v FROM ${qt(tableName)}
           WHERE ${q(catCol)}='${safeGrp}' AND ${q(valueCol)} IS NOT NULL
           ORDER BY CAST(${q(valueCol)} AS REAL) LIMIT 1 OFFSET ${offset}`
        ).get()?.v;
        const q1v  = getVal(Math.floor(cnt * 0.25));
        const medv = getVal(Math.floor(cnt * 0.5));
        const q3v  = getVal(Math.floor(cnt * 0.75));
        const stat = db.prepare(
          `SELECT MIN(CAST(${q(valueCol)} AS REAL)) as mn, MAX(CAST(${q(valueCol)} AS REAL)) as mx,
                  AVG(CAST(${q(valueCol)} AS REAL)) as avg
           FROM ${qt(tableName)} WHERE ${q(catCol)}='${safeGrp}' AND ${q(valueCol)} IS NOT NULL`
        ).get();
        rows.push({ x: grp, q1: q1v, median: medv, q3: q3v, min: stat?.mn, max: stat?.mx, mean: stat?.avg, y: medv });
      }
      return { sql: `-- Grouped boxplot: ${valueCol} by ${catCol}`, rows };
    } else {
      // Single boxplot (no grouping)
      const total = db.prepare(`SELECT COUNT(*) as c FROM ${qt(tableName)} WHERE ${q(valueCol)} IS NOT NULL`).get().c;
      const getVal = (offset) => db.prepare(
        `SELECT CAST(${q(valueCol)} AS REAL) as v FROM ${qt(tableName)}
         WHERE ${q(valueCol)} IS NOT NULL ORDER BY CAST(${q(valueCol)} AS REAL) LIMIT 1 OFFSET ${offset}`
      ).get();
      const q1    = getVal(Math.floor(total * 0.25));
      const q2    = getVal(Math.floor(total * 0.5));
      const q3    = getVal(Math.floor(total * 0.75));
      const stats = db.prepare(
        `SELECT MIN(CAST(${q(valueCol)} AS REAL)) as mn, MAX(CAST(${q(valueCol)} AS REAL)) as mx,
                AVG(CAST(${q(valueCol)} AS REAL)) as avg
         FROM ${qt(tableName)} WHERE ${q(valueCol)} IS NOT NULL`
      ).get();
      return {
        sql: `-- Boxplot stats for ${valueCol}`,
        rows: [{ x: valueCol, q1: q1?.v, median: q2?.v, q3: q3?.v, min: stats?.mn, max: stats?.mx, mean: stats?.avg, y: q2?.v }],
      };
    }
  }

  /* ── Scatter / Bubble / Regression ───────────────────────── */
  else if (chartType === 'scatter' || chartType === 'bubble' || chartType === 'regression') {
    if (!yCol) throw new Error('Y column required for scatter/bubble/regression');
    const zCol = yCols?.[1];
    sql = zCol
      ? `SELECT ${q(xCol)} as x, ${q(yCol)} as y, ${q(zCol)} as z
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL AND ${q(yCol)} IS NOT NULL LIMIT ${lim}`
      : `SELECT ${q(xCol)} as x, ${q(yCol)} as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL AND ${q(yCol)} IS NOT NULL LIMIT ${lim}`;
  }

  /* ── Correlation Heatmap ─────────────────────────────────── */
  else if (chartType === 'heatmap' || chartType === 'corr_matrix' || chartType === 'correlation') {
    const numCols = yCols.length > 1 ? yCols : (yCol ? [xCol, yCol] : [xCol]);
    const rows = [];
    for (const c1 of numCols) {
      for (const c2 of numCols) {
        try {
          const r = db.prepare(`
            SELECT (
              AVG(CAST(${q(c1)} AS REAL) * CAST(${q(c2)} AS REAL))
              - AVG(CAST(${q(c1)} AS REAL)) * AVG(CAST(${q(c2)} AS REAL))
            ) / NULLIF(
              SQRT(
                (AVG(CAST(${q(c1)} AS REAL)*CAST(${q(c1)} AS REAL)) - AVG(CAST(${q(c1)} AS REAL))*AVG(CAST(${q(c1)} AS REAL))) *
                (AVG(CAST(${q(c2)} AS REAL)*CAST(${q(c2)} AS REAL)) - AVG(CAST(${q(c2)} AS REAL))*AVG(CAST(${q(c2)} AS REAL)))
              ), 0
            ) as corr
            FROM ${qt(tableName)}
            WHERE ${q(c1)} IS NOT NULL AND ${q(c2)} IS NOT NULL AND ${q(c1)} != '' AND ${q(c2)} != ''
          `).get();
          rows.push({ x: c1, y: c2, value: r?.corr !== null ? parseFloat((r.corr).toFixed(4)) : 0 });
        } catch { rows.push({ x: c1, y: c2, value: 0 }); }
      }
    }
    return { sql: `-- Correlation matrix for [${numCols.join(', ')}]`, rows };
  }

  /* ── Feature Variance (renamed from feature_importance) ──── */
  // FIX: renamed chart type label, still computes variance per column.
  // True feature importance requires a target column — we use variance as proxy.
  else if (chartType === 'feature_importance' || chartType === 'feature_variance') {
    const numCols = yCols.length > 0 ? yCols :
      db.prepare(`PRAGMA table_info(${qt(tableName)})`).all()
        .filter(c => { const t = c.type.toLowerCase(); return t.includes('int') || t.includes('real'); })
        .map(c => c.name).slice(0, 10);
    const rows = [];
    for (const c of numCols) {
      try {
        const r = db.prepare(`
          SELECT AVG(
            (CAST(${q(c)} AS REAL) - (SELECT AVG(CAST(${q(c)} AS REAL)) FROM ${qt(tableName)} WHERE ${q(c)} IS NOT NULL)) *
            (CAST(${q(c)} AS REAL) - (SELECT AVG(CAST(${q(c)} AS REAL)) FROM ${qt(tableName)} WHERE ${q(c)} IS NOT NULL))
          ) as variance
          FROM ${qt(tableName)} WHERE ${q(c)} IS NOT NULL
            AND CAST(${q(c)} AS REAL) = CAST(${q(c)} AS REAL)
        `).get();
        rows.push({ x: c, y: Math.abs(r?.variance || 0) });
      } catch { rows.push({ x: c, y: 0 }); }
    }
    rows.sort((a, b) => b.y - a.y);
    return { sql: '-- Feature variance (proxy for importance)', rows };
  }

  /* ── Multi-line / Stacked Area ───────────────────────────── */
  else if (chartType === 'multi_line' || chartType === 'stacked_area') {
    if (yCols.length > 1) {
      const colSelects = yCols.map(c =>
        `${agg === 'COUNT' ? `COUNT(${q(c)})` : `${agg}(CAST(${q(c)} AS REAL))`} as ${q(c)}`
      ).join(', ');
      sql = `SELECT ${q(xCol)} as x, ${colSelects}
             FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
             GROUP BY ${q(xCol)} ORDER BY ${q(xCol)} LIMIT ${lim}`;
    } else {
      sql = yCol
        ? `SELECT ${q(xCol)} as x, ${agg}(CAST(${q(yCol)} AS REAL)) as y
           FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
           GROUP BY ${q(xCol)} ORDER BY ${q(xCol)} LIMIT ${lim}`
        : `SELECT ${q(xCol)} as x, COUNT(*) as y
           FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
           GROUP BY ${q(xCol)} ORDER BY ${q(xCol)} LIMIT ${lim}`;
    }
  }

  /* ── Rolling Average ─────────────────────────────────────── */
  // FIX: was just GROUP BY (not rolling at all). Now uses window AVG OVER ROWS.
  else if (chartType === 'rolling_avg') {
    const win = Math.max(2, parseInt(rollingWindow) || 3);
    const preceding = win - 1;
    if (!yCol) throw new Error('Y column required for rolling average');
    sql = `
      WITH base AS (
        SELECT ${q(xCol)} as x,
               ${agg}(CAST(${q(yCol)} AS REAL)) as raw_y
        FROM ${qt(tableName)}
        WHERE ${q(xCol)} IS NOT NULL AND ${q(yCol)} IS NOT NULL
        GROUP BY ${q(xCol)} ORDER BY ${q(xCol)}
      )
      SELECT x,
             raw_y as y,
             AVG(raw_y) OVER (
               ORDER BY x
               ROWS BETWEEN ${preceding} PRECEDING AND CURRENT ROW
             ) as rolling_avg
      FROM base
      LIMIT ${lim}`;
  }

  /* ── Grouped Bar / Stacked Bar / 100% Stacked ────────────── */
  // FIX: stacked bar requires multiple Y columns to actually stack.
  // With single Y it's just a regular bar — documented in comment.
  else if (chartType === 'grouped_bar' || chartType === 'stacked_bar' || chartType === 'stacked_100') {
    if (yCols.length > 1) {
      const colSelects = yCols.map(c =>
        `${agg === 'COUNT' ? `COUNT(${q(c)})` : `${agg}(CAST(${q(c)} AS REAL))`} as ${q(c)}`
      ).join(', ');
      sql = `SELECT ${q(xCol)} as x, ${colSelects}
             FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
             GROUP BY ${q(xCol)} ORDER BY ${q(xCol)} LIMIT ${lim}`;
    } else {
      // Single Y: pivot-style — group by xCol, use yCol as category dimension
      // This lets "department + status" produce stacked bars
      if (yCol) {
        // True pivot: xCol = x-axis categories, yCol = stack segments
        const segments = db.prepare(
          `SELECT DISTINCT CAST(${q(yCol)} AS TEXT) as s FROM ${qt(tableName)}
           WHERE ${q(yCol)} IS NOT NULL AND ${q(yCol)} != '' ORDER BY s LIMIT 10`
        ).all().map(r => r.s);

        if (segments.length > 1) {
          const colSelects = segments.map(seg => {
            const safeLabel = seg.replace(/"/g, '');
            const escapedSeg = seg.replace(/'/g, "''");
            return `SUM(CASE WHEN CAST(${q(yCol)} AS TEXT)='${escapedSeg}' THEN 1 ELSE 0 END) as "${safeLabel}"`;
          }).join(', ');
          sql = `SELECT ${q(xCol)} as x, ${colSelects}
                 FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
                 GROUP BY ${q(xCol)} ORDER BY ${q(xCol)} LIMIT ${lim}`;
          // rewrite yCols for frontend so it knows the segment columns
          config._stackSegments = segments;
        } else {
          sql = `SELECT ${q(xCol)} as x, ${agg}(CAST(${q(yCol)} AS REAL)) as y
                 FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
                 GROUP BY ${q(xCol)} ORDER BY y DESC LIMIT ${lim}`;
        }
      } else {
        sql = `SELECT ${q(xCol)} as x, COUNT(*) as y
               FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
               GROUP BY ${q(xCol)} ORDER BY y DESC LIMIT ${lim}`;
      }
    }
  }

  /* ── Horizontal Bar ───────────────────────────────────────── */
  else if (chartType === 'horizontal_bar') {
    sql = yCol
      ? `SELECT ${q(xCol)} as x, ${agg}(CAST(${q(yCol)} AS REAL)) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY y DESC LIMIT ${lim}`
      : `SELECT ${q(xCol)} as x, COUNT(*) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY y DESC LIMIT ${lim}`;
  }

  /* ── Top-N Categories ─────────────────────────────────────── */
  else if (chartType === 'top_n') {
    const n = topN || config.topN || 10;
    sql = yCol
      ? `SELECT ${q(xCol)} as x, ${agg}(CAST(${q(yCol)} AS REAL)) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY y DESC LIMIT ${n}`
      : `SELECT ${q(xCol)} as x, COUNT(*) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY y DESC LIMIT ${n}`;
  }

  /* ── Anomaly Highlight ────────────────────────────────────── */
  else if (chartType === 'anomaly') {
    if (!yCol) throw new Error('Y column required for anomaly chart');
    const total = db.prepare(`SELECT COUNT(*) as c FROM ${qt(tableName)} WHERE ${q(yCol)} IS NOT NULL`).get().c;
    const q1r = db.prepare(`SELECT CAST(${q(yCol)} AS REAL) as v FROM ${qt(tableName)} WHERE ${q(yCol)} IS NOT NULL ORDER BY CAST(${q(yCol)} AS REAL) LIMIT 1 OFFSET ${Math.floor(total*0.25)}`).get();
    const q3r = db.prepare(`SELECT CAST(${q(yCol)} AS REAL) as v FROM ${qt(tableName)} WHERE ${q(yCol)} IS NOT NULL ORDER BY CAST(${q(yCol)} AS REAL) LIMIT 1 OFFSET ${Math.floor(total*0.75)}`).get();
    if (!q1r || !q3r) {
      sql = `SELECT ${q(xCol)} as x, ${q(yCol)} as y FROM ${qt(tableName)} LIMIT ${lim}`;
    } else {
      const iqr = q3r.v - q1r.v;
      const lo = q1r.v - 1.5 * iqr, hi = q3r.v + 1.5 * iqr;
      sql = `SELECT ${q(xCol)} as x, CAST(${q(yCol)} AS REAL) as y,
             CASE WHEN CAST(${q(yCol)} AS REAL) < ${lo} OR CAST(${q(yCol)} AS REAL) > ${hi}
               THEN 1 ELSE 0 END as is_anomaly
             FROM ${qt(tableName)}
             WHERE ${q(xCol)} IS NOT NULL AND ${q(yCol)} IS NOT NULL
             ORDER BY ${q(xCol)} LIMIT ${lim}`;
    }
  }

  /* ── Distribution by Target ─────────────────────────────── */
  else if (chartType === 'dist_by_target') {
    if (!yCol) throw new Error('Target column required');
    sql = `SELECT ${q(yCol)} as x, ${q(xCol)} as category, COUNT(*) as y
           FROM ${qt(tableName)}
           WHERE ${q(yCol)} IS NOT NULL AND ${q(xCol)} IS NOT NULL
           GROUP BY ${q(yCol)}, ${q(xCol)} ORDER BY ${q(yCol)}, y DESC LIMIT ${lim}`;
  }

  /* ── Auto Chart Suggestion ────────────────────────────────── */
  else if (chartType === 'auto_suggest') {
    const col = db.prepare(`PRAGMA table_info(${qt(tableName)})`).all().find(c => c.name === xCol);
    const isNum = col && (col.type.toLowerCase().includes('int') || col.type.toLowerCase().includes('real'));
    if (isNum && yCol) {
      sql = `SELECT ${q(xCol)} as x, ${q(yCol)} as y
             FROM ${qt(tableName)}
             WHERE ${q(xCol)} IS NOT NULL AND ${q(yCol)} IS NOT NULL
             ORDER BY ${q(xCol)} LIMIT ${lim}`;
    } else {
      sql = `SELECT ${q(xCol)} as x, COUNT(*) as y
             FROM ${qt(tableName)}
             WHERE ${q(xCol)} IS NOT NULL
             GROUP BY ${q(xCol)} ORDER BY y DESC LIMIT 20`;
    }
  }

  /* ── Pair Plot ────────────────────────────────────────────── */
  // FIX: returns ALL pairwise combinations, not just 2 columns.
  else if (chartType === 'pair_plot') {
    const numCols = yCols.length > 1 ? yCols : [xCol, ...(yCol ? [yCol] : [])];
    if (numCols.length < 2) {
      sql = `SELECT ${q(numCols[0])} as x, ${q(numCols[0])} as y
             FROM ${qt(tableName)} WHERE ${q(numCols[0])} IS NOT NULL LIMIT 200`;
      const rows = db.prepare(sql).all();
      return { sql, rows };
    }
    // Return all pairs as separate datasets: [{pair: "A vs B", data: [{x,y},...]}]
    const allRows = [];
    for (let i = 0; i < numCols.length; i++) {
      for (let j = i + 1; j < numCols.length; j++) {
        const c1 = numCols[i], c2 = numCols[j];
        const pairSql = `SELECT ${q(c1)} as x, ${q(c2)} as y
                         FROM ${qt(tableName)}
                         WHERE ${q(c1)} IS NOT NULL AND ${q(c2)} IS NOT NULL
                         LIMIT 200`;
        try {
          const pts = db.prepare(pairSql).all();
          // Tag each point with pair label for frontend
          pts.forEach(p => allRows.push({ ...p, pair: `${c1} vs ${c2}` }));
        } catch {}
      }
    }
    return { sql: `-- Pair plot: ${numCols.join(', ')}`, rows: allRows };
  }

  /* ── Time Series ─────────────────────────────────────────── */
  // FIX: use strftime to group by month/year instead of raw ORDER BY string.
  else if (chartType === 'timeseries') {
    // Detect granularity: try to figure out if column has date-like values
    const sample = db.prepare(
      `SELECT ${q(xCol)} as v FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL LIMIT 1`
    ).get();
    const looksLikeDate = sample?.v && /^\d{4}[-/]/.test(String(sample.v));

    let xExpr, orderExpr;
    if (looksLikeDate) {
      if (timeGranularity === 'year') {
        xExpr = `strftime('%Y', ${q(xCol)})`;
      } else if (timeGranularity === 'day') {
        xExpr = `strftime('%Y-%m-%d', ${q(xCol)})`;
      } else {
        // default: month
        xExpr = `strftime('%Y-%m', ${q(xCol)})`;
      }
      orderExpr = xExpr;
    } else {
      xExpr = q(xCol);
      orderExpr = q(xCol);
    }

    sql = yCol
      ? `SELECT ${xExpr} as x, ${agg}(CAST(${q(yCol)} AS REAL)) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL AND ${q(yCol)} IS NOT NULL
         GROUP BY ${xExpr} ORDER BY ${orderExpr} LIMIT ${lim}`
      : `SELECT ${xExpr} as x, COUNT(*) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${xExpr} ORDER BY ${orderExpr} LIMIT ${lim}`;
  }

  /* ── Line / Area ─────────────────────────────────────────── */
  else if (chartType === 'line' || chartType === 'area') {
    sql = yCol
      ? `SELECT ${q(xCol)} as x, ${agg}(CAST(${q(yCol)} AS REAL)) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY ${q(xCol)} LIMIT ${lim}`
      : `SELECT ${q(xCol)} as x, COUNT(*) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY ${q(xCol)} LIMIT ${lim}`;
  }

  /* ── Default: Bar ─────────────────────────────────────────── */
  else {
    sql = yCol
      ? `SELECT ${q(xCol)} as x, ${agg}(CAST(${q(yCol)} AS REAL)) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY y DESC LIMIT ${lim}`
      : `SELECT ${q(xCol)} as x, COUNT(*) as y
         FROM ${qt(tableName)} WHERE ${q(xCol)} IS NOT NULL
         GROUP BY ${q(xCol)} ORDER BY y DESC LIMIT ${lim}`;
  }

  const rows = db.prepare(sql).all();
  return { sql, rows };
}

/* ══════════════════════════════════════════════════════════════
   ROUTES
   ══════════════════════════════════════════════════════════════ */

// POST /api/visualizations/query
router.post('/query', (req, res) => {
  const db = getDb();
  const { datasetId, config } = req.body;
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId);
  if (!dataset) return res.status(404).json({ error: 'Dataset not found' });
  try {
    const result = buildVizQuery(db, dataset.table_name, config);
    res.json({ rows: result.rows, sql: result.sql });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/visualizations
router.get('/', (req, res) => {
  const db = getDb();
  const { datasetId } = req.query;
  const vizs = datasetId
    ? db.prepare(`SELECT * FROM visualizations WHERE dataset_id = ? ORDER BY created_at DESC`).all(datasetId)
    : db.prepare(`SELECT * FROM visualizations ORDER BY created_at DESC`).all();
  res.json({ visualizations: vizs.map(v => ({ ...v, config: JSON.parse(v.config_json || '{}') })) });
});

// POST /api/visualizations — save chart
router.post('/', (req, res) => {
  const db = getDb();
  const { datasetId, name, chartType, config } = req.body;
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId);
  if (!dataset) return res.status(404).json({ error: 'Dataset not found' });
  let sql = '';
  try { ({ sql } = buildVizQuery(db, dataset.table_name, { chartType, ...config })); } catch {}
  const id = uuidv4();
  db.prepare(`INSERT INTO visualizations (id, dataset_id, name, chart_type, config_json, query_sql) VALUES (?,?,?,?,?,?)`)
    .run(id, datasetId, name, chartType, JSON.stringify(config), sql);
  const viz = db.prepare('SELECT * FROM visualizations WHERE id = ?').get(id);
  res.json({ visualization: { ...viz, config: JSON.parse(viz.config_json || '{}') } });
});

// PUT /api/visualizations/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, chartType, config } = req.body;
  const viz = db.prepare('SELECT * FROM visualizations WHERE id = ?').get(req.params.id);
  if (!viz) return res.status(404).json({ error: 'Not found' });
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(viz.dataset_id);
  let sql = '';
  try { ({ sql } = buildVizQuery(db, dataset.table_name, { chartType, ...config })); } catch {}
  db.prepare(`UPDATE visualizations SET name=?, chart_type=?, config_json=?, query_sql=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(name || viz.name, chartType || viz.chart_type, JSON.stringify(config), sql, req.params.id);
  res.json({ success: true });
});

// DELETE /api/visualizations/:id
router.delete('/:id', (req, res) => {
  getDb().prepare('DELETE FROM visualizations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/visualizations/kpi/:datasetId
router.get('/kpi/:datasetId', (req, res) => {
  const db = getDb();
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(req.params.datasetId);
  if (!dataset) return res.status(404).json({ error: 'Not found' });
  const schema = JSON.parse(dataset.schema_json || '[]');
  const numericCols = schema.filter(c => c.type === 'integer' || c.type === 'real');
  const kpis = numericCols.slice(0, 6).map(col => {
    const agg = db.prepare(
      `SELECT SUM(CAST("${col.name}" AS REAL)) as total,
              AVG(CAST("${col.name}" AS REAL)) as avg,
              COUNT(*) as count
       FROM "${dataset.table_name}" WHERE "${col.name}" IS NOT NULL`
    ).get();
    return { column: col.name, ...agg };
  });
  res.json({ kpis });
});

export default router;