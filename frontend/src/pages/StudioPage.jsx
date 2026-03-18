import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Plus, Undo2, Redo2, Trash2, Eye, EyeOff, ChevronDown, ChevronRight,
  X, Check, AlertTriangle, BarChart3, Wrench, BarChart2, TrendingUp,
  PieChart, ScatterChart, Activity, RefreshCw, Save, Layers, Zap,
  AlertCircle, Database, ArrowRight, Table2, CloudOff, Cloud,
  Lightbulb, Lock, Search, Info
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line, Pie, Doughnut, Scatter } from 'react-chartjs-2';
import useStore from '../store';
import api from '../utils/api';
import DatasetSelector from '../components/shared/DatasetSelector';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

/* ═══════════════════════════════════════════════════════════════
   OPERATION DEFINITIONS — multi:true = allows multiple columns
   ═══════════════════════════════════════════════════════════════ */
const OP_GROUPS = [
  { group: 'Column', color: '#7c3aed', ops: [
    { id: 'select_columns',    label: 'Select columns (keep)',  multi: true,  extraParams: [] },
    { id: 'duplicate_column',  label: 'Duplicate column',       multi: false, extraParams: [] },
    { id: 'merge_columns',     label: 'Merge columns',          multi: true,  extraParams: ['newName','separator'] },
    { id: 'split_column',      label: 'Split column',           multi: false, extraParams: ['separator','nameLeft','nameRight'] },
    { id: 'add_column_formula',label: 'Add column (formula)🔥', multi: false, extraParams: ['newName','formula'], noCol: true },
    { id: 'rename_multiple',   label: 'Rename multiple',        multi: false, extraParams: ['renames'], noCol: true },
    { id: 'rename_column',     label: 'Rename column',          multi: false, extraParams: ['newName'] },
    { id: 'drop_column',       label: 'Delete column(s)',       multi: true,  extraParams: [], danger: true },
    { id: 'change_type_numeric', label: 'Change type → Number', multi: true,  extraParams: [] },
    { id: 'change_type_text',  label: 'Change type → Text',     multi: true,  extraParams: [] },
  ]},
  { group: 'Rows', color: '#0891b2', ops: [
    { id: 'filter_rows',            label: 'Filter rows',              multi: false, extraParams: ['operator','value'] },
    { id: 'remove_rows_condition',  label: 'Remove rows by condition', multi: false, extraParams: ['operator','value'] },
    { id: 'sort_rows',              label: 'Sort rows',                multi: true,  extraParams: ['direction'] },
    { id: 'limit_rows',             label: 'Limit rows',               multi: false, extraParams: ['n'], noCol: true },
    { id: 'sample_rows',            label: 'Sample rows (random)',     multi: false, extraParams: ['n'], noCol: true },
    { id: 'remove_duplicates',      label: 'Remove all duplicates',    multi: false, extraParams: [], noCol: true },
    { id: 'remove_duplicates_by_col', label: 'Drop dupes keep first/last', multi: true, extraParams: ['keep'] },
  ]},
  { group: 'Missing Data', color: '#2563eb', ops: [
    { id: 'remove_nulls',         label: 'Remove null rows',        multi: true, extraParams: [] },
    { id: 'fill_mean',            label: 'Fill with mean',          multi: true, extraParams: [], numericOnly: true },
    { id: 'fill_median',          label: 'Fill with median',        multi: true, extraParams: [], numericOnly: true },
    { id: 'fill_value',           label: 'Fill with value',         multi: true, extraParams: ['value'] },
    { id: 'fill_mode',            label: 'Fill with mode',          multi: true, extraParams: [] },
    { id: 'fill_forward',         label: 'Forward fill',            multi: true, extraParams: [] },
    { id: 'fill_backward',        label: 'Backward fill',           multi: true, extraParams: [] },
    { id: 'fill_constant_numeric',label: 'Fill numeric constant',   multi: true, extraParams: ['constant'], numericOnly: true },
    { id: 'fill_by_group',        label: 'Fill by group mean',      multi: true, extraParams: ['groupColumn'], numericOnly: true },
  ]},
  { group: 'Encoding 🔥', color: '#7c3aed', ops: [
    { id: 'label_encoding',  label: 'Label encoding',   multi: true, extraParams: [] },
    { id: 'one_hot_encoding',label: 'One-hot encoding', multi: true, extraParams: [] },
    { id: 'binary_encoding', label: 'Binary encoding',  multi: true, extraParams: [] },
  ]},
  { group: 'Text', color: '#059669', ops: [
    { id: 'lowercase',              label: 'Lowercase',            multi: true,  extraParams: [] },
    { id: 'uppercase',              label: 'Uppercase',            multi: true,  extraParams: [] },
    { id: 'capitalize',             label: 'Capitalize',           multi: true,  extraParams: [] },
    { id: 'trim',                   label: 'Trim whitespace',      multi: true,  extraParams: [] },
    { id: 'replace_text',           label: 'Find & replace',       multi: true,  extraParams: ['find','replace'] },
    { id: 'string_replace_condition', label: 'Replace with condition', multi: true, extraParams: ['condition','replacement'] },
    { id: 'remove_special_chars',   label: 'Remove special chars', multi: true,  extraParams: [] },
    { id: 'remove_numbers',         label: 'Remove numbers',       multi: true,  extraParams: [] },
    { id: 'string_length',          label: 'String length',        multi: true,  extraParams: [] },
  ]},
  { group: 'Numeric', color: '#d97706', ops: [
    { id: 'normalize',         label: 'Normalize (0–1)',        multi: true, extraParams: [], numericOnly: true },
    { id: 'normalize_range',   label: 'Scale (custom range)',   multi: true, extraParams: ['rangeMin','rangeMax'], numericOnly: true },
    { id: 'standardize',       label: 'Standardize (z-score)', multi: true, extraParams: [], numericOnly: true },
    { id: 'log_transform',     label: 'Log transform',          multi: true, extraParams: [], numericOnly: true },
    { id: 'clip_values',       label: 'Clip values (min/max)',  multi: true, extraParams: ['clipMin','clipMax'], numericOnly: true },
    { id: 'absolute_value',    label: 'Absolute value',         multi: true, extraParams: [], numericOnly: true },
    { id: 'round_values',      label: 'Round',                  multi: true, extraParams: ['decimals'], numericOnly: true },
    { id: 'floor_values',      label: 'Floor',                  multi: true, extraParams: [], numericOnly: true },
    { id: 'rank_column',       label: 'Rank',                   multi: true, extraParams: [], numericOnly: true },
    { id: 'percentile_column', label: 'Percentile',             multi: true, extraParams: [], numericOnly: true },
  ]},
  { group: 'Outlier 🔥', color: '#dc2626', ops: [
    { id: 'detect_outliers_iqr', label: 'Detect outliers (IQR)',   multi: true, extraParams: [], numericOnly: true },
    { id: 'remove_outliers_iqr', label: 'Remove outliers',         multi: true, extraParams: [], numericOnly: true },
    { id: 'cap_outliers_iqr',    label: 'Cap outliers (winsorize)',multi: true, extraParams: [], numericOnly: true },
  ]},
  { group: 'Binning 🔥', color: '#8b5cf6', ops: [
    { id: 'bin_equal_width', label: 'Equal width binning',     multi: false, extraParams: ['bins','outputCol'] },
    { id: 'bin_custom',      label: 'Custom binning',          multi: false, extraParams: ['edges','outputCol'] },
  ]},
  { group: 'Aggregation 🔥', color: '#0891b2', ops: [
    { id: 'group_agg', label: 'Group by + aggregate', multi: false, extraParams: ['groupColumn','valueColumn','aggFunction'], noCol: true },
  ]},
  { group: 'Boolean / Condition', color: '#059669', ops: [
    { id: 'create_flag',          label: 'Create flag (if condition)', multi: false, extraParams: ['operator','value','flagName'] },
    { id: 'conditional_replace',  label: 'Conditional replace',       multi: false, extraParams: ['condOp','condition','replacement'] },
  ]},
  { group: 'Date', color: '#dc2626', ops: [
    { id: 'convert_to_date',label: 'Convert to date',    multi: true,  extraParams: [] },
    { id: 'extract_year',   label: 'Extract year',       multi: true,  extraParams: [] },
    { id: 'extract_month',  label: 'Extract month',      multi: true,  extraParams: [] },
    { id: 'extract_day',    label: 'Extract day',        multi: true,  extraParams: [] },
    { id: 'extract_weekday',label: 'Extract weekday',    multi: true,  extraParams: [] },
    { id: 'extract_hour',   label: 'Extract hour',       multi: true,  extraParams: [] },
    { id: 'extract_quarter',label: 'Extract quarter',    multi: true,  extraParams: [] },
    { id: 'date_diff',      label: 'Difference between dates', multi: false, extraParams: ['columnB','outputCol'] },
  ]},
];
const ALL_OPS = OP_GROUPS.flatMap(g => g.ops);

/* ═══════════════════════════════════════════════════════════════
   CHART GROUPS — multi-column where relevant
   ═══════════════════════════════════════════════════════════════ */
