import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import {
  Upload, Database, Plus, Trash2, Table2, Wrench,
  BarChart3, Link, X, AlertCircle, RefreshCw,
  Layers, TrendingUp, FileText, FileJson, Sheet
} from 'lucide-react';
import useStore from '../store';
import api from '../utils/api';

function ImportModal({ onClose, onImported }) {
  const [tab, setTab] = useState('file');
  const [url, setUrl] = useState('');
  const [dsName, setDsName] = useState('');
  const [loading, setLoading] = useState(false);

  const onDrop = useCallback(async (files) => {
    const file = files[0];
    if (!file) return;
    setLoading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('name', dsName || file.name.replace(/\.[^.]+$/, ''));
    try {
      const data = await api.uploadDataset(form);
      if (data.error) throw new Error(data.error);
      toast.success(`"${data.dataset.name}" imported — ${data.dataset.row_count.toLocaleString()} rows`);
      onImported(data.dataset);
      onClose();
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [dsName]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.xls','.xlsx'], 'application/json': ['.json'] },
    multiple: false,
  });

  const handleUrlImport = async () => {
    if (!url) return toast.error('Enter a URL');
    setLoading(true);
    try {
      const data = await api.importFromUrl(url, dsName);
      if (data.error) throw new Error(data.error);
      toast.success(`"${data.dataset.name}" imported — ${data.dataset.row_count.toLocaleString()} rows`);
      onImported(data.dataset);
      onClose();
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Import Dataset</span>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Dataset Name (optional)</label>
            <input value={dsName} onChange={e => setDsName(e.target.value)} placeholder="Auto-detected from filename..." />
          </div>

          <div className="tabs" style={{ marginBottom: 16 }}>
            {[{ id: 'file', label: 'Upload File' }, { id: 'url', label: 'From URL' }].map(t => (
              <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'file' && (
            <div {...getRootProps()} style={{
              border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-lg)', padding: '36px 24px', textAlign: 'center',
              cursor: 'pointer', background: isDragActive ? 'var(--accent-dim)' : 'var(--bg-elevated)',
              transition: 'var(--transition)',
            }}>
              <input {...getInputProps()} />
              <Upload size={32} style={{ color: isDragActive ? 'var(--accent)' : 'var(--text-muted)', marginBottom: 12 }} />
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontSize: 15 }}>
                {isDragActive ? 'Drop to import' : 'Drag & drop your file here'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Supports CSV, Excel (.xlsx, .xls), and JSON · Up to 100MB
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                {[{ icon: FileText, label: 'CSV' }, { icon: Sheet, label: 'Excel' }, { icon: FileJson, label: 'JSON' }].map(ft => (
                  <div key={ft.label} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'var(--bg-surface)', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    <ft.icon size={12} />{ft.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'url' && (
            <div>
              <div className="info-banner"><AlertCircle size={13} />Imports CSV or JSON data from a public URL</div>
              <div className="form-group">
                <label>Dataset URL</label>
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/data.csv" onKeyDown={e => e.key === 'Enter' && handleUrlImport()} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setUrl('https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv')}>
                  Try Titanic CSV
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {tab === 'url' && (
            <button className="btn btn-primary" onClick={handleUrlImport} disabled={loading || !url}>
              {loading ? <><span className="spinner" style={{ width: 13, height: 13 }} />Importing...</> : 'Import'}
            </button>
          )}
          {loading && tab === 'file' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
              <span className="spinner" style={{ width: 14, height: 14 }} /> Importing...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DatasetCard({ dataset, onDelete, onActivate, isActive }) {
  const navigate = useNavigate();
  const stats = (() => { try { return JSON.parse(dataset.stats_json || '{}'); } catch { return {}; } })();

  return (
    <div className="card fade-in" style={{
      border: isActive ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
      boxShadow: isActive ? '0 0 0 3px var(--accent-glow), var(--shadow-md)' : 'var(--shadow-sm)',
      transition: 'var(--transition)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: isActive ? 'var(--accent)' : 'var(--bg-elevated)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1.5px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
            boxShadow: isActive ? '0 2px 8px rgba(124,58,237,0.3)' : 'none',
          }}>
            <Database size={16} style={{ color: isActive ? '#fff' : 'var(--text-secondary)' }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2, fontSize: 14 }}>{dataset.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {dataset.file_type?.toUpperCase()} · {new Date(dataset.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {isActive && <span className="badge badge-purple">Active</span>}
          <button className="btn-icon" onClick={() => onDelete(dataset.id)} title="Delete dataset" style={{ color: 'var(--danger)' }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Rows', val: dataset.row_count?.toLocaleString() || '0' },
          { label: 'Cols', val: dataset.column_count || '0' },
          { label: 'Missing', val: stats.missingValues || 0 },
        ].map(({ label, val }) => (
          <div key={label} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Type badges */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
        {stats.numericColumns > 0 && <span className="badge badge-blue">📊 {stats.numericColumns} numeric</span>}
        {stats.categoricalColumns > 0 && <span className="badge badge-purple">🏷 {stats.categoricalColumns} categorical</span>}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
          onClick={() => { onActivate(dataset); navigate('/explorer'); }}>
          <Table2 size={12} /> Explore
        </button>
        <button className="btn btn-secondary btn-sm" style={{ flex: 1 }}
          onClick={() => { onActivate(dataset); navigate('/studio'); }}>
          <Layers size={12} /> Studio
        </button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { datasets, setDatasets, activeDataset, setActiveDataset, addDataset, removeDataset } = useStore();
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDatasets()
      .then(d => { setDatasets(d.datasets); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id) => {
    if (!confirm('Delete this dataset? This cannot be undone.')) return;
    try {
      await api.deleteDataset(id);
      removeDataset(id);
      if (activeDataset?.id === id) setActiveDataset(null);
      toast.success('Dataset deleted');
    } catch (e) { toast.error(e.message); }
  };

  const totalRows = datasets.reduce((s, d) => s + (d.row_count || 0), 0);

  return (
    <div className="page-content fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">My Datasets</div>
          <div className="page-subtitle">Import and manage your data sources</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setLoading(true);
            api.getDatasets().then(d => { setDatasets(d.datasets); }).finally(() => setLoading(false));
          }}>
            <RefreshCw size={13} />
          </button>
          <button className="btn btn-primary" onClick={() => setShowImport(true)}>
            <Plus size={14} /> Import Dataset
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="stat-grid" style={{ marginBottom: 28 }}>
        <div className="stat-card">
          <div className="stat-label">Datasets</div>
          <div className="stat-value">{datasets.length}</div>
          <div className="stat-sub">imported</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Rows</div>
          <div className="stat-value">{totalRows.toLocaleString()}</div>
          <div className="stat-sub">across all datasets</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Dataset</div>
          <div className="stat-value" style={{ fontSize: 14, lineHeight: 1.3 }}>{activeDataset?.name || '—'}</div>
          <div className="stat-sub">{activeDataset ? `${activeDataset.row_count?.toLocaleString()} rows` : 'none selected'}</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--accent-dim)', border: '1.5px solid rgba(124,58,237,0.2)' }}>
          <div className="stat-label" style={{ color: 'var(--accent)' }}>Recommended Max</div>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>1M</div>
          <div className="stat-sub">rows for local use</div>
        </div>
      </div>

      {/* Empty state */}
      {datasets.length === 0 && !loading && (
        <div style={{
          background: 'var(--bg-surface)', border: '2px dashed var(--border)',
          borderRadius: 'var(--radius-xl)', padding: 56, textAlign: 'center', marginBottom: 24,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, background: 'var(--accent-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
          }}>
            <Database size={28} style={{ color: 'var(--accent)' }} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10, color: 'var(--text-primary)' }}>
            No datasets yet
          </div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 28, maxWidth: 380, margin: '0 auto 28px', lineHeight: 1.6, fontSize: 13 }}>
            Import a CSV, Excel, or JSON file to start analyzing your data. You can also pull data from any public URL.
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => setShowImport(true)}>
            <Upload size={16} /> Import Your First Dataset
          </button>
        </div>
      )}

      {loading && (
        <div className="empty-state">
          <div className="spinner" style={{ width: 28, height: 28 }} />
          <p>Loading datasets...</p>
        </div>
      )}

      {/* Dataset grid */}
      {datasets.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {datasets.map(ds => (
            <DatasetCard
              key={ds.id} dataset={ds}
              isActive={activeDataset?.id === ds.id}
              onDelete={handleDelete}
              onActivate={setActiveDataset}
            />
          ))}
        </div>
      )}

      {/* Workflow guide */}
      {datasets.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <div className="section-title">Recommended Workflow</div>
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto', background: 'var(--bg-surface)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
            {[
              { step: 1, label: 'Import', desc: 'Upload CSV/Excel/JSON', icon: Upload, done: true },
              { step: 2, label: 'Explore', desc: 'Browse & inspect', icon: Table2 },
              { step: 3, label: 'Studio', desc: 'Clean + Visualize', icon: Layers },
              { step: 4, label: 'Dashboard', desc: 'Build dashboards', icon: BarChart3 },
              { step: 5, label: 'Export', desc: 'Download & share', icon: TrendingUp },
            ].map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.step} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px',
                  borderRight: i < 4 ? '1.5px solid var(--border)' : 'none', flex: 1, minWidth: 120,
                }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                    background: step.done ? 'var(--accent)' : 'var(--bg-elevated)',
                    border: `1.5px solid ${step.done ? 'var(--accent)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: step.done ? '0 2px 6px rgba(124,58,237,0.3)' : 'none',
                  }}>
                    <Icon size={13} style={{ color: step.done ? '#fff' : 'var(--text-secondary)' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{step.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{step.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={(ds) => { addDataset(ds); setActiveDataset(ds); }}
        />
      )}
    </div>
  );
}
