import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowUp, ArrowDown, ArrowUpDown, Search, RefreshCw,
  ChevronLeft, ChevronRight, Info, Play, AlertTriangle,
  Undo2, Redo2, X, Database
} from 'lucide-react';
import toast from 'react-hot-toast';
import useStore from '../store';
import api from '../utils/api';
import DatasetSelector from '../components/shared/DatasetSelector';

/* SQL validation - only allow SELECT */
function validateSQL(sql) {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed) return { ok: false, msg: 'Query cannot be empty.' };
  if (!trimmed.startsWith('SELECT')) return { ok: false, msg: 'Only SELECT queries are allowed in the Explorer. Use the Studio for modifications.' };
  const BLOCKED = ['INSERT','UPDATE','DELETE','DROP','ALTER','CREATE','TRUNCATE','EXEC','PRAGMA'];
  for (const kw of BLOCKED) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(trimmed)) return { ok: false, msg: `"${kw}" is not allowed. Only SELECT queries are permitted.` };
  }
  return { ok: true };
}

function ColumnStatsPanel({ datasetId, column, onClose }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.getColumnStats(datasetId, column.name)
      .then(d => { setStats(d.stats); setLoading(false); })
      .catch(() => setLoading(false));
  }, [datasetId, column.name]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 14 }}>{column.name}</div>
          <span className={`badge ${column.type === 'integer' || column.type === 'real' ? 'badge-blue' : 'badge-purple'}`} style={{ marginTop: 4 }}>{column.type}</span>
        </div>
        <button className="btn-icon" onClick={onClose}><X size={15} /></button>
      </div>
      {loading && <div className="spinner" style={{ margin: '20px auto' }} />}
      {stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'Total', val: stats.totalCount?.toLocaleString() },
            { label: 'Missing', val: `${stats.missingCount} (${stats.missingPct}%)`, warn: stats.missingCount > 0 },
            { label: 'Unique', val: stats.uniqueCount?.toLocaleString() },
            stats.min !== undefined && { label: 'Min', val: stats.min },
            stats.max !== undefined && { label: 'Max', val: stats.max },
            stats.mean !== undefined && { label: 'Mean', val: Number(stats.mean)?.toFixed(4) },
          ].filter(Boolean).map(({ label, val, warn }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: warn ? 'var(--warning)' : 'var(--text-primary)' }}>{val}</span>
            </div>
          ))}
          {stats.topValues?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, fontWeight: 700 }}>Top Values</div>
              {stats.topValues.map(({ val, cnt }) => (
                <div key={val} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{String(val)}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{cnt}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ExplorerPage() {
  const { activeDataset } = useStore();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // Read limit from settings (localStorage), fallback to 100
  const [limit] = useState(() => {
    const saved = localStorage.getItem('settings_previewSize');
    return saved ? Number(saved) : 100;
  });
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [filterCol, setFilterCol] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const [schema, setSchema] = useState([]);
  const [selectedCol, setSelectedCol] = useState(null);

  // SQL query state
  const [sqlMode, setSqlMode] = useState(false);
  const [customSql, setCustomSql] = useState('');
  const [sqlRows, setSqlRows] = useState(null);
  const [sqlError, setSqlError] = useState('');
  const [sqlWarning, setSqlWarning] = useState('');
  const [sqlRunning, setSqlRunning] = useState(false);

  // Undo/Redo for filter/sort state
  const [stateHistory, setStateHistory] = useState([{ sortCol: '', sortDir: 'asc', filterCol: '', filterVal: '' }]);
  const [stateIdx, setStateIdx] = useState(0);

  useEffect(() => {
    if (activeDataset) {
      setSchema(JSON.parse(activeDataset.schema_json || '[]'));
      setPage(1); setSqlRows(null); setSqlError('');
      setCustomSql(`SELECT * FROM "${activeDataset.table_name}" LIMIT 100;`);
    }
  }, [activeDataset]);

  const fetchRows = useCallback(async () => {
    if (!activeDataset || sqlMode) return;
    setLoading(true);
    try {
      const params = { page, limit };
      if (sortCol) { params.sort = sortCol; params.dir = sortDir; }
      if (filterCol && filterVal) { params.filterCol = filterCol; params.filterVal = filterVal; }
      const data = await api.getDatasetRows(activeDataset.id, params);
      setRows(data.rows); setTotal(data.total);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [activeDataset, page, limit, sortCol, sortDir, filterCol, filterVal, sqlMode]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const pushState = (newState) => {
    setStateHistory(h => {
      const trimmed = h.slice(0, stateIdx + 1);
      return [...trimmed, newState];
    });
    setStateIdx(i => i + 1);
  };

  const handleSort = (col) => {
    const newDir = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    const st = { sortCol: col, sortDir: newDir, filterCol, filterVal };
    setSortCol(col); setSortDir(newDir); setPage(1);
    pushState(st);
  };

  const handleFilter = (col, val) => {
    setFilterCol(col); setFilterVal(val); setPage(1);
    pushState({ sortCol, sortDir, filterCol: col, filterVal: val });
  };

  const undo = () => {
    if (stateIdx <= 0) return;
    const prev = stateHistory[stateIdx - 1];
    setStateIdx(i => i - 1);
    setSortCol(prev.sortCol); setSortDir(prev.sortDir);
    setFilterCol(prev.filterCol); setFilterVal(prev.filterVal);
    setPage(1);
  };

  const redo = () => {
    if (stateIdx >= stateHistory.length - 1) return;
    const next = stateHistory[stateIdx + 1];
    setStateIdx(i => i + 1);
    setSortCol(next.sortCol); setSortDir(next.sortDir);
    setFilterCol(next.filterCol); setFilterVal(next.filterVal);
    setPage(1);
  };

  const runSQL = async () => {
    setSqlError(''); setSqlWarning('');
    const validation = validateSQL(customSql);
    if (!validation.ok) { setSqlError(validation.msg); return; }
    setSqlRunning(true);
    try {
      const result = await api.executeCustomSql(activeDataset.id, customSql);
      if (result.error) throw new Error(result.error);
      setSqlRows(result.results || []);
      if (result.results?.length === 0) setSqlWarning('Query executed successfully but returned no rows.');
    } catch (e) {
      setSqlError(e.message);
    } finally { setSqlRunning(false); }
  };

  const headers = sqlMode && sqlRows?.length > 0
    ? Object.keys(sqlRows[0]).filter(k => k !== '__rowid')
    : rows.length > 0 ? Object.keys(rows[0]).filter(k => k !== '__rowid') : schema.map(c => c.name);

  const displayRows = sqlMode ? (sqlRows || []) : rows;
  const totalPages = Math.ceil(total / limit);

  if (!activeDataset) {
    return (
      <div className="page-content">
        <div className="page-header">
          <div><div className="page-title">Data Explorer</div></div>
          <DatasetSelector />
        </div>
        <div className="empty-state">
          <Database size={40} /><h3>No dataset selected</h3>
          <p>Select a dataset to browse and explore your data.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 20px', borderBottom: '1.5px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, background: 'var(--bg-surface)', flexWrap: 'wrap' }}>
        <DatasetSelector />
        <div style={{ height: 20, width: 1.5, background: 'var(--border)' }} />

        {/* Undo/Redo */}
        <button className="btn btn-secondary btn-sm" onClick={undo} disabled={stateIdx <= 0 || sqlMode} title="Undo sort/filter"><Undo2 size={12} /></button>
        <button className="btn btn-secondary btn-sm" onClick={redo} disabled={stateIdx >= stateHistory.length - 1 || sqlMode} title="Redo"><Redo2 size={12} /></button>

        <div style={{ height: 20, width: 1.5, background: 'var(--border)' }} />

        {!sqlMode && (
          <>
            <select value={filterCol} onChange={e => handleFilter(e.target.value, filterVal)} style={{ width: 150, fontSize: 12 }}>
              <option value="">Filter column...</option>
              {schema.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input value={filterVal} onChange={e => handleFilter(filterCol, e.target.value)} placeholder="Filter value..." style={{ paddingLeft: 26, width: 180, fontSize: 12 }} />
            </div>
            {filterVal && <button className="btn-icon" onClick={() => handleFilter('', '')} title="Clear filter"><X size={13} /></button>}
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {!sqlMode && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{total.toLocaleString()}</span> rows
          </span>}
          <button
            className={`btn btn-sm ${sqlMode ? 'btn-primary' : 'btn-purple-soft'}`}
            onClick={() => { setSqlMode(m => !m); setSqlRows(null); setSqlError(''); setSqlWarning(''); }}
          >
            SQL Query {sqlMode ? '(active)' : ''}
          </button>
          {!sqlMode && <button className="btn-icon" onClick={fetchRows} title="Refresh"><RefreshCw size={14} /></button>}
        </div>
      </div>

      {/* SQL query panel */}
      {sqlMode && (
        <div style={{ padding: '14px 20px', borderBottom: '1.5px solid var(--border)', background: '#f8f7ff', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <textarea
              value={customSql}
              onChange={e => { setCustomSql(e.target.value); setSqlError(''); setSqlWarning(''); }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSQL(); } }}
              placeholder="SELECT * FROM your_table WHERE ..."
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical', minHeight: 70, maxHeight: 160, lineHeight: 1.6, color: 'var(--accent-2)' }}
              spellCheck={false}
            />
            <button className="btn btn-primary" onClick={runSQL} disabled={sqlRunning} style={{ alignSelf: 'flex-end' }}>
              {sqlRunning ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Play size={13} />}
              {sqlRunning ? 'Running...' : 'Run'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>Ctrl+Enter</span> to run · Only SELECT queries are allowed
            {activeDataset && <span style={{ marginLeft: 8 }}>Table: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>"{activeDataset.table_name}"</span></span>}
          </div>

          {sqlError && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--danger-dim)', border: '1.5px solid rgba(220,38,38,0.25)', borderRadius: 8, padding: '10px 12px' }}>
              <AlertTriangle size={14} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 12 }}>Query Error</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--danger)', marginTop: 2 }}>{sqlError}</div>
              </div>
            </div>
          )}
          {sqlWarning && !sqlError && (
            <div style={{ marginTop: 8 }} className="warning-banner"><AlertTriangle size={13} />{sqlWarning}</div>
          )}
          {sqlRows && !sqlError && (
            <div className="success-banner" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontSize: 12 }}>
              ✓ {sqlRows.length} row{sqlRows.length !== 1 ? 's' : ''} returned
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {loading && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, var(--accent), var(--accent-light))', zIndex: 10, borderRadius: 0 }} />}
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 44, color: 'var(--text-muted)', cursor: 'default' }}>#</th>
                {headers.map(col => {
                  const colInfo = schema.find(c => c.name === col);
                  const isSorted = sortCol === col && !sqlMode;
                  return (
                    <th key={col} onClick={() => !sqlMode && handleSort(col)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span className={`type-${colInfo?.type || 'text'}`} style={{ fontSize: 9 }}>●</span>
                        {col}
                        {!sqlMode && (isSorted ? (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} style={{ opacity: 0.25 }} />)}
                        {!sqlMode && (
                          <button className="btn-icon" style={{ padding: 2 }}
                            onClick={e => { e.stopPropagation(); setSelectedCol(colInfo || { name: col, type: 'text' }); }}>
                            <Info size={10} />
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, i) => (
                <tr key={row.__rowid || i}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    {sqlMode ? i + 1 : (page - 1) * limit + i + 1}
                  </td>
                  {headers.map(col => (
                    <td key={col} title={String(row[col] ?? '')}>
                      {row[col] === null || row[col] === '' || row[col] === undefined
                        ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 11 }}>null</span>
                        : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {displayRows.length === 0 && !loading && (
            <div className="empty-state">
              <Search size={28} />
              <h3>{sqlMode ? 'No results' : 'No rows found'}</h3>
              <p>{sqlMode ? 'Your query returned no rows.' : filterVal ? 'Try a different filter.' : 'Dataset appears to be empty.'}</p>
            </div>
          )}
        </div>

        {/* Column stats panel */}
        {selectedCol && !sqlMode && (
          <div className="panel-side">
            <ColumnStatsPanel datasetId={activeDataset.id} column={selectedCol} onClose={() => setSelectedCol(null)} />
          </div>
        )}
      </div>

      {/* Pagination (table mode only) */}
      {!sqlMode && (
        <div style={{ padding: '9px 20px', borderTop: '1.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'var(--bg-surface)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {((page - 1) * limit + 1).toLocaleString()}–{Math.min(page * limit, total).toLocaleString()} of {total.toLocaleString()}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={13} /></button>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', padding: '0 8px', fontWeight: 600 }}>{page} / {totalPages || 1}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}><ChevronRight size={13} /></button>
          </div>
        </div>
      )}
    </div>
  );
}