const CHART_GROUPS = [
  { group: 'Comparison', color: '#7c3aed', charts: [
    { id: 'bar',            label: 'Bar Chart' },
    { id: 'horizontal_bar', label: 'Horizontal Bar' },
    { id: 'grouped_bar',    label: 'Grouped Bar',   multiY: true },
    { id: 'stacked_bar',    label: 'Stacked Bar',   multiY: true },
  ]},
  { group: 'Trend', color: '#2563eb', charts: [
    { id: 'line',           label: 'Line Chart' },
    { id: 'multi_line',     label: 'Multi-line',    multiY: true },
    { id: 'area',           label: 'Area Chart' },
    { id: 'rolling_avg',    label: 'Rolling Average' },
    { id: 'timeseries',     label: 'Time Series' },
  ]},
  { group: 'Distribution', color: '#059669', charts: [
    { id: 'histogram',      label: 'Histogram' },
    { id: 'violin',         label: 'Violin Plot 🔥' },
    { id: 'density',        label: 'Density Plot' },
    { id: 'cumulative',     label: 'Cumulative Distribution' },
    { id: 'boxplot',        label: 'Box Plot' },
  ]},
  { group: 'Relationship', color: '#d97706', charts: [
    { id: 'scatter',        label: 'Scatter' },
    { id: 'bubble',         label: 'Bubble' },
    { id: 'regression',     label: 'Regression Line' },
    { id: 'pair_plot',      label: 'Pair Plot 🔥',   multiY: true },
    { id: 'heatmap',        label: 'Correlation Heatmap', multiY: true },
  ]},
  { group: 'Correlation', color: '#0891b2', charts: [
    { id: 'corr_matrix',    label: 'Correlation Matrix', multiY: true },
    { id: 'feature_importance', label: 'Feature Importance' },
  ]},
  { group: 'Composition', color: '#dc2626', charts: [
    { id: 'pie',            label: 'Pie' },
    { id: 'donut',          label: 'Donut' },
    { id: 'stacked_area',   label: 'Stacked Area',   multiY: true },
    { id: 'stacked_100',    label: '100% Stacked Bar', multiY: true },
  ]},
  { group: 'Advanced 🔥', color: '#8b5cf6', charts: [
    { id: 'auto_suggest',   label: 'Auto Chart Suggestion 🔥' },
    { id: 'top_n',          label: 'Top-N Categories' },
    { id: 'anomaly',        label: 'Anomaly Highlight' },
    { id: 'dist_by_target', label: 'Distribution by Target', multiY: true },
  ]},
];
const ALL_CHARTS = CHART_GROUPS.flatMap(g => g.charts);
const COLORS = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#8b5cf6','#84cc16','#f472b6','#fb923c'];

/* ─── Chart render ───────────────────────────────────────────── */
const COPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#6b5f8a', font: { family: 'Plus Jakarta Sans', size: 11 } } }, tooltip: { backgroundColor: '#fff', borderColor: '#e2ddf0', borderWidth: 1.5, titleColor: '#1e1535', bodyColor: '#6b5f8a' } },
  scales: { x: { ticks: { color: '#a89ec4', font: { size: 11 } }, grid: { color: '#f0eef8' } }, y: { ticks: { color: '#a89ec4', font: { size: 11 } }, grid: { color: '#f0eef8' } } },
};

function buildChartData(rows, chartType, yColumns) {
  if (!rows?.length) return null;
  const multiY = yColumns?.length > 1;

  if (chartType === 'pie' || chartType === 'donut') {
    return { labels: rows.map(r => String(r.x ?? r.label ?? '')), datasets: [{ data: rows.map(r => Number(r.y ?? r.value ?? 0)), backgroundColor: COLORS, borderWidth: 2, borderColor: '#fff' }] };
  }
  if (chartType === 'scatter' || chartType === 'bubble' || chartType === 'regression') {
    return { datasets: [{ label: 'Data', data: rows.map(r => ({ x: Number(r.x), y: Number(r.y) })), backgroundColor: '#7c3aed88', pointRadius: 5 }] };
  }
  if (chartType === 'horizontal_bar') {
    return {
      labels: rows.map(r => String(r.x ?? '')),
      datasets: [{ label: 'Value', data: rows.map(r => Number(r.y ?? 0)), backgroundColor: COLORS.map(c => c + 'bb'), borderColor: '#7c3aed', borderWidth: 1.5, indexAxis: 'y' }],
    };
  }
  if (multiY && yColumns) {
    return {
      labels: rows.map(r => String(r.x ?? '')),
      datasets: yColumns.map((col, i) => ({
        label: col, data: rows.map(r => Number(r[col] ?? r[`y${i}`] ?? 0)),
        backgroundColor: COLORS[i % COLORS.length] + 'bb',
        borderColor: COLORS[i % COLORS.length], borderWidth: 2,
        fill: chartType === 'stacked_area',
        tension: 0.35,
      })),
    };
  }
  return {
    labels: rows.map(r => String(r.x ?? '')),
    datasets: [{ label: 'Value', data: rows.map(r => Number(r.y ?? r.value ?? 0)), backgroundColor: (chartType === 'line' || chartType === 'area') ? 'rgba(124,58,237,0.1)' : COLORS.map(c => c + 'bb'), borderColor: '#7c3aed', fill: chartType === 'area' || chartType === 'stacked_area', tension: 0.35, pointBackgroundColor: '#7c3aed', borderWidth: 2 }],
  };
}

function MiniChart({ chartType, data }) {
  if (!data) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--text-muted)', fontSize:11 }}>Run query</div>;
  const noScale = { ...COPTS, scales: undefined };
  const hbar = { ...COPTS, indexAxis: 'y' };
  if (chartType === 'pie')          return <Pie      data={data} options={noScale} style={{ height:'100%' }} />;
  if (chartType === 'donut')        return <Doughnut data={data} options={noScale} style={{ height:'100%' }} />;
  if (chartType === 'scatter' || chartType === 'bubble' || chartType === 'regression') return <Scatter data={data} options={COPTS} style={{ height:'100%' }} />;
  if (chartType === 'line' || chartType === 'area' || chartType === 'multi_line' || chartType === 'timeseries' || chartType === 'rolling_avg') return <Line data={data} options={COPTS} style={{ height:'100%' }} />;
  if (chartType === 'horizontal_bar') return <Bar data={data} options={hbar} style={{ height:'100%' }} />;
  return <Bar data={data} options={COPTS} style={{ height:'100%' }} />;
}

/* ─── Dependency analysis ────────────────────────────────────── */
function computeDeps(steps) {
  const warns = {}, clean = steps.filter(s => s.type === 'clean');
  for (let i = 0; i < clean.length; i++) {
    const step = clean[i];
    if (step.enabled === false) continue;
    const cols = step.params?.columns?.length ? step.params.columns : (step.params?.column ? [step.params.column] : []);
    for (const col of cols) {
      for (let j = 0; j < i; j++) {
        const prev = clean[j];
        if (prev.enabled === false) continue;
        if (prev.opId === 'rename_column' && prev.params?.column === col)
          warns[step.id] = { type: 'warning', msg: `⚠ Step ${j+1} me-rename "${col}" → "${prev.params?.newName}"` };
        if (prev.opId === 'drop_column' && (prev.params?.columns||[prev.params?.column]).includes(col))
          warns[step.id] = { type: 'error', msg: `⚠ Step ${j+1} menghapus kolom "${col}"` };
      }
    }
  }
  return warns;
}

/* ═══════════════════════════════════════════════════════════════
   OP PICKER MODAL — with search
   ═══════════════════════════════════════════════════════════════ */
