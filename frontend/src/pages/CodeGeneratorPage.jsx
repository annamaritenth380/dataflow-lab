import React, { useEffect, useState } from 'react';
import { Code2, Play, Copy, Check, Download, RefreshCw, AlertCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import useStore from '../store';
import api from '../utils/api';
import DatasetSelector from '../components/shared/DatasetSelector';

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button className="btn btn-secondary btn-sm" onClick={copy}>
      {copied ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// Detect if a SQL string contains any mutation statements
function containsMutation(sql) {
  const MUTATION = new Set(['UPDATE','DELETE','DROP','ALTER','INSERT','CREATE','REPLACE','TRUNCATE']);
  return sql
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .some(s => MUTATION.has(s.trimStart().split(/\s+/)[0].toUpperCase()));
}

export default function CodeGeneratorPage() {
  const { activeDataset, setActiveDataset, generatedSQL, generatedPython, setGeneratedCode } = useStore();
  const [tab, setTab] = useState('sql');
  const [sqlCode, setSqlCode] = useState('');
  const [pythonCode, setPythonCode] = useState('');
  const [execResult, setExecResult] = useState(null);
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError] = useState('');
  const [history, setHistory] = useState([]);
  const [mutationWarning, setMutationWarning] = useState(false);

  useEffect(() => {
    if (activeDataset) {
      api.getOperationHistory(activeDataset.id).then(d => {
        const ops = d.operations;
        setHistory(ops);

        const sqlLines = [
          `-- DataFlow Lab | ${activeDataset.name}`,
          `-- ${activeDataset.row_count?.toLocaleString()} rows × ${activeDataset.column_count} columns`,
          `-- Generated: ${new Date().toLocaleString()}`,
          '',
          `-- Preview`,
          `SELECT * FROM "${activeDataset.table_name}" LIMIT 100;`,
          '',
          `-- Applied Transformations:`,
        ];
        const pyLines = [
          `# DataFlow Lab | ${activeDataset.name}`,
          `# Generated: ${new Date().toLocaleString()}`,
          '',
          `import pandas as pd`,
          '',
          `df = pd.read_csv("${activeDataset.original_filename || activeDataset.name + '.csv'}")`,
          `print(f"Shape: {df.shape}")`,
          `print(df.head())`,
          '',
          `# Applied Transformations:`,
        ];

        ops.forEach(op => {
          sqlLines.push(``, `-- ${op.operation_type}`, op.sql_generated || '-- (no SQL)');
          pyLines.push(``, `# ${op.operation_type}`, op.python_generated || '# (no python)');
        });

        setSqlCode(generatedSQL || sqlLines.join('\n'));
        setPythonCode(generatedPython || pyLines.join('\n'));
      });
    }
  }, [activeDataset]);

  useEffect(() => {
    if (generatedSQL) setSqlCode(generatedSQL);
    if (generatedPython) setPythonCode(generatedPython);
  }, [generatedSQL, generatedPython]);

  // Show mutation warning when SQL contains write statements
  useEffect(() => {
    if (tab === 'sql') {
      setMutationWarning(containsMutation(sqlCode));
    } else {
      setMutationWarning(false);
    }
  }, [sqlCode, tab]);

  const handleRun = async () => {
    if (!activeDataset) return toast.error('Select a dataset first');
    setExecLoading(true);
    setExecError('');
    setExecResult(null);
    try {
      const result = await api.executeCustomSql(activeDataset.id, sqlCode);
      if (result.error) throw new Error(result.error);

      setExecResult(result.results);

      // If the SQL mutated data, sync activeDataset so Studio + Explorer reflect changes
      if (result.hasMutation) {
        if (result.updatedDataset) {
          // Backend returned fresh metadata — update store immediately
          setActiveDataset({
            ...activeDataset,
            ...result.updatedDataset,
            schema: result.updatedDataset.schema,
          });
          toast.success(
            result.results
              ? `${result.results.length} rows returned`
              : `Executed — dataset updated (${result.updatedDataset.row_count?.toLocaleString()} rows)`,
          );
        } else {
          // Table may have been dropped; re-fetch dataset list
          toast.success('Executed — data changed');
        }
      } else {
        toast.success(result.results ? `${result.results.length} rows returned` : 'Executed');
      }
    } catch (e) {
      setExecError(e.message);
      toast.error(e.message);
    } finally {
      setExecLoading(false);
    }
  };

  const resultHeaders = execResult?.length > 0
    ? Object.keys(execResult[0]).filter(k => k !== '__rowid')
    : [];

  const activeCode = tab === 'sql' ? sqlCode : pythonCode;
  const setActiveCode = tab === 'sql'
    ? (v) => { setSqlCode(v); setGeneratedCode(v, pythonCode); }
    : (v) => { setPythonCode(v); setGeneratedCode(sqlCode, v); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 20px', borderBottom: '1.5px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0, background: 'var(--bg-surface)', flexWrap: 'wrap' }}>
        <DatasetSelector />
        <div style={{ height: 20, width: 1.5, background: 'var(--border)' }} />
        <div className="tabs" style={{ margin: 0, borderBottom: 'none' }}>
          {[{ id: 'sql', label: '🗃 SQL' }, { id: 'python', label: '🐍 Python' }].map(t => (
            <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} style={{ marginBottom: 0 }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            if (activeDataset) {
              api.getOperationHistory(activeDataset.id).then(d => {
                const sqlLines = d.operations.map(op => `-- ${op.operation_type}\n${op.sql_generated}`).join('\n\n');
                const pyLines = d.operations.map(op => `# ${op.operation_type}\n${op.python_generated}`).join('\n\n');
                setSqlCode(sqlLines || `SELECT * FROM "${activeDataset?.table_name}" LIMIT 100;`);
                setPythonCode(pyLines || `df = pd.read_csv("${activeDataset?.name}.csv")\nprint(df.head())`);
                setGeneratedCode('', '');
              });
            }
          }}>
            <RefreshCw size={12} /> Regenerate
          </button>
          <CopyBtn text={activeCode} />
          {tab === 'sql' && (
            <button className="btn btn-primary btn-sm" onClick={handleRun} disabled={execLoading || !activeDataset}>
              {execLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Play size={12} />}
              {execLoading ? 'Running...' : 'Run SQL'}
            </button>
          )}
          {activeDataset && (
            <button className="btn btn-secondary btn-sm" onClick={() => tab === 'sql' ? api.exportSQL(activeDataset.id) : api.exportPython(activeDataset.id)}>
              <Download size={12} /> .{tab === 'sql' ? 'sql' : 'py'}
            </button>
          )}
        </div>
      </div>

      {/* Mutation warning banner */}
      {mutationWarning && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 20px',
          background: 'var(--warning-dim, #fffbeb)',
          borderBottom: '1px solid var(--warning, #f59e0b)33',
          fontSize: 12, color: 'var(--warning, #92400e)',
          flexShrink: 0,
        }}>
          <Info size={13} style={{ flexShrink: 0 }} />
          SQL contains write statements (UPDATE / DELETE / etc). Running will modify the live dataset.
          Studio preview and Data Explorer will automatically reflect the changes.
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: execResult || execError ? '0 0 55%' : 1, overflow: 'hidden', position: 'relative' }}>
            <textarea
              value={activeCode}
              onChange={e => setActiveCode(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%', height: '100%',
                background: '#faf9ff',
                color: '#3d1f8a',
                border: 'none', outline: 'none',
                fontFamily: 'var(--font-mono)', fontSize: 13,
                lineHeight: 1.7, padding: 20, resize: 'none', tabSize: 2,
                borderBottom: (execResult || execError) ? '1.5px solid var(--border)' : 'none',
              }}
            />
          </div>

          {execError && (
            <div style={{ padding: 16, overflowY: 'auto', flex: 1, background: 'var(--bg-base)' }}>
              <div style={{ display: 'flex', gap: 10, background: 'var(--danger-dim)', border: '1.5px solid rgba(220,38,38,0.25)', borderRadius: 10, padding: '12px 16px' }}>
                <AlertCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 13, marginBottom: 4 }}>SQL Error</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--danger)' }}>{execError}</div>
                </div>
              </div>
            </div>
          )}

          {execResult && !execError && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: 'var(--bg-base)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 10 }}>
                {execResult.length > 0 ? `${execResult.length} rows returned` : 'Query executed. No rows returned.'}
              </div>
              {execResult.length > 0 && (
                <div className="data-table-wrapper" style={{ maxHeight: 260 }}>
                  <table className="data-table">
                    <thead><tr>{resultHeaders.map(h => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {execResult.slice(0, 200).map((row, i) => (
                        <tr key={i}>{resultHeaders.map(h => <td key={h}>{String(row[h] ?? '')}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* History sidebar */}
        <div style={{ width: 220, borderLeft: '1.5px solid var(--border)', overflowY: 'auto', padding: 14, background: 'var(--bg-surface)', flexShrink: 0 }}>
          <div className="section-title">Applied Operations</div>
          {history.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
              No operations yet. Use the Studio to generate code.
            </div>
          ) : history.map((op, i) => (
            <button key={op.id} style={{
              display: 'block', width: '100%', padding: '8px 10px', background: 'var(--bg-elevated)',
              border: '1.5px solid var(--border)', borderRadius: 8, marginBottom: 6,
              cursor: 'pointer', textAlign: 'left', transition: 'var(--transition)',
            }}
              onClick={() => {
                const snippet = tab === 'sql' ? op.sql_generated : op.python_generated;
                if (snippet) { setActiveCode(activeCode + '\n\n' + snippet); toast.success('Appended'); }
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-dim)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
            >
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginBottom: 3, fontWeight: 600 }}>#{i + 1} {op.operation_type}</div>
              {op.params?.column && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{op.params.column}</div>}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Click to append</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}