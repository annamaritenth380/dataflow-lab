import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  LayoutTemplate, Plus, Trash2, BarChart3, Hash, X, Save,
  FileText, Settings2, Check, Sparkles, Grid3x3, Layers, Download
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';
import useStore from '../store';
import api from '../utils/api';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

/* ═══════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════ */
const PALETTE_PRESETS = [
  { name: 'Violet',  colors: ['#7c3aed','#a78bfa','#c4b5fd','#ddd6fe','#5b21b6'] },
  { name: 'Ocean',   colors: ['#0ea5e9','#38bdf8','#7dd3fc','#059669','#0891b2'] },
  { name: 'Sunset',  colors: ['#f59e0b','#ef4444','#8b5cf6','#ec4899','#f97316'] },
  { name: 'Forest',  colors: ['#059669','#10b981','#34d399','#065f46','#6ee7b7'] },
  { name: 'Slate',   colors: ['#475569','#64748b','#94a3b8','#1e293b','#cbd5e1'] },
  { name: 'Rose',    colors: ['#f43f5e','#fb7185','#fda4af','#e11d48','#fecdd3'] },
];

// h = total card height (px)
// chartH = used only for KPI value font size scaling
const WIDGET_SIZES = [
  { id: 'sm',   label: 'Small',  cols: 1, rows: 1, h: 240,  chartH: 140 },
  { id: 'md',   label: 'Medium', cols: 2, rows: 1, h: 280,  chartH: 180 },
  { id: 'lg',   label: 'Large',  cols: 2, rows: 2, h: 460,  chartH: 360 },
  { id: 'wide', label: 'Wide',   cols: 3, rows: 1, h: 280,  chartH: 180 },
  { id: 'full', label: 'Full',   cols: 3, rows: 2, h: 460,  chartH: 360 },
];

const DASHBOARD_TEMPLATES = [
  {
    id: 'blank', name: 'Blank Canvas', icon: '⬜', desc: 'Start from scratch', widgets: [],
  },
  {
    id: 'overview', name: 'Executive Overview', icon: '📊', desc: '4 KPIs + 2 charts',
    widgets: [
      { widget_type: 'kpi',   size: 'sm', config: { label: 'Total Records', value: '—', description: 'All records in dataset' } },
      { widget_type: 'kpi',   size: 'sm', config: { label: 'Avg Value',     value: '—', description: 'Mean across numeric cols' } },
      { widget_type: 'kpi',   size: 'sm', config: { label: 'Min',           value: '—' } },
      { widget_type: 'kpi',   size: 'sm', config: { label: 'Max',           value: '—' } },
      { widget_type: 'chart', size: 'md', config: { title: 'Distribution',  description: 'Select a chart from saved visualizations' } },
      { widget_type: 'chart', size: 'md', config: { title: 'Trend',         description: 'Select a chart from saved visualizations' } },
    ],
  },
  {
    id: 'analysis', name: 'Deep Analysis', icon: '🔬', desc: '1 wide + 3 medium charts',
    widgets: [
      { widget_type: 'chart', size: 'wide', config: { title: 'Main Trend',  description: 'Primary time series or bar chart' } },
      { widget_type: 'chart', size: 'md',   config: { title: 'Breakdown A' } },
      { widget_type: 'chart', size: 'md',   config: { title: 'Breakdown B' } },
      { widget_type: 'text',  size: 'md',   config: { title: 'Notes', text: 'Add your analysis notes here...' } },
    ],
  },
  {
    id: 'kpi_focus', name: 'KPI Dashboard', icon: '🎯', desc: '6 KPI cards',
    widgets: Array.from({ length: 6 }, (_, i) => ({
      widget_type: 'kpi', size: 'sm',
      config: { label: `Metric ${i + 1}`, value: '—', description: 'Click edit to configure' },
    })),
  },
];

/* ═══════════════════════════════════════════════════
   CHART BUILDER
═══════════════════════════════════════════════════ */
// Detect if rows have multi-series columns (stacked/grouped format from backend)
// Backend pivot returns: [{x:'A', col1:10, col2:5}, ...] — no .y field
function detectMultiSeries(data) {
  if (!data?.length) return null;
  const keys = Object.keys(data[0]).filter(k => k !== 'x' && k !== 'label');
  // Multi-series: more than one non-x numeric column
  if (keys.length > 1) return keys;
  // Single-y series: has .y or .value
  return null;
}

function buildChartData(data, chartType, palette, accentColor) {
  if (!data?.length) return null;
  const colors = accentColor
    ? [accentColor, accentColor + 'cc', accentColor + '99', accentColor + '66']
    : (palette?.colors || PALETTE_PRESETS[0].colors);
  const labels  = data.map(r => String(r.x ?? r.label ?? ''));
  const isLine  = ['line','timeseries','area'].includes(chartType);
  const isStack = chartType === 'stacked_bar' || chartType === 'stacked_100';

  if (chartType === 'pie' || chartType === 'donut') {
    const values = data.map(r => Number(r.y ?? r.value ?? 0));
    return { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] };
  }

  // FIX: detect multi-series pivot data from backend (stacked_bar, grouped_bar, multi_line)
  const multiKeys = detectMultiSeries(data);
  if (multiKeys) {
    // stacked_100: normalize each row to percentages
    const normalize = chartType === 'stacked_100';
    return {
      labels,
      datasets: multiKeys.map((key, i) => {
        const rawValues = data.map(r => Number(r[key] ?? 0));
        const finalValues = normalize
          ? data.map((r, ri) => {
              const total = multiKeys.reduce((s, k) => s + Number(r[k] ?? 0), 0);
              return total > 0 ? parseFloat(((Number(r[key] ?? 0) / total) * 100).toFixed(2)) : 0;
            })
          : rawValues;
        return {
          label: key,
          data: finalValues,
          backgroundColor: colors[i % colors.length] + (isStack ? 'dd' : 'bb'),
          borderColor:     colors[i % colors.length],
          borderWidth: 1.5,
          // FIX: stack property is REQUIRED for Chart.js to actually stack bars
          ...(isStack ? { stack: 'stack0' } : {}),
          fill: chartType === 'stacked_area',
          tension: 0.35,
        };
      }),
    };
  }

  // Single series
  const values = data.map(r => Number(r.y ?? r.value ?? 0));
  return {
    labels,
    datasets: [{
      label: 'Value', data: values,
      backgroundColor: isLine ? colors[0] + '22' : colors.map((_, i) => colors[i % colors.length]),
      borderColor: colors[0], borderWidth: 2,
      fill: chartType === 'area', tension: 0.4,
      pointBackgroundColor: colors[0], pointRadius: isLine ? 3 : 0,
      ...(isStack ? { stack: 'stack0' } : {}),
    }],
  };
}