function OpPickerModal({ onClose, onPick }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(
    Object.fromEntries(OP_GROUPS.map(g => [g.group, true]))
  );
  const inputRef = useRef();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return OP_GROUPS;
    const q = search.toLowerCase();
    return OP_GROUPS.map(g => ({
      ...g,
      ops: g.ops.filter(op => op.label.toLowerCase().includes(q) || op.id.toLowerCase().includes(q) || g.group.toLowerCase().includes(q))
    })).filter(g => g.ops.length > 0);
  }, [search]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Add Operation</span>
          <button className="btn-icon" onClick={onClose}><X size={16}/></button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', background: 'var(--bg-elevated)', border: '1.5px solid var(--border)', borderRadius: 8 }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
            <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search operations…"
              style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--text-primary)', width: '100%' }}/>
            {search && <button onClick={() => setSearch('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--text-muted)' }}><X size={12}/></button>}
          </div>
          {search && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>{filtered.reduce((a,g)=>a+g.ops.length,0)} result(s)</div>}
        </div>

        <div className="modal-body" style={{ padding: '8px 12px', overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>No operations match "{search}"</div>
          ) : filtered.map(g => (
            <div key={g.group} style={{ marginBottom: 6 }}>
              <button onClick={() => !search && setOpen(s => ({ ...s, [g.group]: !s[g.group] }))}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-elevated)', border: '1.5px solid var(--border)', borderRadius: (open[g.group] || search) ? '8px 8px 0 0' : 8, cursor: 'pointer', color: g.color, fontSize: 11.5, fontWeight: 700, borderBottom: (open[g.group] || search) ? 'none' : undefined }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: g.color }}/>{g.group}</span>
                {!search && ((open[g.group]) ? <ChevronDown size={12}/> : <ChevronRight size={12}/>)}
              </button>
              {(open[g.group] || search) && (
                <div style={{ border: '1.5px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
                  {g.ops.map((op, i) => (
                    <button key={op.id} onClick={() => { onPick(op); onClose(); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 13px', background: 'var(--bg-surface)', border: 'none', borderBottom: i < g.ops.length-1 ? '1px solid var(--border-subtle)' : 'none', cursor: 'pointer', color: op.danger ? 'var(--danger)' : 'var(--text-primary)', fontSize: 13, fontWeight: 500, textAlign: 'left', transition: 'var(--transition)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-surface)'}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: g.color, flexShrink: 0 }}/>
                      <span style={{ flex: 1 }}>{op.label}</span>
                      {op.multi && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: 700 }}>MULTI</span>}
                      {op.numericOnly && <span className="badge badge-orange" style={{ fontSize: 9 }}>numeric</span>}
                      {op.danger && <span className="badge badge-red" style={{ fontSize: 9 }}>destructive</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VIZ PICKER MODAL — with search
   ═══════════════════════════════════════════════════════════════ */
function VizPickerModal({ onClose, onPick }) {
  const [search, setSearch] = useState('');
  const inputRef = useRef();
  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return CHART_GROUPS;
    const q = search.toLowerCase();
    return CHART_GROUPS.map(g => ({ ...g, charts: g.charts.filter(c => c.label.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)) })).filter(g => g.charts.length > 0);
  }, [search]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 500, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Add Visualization</span>
          <button className="btn-icon" onClick={onClose}><X size={16}/></button>
        </div>

        <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', background: 'var(--bg-elevated)', border: '1.5px solid var(--border)', borderRadius: 8 }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
            <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chart types…"
              style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--text-primary)', width: '100%' }}/>
            {search && <button onClick={() => setSearch('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--text-muted)' }}><X size={12}/></button>}
          </div>
        </div>

        <div className="modal-body" style={{ padding: '10px 14px', overflowY: 'auto', flex: 1 }}>
          {filtered.map(g => (
            <div key={g.group} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>{g.group}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {g.charts.map(ct => (
                  <button key={ct.id} onClick={() => { onPick(ct); onClose(); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '9px 6px', background: 'var(--bg-elevated)', border: '1.5px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-primary)', fontSize: 11.5, fontWeight: 600, transition: 'var(--transition)', lineHeight: 1.3 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = g.color; e.currentTarget.style.color = g.color; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-primary)'; }}>
                    <span style={{ fontSize: 18 }}>
                      {g.group.includes('Trend') ? '📈' : g.group.includes('Distribution') ? '📊' : g.group.includes('Relation') ? '🔵' : g.group.includes('Corr') ? '🟥' : g.group.includes('Comp') ? '🥧' : g.group.includes('Adv') ? '🔥' : '📉'}
                    </span>
                    {ct.label}
                    {ct.multiY && <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 4, background: g.color+'22', color: g.color, fontWeight: 700 }}>MULTI</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MULTI-COLUMN SELECTOR — reusable component
   ═══════════════════════════════════════════════════════════════ */
function ColSelector({ schema, selected, onChange, multi = false, numericOnly = false, label = 'Column', required = true }) {
  const [search, setSearch] = useState('');
  const cols = schema.filter(c => {
    if (numericOnly && c.type === 'text') return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggle = (name) => {
    if (!multi) { onChange(name === selected[0] ? [] : [name]); return; }
    const next = selected.includes(name) ? selected.filter(s => s !== name) : [...selected, name];
    onChange(next);
  };
  const selAll = () => onChange(cols.map(c => c.name));
  const clrAll = () => onChange([]);

  return (
    <div className="form-group">
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{label}{required && !selected.length && <span style={{ color: 'var(--danger)', marginLeft: 5, fontWeight: 700 }}>← required</span>}</span>
        {multi && schema.length > 0 && (
          <span style={{ display: 'flex', gap: 8, fontSize: 11, fontWeight: 600 }}>
            <button onClick={selAll} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0 }}>All</button>
            <button onClick={clrAll} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>None</button>
          </span>
        )}
      </label>

      {schema.length > 5 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 6 }}>
          <Search size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter columns…"
            style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 12, color: 'var(--text-primary)', width: '100%' }}/>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' }}>
        {cols.map(col => {
          const isNum = col.type === 'integer' || col.type === 'real';
          const sel   = selected.includes(col.name);
          const dis   = numericOnly && !isNum;
          return (
            <div key={col.name}
              onClick={() => !dis && toggle(col.name)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, cursor: dis ? 'not-allowed' : 'pointer', background: sel ? 'var(--accent-dim)' : 'var(--bg-elevated)', border: `1.5px solid ${sel ? 'var(--accent-light)' : 'transparent'}`, transition: 'var(--transition)', opacity: dis ? 0.4 : 1, fontSize: 13, fontWeight: sel ? 700 : 400, color: sel ? 'var(--accent)' : 'var(--text-primary)', userSelect: 'none' }}>
              <div style={{ width: 13, height: 13, borderRadius: multi ? 3 : '50%', border: `2px solid ${sel ? 'var(--accent)' : 'var(--border)'}`, background: sel ? 'var(--accent)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {sel && <div style={{ width: multi ? 7 : 5, height: multi ? 7 : 5, borderRadius: multi ? 1 : '50%', background: '#fff' }}/>}
              </div>
              <span style={{ flex: 1 }}>{col.name}</span>
              <span className={`badge ${isNum ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 10 }}>{col.type}</span>
            </div>
          );
        })}
        {cols.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0', textAlign: 'center' }}>No columns match</div>}
      </div>
      {multi && selected.length > 0 && (
        <div style={{ marginTop: 5, fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
          {selected.length} selected: {selected.slice(0,4).join(', ')}{selected.length > 4 ? ` +${selected.length-4}` : ''}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   OP STEP CARD
   ═══════════════════════════════════════════════════════════════ */
function OpStepCard({ step, schemaAtStep, idx, total, stepResult, depWarning, datasetId, onRemove, onToggle, onMoveUp, onMoveDown, onParamChange }) {
  const opDef = ALL_OPS.find(o => o.id === step.opId) || {};

  // Derive columns from step.params — prefer columns[], fallback to column
  const deriveCols = (p) => p?.columns?.length ? p.columns : (p?.column ? [p.column] : []);

  const [selCols, setSelCols]   = useState(() => deriveCols(step.params));
  const [extras, setExtras]     = useState(step.params || {});
  const [open, setOpen]         = useState(() => !deriveCols(step.params).length && !opDef.noCol);
  const [opInfo, setOpInfo]     = useState(stepResult?.opInfo || '');
  const infoTimer = useRef(null);

  const groupColor = OP_GROUPS.find(g => g.ops.some(o => o.id === step.opId))?.color || 'var(--accent)';

  // Sync local state when this card gets a completely new step.id
  // (happens when steps are reordered). Since key={step.id + renderKey},
  // undo/redo also triggers full remount via renderKey, so no extra sync needed.
  // We intentionally do NOT watch step.params — local state IS the source of truth.
  // fireChange() pushes local changes up; updateParams() stores them in steps array.
  useEffect(() => {
    const c = deriveCols(step.params);
    setSelCols(c);
    setExtras(step.params || {});
  }, [step.id]); // eslint-disable-line

  // Auto-clear columns that no longer exist in schema (e.g. after rename/drop above)
  useEffect(() => {
    if (!schemaAtStep.length) return;
    const valid = selCols.filter(c => schemaAtStep.some(s => s.name === c));
    if (valid.length !== selCols.length) {
      setSelCols(valid);
      fireChange(valid, extras);
    }
  }, [schemaAtStep]);

  const fireChange = (cols, ext) => {
    const params = { ...ext, columns: cols, column: cols[0] || '' };
    onParamChange(step.id, params);
    // Fetch op info
    if (datasetId && cols.length > 0) {
      clearTimeout(infoTimer.current);
      infoTimer.current = setTimeout(async () => {
        try { const r = await api.getOpInfo(datasetId, step.opId, params); setOpInfo(r.info||''); } catch {}
      }, 400);
    }
  };

  const updCols = (cols) => { setSelCols(cols); fireChange(cols, extras); };
  const updExt  = (k, v) => { const ne = { ...extras, [k]: v }; setExtras(ne); fireChange(selCols, ne); };
  // updExts: update multiple keys at once — avoids stale-closure bug when two updExt calls share the same extras snapshot
  const updExts = (patch) => { const ne = { ...extras, ...patch }; setExtras(ne); fireChange(selCols, ne); };

  const hasErr  = stepResult && !stepResult.success && !stepResult.skipped && !stepResult.blocked;
  const isBlk   = stepResult?.blocked;
  const isOk    = stepResult?.success;

  const isNeedsConfig = stepResult?.needsConfig || (!selCols.length && !opDef.noCol);
  const badge = isBlk ? <span className="badge badge-orange" style={{ fontSize:10 }}>Blocked</span>
    : hasErr ? <span className="badge badge-red" style={{ fontSize:10 }}><AlertCircle size={8} style={{marginRight:3}}/>Error</span>
    : isOk   ? <span className="badge badge-green" style={{ fontSize:10 }}><Check size={8} style={{marginRight:3}}/>{stepResult.rowCount?.toLocaleString()} rows</span>
    : isNeedsConfig ? <span className="badge badge-orange" style={{ fontSize:10 }}>Select column</span>
    : <span className="badge badge-purple" style={{ fontSize:10 }}>Ready</span>;

  const border = hasErr ? 'var(--danger)' : isBlk ? 'rgba(217,119,6,0.4)' : isOk ? 'rgba(5,150,105,0.3)' : 'var(--border)';

  return (
    <div className="fade-in" style={{ background:'var(--bg-surface)', border:`1.5px solid ${border}`, borderRadius:'var(--radius-lg)', opacity: step.enabled ? 1 : 0.5, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 11px', cursor:!isBlk?'pointer':'default', background: open?'var(--bg-surface)':'var(--bg-elevated)' }}
        onClick={() => !isBlk && setOpen(o => !o)}>
        <div style={{ width:20, height:20, borderRadius:'50%', flexShrink:0, background:isOk?'var(--success)':hasErr?'var(--danger)':'var(--bg-elevated)', border:`1.5px solid ${isOk?'var(--success)':hasErr?'var(--danger)':groupColor}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:isOk||hasErr?'#fff':groupColor }}>
          {isOk ? <Check size={10}/> : hasErr ? '!' : isBlk ? '–' : idx+1}
        </div>
        <span style={{ fontWeight:600, fontSize:13, flex:1 }}>{step.label}</span>
        {selCols.length > 0 && !open && (
          <span style={{ fontSize:11, color:'var(--text-secondary)', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {selCols.length === 1 ? selCols[0] : `${selCols.length} cols`}
          </span>
        )}
        {badge}
        <div style={{ display:'flex', gap:1 }} onClick={e => e.stopPropagation()}>
          <button className="btn-icon" onClick={() => onMoveUp(idx)}   disabled={idx===0}        style={{ padding:3 }}><ChevronDown size={11} style={{ transform:'rotate(180deg)' }}/></button>
          <button className="btn-icon" onClick={() => onMoveDown(idx)} disabled={idx===total-1}  style={{ padding:3 }}><ChevronDown size={11}/></button>
          <button className="btn-icon" onClick={() => onToggle(step.id)} style={{ padding:3 }}>{step.enabled?<Eye size={11}/>:<EyeOff size={11}/>}</button>
          <button className="btn-icon" onClick={() => onRemove(step.id)} style={{ padding:3, color:'var(--danger)' }}><Trash2 size={11}/></button>
        </div>
        {!isBlk && <ChevronDown size={12} style={{ transform:open?'rotate(180deg)':'none', transition:'var(--transition)', color:'var(--text-muted)', flexShrink:0 }}/>}
      </div>

      {/* Dependency warning */}
      {depWarning && <div style={{ padding:'5px 11px', fontSize:11.5, fontWeight:500, background:depWarning.type==='error'?'var(--danger-dim)':'var(--warning-dim)', color:depWarning.type==='error'?'var(--danger)':'var(--warning)', borderTop:'1px solid rgba(0,0,0,0.05)' }}>{depWarning.msg}</div>}

      {/* Error / blocked */}
      {hasErr && <div style={{ padding:'5px 11px', background:'var(--danger-dim)', borderTop:'1px solid rgba(220,38,38,0.15)', fontSize:12, color:'var(--danger)', fontWeight:600 }}><AlertCircle size={11} style={{ display:'inline', marginRight:4 }}/>{stepResult.error}</div>}
      {isBlk  && <div style={{ padding:'5px 11px', background:'var(--warning-dim)', borderTop:'1px solid rgba(217,119,6,0.15)', fontSize:11, color:'var(--warning)' }}><Lock size={10} style={{ display:'inline', marginRight:4 }}/>Step sebelumnya gagal.</div>}

      {/* Op info */}
      {isOk && stepResult?.opInfo && <div style={{ padding:'4px 11px', background:'rgba(5,150,105,0.06)', borderTop:'1px solid rgba(5,150,105,0.15)', fontSize:11.5, color:'var(--success)', display:'flex', alignItems:'center', gap:5 }}><Check size={11}/>{stepResult.opInfo}</div>}
      {!isOk && opInfo && selCols.length > 0 && <div style={{ padding:'4px 11px', background:'var(--info-dim)', borderTop:'1px solid rgba(37,99,235,0.15)', fontSize:11.5, color:'var(--info)', display:'flex', alignItems:'center', gap:5 }}><Info size={11}/>{opInfo}</div>}

      {/* Config body */}
      {open && !isBlk && (
        <div style={{ padding:'10px 12px 12px', borderTop:'1px solid var(--border-subtle)' }}>
          {/* Column selector (multi or single) */}
          {!opDef.noCol && (
            <ColSelector
              schema={schemaAtStep}
              selected={selCols}
              onChange={updCols}
              multi={opDef.multi}
              numericOnly={opDef.numericOnly}
              label={opDef.multi ? 'Columns (select one or more)' : 'Column'}
            />
          )}

          {/* Extra params per op */}
          {step.opId === 'rename_column'     && <div className="form-group"><label>New Name</label><input value={extras.newName||''} onChange={e=>updExt('newName',e.target.value)} placeholder="new_name"/></div>}
          {step.opId === 'rename_multiple' && (
            <div className="form-group">
              <label>Rename Columns</label>
              {schemaAtStep.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                  No columns available
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {schemaAtStep.map(col => {
                  const existing = (extras.renames || []).find(r => r.from === col.name);
                  return (
                    <div key={col.name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{
                        flex: '0 0 auto', maxWidth: 120, fontSize: 12, fontWeight: 600,
                        color: 'var(--text-secondary)', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        padding: '5px 8px', background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)', borderRadius: 6
                      }} title={col.name}>{col.name}</span>
                      <ArrowRight size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
                      <input
                        value={existing?.to || ''}
                        placeholder={col.name}
                        onChange={e => {
                          const val = e.target.value;
                          const prev = extras.renames || [];
                          let next;
                          if (!val || val === col.name) {
                            next = prev.filter(r => r.from !== col.name);
                          } else {
                            const idx2 = prev.findIndex(r => r.from === col.name);
                            if (idx2 >= 0) {
                              next = prev.map((r, i) => i === idx2 ? { from: col.name, to: val } : r);
                            } else {
                              next = [...prev, { from: col.name, to: val }];
                            }
                          }
                          updExt('renames', next);
                        }}
                        style={{ flex: 1, fontSize: 12 }}
                      />
                    </div>
                  );
                })}
              </div>
              {(extras.renames?.length > 0) && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                  {extras.renames.length} column(s) will be renamed
                </div>
              )}
            </div>
          )}
          {step.opId === 'fill_value'        && <div className="form-group"><label>Fill Value</label><input value={extras.value||''} onChange={e=>updExt('value',e.target.value)} placeholder="e.g. Unknown or 0"/></div>}
          {step.opId === 'fill_constant_numeric' && <div className="form-group"><label>Constant</label><input type="number" value={extras.constant??''} onChange={e=>updExt('constant',Number(e.target.value))} placeholder="0"/></div>}
          {step.opId === 'fill_by_group'     && <div className="form-group"><label>Group by Column</label><select value={extras.groupColumn||''} onChange={e=>updExt('groupColumn',e.target.value)}><option value="">Select…</option>{schemaAtStep.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></div>}
          {step.opId === 'replace_text'      && (<><div className="form-group"><label>Find</label><input value={extras.find||''} onChange={e=>updExt('find',e.target.value)} placeholder="text to find"/></div><div className="form-group"><label>Replace with</label><input value={extras.replace||''} onChange={e=>updExt('replace',e.target.value)} placeholder="replacement"/></div></>)}
          {step.opId === 'string_replace_condition' && (<><div className="form-group"><label>Condition (LIKE pattern)</label><input value={extras.condition||''} onChange={e=>updExt('condition',e.target.value)} placeholder="%value%"/></div><div className="form-group"><label>Replace with</label><input value={extras.replacement||''} onChange={e=>updExt('replacement',e.target.value)} placeholder="replacement"/></div></>)}
          {(step.opId==='filter_rows'||step.opId==='remove_rows_condition') && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label>Operator</label>
                <select value={extras.operator||'='} onChange={e=>updExt('operator',e.target.value)}>
                  {['=','!=','>','<','>=','<=','contains','not_contains','starts_with','ends_with'].map(o=><option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom:0 }}>
                <label>Value</label>
                <input value={extras.value||''} onChange={e=>updExt('value',e.target.value)} placeholder="value"/>
              </div>
            </div>
          )}
          {step.opId==='sort_rows' && <div className="form-group"><label>Direction</label><select value={extras.direction||'ASC'} onChange={e=>updExt('direction',e.target.value)}><option value="ASC">Ascending (A→Z)</option><option value="DESC">Descending (Z→A)</option></select></div>}
          {(step.opId==='limit_rows'||step.opId==='sample_rows') && <div className="form-group"><label>Number of rows</label><input type="number" value={extras.n||100} onChange={e=>updExt('n',Number(e.target.value))} min={1}/></div>}
          {step.opId==='remove_duplicates_by_col' && <div className="form-group"><label>Keep</label><select value={extras.keep||'first'} onChange={e=>updExt('keep',e.target.value)}><option value="first">First occurrence</option><option value="last">Last occurrence</option></select></div>}
          {step.opId==='merge_columns' && (<><div className="form-group"><label>Separator</label><input value={extras.separator||' '} onChange={e=>updExt('separator',e.target.value)} placeholder=" "/></div><div className="form-group"><label>New Column Name</label><input value={extras.newName||'merged'} onChange={e=>updExt('newName',e.target.value)} placeholder="merged"/></div></>)}
          {step.opId==='split_column' && (<><div className="form-group"><label>Separator</label><input value={extras.separator||' '} onChange={e=>updExt('separator',e.target.value)} placeholder=" "/></div><div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}><div className="form-group" style={{ marginBottom:0 }}><label>Left name</label><input value={extras.nameLeft||''} onChange={e=>updExt('nameLeft',e.target.value)} placeholder={`${selCols[0]||'col'}_1`}/></div><div className="form-group" style={{ marginBottom:0 }}><label>Right name</label><input value={extras.nameRight||''} onChange={e=>updExt('nameRight',e.target.value)} placeholder={`${selCols[0]||'col'}_2`}/></div></div></>)}
          {step.opId==='add_column_formula' && (<><div className="form-group"><label>New Column Name</label><input value={extras.newName||'new_col'} onChange={e=>updExt('newName',e.target.value)} placeholder="new_col"/></div><div className="form-group"><label>Formula (SQL expression)</label><input value={extras.formula||''} onChange={e=>updExt('formula',e.target.value)} placeholder={`"col_a" * "col_b"`}/></div></>)}
          {step.opId==='normalize_range' && (<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}><div className="form-group" style={{ marginBottom:0 }}><label>Min</label><input type="number" value={extras.rangeMin??0} onChange={e=>updExt('rangeMin',Number(e.target.value))}/></div><div className="form-group" style={{ marginBottom:0 }}><label>Max</label><input type="number" value={extras.rangeMax??1} onChange={e=>updExt('rangeMax',Number(e.target.value))}/></div></div>)}
          {step.opId==='clip_values' && (<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}><div className="form-group" style={{ marginBottom:0 }}><label>Min cap</label><input type="number" value={extras.clipMin??''} onChange={e=>updExt('clipMin',e.target.value===''?undefined:Number(e.target.value))} placeholder="no limit"/></div><div className="form-group" style={{ marginBottom:0 }}><label>Max cap</label><input type="number" value={extras.clipMax??''} onChange={e=>updExt('clipMax',e.target.value===''?undefined:Number(e.target.value))} placeholder="no limit"/></div></div>)}
          {step.opId==='round_values' && <div className="form-group"><label>Decimal places</label><input type="number" value={extras.decimals??2} onChange={e=>updExt('decimals',Number(e.target.value))} min={0} max={10}/></div>}
          {step.opId==='bin_equal_width' && (<><div className="form-group"><label>Number of bins</label><input type="number" value={extras.bins||5} onChange={e=>updExt('bins',Number(e.target.value))} min={2}/></div><div className="form-group"><label>Output column name</label><input value={extras.outputCol||''} onChange={e=>updExt('outputCol',e.target.value)} placeholder={`${selCols[0]||'col'}_bin`}/></div></>)}
          {step.opId==='bin_custom' && (
            <>
              <div className="form-group">
                <label>Output Column Name</label>
                <input value={extras.outputCol||''} onChange={e=>updExt('outputCol',e.target.value)} placeholder={`${selCols[0]||'col'}_bin`}/>
              </div>
              <div className="form-group">
                <label>Bin Edges <span style={{fontSize:10,color:'var(--text-muted)',fontWeight:400}}>(comma-separated numbers, min 2)</span></label>
                <input
                  value={extras.edgesStr||''}
                  onChange={e=>{
                    const str = e.target.value;
                    // Only parse complete numbers — ignore trailing comma/space while typing
                    const nums = str.split(',')
                      .map(s => s.trim())
                      .filter(s => s !== '' && !isNaN(Number(s)))
                      .map(Number)
                      .filter(n => isFinite(n));
                    updExts({ edgesStr: str, edges: nums });
                  }}
                  placeholder="0, 25, 50, 75, 100"
                />
                {(extras.edges||[]).length >= 2 && (
                  <div style={{fontSize:10,color:'var(--accent)',marginTop:4,fontWeight:600}}>
                    {extras.edges.length - 1} bin(s): {extras.edges.slice(0,-1).map((e,i)=> i===extras.edges.length-2 ? `≥${e}` : `${e}–${extras.edges[i+1]}`).join(', ')}
                  </div>
                )}
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label>Labels <span style={{fontSize:10,color:'var(--text-muted)',fontWeight:400}}>(optional, one per bin)</span></label>
                <input
                  value={extras.labelsStr||''}
                  onChange={e=>{
                    const str = e.target.value;
                    const arr = str.split(',').map(s=>s.trim()).filter(Boolean);
                    updExts({ labelsStr: str, labels: arr });
                  }}
                  placeholder="Low, Medium, High, Very High"
                />
                {(extras.labels||[]).length > 0 && (extras.edges||[]).length >= 2 && (extras.labels||[]).length !== (extras.edges||[]).length - 1 && (
                  <div style={{fontSize:10,color:'var(--warning,#b45309)',marginTop:4}}>
                    ⚠ {(extras.edges.length-1)} bin(s) but {extras.labels.length} label(s) — counts should match
                  </div>
                )}
              </div>
            </>
          )}
          {step.opId==='group_agg' && (<><div className="form-group"><label>Group by column</label><select value={extras.groupColumn||''} onChange={e=>updExt('groupColumn',e.target.value)}><option value="">Select…</option>{schemaAtStep.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></div><div className="form-group"><label>Value column</label><select value={extras.valueColumn||''} onChange={e=>updExt('valueColumn',e.target.value)}><option value="">Select…</option>{schemaAtStep.filter(c=>c.type!=='text').map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></div><div className="form-group"><label>Aggregation</label><select value={extras.aggFunction||'AVG'} onChange={e=>updExt('aggFunction',e.target.value)}>{['AVG','SUM','COUNT','MIN','MAX'].map(a=><option key={a}>{a}</option>)}</select></div></>)}
          {step.opId==='create_flag' && (<><div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}><div className="form-group" style={{ marginBottom:0 }}><label>Operator</label><select value={extras.operator||'='} onChange={e=>updExt('operator',e.target.value)}>{['=','!=','>','<','>=','<='].map(o=><option key={o}>{o}</option>)}</select></div><div className="form-group" style={{ marginBottom:0 }}><label>Value</label><input value={extras.value||''} onChange={e=>updExt('value',e.target.value)}/></div></div><div className="form-group"><label>Flag column name</label><input value={extras.flagName||''} onChange={e=>updExt('flagName',e.target.value)} placeholder={`${selCols[0]||'col'}_flag`}/></div></>)}
          {step.opId==='conditional_replace' && (<><div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}><div className="form-group" style={{ marginBottom:0 }}><label>Operator</label><select value={extras.condOp||'='} onChange={e=>updExt('condOp',e.target.value)}>{['=','!=','LIKE'].map(o=><option key={o}>{o}</option>)}</select></div><div className="form-group" style={{ marginBottom:0 }}><label>Condition value</label><input value={extras.condition||''} onChange={e=>updExt('condition',e.target.value)}/></div></div><div className="form-group"><label>Replace with</label><input value={extras.replacement||''} onChange={e=>updExt('replacement',e.target.value)} placeholder="new value"/></div></>)}
          {step.opId==='date_diff' && (<><div className="form-group"><label>Second date column</label><select value={extras.columnB||''} onChange={e=>updExt('columnB',e.target.value)}><option value="">Select…</option>{schemaAtStep.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></div><div className="form-group"><label>Output column</label><input value={extras.outputCol||'date_diff'} onChange={e=>updExt('outputCol',e.target.value)}/></div></>)}

          {/* Warnings */}
          {step.opId==='drop_column' && selCols.length>0 && <div className="warning-banner"><AlertTriangle size={12}/>Will delete: {selCols.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VIZ STEP CARD — supports multi-Y columns
   ═══════════════════════════════════════════════════════════════ */
function VizStepCard({ step, previewSchema, idx, total, onRemove, onMoveUp, onMoveDown, onConfigChange, datasetId }) {
  const [open, setOpen]   = useState(true);
  const [cfg, setCfg]     = useState(step.config || { xCol:'', yCols:[], aggregation:'COUNT', limit:50 });
  const [rows, setRows]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [name, setName]   = useState('');

  const chartMeta  = ALL_CHARTS.find(t => t.id === step.chartType) || {};
  const groupColor = CHART_GROUPS.find(g => g.charts.some(c => c.id === step.chartType))?.color || 'var(--accent)';

  const upd = (k, v) => { const n = {...cfg,[k]:v}; setCfg(n); onConfigChange(step.id, n); };

  const run = async () => {
    if (!datasetId || !cfg.xCol) return toast.error('Select X column');
    setLoading(true);
    try {
      const r = await api.queryVisualization(datasetId, { chartType: step.chartType, xCol: cfg.xCol, yCol: cfg.yCols?.[0] || '', yCols: cfg.yCols, aggregation: cfg.aggregation, limit: cfg.limit });
      setRows(r.rows);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const save = async () => {
    if (!rows) return toast.error('Run first');
    try { await api.saveVisualization({ datasetId, name: name||`${step.chartType} of ${cfg.xCol}`, chartType: step.chartType, config: cfg }); toast.success('Chart saved'); }
    catch (e) { toast.error(e.message); }
  };

  const multiY = chartMeta.multiY;
  const chartData = buildChartData(rows, step.chartType, multiY ? cfg.yCols : null);

  return (
    <div className="fade-in" style={{ background:'var(--bg-surface)', border:'1.5px solid var(--border)', borderRadius:'var(--radius-lg)', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 11px', cursor:'pointer', background:'var(--bg-elevated)' }} onClick={() => setOpen(o=>!o)}>
        <span style={{ fontSize:16 }}>📊</span>
        <span style={{ fontWeight:600, fontSize:13, flex:1, color:groupColor }}>{chartMeta.label || step.chartType}</span>
        {cfg.xCol && <span className="badge badge-purple" style={{ fontSize:10 }}>{cfg.xCol}</span>}
        {multiY && cfg.yCols?.length > 0 && <span className="badge badge-blue" style={{ fontSize:10 }}>{cfg.yCols.length}Y</span>}
        <div style={{ display:'flex', gap:1 }} onClick={e=>e.stopPropagation()}>
          <button className="btn-icon" onClick={()=>onMoveUp(idx)}   disabled={idx===0}        style={{ padding:3 }}><ChevronDown size={11} style={{ transform:'rotate(180deg)' }}/></button>
          <button className="btn-icon" onClick={()=>onMoveDown(idx)} disabled={idx===total-1}  style={{ padding:3 }}><ChevronDown size={11}/></button>
          <button className="btn-icon" onClick={()=>onRemove(step.id)} style={{ padding:3, color:'var(--danger)' }}><Trash2 size={11}/></button>
        </div>
        <ChevronDown size={12} style={{ transform:open?'rotate(180deg)':'none', transition:'var(--transition)', color:'var(--text-muted)', flexShrink:0 }}/>
      </div>
      {open && (
        <div style={{ padding:'10px 12px 12px', borderTop:'1px solid var(--border-subtle)' }}>
          {/* X axis */}
          <div className="form-group">
            <label>X Axis</label>
            <select value={cfg.xCol} onChange={e=>upd('xCol',e.target.value)}>
              <option value="">Select…</option>
              {(previewSchema||[]).map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          {/* Y axis — multi if chartMeta.multiY */}
          {multiY ? (
            <ColSelector schema={(previewSchema||[]).filter(c=>c.type!=='text')} selected={cfg.yCols||[]} onChange={v=>upd('yCols',v)} multi={true} numericOnly={true} label="Y Columns (multi-select)" required={false}/>
          ) : (
            <div className="form-group">
              <label>Y Axis</label>
              <select value={cfg.yCols?.[0]||''} onChange={e=>upd('yCols',[e.target.value].filter(Boolean))}>
                <option value="">Count rows</option>
                {(previewSchema||[]).filter(c=>c.type!=='text').map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
            {(cfg.yCols?.length>0) && <div className="form-group" style={{ marginBottom:0 }}>
              <label>Aggregation</label>
              <select value={cfg.aggregation} onChange={e=>upd('aggregation',e.target.value)}>{['COUNT','SUM','AVG','MIN','MAX'].map(a=><option key={a}>{a}</option>)}</select>
            </div>}
            <div className="form-group" style={{ marginBottom:0 }}>
              <label>Row Limit</label>
              <select value={cfg.limit} onChange={e=>upd('limit',Number(e.target.value))}>{[20,50,100,250].map(n=><option key={n} value={n}>{n}</option>)}</select>
            </div>
          </div>

          <div style={{ display:'flex', gap:7, marginBottom: rows?9:0 }}>
            <button className="btn btn-primary btn-sm" onClick={run} disabled={loading||!cfg.xCol} style={{ flex:1 }}>
              {loading?<><span className="spinner" style={{ width:12,height:12 }}/>Running…</>:<><RefreshCw size={11}/>Run</>}
            </button>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Chart name…" style={{ flex:1, fontSize:12 }}/>
            <button className="btn btn-secondary btn-sm" onClick={save} disabled={!rows}><Save size={11}/></button>
          </div>
          {rows && <><div style={{ height:180 }} className="fade-in"><MiniChart chartType={step.chartType} data={chartData}/></div></>}
        </div>
      )}
    </div>
  );
}

/* ─── Preview Panel ──────────────────────────────────────────── */
function PreviewPanel({ rows, schema, rowCount, loading, originalRowCount, cleanOpsCount }) {
  const headers = schema?.map(c=>c.name)||[];
  const diff    = rowCount!==null&&originalRowCount ? rowCount-originalRowCount : null;
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{ padding:'8px 13px', borderBottom:'1.5px solid var(--border)', display:'flex', alignItems:'center', gap:9, flexShrink:0, background:'var(--bg-elevated)' }}>
        <Table2 size={13} style={{ color:'var(--accent)' }}/>
        <span style={{ fontWeight:700, fontSize:13 }}>Preview</span>
        {loading && <span className="spinner" style={{ width:12,height:12 }}/>}
        {!loading && rowCount!==null && (
          <span style={{ fontSize:12, color:'var(--text-secondary)' }}>
            <strong style={{ fontFamily:'var(--font-mono)', color:'var(--text-primary)' }}>{rowCount?.toLocaleString()}</strong> rows
            {diff!==null&&diff!==0 && <span style={{ marginLeft:7, fontSize:11, padding:'2px 7px', borderRadius:99, fontWeight:600, background:diff<0?'var(--info-dim)':'var(--success-dim)', color:diff<0?'var(--info)':'var(--success)' }}>{diff<0?`−${Math.abs(diff).toLocaleString()} removed`:`+${diff.toLocaleString()} added`}</span>}
          </span>
        )}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:5, fontSize:10, padding:'2px 8px', borderRadius:99, background:'var(--accent-dim)', color:'var(--accent)', fontWeight:700 }}>
          <Zap size={9}/> PREVIEW from current data
        </div>
      </div>
      <div style={{ flex:1, overflow:'auto' }}>
        {loading ? (
          <div className="empty-state" style={{ height:'100%' }}><div className="spinner" style={{ width:22,height:22 }}/><p>Replaying pipeline…</p></div>
        ) : !rows?.length ? (
          <div className="empty-state" style={{ height:'100%' }}><Table2 size={24}/><h3>No data</h3><p>Add operations to see preview.</p></div>
        ) : (
          <table className="data-table">
            <thead><tr>
              <th style={{ width:32, color:'var(--text-muted)', fontSize:10 }}>#</th>
              {headers.map(h=>{const col=schema?.find(c=>c.name===h); return <th key={h}><span className={`type-${col?.type||'text'}`} style={{ fontSize:8, marginRight:3 }}>●</span>{h}</th>;})}
            </tr></thead>
            <tbody>
              {rows.map((row,i)=>(
                <tr key={i}>
                  <td style={{ color:'var(--text-muted)', fontSize:10 }}>{i+1}</td>
                  {headers.map(h=>(
                    <td key={h} title={String(row[h]??'')}>
                      {row[h]===null||row[h]===''||row[h]===undefined?<span style={{ color:'var(--text-muted)', fontStyle:'italic', fontSize:10 }}>null</span>:String(row[h])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ─── Rule Engine Panel ──────────────────────────────────────── */
function RuleEnginePanel({ recommendations, onAddStep }) {
  const [filter, setFilter] = useState('all');
  const sev = { warning:{ color:'var(--warning)',bg:'var(--warning-dim)' }, info:{ color:'var(--info)',bg:'var(--info-dim)' }, error:{ color:'var(--danger)',bg:'var(--danger-dim)' } };
  const filtered = filter==='all' ? recommendations : recommendations.filter(r=>r.severity===filter||r.category===filter);
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{ padding:'9px 12px', borderBottom:'1.5px solid var(--border)', flexShrink:0, background:'var(--bg-elevated)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:7 }}>
          <Lightbulb size={13} style={{ color:'var(--accent)' }}/>
          <span style={{ fontWeight:700, fontSize:13 }}>Recommendations</span>
          {recommendations.filter(r=>r.severity==='warning').length>0 && <span className="badge badge-orange" style={{ fontSize:10 }}>{recommendations.filter(r=>r.severity==='warning').length}</span>}
        </div>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{ fontSize:11, padding:'3px 7px', width:'100%' }}>
          <option value="all">All ({recommendations.length})</option>
          <option value="warning">Warnings</option>
          <option value="missing">Missing data</option>
          <option value="duplicates">Duplicates</option>
          <option value="outliers">Outliers</option>
          <option value="text">Text issues</option>
          <option value="distribution">Distribution</option>
        </select>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'8px 10px' }}>
        {filtered.length===0 ? (
          <div style={{ textAlign:'center', color:'var(--text-muted)', fontSize:12, padding:'20px 0' }}><Check size={18} style={{ display:'block', margin:'0 auto 7px', color:'var(--success)' }}/>No issues found</div>
        ) : filtered.map((rec,i)=>{
          const s=sev[rec.severity]||sev.info;
          return (
            <div key={i} style={{ background:'var(--bg-surface)', border:`1.5px solid ${s.color}33`, borderRadius:9, padding:'9px 10px', marginBottom:7 }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:4 }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background:s.color, flexShrink:0, marginTop:4 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:12, color:'var(--text-primary)', marginBottom:2 }}>{rec.title}</div>
                  <div style={{ fontSize:11, color:'var(--text-secondary)', lineHeight:1.5 }}>{rec.description}</div>
                </div>
              </div>
              {rec.suggestedOps?.length>0 && (
                <div style={{ display:'flex', gap:5, flexWrap:'wrap', paddingLeft:12 }}>
                  {rec.suggestedOps.map((op,j)=>(
                    <button key={j} onClick={()=>onAddStep(op)}
                      style={{ fontSize:11, padding:'3px 8px', borderRadius:6, background:s.bg, color:s.color, border:`1px solid ${s.color}44`, cursor:'pointer', fontWeight:600 }}>
                      + {op.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN STUDIO PAGE
   ═══════════════════════════════════════════════════════════════ */
let _seq = 0;
const uid = () => `s${++_seq}_${Date.now()}`;

export default function StudioPage() {
  const { activeDataset, setActiveDataset, appendCode } = useStore();

  const [steps, setSteps]         = useState([]);
  const [origSchema, setOrigSchema] = useState([]);
  const [history, setHistory]     = useState([]);
  const [future, setFuture]       = useState([]);
  const [pRows, setPRows]         = useState(null);
  const [pSchema, setPSchema]     = useState([]);
  const [pCount, setPCount]       = useState(null);
  const [sResults, setSResults]   = useState([]);
  const [pLoading, setPLoading]   = useState(false);
  const [recs, setRecs]           = useState([]);
  const [profiling, setProfiling] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showRules, setShowRules]     = useState(true);
  const [applying, setApplying]   = useState(false);
  const [lastUndo, setLastUndo]   = useState(null);
  const [applyError, setApplyError] = useState('');
  const [showOp, setShowOp]       = useState(false);
  const [showViz, setShowViz]     = useState(false);
  const [opHistory, setOpHistory] = useState([]);
  const [isDirty, setIsDirty]     = useState(false);

  const prevTimer = useRef(null);
  const saveTimer = useRef(null);
  const idRef     = useRef(null);

  useEffect(() => {
    if (!activeDataset || idRef.current === activeDataset.id) return;
    idRef.current = activeDataset.id;
    setOrigSchema(JSON.parse(activeDataset.schema_json||'[]'));
    setHistory([]); setFuture([]);
    setPRows(null); setSResults([]); setLastUndo(null); setRecs([]);
    api.getSavedPipeline(activeDataset.id).then(d => {
      const saved = d.steps?.length ? d.steps : [];
      setSteps(saved); setIsDirty(false);
      if (!saved.length) fetchOrig(); else schedulePreview(saved);
    }).catch(() => { setSteps([]); fetchOrig(); });
    api.getOperationHistory(activeDataset.id).then(d => setOpHistory(d.operations));
    fetchProfile();
  }, [activeDataset?.id]);

  useEffect(() => {
    const h = e => { if (!isDirty) return; e.preventDefault(); e.returnValue='Pipeline has not been saved.'; };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [isDirty]);

  const fetchOrig = useCallback(() => {
    if (!activeDataset) return;
    setPLoading(true);
    api.getDatasetRows(activeDataset.id, { limit: 50 })
      .then(d => { setPRows(d.rows); setPCount(d.total); setPSchema(JSON.parse(activeDataset.schema_json||'[]')); setSResults([]); })
      .catch(() => {}).finally(() => setPLoading(false));
  }, [activeDataset]);

  const fetchProfile = useCallback(() => {
    if (!activeDataset) return;
    setProfiling(true);
    api.getProfile(activeDataset.id).then(d => setRecs(d.recommendations||[])).catch(()=>{}).finally(()=>setProfiling(false));
  }, [activeDataset]);

  const schedulePreview = useCallback((newSteps) => {
    if (!activeDataset) return;
    clearTimeout(prevTimer.current);
    const cleanOps = newSteps.filter(s => s.type==='clean'||!s.type);
    if (!cleanOps.length) { fetchOrig(); return; }
    setPLoading(true);
    prevTimer.current = setTimeout(async () => {
      try { const r=await api.previewPipeline(activeDataset.id,cleanOps,50); setPRows(r.rows); setPSchema(r.schema); setPCount(r.rowCount); setSResults(r.stepResults||[]); }
      catch(e) { toast.error('Preview: '+e.message); }
      finally { setPLoading(false); }
    }, 350);
  }, [activeDataset, fetchOrig]);

  const scheduleSave = useCallback((newSteps) => {
    if (!activeDataset) return;
    setIsDirty(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { api.savePipeline(activeDataset.id,newSteps).then(()=>setIsDirty(false)).catch(()=>{}); }, 1500);
  }, [activeDataset]);

  const commit = useCallback((newSteps, pushH=true) => {
    if (pushH) { setHistory(h=>[...h,steps]); setFuture([]); }
    setSteps(newSteps); schedulePreview(newSteps); scheduleSave(newSteps);
  }, [steps, schedulePreview, scheduleSave]);

  const [renderKey, setRenderKey] = useState(0); // force remount of cards after undo/redo

  const undo = () => {
    if (!history.length) return toast('Nothing to undo',{icon:'ℹ️'});
    setFuture(f=>[...f,steps]);
    const p=history[history.length-1];
    setHistory(h=>h.slice(0,-1));
    commit(p,false);
    setRenderKey(k=>k+1); // force card remount so local state resets
    toast('Undone ↩',{icon:'↩️'});
  };
  const redo = () => {
    if (!future.length) return toast('Nothing to redo',{icon:'ℹ️'});
    setHistory(h=>[...h,steps]);
    const n=future[future.length-1];
    setFuture(f=>f.slice(0,-1));
    commit(n,false);
    setRenderKey(k=>k+1);
    toast('Redone ↪',{icon:'↪️'});
  };

  const addOp  = (op)  => commit([...steps, { id:uid(), type:'clean', opId:op.id, label:op.label, params:{columns:[],column:''}, enabled:true }]);
  const addViz = (ct)  => commit([...steps, { id:uid(), type:'viz', chartType:ct.id, config:{ xCol:'',yCols:[],aggregation:'COUNT',limit:50 }, enabled:true }]);
  const addFromRec = (op) => {
    const def = ALL_OPS.find(o=>o.id===op.opId);
    if (!def) return;
    commit([...steps, { id:uid(), type:'clean', opId:op.opId, label:def.label, params:{ ...op.params, columns:op.params?.columns||[], column:op.params?.columns?.[0]||'' }, enabled:true }]);
    toast.success('Added: '+def.label);
  };
  const remove = id => commit(steps.filter(s=>s.id!==id));
  const toggle = id => commit(steps.map(s=>s.id===id?{...s,enabled:!s.enabled}:s));
  const moveUp   = i => { const n=[...steps]; [n[i],n[i-1]]=[n[i-1],n[i]]; commit(n); };
  const moveDown = i => { const n=[...steps]; [n[i],n[i+1]]=[n[i+1],n[i]]; commit(n); };
  // updateParams: update params without pushing to undo history
  // Preview is triggered via debounce inside schedulePreview
  const updateParams = useCallback((id, params) => {
    setSteps(prev => {
      const next = prev.map(s => s.id === id ? { ...s, params } : s);
      schedulePreview(next);
      scheduleSave(next);
      return next;
    });
  }, [schedulePreview, scheduleSave]);
  const updateVizCfg = (id, cfg) => setSteps(s=>s.map(x=>x.id===id?{...x,config:cfg}:x));
  const clearAll = () => { if (confirm('Remove all steps?')) commit([]); };

  const schemaForStep = useCallback((idx) => {
    const before=steps.slice(0,idx).filter(s=>s.type==='clean'&&s.enabled!==false);
    for (let j=before.length-1;j>=0;j--) {
      const r=sResults.find(r=>r.stepId===before[j].id);
      if (r?.success&&r.schemaAfter) return r.schemaAfter;
    }
    return origSchema;
  }, [steps,sResults,origSchema]);

  const handleApply = async () => {
    if (!activeDataset) return toast.error('Select dataset first');
    const clean=steps.filter(s=>s.type==='clean'&&s.enabled!==false);
    if (!clean.length) return toast('No operations',{icon:'ℹ️'});
    const errors=sResults.filter(r=>!r.success&&!r.skipped&&!r.blocked);
    if (errors.length) { toast.error(`Fix ${errors.length} error(s) first`); return; }
    if (!confirm(`Apply ${clean.length} operation(s) to "${activeDataset.name}"?\n\nData will be modified permanently (undo available).`)) return;
    setApplying(true); setApplyError('');
    try {
      const r=await api.applyPipeline(activeDataset.id,steps);
      if (!r.success) throw new Error(r.error);
      setLastUndo(r.undoName);
      setActiveDataset({...activeDataset,row_count:r.rowCount,schema_json:JSON.stringify(r.schema)});
      setOrigSchema(r.schema);
      const sqlAll=r.appliedOps?.map(o=>o.sql).filter(Boolean).join('\n\n')||'';
      const pyAll=r.appliedOps?.map(o=>o.python).filter(Boolean).join('\n')||'';
      if (sqlAll) appendCode(sqlAll,pyAll);
      api.getOperationHistory(activeDataset.id).then(d=>setOpHistory(d.operations));
      const empty=[];
      setHistory(h=>[...h,steps]); setFuture([]);
      setSteps(empty); scheduleSave(empty);
      clearTimeout(prevTimer.current); setPLoading(true);
      api.getDatasetRows(activeDataset.id,{limit:50}).then(d=>{setPRows(d.rows);setPCount(d.total);setPSchema(r.schema);setSResults([]);}).catch(()=>{}).finally(()=>setPLoading(false));
      fetchProfile();
      toast.success(`✓ Applied. ${r.rowCount?.toLocaleString()} rows · ${r.schema?.length} columns.`,{duration:4000});
    } catch(e) { setApplyError(e.message); toast.error('Apply failed: '+e.message,{duration:6000}); }
    finally { setApplying(false); }
  };

  const handleUndoApply = async () => {
    if (!lastUndo||!activeDataset) return;
    if (!confirm('Restore dataset to state before last Apply?')) return;
    try {
      const r=await api.undoApply(activeDataset.id,lastUndo);
      setActiveDataset({...activeDataset,row_count:r.rowCount,schema_json:JSON.stringify(r.schema)});
      setOrigSchema(r.schema); setLastUndo(null);
      api.getOperationHistory(activeDataset.id).then(d=>setOpHistory(d.operations));
      schedulePreview(steps); fetchProfile();
      toast.success('Dataset restored');
    } catch(e) { toast.error(e.message); }
  };

  const depWarns   = computeDeps(steps);
  const cleanCount = steps.filter(s=>s.type==='clean'&&s.enabled!==false).length;
  const hasErrors  = sResults.some(r=>!r.success&&!r.skipped&&!r.blocked);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'var(--bg-base)' }}>
      {/* Toolbar */}
      <div style={{ padding:'8px 16px', borderBottom:'1.5px solid var(--border)', display:'flex', alignItems:'center', gap:7, background:'var(--bg-surface)', flexShrink:0, flexWrap:'wrap' }}>
        <DatasetSelector/>
        <div style={{ height:18, width:1.5, background:'var(--border)' }}/>
        <button className="btn btn-secondary btn-sm" onClick={undo} disabled={!history.length}><Undo2 size={12}/> Undo</button>
        <button className="btn btn-secondary btn-sm" onClick={redo} disabled={!future.length}><Redo2 size={12}/> Redo</button>
        <div style={{ height:18, width:1.5, background:'var(--border)' }}/>
        <button className="btn btn-purple-soft btn-sm" onClick={()=>setShowOp(true)}  disabled={!activeDataset}><Plus size={12}/> Add Operation</button>
        <button className="btn btn-purple-soft btn-sm" onClick={()=>setShowViz(true)} disabled={!activeDataset}><Plus size={12}/> Add Visualization</button>
        {cleanCount > 0 && (<>
          <div style={{ height:18, width:1.5, background:'var(--border)' }}/>
          <button className="btn btn-primary btn-sm" onClick={handleApply} disabled={applying||!activeDataset||hasErrors} style={{ background:hasErrors?'var(--danger)':undefined }}>
            {applying?<><span className="spinner" style={{ width:12,height:12 }}/>Applying…</>:hasErrors?<><AlertCircle size={12}/>Fix errors</>:<><Database size={12}/>Apply to Dataset</>}
          </button>
          {lastUndo && <button className="btn btn-secondary btn-sm" onClick={handleUndoApply}><Undo2 size={12}/> Undo Apply</button>}
        </>)}

        <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
          {isDirty?<span style={{ display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--warning)' }}><CloudOff size={10}/>Unsaved</span>:steps.length>0?<span style={{ display:'flex',alignItems:'center',gap:4,fontSize:11,color:'var(--success)' }}><Cloud size={10}/>Saved</span>:null}
          <button className={`btn btn-sm ${showRules?'btn-purple-soft':'btn-ghost'}`} onClick={()=>setShowRules(v=>!v)} title="Toggle recommendations">
            <Lightbulb size={12}/>
            {recs.length>0&&<span style={{ background:'var(--warning)',color:'#fff',borderRadius:99,padding:'0 5px',fontSize:10,fontWeight:700,marginLeft:3 }}>{recs.length}</span>}
          </button>
          <button className={`btn btn-sm ${showPreview?'btn-purple-soft':'btn-ghost'}`} onClick={()=>setShowPreview(v=>!v)} title="Toggle preview">
            <Table2 size={12}/> Preview
          </button>
          {steps.length>0&&<button className="btn btn-ghost btn-sm" onClick={clearAll} style={{ color:'var(--danger)' }}><Trash2 size={11}/> Clear</button>}
        </div>
      </div>

      {/* Info bar */}
      {activeDataset && (
        <div style={{ padding:'3px 16px', borderBottom:'1px solid var(--border-subtle)', display:'flex', alignItems:'center', gap:10, flexShrink:0, background:'#faf9ff', fontSize:11 }}>
          <span style={{ color:'var(--text-secondary)', display:'flex', gap:4, alignItems:'center' }}><Database size={9} style={{ color:'var(--accent)' }}/>{activeDataset.row_count?.toLocaleString()} rows</span>
          {pCount!==null&&cleanCount>0&&<><ArrowRight size={9} style={{ color:'var(--text-muted)' }}/><span style={{ color:'var(--accent)', display:'flex', gap:4, alignItems:'center' }}><Zap size={9}/>Preview: {pCount?.toLocaleString()} rows</span></>}
          {pLoading&&<span style={{ color:'var(--text-muted)' }}>rebuilding…</span>}
          <span style={{ marginLeft:'auto', color:'var(--text-muted)' }}>Preview from current data · <strong style={{ color:'var(--accent)' }}>Apply</strong> to write permanently</span>
        </div>
      )}

      {/* Apply error */}
      {applyError && (
        <div style={{ padding:'8px 16px', borderBottom:'1.5px solid rgba(220,38,38,0.2)', background:'rgba(220,38,38,0.04)', flexShrink:0, display:'flex', alignItems:'flex-start', gap:9 }}>
          <AlertCircle size={14} style={{ color:'var(--danger)', flexShrink:0, marginTop:1 }}/>
          <div style={{ flex:1 }}><div style={{ fontWeight:700, color:'var(--danger)', fontSize:13, marginBottom:2 }}>Apply failed</div><div style={{ fontSize:12, color:'var(--danger)', opacity:.85 }}>{applyError}</div></div>
          <button className="btn-icon" onClick={()=>setApplyError('')} style={{ padding:4 }}><X size={12}/></button>
        </div>
      )}

      {/* Main layout */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {/* Pipeline */}
        <div style={{ width: (showPreview||showRules)?360:'100%', flexShrink:0, borderRight:(showPreview||showRules)?'1.5px solid var(--border)':'none', overflowY:'auto', padding:'12px', background:'var(--bg-base)' }}>
          {!activeDataset ? (
            <div className="empty-state" style={{ marginTop:30 }}><Layers size={34} style={{ color:'var(--accent-light)' }}/><h3>No dataset selected</h3></div>
          ) : steps.length===0 ? (
            <div style={{ border:'2px dashed var(--border)', borderRadius:12, padding:'32px 18px', textAlign:'center', background:'var(--bg-surface)' }}>
              <div style={{ fontWeight:800, fontSize:15, color:'var(--text-primary)', marginBottom:6 }}>Pipeline is empty</div>
              <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:16, lineHeight:1.6 }}>
                Add operation. Preview auto-update.
                {recs.length>0&&<><br/><strong style={{ color:'var(--accent)' }}>{recs.length} recommendations</strong> in the right panel.</>}
              </p>
              <div style={{ display:'flex', gap:7, justifyContent:'center' }}>
                <button className="btn btn-primary btn-sm" onClick={()=>setShowOp(true)}><Plus size={12}/>Operation</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setShowViz(true)}><Plus size={12}/>Visualization</button>
              </div>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {steps.map((step,idx) => step.type==='clean' ? (
                <OpStepCard
                  key={`${step.id}_${renderKey}`}
                  step={step}
                  schemaAtStep={schemaForStep(idx)}
                  idx={idx} total={steps.length}
                  stepResult={sResults.find(r=>r.stepId===step.id)}
                  depWarning={depWarns[step.id]}
                  datasetId={activeDataset?.id}
                  onRemove={remove} onToggle={toggle} onMoveUp={moveUp} onMoveDown={moveDown} onParamChange={updateParams}/>
              ) : (
                <VizStepCard key={step.id} step={step} previewSchema={pSchema}
                  idx={idx} total={steps.length}
                  onRemove={remove} onMoveUp={moveUp} onMoveDown={moveDown}
                  onConfigChange={updateVizCfg} datasetId={activeDataset?.id}/>
              ))}
              {hasErrors&&<div style={{ display:'flex', gap:7, background:'var(--danger-dim)', border:'1.5px solid rgba(220,38,38,0.2)', borderRadius:9, padding:'8px 11px' }}><AlertTriangle size={13} style={{ color:'var(--danger)',flexShrink:0,marginTop:1 }}/><div style={{ fontSize:12,color:'var(--danger)',fontWeight:600 }}>{sResults.filter(r=>!r.success&&!r.skipped&&!r.blocked).length} error(s) — fix before Apply.</div></div>}
              <div style={{ display:'flex', gap:7 }}>
                <button className="btn btn-ghost btn-sm" onClick={()=>setShowOp(true)} style={{ flex:1, justifyContent:'center', border:'1.5px dashed var(--border)' }}><Plus size={11}/> Operation</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>setShowViz(true)} style={{ flex:1, justifyContent:'center', border:'1.5px dashed var(--border)' }}><Plus size={11}/> Visualization</button>
              </div>
            </div>
          )}
        </div>

        {/* Preview */}
        {showPreview && (
          <div style={{ flex:showRules?1:2, overflow:'hidden', display:'flex', flexDirection:'column', borderRight:showRules?'1.5px solid var(--border)':'none' }}>
            <PreviewPanel rows={pRows} schema={pSchema} rowCount={pCount} loading={pLoading} originalRowCount={activeDataset?.row_count} cleanOpsCount={cleanCount}/>
          </div>
        )}

        {/* Rules */}
        {showRules && (
          <div style={{ width:showPreview?270:340, flexShrink:0, overflow:'hidden', display:'flex', flexDirection:'column' }}>
            {profiling ? <div className="empty-state" style={{ height:'100%' }}><div className="spinner" style={{ width:20,height:20 }}/><p>Profiling…</p></div>
              : <RuleEnginePanel recommendations={recs} onAddStep={addFromRec}/>}
          </div>
        )}
      </div>

      {showOp  && <OpPickerModal  onClose={()=>setShowOp(false)}  onPick={addOp} />}
      {showViz && <VizPickerModal onClose={()=>setShowViz(false)} onPick={addViz}/>}
    </div>
  );
}