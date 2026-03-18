import React, { useState, useEffect } from 'react';
import { Settings, BookOpen, Database, Palette, BarChart3, Info, ChevronDown, ChevronRight, Zap, Layers, Check } from 'lucide-react';

/* ── localStorage helpers ──────────────────────────────── */
const KEYS = {
  previewSize: 'settings_previewSize',
  chartLib:    'settings_chartLib',
};

function loadSetting(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/* ── SettingsPage ──────────────────────────────────────── */
export function SettingsPage() {
  // Initialise from localStorage so values survive navigation
  const [previewSize, setPreviewSizeState] = useState(() => loadSetting(KEYS.previewSize, 100));
  const [chartLib,    setChartLibState]    = useState(() => loadSetting(KEYS.chartLib,    'chartjs'));
  const [saved, setSaved] = useState(false);

  const setPreviewSize = (v) => { setPreviewSizeState(v); saveSetting(KEYS.previewSize, v); };
  const setChartLib    = (v) => { setChartLibState(v);    saveSetting(KEYS.chartLib,    v); };

  // Show brief "Saved" confirmation when any setting changes
  useEffect(() => {
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 1400);
    return () => clearTimeout(t);
  }, [previewSize, chartLib]);

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Configure DataFlow Lab preferences</div>
        </div>
        {/* Saved indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 600,
          color: saved ? 'var(--success)' : 'transparent',
          transition: 'color 0.3s',
        }}>
          <Check size={13} /> Saved
        </div>
      </div>

      <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Appearance */}
        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Palette size={14} style={{ color: 'var(--accent)' }} /> Appearance
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, padding: '14px 16px', background: 'var(--accent-dim)', border: '2px solid var(--accent)', borderRadius: 10, cursor: 'pointer', textAlign: 'center' }}>
              <div style={{ width: 32, height: 20, background: 'linear-gradient(135deg,#f5f4fa,#fff)', borderRadius: 4, margin: '0 auto 6px', border: '1px solid var(--border)' }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>Light Purple</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Current theme</div>
            </div>
          </div>
        </div>

        {/* Visualization */}
        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChart3 size={14} style={{ color: 'var(--accent)' }} /> Visualization
            </span>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Default Chart Library</label>
            <select value={chartLib} onChange={e => setChartLib(e.target.value)}>
              <option value="chartjs">Chart.js (default)</option>
              <option value="plotly">Plotly.js</option>
            </select>
          </div>
        </div>

        {/* Data */}
        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Database size={14} style={{ color: 'var(--accent)' }} /> Data
            </span>
          </div>
          <div className="form-group">
            <label>Default Preview Row Count</label>
            <select value={previewSize} onChange={e => setPreviewSize(Number(e.target.value))}>
              {[50, 100, 250, 500].map(n => (
                <option key={n} value={n}>{n} rows per page</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Applies to Data Explorer. Takes effect on next navigation.
            </div>
          </div>
          <div className="info-banner" style={{ marginBottom: 0 }}>
            <Info size={13} />
            DataFlow Lab is optimized for datasets up to 1M rows. For larger datasets, consider pre-aggregating externally before importing.
          </div>
        </div>

        {/* About */}
        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={14} style={{ color: 'var(--accent)' }} /> About
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            <div>Version: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>2.0.0</span></div>
            <div>Backend: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>Node.js + Express + SQLite</span></div>
            <div>Frontend: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>React + Vite + Chart.js</span></div>
            <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--accent-dim)', borderRadius: 8, color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>
              🔒 All data is stored locally. Nothing is sent to external servers.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── GuidePage (unchanged) ─────────────────────────────── */
const GUIDE_SECTIONS = [
  {
    title: '1. Import a Dataset',
    content: `Go to the Dashboard and click "Import Dataset". Upload a CSV, Excel (.xlsx/.xls), or JSON file, or paste a public URL.\n\nDataFlow Lab auto-detects column types (integer, real, text) and computes statistics including row count, missing values, and unique counts.`,
  },
  {
    title: '2. Explore Data (Data Explorer)',
    content: `The Data Explorer shows your dataset as a scrollable, sortable, filterable table.\n\n• Click any column header to sort ascending/descending\n• Use the filter controls to search within a column\n• Click the ℹ️ icon on a column header to open Column Statistics (missing count, unique count, min/max/mean, top values)\n• Undo/Redo your sort and filter actions with the toolbar buttons\n• Toggle to SQL Mode to run custom SELECT queries directly against your dataset`,
  },
  {
    title: '3. SQL Query Mode (Explorer)',
    content: `In the Data Explorer, click "SQL Query" to open the query panel.\n\nOnly SELECT queries are allowed — write queries like:\n\n  SELECT department, COUNT(*) as count\n  FROM your_table\n  GROUP BY department\n  ORDER BY count DESC;\n\nPress Ctrl+Enter to run. Errors are shown with clear messages. Mutation statements (INSERT, UPDATE, DELETE, DROP) are blocked.`,
  },
  {
    title: '4. Studio — Cleaning + Visualization + Pipeline',
    content: `The Studio is the core of DataFlow Lab. It's a unified canvas where you can:\n\n• Add Operations (cleaning steps) with the + Add Operation button\n• Add Visualizations (charts) with the + Add Visualization button\n• Mix operations and charts in any order\n• Reorder steps by dragging the up/down arrows\n• Toggle steps on/off with the eye icon\n• Undo/Redo changes with the toolbar buttons\n\nAll applied operations appear in the History sidebar on the right.`,
  },
  {
    title: '5. Adding a Cleaning Operation',
    content: `Click "+ Add Operation" to open the operation picker. Operations are grouped:\n\n• Column Operations: Rename, Delete column\n• Missing Data: Remove nulls, Fill with mean/median/custom value\n  — Fill with value works for both numeric AND string/categorical columns\n• Duplicates: Remove duplicates\n• Text Cleaning: Lowercase, Uppercase, Trim, Find & Replace\n• Numeric Transforms: Normalize (min-max 0–1)\n• Date Transforms: Extract Year, Month, Day\n\nAfter adding, select a column using checkboxes, configure any parameters, optionally load a Preview to see before/after values, then click Apply.`,
  },
  {
    title: '6. Adding a Visualization',
    content: `Click "+ Add Visualization" to pick a chart type (Bar, Line, Pie, Donut, Scatter, Histogram, Time Series).\n\nEach chart card lets you:\n• Select X Axis column\n• Select Y Axis column (optional — defaults to COUNT)\n• Choose aggregation (COUNT, SUM, AVG, MIN, MAX)\n• Set row limit\n• Run the query and see the chart\n• Save the chart to use in a Dashboard`,
  },
  {
    title: '7. Dashboard Builder',
    content: `Create a dashboard and add widgets:\n• Chart widgets — display saved visualizations\n• KPI widgets — custom metric + label\n• Numeric columns automatically generate KPI summary cards at the top\n\nDelete widgets or the entire dashboard as needed.`,
  },
  {
    title: '8. Code Generator',
    content: `Every operation you apply generates:\n• SQL — the actual query run against the database\n• Python (Pandas) — equivalent pandas code\n\nThe Code Generator page shows all generated code in an editable text area. You can:\n• Run SQL queries live and see results in the table below\n• Copy or download the full script\n• Append individual operations from the history sidebar`,
  },
  {
    title: '9. Export Center',
    content: `Export your dataset or code:\n• Dataset: CSV, Excel (.xlsx), JSON\n• Code: SQL script (all operations), Python script (Pandas pipeline)\n\nExports run server-side for efficiency, even with large datasets.`,
  },
  {
    title: 'Dataset Size Guidelines',
    content: `DataFlow Lab is built for local personal use:\n\n• Small (1k–50k rows) — instant\n• Medium (50k–500k rows) — fast (seconds)\n• Large (up to 1M rows) — supported, some ops may be slower\n\nFor 10M+ row datasets, pre-aggregate with DuckDB or Polars first.`,
  },
];

export function GuidePage() {
  const keys = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const initialState = Object.fromEntries(keys.map(k => [k, true]));

  const [open, setOpen] = useState(initialState);
  const toggle = (i) => setOpen(o => ({ ...o, [i]: !o[i] }));

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <div>
          <div className="page-title">User Guide</div>
          <div className="page-subtitle">Complete reference for all DataFlow Lab features</div>
        </div>
      </div>

      <div style={{ maxWidth: 740 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--accent-dim)', border: '1.5px solid rgba(124,58,237,0.2)', borderRadius: 10, marginBottom: 20 }}>
          <Layers size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--accent)' }}>DataFlow Lab is flexible</strong> — use any module independently in any order. There is no required workflow.
          </span>
        </div>

        {GUIDE_SECTIONS.map((s, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <button onClick={() => toggle(i)} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '13px 18px',
              background: open[i] ? 'var(--accent-dim)' : 'var(--bg-surface)',
              border: `1.5px solid ${open[i] ? 'rgba(124,58,237,0.25)' : 'var(--border)'}`,
              borderRadius: open[i] ? '10px 10px 0 0' : 10,
              cursor: 'pointer', color: open[i] ? 'var(--accent)' : 'var(--text-primary)',
              fontSize: 14, fontWeight: 700,
              borderBottom: open[i] ? 'none' : undefined, transition: 'var(--transition)',
            }}>
              {s.title}
              {open[i] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
            {open[i] && (
              <div style={{
                padding: '16px 20px', background: 'var(--bg-surface)',
                border: '1.5px solid rgba(124,58,237,0.2)', borderTop: 'none',
                borderRadius: '0 0 10px 10px',
                fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.85,
                whiteSpace: 'pre-line',
              }}>
                {s.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}