function makeChartOpts(showLegend = true, chartType = '', xLabel = '', yLabel = '') {
  const isStack = chartType === 'stacked_bar' || chartType === 'stacked_100' || chartType === 'stacked_area';

  const xScale = {
    display: true,
    stacked: isStack || undefined,
    ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 8, maxRotation: 45 },
    grid: { display: false },
    title: xLabel
      ? { display: true, text: xLabel, color: '#64748b', font: { size: 9, weight: '600' }, padding: { top: 4 } }
      : { display: false },
  };

  const yScale = {
    display: true,
    stacked: isStack || undefined,
    ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 5 },
    grid: { color: '#f1f5f9', lineWidth: 1 },
    title: yLabel
      ? { display: true, text: yLabel, color: '#64748b', font: { size: 9, weight: '600' }, padding: { bottom: 4 } }
      : { display: false },
  };

  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 2, right: 4, bottom: 0, left: 0 } },
    plugins: {
      // FIX: legend at BOTTOM CENTER — color swatches match dataset colors naturally
      legend: {
        display: showLegend,
        position: 'bottom',
        align: 'center',
        labels: {
          font: { size: 10 },
          padding: 10,
          boxWidth: 10,
          boxHeight: 10,
          color: '#64748b',
          usePointStyle: true,
          pointStyle: 'rect',
        },
      },
      tooltip: {
        enabled: true,
        backgroundColor: '#1e293b',
        titleColor: '#f1f5f9',
        bodyColor: '#94a3b8',
        padding: 8,
        cornerRadius: 8,
        displayColors: true,
      },
    },
    scales: { x: xScale, y: yScale },
  };
}

/* ═══════════════════════════════════════════════════
   KPI WIDGET
═══════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════
   KPI WIDGET — query-driven
   config fields:
     label        (string)  – display label
     kpiMode      ('basic'|'sql') – which mode was used
     valueQuery   (string)  – SQL: SELECT ... or basic-generated SQL
     trendQuery   (string)  – optional SQL returning a single number (%)
     sub          (string)  – static sub-label (optional template)
     accentColor, bgColor, size, palette, description
═══════════════════════════════════════════════════ */
function KPIWidget({ config, accentColor, chartH = 180, datasetId }) {
  const color  = accentColor || '#7c3aed';
  const isDark = config.bgColor === '#1e293b' || config.bgColor === '#0f172a';
  const valueFontSize = chartH >= 340 ? 52 : chartH >= 260 ? 42 : chartH >= 180 ? 34 : 26;

  const [liveValue, setLiveValue] = useState(config.value || '—');
  const [liveTrend, setLiveTrend] = useState(config.trend ?? null);
  const [loading,   setLoading]   = useState(false);

  // Run queries whenever config or dataset changes
  useEffect(() => {
    if (!datasetId || !config.valueQuery) return;
    setLoading(true);

    const runQuery = async (sql) => {
      if (!sql?.trim()) return null;
      try {
        const res = await api.executeCustomSql(datasetId, sql.trim());
        if (res.error) return null;
        const rows = res.results;
        if (!rows?.length) return null;
        const firstVal = Object.values(rows[0])[0];
        return firstVal;
      } catch { return null; }
    };

    (async () => {
      const val = await runQuery(config.valueQuery);
      if (val != null) {
        // Format numbers nicely
        const n = Number(val);
        setLiveValue(
          !isNaN(n)
            ? n % 1 === 0
              ? n.toLocaleString()
              : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : String(val)
        );
      } else {
        setLiveValue(config.value || '—');
      }

      if (config.trendQuery) {
        const t = await runQuery(config.trendQuery);
        setLiveTrend(t != null ? parseFloat(Number(t).toFixed(2)) : null);
      }
      setLoading(false);
    })();
  }, [datasetId, config.valueQuery, config.trendQuery]);

  const trend  = liveTrend;
  const isUp   = trend > 0;
  const isDown = trend < 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {config.label || 'Metric'}
      </div>
      <div style={{ fontSize: valueFontSize, fontWeight: 800, color: loading ? '#cbd5e1' : color, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', marginBottom: 6, transition: 'color 0.3s' }}>
        {loading ? '…' : liveValue}
      </div>
      {config.sub && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{config.sub}</div>
      )}
      {trend != null && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 11, fontWeight: 700, color: isUp ? '#10b981' : isDown ? '#ef4444' : '#94a3b8', background: isUp ? '#dcfce7' : isDown ? '#fee2e2' : '#f1f5f9', padding: '3px 8px', borderRadius: 99, width: 'fit-content' }}>
          {isUp ? '▲' : isDown ? '▼' : '—'} {Math.abs(trend)}% vs prev
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   WIDGET CARD
   Layout:
     [Title]                      ← top, bold, left
     ─────────────────────────────
     Y-label ← [Chart / KPI / Text body]
                ──────────────────────
                [X-label]           ← bottom of chart (Chart.js axis title)
     ─────────────────────────────
     [Description / Notes]        ← card footer, italic
═══════════════════════════════════════════════════ */
function WidgetCard({ widget, vizMap, onDelete, onEdit, isEditMode, datasetId }) {
  const viz    = widget.visualization_id ? vizMap[widget.visualization_id] : null;
  const config = typeof widget.config === 'string'
    ? (() => { try { return JSON.parse(widget.config); } catch { return {}; } })()
    : (widget.config || {});

  const palette     = PALETTE_PRESETS.find(p => p.name === config.palette) || PALETTE_PRESETS[0];
  const accent      = config.accentColor || palette.colors[0];
  const isDark      = config.bgColor === '#1e293b' || config.bgColor === '#0f172a';

  // Resolve axis labels from config (saved at add-widget time) or live viz config
  const vizCfg  = viz?.config || {};
  const xLabel  = config.xLabel || vizCfg.xCol  || '';
  const yLabel  = config.yLabel || vizCfg.yCols?.[0] || vizCfg.yCol || '';

  // Build chart data + options — pass x/y labels so Chart.js renders them as axis titles
  const chartData   = viz ? buildChartData(viz.data, viz.chart_type, palette, config.accentColor || null) : null;
  const chartOpts   = makeChartOpts(config.showLegend !== false, viz?.chart_type || '', xLabel, yLabel);
  const noScaleOpts = { ...chartOpts, scales: undefined };

  // chartH still needed for KPI font size scaling
  const sizeId  = config.size || widget.size || 'md';
  const sizeObj = WIDGET_SIZES.find(x => x.id === sizeId) || WIDGET_SIZES.find(x => x.id === 'md');
  const chartH  = sizeObj.chartH;

  const textColor = isDark ? '#f1f5f9' : '#1e293b';
  const descColor = isDark ? '#64748b'  : '#94a3b8';

  return (
    <div style={{
      background:    config.bgColor || '#fff',
      border:        `1.5px solid ${isEditMode ? accent + '55' : '#e2e8f0'}`,
      borderRadius:  16,
      padding:       '12px 14px 10px',
      height:        '100%',
      display:       'flex',
      flexDirection: 'column',
      overflow:      'hidden',
      minWidth: 0, maxWidth: '100%', boxSizing: 'border-box',
      boxShadow: isEditMode
        ? `0 0 0 3px ${accent}18, 0 4px 24px #0000000d`
        : '0 1px 3px #0000000a, 0 4px 12px #0000000a',
      transition: 'all 0.2s ease',
      position: 'relative',
    }}>

      {/* ── Edit controls (absolute overlay, top-right) ── */}
      {isEditMode && (
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 3, zIndex: 10 }}>
          <button onClick={() => onEdit(widget)} title="Edit widget"
            style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            <Settings2 size={11} />
          </button>
          <button onClick={() => onDelete(widget.id)} title="Delete widget"
            style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid #fee2e2', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
            <X size={11} />
          </button>
        </div>
      )}

      {/* ── ZONE 1: TITLE — top, bold, left-aligned ── */}
      <div style={{
        fontSize:     13,
        fontWeight:   700,
        color:        textColor,
        lineHeight:   1.3,
        paddingRight: isEditMode ? 58 : 0,
        flexShrink:   0,
        marginBottom: 8,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {config.title || viz?.name || (widget.widget_type === 'kpi' ? config.label : widget.widget_type)}
      </div>

      {/* ── ZONE 2: BODY — flex:1 fills ALL remaining space ──
           With no description: chart gets 100% of remaining height → centered vertically.
           With description: description takes its natural height at bottom, chart gets the rest.
           This is better than a fixed chartH because the chart adapts to available space.
      ── */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>

        {/* Chart widget */}
        {widget.widget_type === 'chart' && chartData && (() => {
          const ct = viz?.chart_type;
          if (ct === 'pie')   return <Pie      data={chartData} options={noScaleOpts} />;
          if (ct === 'donut') return <Doughnut data={chartData} options={noScaleOpts} />;
          if (ct === 'line' || ct === 'timeseries' || ct === 'area')
            return <Line data={chartData} options={chartOpts} />;
          return <Bar data={chartData} options={chartOpts} />;
        })()}

        {widget.widget_type === 'chart' && !chartData && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#cbd5e1' }}>
            <BarChart3 size={26} />
            <span style={{ fontSize: 11 }}>No visualization linked</span>
          </div>
        )}

        {/* KPI widget */}
        {widget.widget_type === 'kpi' && (
          <KPIWidget config={config} accentColor={accent} chartH={chartH} datasetId={datasetId} />
        )}

        {/* Text widget */}
        {widget.widget_type === 'text' && (
          <div style={{
            fontSize:   12,
            color:      isDark ? '#94a3b8' : '#475569',
            lineHeight: 1.7,
            overflow:   'auto',
            height:     '100%',
            whiteSpace: 'pre-wrap',
          }}>
            {config.text || 'Text widget'}
          </div>
        )}
      </div>

      {/* ── ZONE 3: DESCRIPTION — below chart body, italic, small ──
           Positioned here so it is always at the bottom of the card,
           consistent across all widgets regardless of type.
      ── */}
      {config.description && (
        <div style={{
          fontSize:    10,
          color:       descColor,
          marginTop:   6,
          lineHeight:  1.5,
          flexShrink:  0,
          fontStyle:   'italic',
          overflow:    'hidden',
          display:     '-webkit-box',
          WebkitLineClamp:     2,
          WebkitBoxOrient:     'vertical',
        }}>
          {config.description}
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   WIDGET MODAL (Add + Edit unified)
═══════════════════════════════════════════════════ */
function WidgetModal({ mode, initial, vizList, vizMap, activeDataset, onSave, onClose }) {
  const initCfg   = initial?.config || {};
  const [tab,         setTab]         = useState('content');
  const [wType,       setWType]       = useState(initial?.widget_type || 'chart');
  const [title,       setTitle]       = useState(initCfg.title || '');
  const [description, setDescription] = useState(initCfg.description || '');
  const [selectedViz, setSelectedViz] = useState(initial?.visualization_id || '');
  const [kpiLabel,      setKpiLabel]      = useState(initCfg.label || '');
  const [kpiMode,       setKpiMode]       = useState(initCfg.kpiMode || 'basic');
  // Basic mode fields
  const [kpiAgg,        setKpiAgg]        = useState(initCfg.kpiAgg || 'COUNT');
  const [kpiCol,        setKpiCol]        = useState(initCfg.kpiCol || '');
  const [kpiFilter,     setKpiFilter]     = useState(initCfg.kpiFilter || '');
  const [kpiFilterVal,  setKpiFilterVal]  = useState(initCfg.kpiFilterVal || '');
  // SQL mode fields
  const [kpiValueQuery, setKpiValueQuery] = useState(initCfg.valueQuery || '');
  const [kpiTrendQuery, setKpiTrendQuery] = useState(initCfg.trendQuery || '');
  // Common
  const [kpiSub,        setKpiSub]        = useState(initCfg.sub || '');
  // Live preview
  const [kpiPreview,    setKpiPreview]    = useState(null);
  const [kpiPreviewLoading, setKpiPreviewLoading] = useState(false);
  const [widgetText,  setWidgetText]  = useState(initCfg.text || '');
  const [size,        setSize]        = useState(initCfg.size || 'md');
  const [palette,     setPalette]     = useState(initCfg.palette || 'Violet');
  const [accentColor, setAccentColor] = useState(initCfg.accentColor || '');
  const [bgColor,     setBgColor]     = useState(initCfg.bgColor || '#ffffff');
  const [showLegend,  setShowLegend]  = useState(initCfg.showLegend !== false);

  const viz = vizMap[selectedViz];

  // Build SQL from basic mode params
  const buildBasicKpiSQL = (agg, col, filterCol, filterVal, tblName) => {
    if (!tblName) return '';
    const colExpr = (agg === 'COUNT' && !col) ? '*' : col ? `"${col}"` : '*';
    let sql = `SELECT ${agg}(${agg === 'COUNT' && !col ? '*' : `CAST(${colExpr} AS REAL)`}) FROM "${tblName}"`;
    if (filterCol && filterVal !== '') {
      const escaped = String(filterVal).replace(/'/g, "''");
      sql += ` WHERE "${filterCol}" = '${escaped}'`;
    }
    return sql;
  };

  // Get active dataset table name from vizMap or first viz
  const datasetTableName = activeDataset?.table_name || '';
  const activeDatasetId  = activeDataset?.id || '';

  // Run preview query
  const runKpiPreview = async (sql) => {
    if (!sql?.trim() || !activeDatasetId) return;
    setKpiPreviewLoading(true);
    setKpiPreview(null);
    try {
      const res = await api.executeCustomSql(activeDatasetId, sql.trim());
      if (res.results?.length) {
        const raw = Object.values(res.results[0])[0];
        const n = Number(raw);
        setKpiPreview(!isNaN(n)
          ? n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : String(raw));
      } else {
        setKpiPreview('(no result)');
      }
    } catch (e) {
      setKpiPreview(`Error: ${e.message}`);
    }
    setKpiPreviewLoading(false);
  };

  const currentValueQuery = kpiMode === 'basic'
    ? buildBasicKpiSQL(kpiAgg, kpiCol, kpiFilter, kpiFilterVal, datasetTableName)
    : kpiValueQuery;

  const handleSave = () => {
    const base = { size, palette, accentColor, bgColor, showLegend, description: description.trim() };
    // FIX: explicit wType checks — no else fallthrough that incorrectly triggers text validation
    if (wType === 'chart') {
      if (!selectedViz) return toast.error('Select a visualization');
      onSave({ widget_type: 'chart', visualization_id: selectedViz, config: { ...base, title: title || viz?.name || 'Chart', xLabel: viz?.config?.xCol || '', yLabel: viz?.config?.yCols?.[0] || viz?.config?.yCol || '' } });
    } else if (wType === 'kpi') {
      if (!kpiLabel.trim()) return toast.error('Enter a label');
      if (!currentValueQuery.trim()) return toast.error('Enter a value query or select aggregation + column');
      onSave({
        widget_type: 'kpi',
        visualization_id: null,
        config: {
          ...base,
          title:       kpiLabel.trim(),
          label:       kpiLabel.trim(),
          kpiMode,
          // Basic mode params (stored so edit modal can re-populate)
          kpiAgg, kpiCol, kpiFilter, kpiFilterVal,
          // The actual SQL queries that KPIWidget runs
          valueQuery:  currentValueQuery,
          trendQuery:  kpiTrendQuery.trim() || '',
          sub:         kpiSub.trim(),
          // Fallback static value for widgets without dataset context
          value:       kpiPreview || '—',
        },
      });
    } else if (wType === 'text') {
      if (!widgetText.trim()) return toast.error('Enter some text');
      onSave({ widget_type: 'text', visualization_id: null, config: { ...base, title: title || 'Note', text: widgetText.trim() } });
    } else {
      toast.error('Unknown widget type');
    }
  };

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{ padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: tab === id ? 700 : 500, background: tab === id ? '#f1f0ff' : 'transparent', color: tab === id ? '#7c3aed' : '#64748b', transition: 'all 0.15s' }}>
      {label}
    </button>
  );

  const FieldLabel = ({ children }) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{children}</div>
  );

  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 13, color: '#1e293b', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000060', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 20, width: 540, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px #00000030' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 20px 0', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>
              {mode === 'edit' ? '✏️ Edit Widget' : '➕ Add Widget'}
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #e2e8f0', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 2, paddingBottom: 0 }}>
            <TabBtn id="content" label="📝 Content" />
            <TabBtn id="style"   label="🎨 Style" />
            <TabBtn id="layout"  label="📐 Layout" />
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px 20px' }}>

          {/* CONTENT TAB */}
          {tab === 'content' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Type picker */}
              <div>
                <FieldLabel>Widget Type</FieldLabel>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ id:'chart',icon:'📊',label:'Chart'},{id:'kpi',icon:'🔢',label:'KPI'},{id:'text',icon:'📝',label:'Text'}].map(t => (
                    <button key={t.id} onClick={() => setWType(t.id)} style={{ flex: 1, padding: '12px 6px', borderRadius: 12, border: `2px solid ${wType === t.id ? '#7c3aed' : '#e2e8f0'}`, background: wType === t.id ? '#f5f3ff' : '#fafafa', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}>
                      <span style={{ fontSize: 20 }}>{t.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: wType === t.id ? '#7c3aed' : '#64748b' }}>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Chart */}
              {wType === 'chart' && (
                <>
                  <div>
                    <FieldLabel>Visualization</FieldLabel>
                    <select value={selectedViz} onChange={e => setSelectedViz(e.target.value)} style={{ ...inputStyle, background: '#fff' }}>
                      <option value="">Select saved chart…</option>
                      {vizList.map(v => <option key={v.id} value={v.id}>{v.name} · {v.chart_type}</option>)}
                    </select>
                    {vizList.length === 0 && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>No saved charts. Go to Studio → save a chart first.</div>}
                  </div>
                  {viz && (
                    <div style={{ padding: '10px 14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 11, color: '#475569', lineHeight: 1.7 }}>
                      <b style={{ color: '#1e293b' }}>{viz.name}</b> · <span style={{ color: '#7c3aed' }}>{viz.chart_type}</span><br />
                      {viz.config?.xCol && <span>X: <b>{viz.config.xCol}</b> · </span>}
                      {(viz.config?.yCols?.[0] || viz.config?.yCol) && <span>Y: <b>{viz.config.yCols?.[0] || viz.config.yCol}</b></span>}
                    </div>
                  )}
                  <div>
                    <FieldLabel>Widget Title <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></FieldLabel>
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder={viz?.name || 'Auto from chart name…'} style={inputStyle} />
                  </div>
                </>
              )}

              {/* KPI */}
              {wType === 'kpi' && (() => {
                const schema = activeDataset?.schema_json
                  ? (typeof activeDataset.schema_json === 'string' ? JSON.parse(activeDataset.schema_json) : activeDataset.schema_json)
                  : [];
                const numericCols = schema.filter(c => c.type === 'integer' || c.type === 'real').map(c => c.name);
                const allCols     = schema.map(c => c.name);
                const AGGS = ['COUNT','SUM','AVG','MIN','MAX'];

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Label */}
                    <div>
                      <FieldLabel>Label *</FieldLabel>
                      <input value={kpiLabel} onChange={e => setKpiLabel(e.target.value)} placeholder="e.g. Total Revenue" style={inputStyle} />
                    </div>

                    {/* Mode toggle */}
                    <div>
                      <FieldLabel>Value Source</FieldLabel>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        {[['basic','🟢 Basic'], ['sql','🔴 SQL']].map(([m, lbl]) => (
                          <button key={m} onClick={() => setKpiMode(m)} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `1.5px solid ${kpiMode === m ? '#7c3aed' : '#e2e8f0'}`, background: kpiMode === m ? '#f5f3ff' : '#fff', color: kpiMode === m ? '#7c3aed' : '#64748b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            {lbl}
                          </button>
                        ))}
                      </div>

                      {/* Basic mode */}
                      {kpiMode === 'basic' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: '#f8fafc', borderRadius: 10, border: '1.5px solid #e2e8f0' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                              <FieldLabel>Aggregation</FieldLabel>
                              <select value={kpiAgg} onChange={e => setKpiAgg(e.target.value)} style={inputStyle}>
                                {AGGS.map(a => <option key={a} value={a}>{a}</option>)}
                              </select>
                            </div>
                            <div>
                              <FieldLabel>Column {kpiAgg === 'COUNT' ? '(optional)' : '*'}</FieldLabel>
                              <select value={kpiCol} onChange={e => setKpiCol(e.target.value)} style={inputStyle}>
                                <option value="">— all rows —</option>
                                {(kpiAgg === 'COUNT' ? allCols : numericCols).map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                          </div>
                          <div>
                            <FieldLabel>Filter <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></FieldLabel>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                              <select value={kpiFilter} onChange={e => setKpiFilter(e.target.value)} style={inputStyle}>
                                <option value="">— no filter —</option>
                                {allCols.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <input value={kpiFilterVal} onChange={e => setKpiFilterVal(e.target.value)} placeholder="= value" style={inputStyle} disabled={!kpiFilter} />
                            </div>
                          </div>
                          {/* Generated SQL preview */}
                          {currentValueQuery && (
                            <div style={{ fontSize: 10, fontFamily: 'monospace', background: '#1e1535', color: '#c4b5fd', padding: '8px 10px', borderRadius: 7, lineHeight: 1.6, wordBreak: 'break-all' }}>
                              {currentValueQuery}
                            </div>
                          )}
                        </div>
                      )}

                      {/* SQL mode */}
                      {kpiMode === 'sql' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <textarea
                            value={kpiValueQuery}
                            onChange={e => setKpiValueQuery(e.target.value)}
                            rows={3}
                            placeholder={`SELECT SUM(salary) FROM ${datasetTableName || 'your_table'}`}
                            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', lineHeight: 1.6, color: '#3d1f8a' }}
                          />
                          <div>
                            <FieldLabel>Trend Query <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional — returns a single % number)</span></FieldLabel>
                            <textarea
                              value={kpiTrendQuery}
                              onChange={e => setKpiTrendQuery(e.target.value)}
                              rows={2}
                              placeholder="SELECT (new - old) / old * 100 FROM …"
                              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', lineHeight: 1.6, color: '#3d1f8a' }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Run preview button */}
                      <button
                        onClick={() => runKpiPreview(currentValueQuery)}
                        disabled={!currentValueQuery || kpiPreviewLoading}
                        style={{ marginTop: 8, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: (!currentValueQuery || kpiPreviewLoading) ? 0.5 : 1 }}>
                        {kpiPreviewLoading ? '…' : '▶'} Preview
                      </button>
                      {kpiPreview != null && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 8, marginTop: 4 }}>
                          <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Result:</span>
                          <span style={{ fontSize: 18, fontWeight: 800, color: '#15803d', fontVariantNumeric: 'tabular-nums' }}>{kpiPreview}</span>
                        </div>
                      )}
                    </div>

                    {/* Sub-label */}
                    <div>
                      <FieldLabel>Sub-label <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></FieldLabel>
                      <input value={kpiSub} onChange={e => setKpiSub(e.target.value)} placeholder="e.g. vs last month" style={inputStyle} />
                    </div>
                  </div>
                );
              })()}

              {/* Text */}
              {wType === 'text' && (
                <>
                  <div>
                    <FieldLabel>Title</FieldLabel>
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Note, Insight, Summary…" style={inputStyle} />
                  </div>
                  <div>
                    <FieldLabel>Content *</FieldLabel>
                    <textarea value={widgetText} onChange={e => setWidgetText(e.target.value)} rows={5} placeholder="Enter notes, key findings, or any text…" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
                  </div>
                </>
              )}

              {/* Description — all types */}
              <div>
                <FieldLabel>Description <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></FieldLabel>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Add context or notes for this widget…" style={{ ...inputStyle, resize: 'vertical', fontSize: 12, color: '#475569', lineHeight: 1.5 }} />
              </div>
            </div>
          )}

          {/* STYLE TAB */}
          {tab === 'style' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Palette */}
              <div>
                <FieldLabel>Color Palette</FieldLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {PALETTE_PRESETS.map(p => (
                    <button key={p.name} onClick={() => setPalette(p.name)} style={{ padding: '10px 10px', borderRadius: 12, border: `2px solid ${palette === p.name ? '#7c3aed' : '#e2e8f0'}`, background: palette === p.name ? '#f5f3ff' : '#fafafa', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, transition: 'all 0.15s' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {p.colors.slice(0, 4).map((c, i) => <div key={i} style={{ width: 14, height: 14, borderRadius: 4, background: c }} />)}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: palette === p.name ? 700 : 500, color: palette === p.name ? '#7c3aed' : '#64748b', textAlign: 'left' }}>{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom accent */}
              <div>
                <FieldLabel>Custom Accent Color</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={accentColor || '#7c3aed'} onChange={e => setAccentColor(e.target.value)} style={{ width: 40, height: 38, borderRadius: 8, border: '1.5px solid #e2e8f0', cursor: 'pointer', padding: 3 }} />
                  <input value={accentColor} onChange={e => setAccentColor(e.target.value)} placeholder="#7c3aed — overrides palette" style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 12, color: '#1e293b', outline: 'none' }} />
                  {accentColor && <button onClick={() => setAccentColor('')} style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>✕ Clear</button>}
                </div>
              </div>

              {/* Card background */}
              <div>
                <FieldLabel>Card Background</FieldLabel>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {['#ffffff','#f8fafc','#faf5ff','#fff7ed','#f0fdf4','#eff6ff','#1e293b','#0f172a'].map(c => (
                    <button key={c} onClick={() => setBgColor(c)} title={c} style={{ width: 34, height: 34, borderRadius: 9, background: c, border: `2px solid ${bgColor === c ? '#7c3aed' : '#e2e8f0'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', boxShadow: bgColor === c ? '0 0 0 3px #7c3aed33' : 'none' }}>
                      {bgColor === c && <Check size={12} style={{ color: ['#1e293b','#0f172a'].includes(c) ? '#fff' : '#7c3aed' }} />}
                    </button>
                  ))}
                  <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} style={{ width: 34, height: 34, borderRadius: 9, border: '1.5px solid #e2e8f0', cursor: 'pointer', padding: 3 }} title="Custom" />
                </div>
              </div>

              {/* Legend toggle */}
              {wType === 'chart' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Show legend</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Display dataset labels on the chart</div>
                  </div>
                  <button onClick={() => setShowLegend(v => !v)} style={{ width: 44, height: 24, borderRadius: 12, background: showLegend ? '#7c3aed' : '#e2e8f0', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: 4, left: showLegend ? 22 : 4, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px #0003' }} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* LAYOUT TAB */}
          {tab === 'layout' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <FieldLabel>Widget Size</FieldLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {WIDGET_SIZES.map(s => (
                    <button key={s.id} onClick={() => setSize(s.id)} style={{ padding: '12px 14px', borderRadius: 12, border: `2px solid ${size === s.id ? '#7c3aed' : '#e2e8f0'}`, background: size === s.id ? '#f5f3ff' : '#fafafa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.15s' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(s.cols, 3)}, 1fr)`, gridTemplateRows: `repeat(${s.rows}, 1fr)`, gap: 3, flexShrink: 0, width: 36, height: s.rows > 1 ? 28 : 16 }}>
                        {Array.from({ length: s.cols * s.rows }).map((_, i) => (
                          <div key={i} style={{ borderRadius: 2, background: size === s.id ? '#7c3aed' : '#cbd5e1' }} />
                        ))}
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 12, fontWeight: size === s.id ? 700 : 600, color: size === s.id ? '#7c3aed' : '#1e293b' }}>{s.label}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.cols === 3 ? 'Full width' : s.cols === 1 ? '1 of 3 cols' : '2 of 3 cols'}{s.rows > 1 ? ', tall' : ''}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid preview */}
              <div style={{ padding: '14px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Grid Preview (3 columns)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                  {(() => {
                    const s = WIDGET_SIZES.find(x => x.id === size) || WIDGET_SIZES[1];
                    return Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} style={{ height: s.rows > 1 ? 48 : 28, borderRadius: 6, background: i < s.cols ? '#7c3aed22' : '#f1f5f9', border: `1.5px solid ${i < s.cols ? '#7c3aed66' : 'transparent'}`, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {i < s.cols && <div style={{ width: 12, height: 3, borderRadius: 2, background: '#7c3aed55' }} />}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 8, background: '#fafafa' }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#64748b' }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 10px #7c3aed44' }}>
            <Save size={13} /> {mode === 'edit' ? 'Update Widget' : 'Add Widget'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TEMPLATE PICKER
═══════════════════════════════════════════════════ */
function TemplatePicker({ onPick, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000060', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 20, width: 540, overflow: 'hidden', boxShadow: '0 24px 64px #00000030' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 20px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>Choose a Template</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Pick a starting layout — you can customize everything after</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #e2e8f0', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {DASHBOARD_TEMPLATES.map(t => (
            <button key={t.id} onClick={() => onPick(t)} style={{ padding: '14px 16px', borderRadius: 14, border: '1.5px solid #e2e8f0', background: '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 12, alignItems: 'flex-start', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed88'; e.currentTarget.style.background = '#faf5ff'; e.currentTarget.style.boxShadow = '0 4px 16px #7c3aed14'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = 'none'; }}>
              <span style={{ fontSize: 26, lineHeight: 1 }}>{t.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{t.desc}</div>
                {t.widgets.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {t.widgets.map((w, i) => (
                      <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 600, background: w.widget_type === 'chart' ? '#ede9fe' : w.widget_type === 'kpi' ? '#dcfce7' : '#fff7ed', color: w.widget_type === 'chart' ? '#7c3aed' : w.widget_type === 'kpi' ? '#059669' : '#d97706' }}>
                        {w.widget_type}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════ */
export default function DashboardBuilderPage() {
  const { activeDataset } = useStore();
  const [dashboards,    setDashboards]    = useState([]);
  const [activeDash,    setActiveDash]    = useState(null);
  const [widgets,       setWidgets]       = useState([]);
  const [vizList,       setVizList]       = useState([]);
  const [vizMap,        setVizMap]        = useState({});
  const [kpis,          setKpis]          = useState([]);
  const [newDashName,   setNewDashName]   = useState('');
  const [showNewDash,   setShowNewDash]   = useState(false);
  const [isEditMode,    setIsEditMode]    = useState(false);
  const [showModal,     setShowModal]     = useState(false);
  const [editingWidget, setEditingWidget] = useState(null);
  const [showTemplate,  setShowTemplate]  = useState(false);

  useEffect(() => {
    api.getDashboards().then(d => setDashboards(d.dashboards));
  }, []);

  useEffect(() => {
    if (!activeDash) return;
    api.getDashboard(activeDash.id).then(d => {
      setActiveDash(d.dashboard);
      setWidgets(d.widgets.map(w => ({
        ...w,
        config: typeof w.config === 'string'
          ? (() => { try { return JSON.parse(w.config); } catch { return {}; } })()
          : (w.config || {}),
      })));
    });
  }, [activeDash?.id]);

  useEffect(() => {
    if (!activeDataset) return;
    api.getVisualizations(activeDataset.id).then(async d => {
      setVizList(d.visualizations);
      const map = {};
      for (const viz of d.visualizations) {
        try {
          const res = await api.queryVisualization(activeDataset.id, { chartType: viz.chart_type, ...viz.config });
          map[viz.id] = { ...viz, data: res.rows };
        } catch {}
      }
      setVizMap(map);
    });
    api.getKPIs(activeDataset.id).then(d => setKpis(d.kpis));
  }, [activeDataset]);

  const createDash = async () => {
    if (!newDashName.trim()) return;
    const res = await api.createDashboard({ name: newDashName });
    setDashboards(d => [res.dashboard, ...d]);
    setActiveDash(res.dashboard);
    setWidgets([]);
    setNewDashName('');
    setShowNewDash(false);
    setShowTemplate(true);
    toast.success('Dashboard created');
  };

  const saveWidget = async ({ widget_type, visualization_id, config }) => {
    try {
      if (editingWidget) {
        await api.updateWidget(activeDash.id, editingWidget.id, { config, position: editingWidget.position || {} });
        setWidgets(prev => prev.map(w => w.id === editingWidget.id
          ? { ...w, visualization_id: visualization_id ?? w.visualization_id, config }
          : w
        ));
        toast.success('Widget updated');
      } else {
        const res = await api.addWidget(activeDash.id, {
          widgetType: widget_type, visualizationId: visualization_id || null,
          config, position: { x: 0, y: 0, w: 4, h: 3 },
        });
        const parsed = typeof res.widget.config === 'string' ? JSON.parse(res.widget.config) : (res.widget.config || config);
        setWidgets(w => [...w, { ...res.widget, config: parsed }]);
        toast.success('Widget added');
      }
      setShowModal(false);
      setEditingWidget(null);
    } catch (e) {
      toast.error(e.message || 'Failed to save widget');
    }
  };

  const deleteWidget = async (wId) => {
    await api.deleteWidget(activeDash.id, wId);
    setWidgets(w => w.filter(x => x.id !== wId));
    toast.success('Widget removed');
  };

  const deleteDash = async () => {
    if (!confirm('Delete this dashboard?')) return;
    await api.deleteDashboard(activeDash.id);
    setDashboards(d => d.filter(x => x.id !== activeDash.id));
    setActiveDash(null); setWidgets([]);
  };

  // Helper: reliably trigger a file download
  const triggerDownload = (url, filename) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Revoke after a short delay so browser has time to start download
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 200);
  };

  // Export dashboard as PNG using html2canvas (loaded from CDN on demand)
  const exportDashboardPNG = async () => {
    const el = document.getElementById('dashboard-canvas');
    if (!el) return toast.error('Dashboard canvas not found');

    toast.loading('Generating PNG…', { id: 'export-png' });
    try {
      // Load html2canvas from CDN if not already loaded
      if (!window.html2canvas) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load html2canvas'));
          document.head.appendChild(script);
        });
      }

      const canvas = await window.html2canvas(el, {
        backgroundColor: '#f8fafc',
        scale: 2,              // 2× resolution for crisp PNG
        useCORS: true,         // allow cross-origin images
        allowTaint: true,
        logging: false,
        // Capture full scrollable height, not just visible viewport
        height: el.scrollHeight,
        windowHeight: el.scrollHeight,
      });

      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const name = (activeDash.name || 'dashboard').replace(/[^a-z0-9]/gi, '_');
        triggerDownload(url, `${name}.png`);
        toast.success('PNG exported!', { id: 'export-png' });
      }, 'image/png');

    } catch (e) {
      toast.error(`Export failed: ${e.message}`, { id: 'export-png' });
    }
  };

  const applyTemplate = async (template) => {
    setShowTemplate(false);
    if (!template.widgets.length) return;
    for (const w of template.widgets) {
      try {
        const res = await api.addWidget(activeDash.id, {
          widgetType: w.widget_type, visualizationId: null,
          config: { ...w.config, size: w.size },
          position: { x: 0, y: 0, w: 4, h: 3 },
        });
        setWidgets(prev => [...prev, { ...res.widget, config: { ...w.config, size: w.size } }]);
      } catch {}
    }
    setIsEditMode(true);
    toast.success(`"${template.name}" applied — click each widget to customize`);
  };

  const getGridStyle = (widget) => {
    const cfg = typeof widget.config === 'string'
      ? (() => { try { return JSON.parse(widget.config); } catch { return {}; } })()
      : (widget.config || {});
    const sizeId   = cfg.size || widget.size || 'md';
    const s        = WIDGET_SIZES.find(x => x.id === sizeId) || WIDGET_SIZES.find(x => x.id === 'md');
    const safeCols = Math.min(s.cols, 3);
    // gridAutoRows = 240px per row, gap = 14px
    // sm (rows=1): height = 240px
    // md/wide (rows=1): height = 240px  ← same row height, wider cols
    // lg/full (rows=2): height = 240*2 + 14 = 494px  (two rows + one gap)
    return {
      gridColumn: `span ${safeCols}`,
      gridRow:    s.rows > 1 ? `span ${s.rows}` : undefined,
      // height:100% fills the grid cell exactly (gridAutoRows controls the row height)
      height: '100%',
      minWidth: 0,
      maxWidth: '100%',
      boxSizing: 'border-box',
    };
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#f8fafc', fontFamily: 'inherit' }}>
      <style>{`
        @media print {
          body > *:not(#dashboard-print-area) { display: none !important; }
          #dashboard-print-area {
            display: block !important;
            position: fixed; inset: 0;
            background: #f8fafc;
            padding: 20px;
            overflow: visible;
          }
          #dashboard-print-area .no-print { display: none !important; }
          @page { margin: 15mm; size: A4 landscape; }
        }
      `}</style>

      {/* ── Sidebar ── */}
      <div style={{ width: 236, borderRight: '1px solid #e2e8f0', background: '#fff', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '14px 14px 8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <Layers size={13} style={{ color: '#7c3aed' }} /> Dashboards
            </div>
            <button onClick={() => setShowNewDash(v => !v)} style={{ width: 28, height: 28, borderRadius: 8, border: `1.5px solid ${showNewDash ? '#7c3aed' : '#e2e8f0'}`, background: showNewDash ? '#f5f3ff' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c3aed', transition: 'all 0.15s' }}>
              <Plus size={13} />
            </button>
          </div>

          {showNewDash && (
            <div style={{ marginBottom: 10, display: 'flex', gap: 6 }}>
              <input value={newDashName} onChange={e => setNewDashName(e.target.value)} placeholder="Dashboard name…" onKeyDown={e => e.key === 'Enter' && createDash()} autoFocus style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1.5px solid #7c3aed', fontSize: 12, color: '#1e293b', outline: 'none' }} />
              <button onClick={createDash} style={{ padding: '7px 12px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+</button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
          {dashboards.length === 0 && (
            <div style={{ fontSize: 12, color: '#94a3b8', padding: '8px 6px', lineHeight: 1.6 }}>No dashboards yet.<br />Click + to create one.</div>
          )}
          {dashboards.map(d => (
            <button key={d.id} onClick={() => { setActiveDash(d); setIsEditMode(false); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: activeDash?.id === d.id ? '#f5f3ff' : 'transparent', color: activeDash?.id === d.id ? '#7c3aed' : '#475569', fontSize: 12, fontWeight: activeDash?.id === d.id ? 700 : 500, textAlign: 'left', marginBottom: 2, transition: 'all 0.15s' }}
              onMouseEnter={e => { if (activeDash?.id !== d.id) e.currentTarget.style.background = '#f8fafc'; }}
              onMouseLeave={e => { if (activeDash?.id !== d.id) e.currentTarget.style.background = 'transparent'; }}>
              <LayoutTemplate size={12} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
            </button>
          ))}
        </div>

        {/* Dataset quick stats */}
        {kpis.length > 0 && activeDataset && (
          <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              {activeDataset.name}
            </div>
            {kpis.slice(0, 3).map(kpi => (
              <div key={kpi.column} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 1 }}>{kpi.column}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#7c3aed', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
                  {kpi.total != null ? Number(kpi.total).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Canvas ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!activeDash ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#94a3b8' }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px #7c3aed18' }}>
              <LayoutTemplate size={30} style={{ color: '#7c3aed' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#1e293b', marginBottom: 4 }}>No dashboard selected</div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>Create a new dashboard from the sidebar to get started</div>
            </div>
            <button onClick={() => setShowNewDash(true)} style={{ padding: '10px 22px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 4px 14px #7c3aed33' }}>
              <Plus size={14} /> Create Dashboard
            </button>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid #e2e8f0', background: '#fff', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: '#1e293b' }}>{activeDash.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{widgets.length} widget{widgets.length !== 1 ? 's' : ''}{isEditMode ? ' · editing' : ''}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setIsEditMode(v => !v)} style={{ padding: '7px 14px', borderRadius: 9, border: `1.5px solid ${isEditMode ? '#7c3aed' : '#e2e8f0'}`, background: isEditMode ? '#f5f3ff' : '#fff', color: isEditMode ? '#7c3aed' : '#64748b', cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s' }}>
                  <Settings2 size={12} /> {isEditMode ? 'Done' : 'Edit Layout'}
                </button>
                <button onClick={() => setShowTemplate(true)} style={{ padding: '7px 14px', borderRadius: 9, border: '1.5px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Grid3x3 size={12} /> Templates
                </button>
                <button onClick={() => { setEditingWidget(null); setShowModal(true); }} style={{ padding: '7px 16px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 10px #7c3aed33' }}>
                  <Plus size={13} /> Add Widget
                </button>
                {/* Export PNG button */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={exportDashboardPNG}
                    style={{ padding: '7px 14px', borderRadius: 9, border: '1.5px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Download size={12} /> Export PNG
                  </button>
                </div>
                <button onClick={deleteDash} style={{ width: 34, height: 34, borderRadius: 9, border: '1.5px solid #fee2e2', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Grid */}
            <div id="dashboard-canvas" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 20 }}>
              {widgets.length === 0 ? (
                <div style={{ minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, border: '2px dashed #e2e8f0', borderRadius: 20, color: '#94a3b8' }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Sparkles size={24} style={{ color: '#a78bfa' }} />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 3 }}>Empty dashboard</div>
                    <div style={{ fontSize: 12 }}>Add widgets manually or start with a template</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setShowTemplate(true)} style={{ padding: '9px 18px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Grid3x3 size={12} /> Use Template
                    </button>
                    <button onClick={() => { setEditingWidget(null); setShowModal(true); }} style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={12} /> Add Widget
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gridAutoRows: '240px',   // matches sm.h — lg/full span 2 rows = 2×240 + gap
                  gridAutoFlow: 'dense',   // fills holes so sm2 goes col3 row2 not row2 col1
                  gap: 14,
                  width: '100%',
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                }}>
                  {widgets.map(w => (
                    <div key={w.id} style={getGridStyle(w)}>
                      <WidgetCard
                        widget={w} vizMap={vizMap}
                        onDelete={deleteWidget}
                        onEdit={wid => { setEditingWidget(wid); setShowModal(true); }}
                        isEditMode={isEditMode}
                        datasetId={activeDataset?.id}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {showTemplate && <TemplatePicker onPick={applyTemplate} onClose={() => setShowTemplate(false)} />}
      {showModal && (
        <WidgetModal
          key={editingWidget ? `edit-${editingWidget.id}` : `add-${Date.now()}`}
          mode={editingWidget ? 'edit' : 'add'}
          initial={editingWidget ? JSON.parse(JSON.stringify(editingWidget)) : null}
          vizList={vizList} vizMap={vizMap}
          activeDataset={activeDataset}
          onSave={saveWidget}
          onClose={() => { setShowModal(false); setEditingWidget(null); }}
        />
      )}
    </div>
  );
}