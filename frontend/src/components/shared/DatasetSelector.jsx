import React, { useEffect, useState } from 'react';
import { Database, ChevronDown, Check, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useStore from '../../store';
import api from '../../utils/api';

export default function DatasetSelector({ onSelect }) {
  const { datasets, setDatasets, activeDataset, setActiveDataset } = useStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (datasets.length === 0) {
      setLoading(true);
      api.getDatasets()
        .then(d => { setDatasets(d.datasets); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, []);

  const handleSelect = (ds) => {
    setActiveDataset(ds);
    setOpen(false);
    if (onSelect) onSelect(ds);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 11px',
          background: activeDataset ? 'var(--accent-dim)' : 'var(--bg-elevated)',
          border: `1.5px solid ${activeDataset ? 'rgba(124,58,237,0.25)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          cursor: 'pointer',
          color: activeDataset ? 'var(--accent)' : 'var(--text-secondary)',
          fontSize: 13, fontWeight: activeDataset ? 700 : 500,
          transition: 'var(--transition)', minWidth: 200,
        }}
      >
        <Database size={13} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading ? 'Loading...' : activeDataset ? activeDataset.name : 'Select dataset...'}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: 'var(--transition)' }} />
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 5px)', left: 0,
            minWidth: 260, background: 'var(--bg-surface)',
            border: '1.5px solid var(--border)', borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-popup)', zIndex: 100, overflow: 'hidden',
            maxHeight: 320, overflowY: 'auto',
          }}>
            {datasets.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>No datasets imported yet.</div>
                <button className="btn btn-primary btn-sm" onClick={() => { setOpen(false); navigate('/'); }}>
                  <Plus size={12} /> Import Dataset
                </button>
              </div>
            ) : (
              <>
                <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  {datasets.length} dataset{datasets.length !== 1 ? 's' : ''}
                </div>
                {datasets.map(ds => (
                  <button
                    key={ds.id}
                    onClick={() => handleSelect(ds)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      padding: '9px 12px',
                      background: activeDataset?.id === ds.id ? 'var(--accent-dim)' : 'transparent',
                      border: 'none', cursor: 'pointer', color: 'var(--text-primary)',
                      fontSize: 13, textAlign: 'left', transition: 'var(--transition)',
                    }}
                    onMouseEnter={e => { if (activeDataset?.id !== ds.id) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                    onMouseLeave={e => { if (activeDataset?.id !== ds.id) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                      background: activeDataset?.id === ds.id ? 'var(--accent)' : 'var(--bg-elevated)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Database size={13} style={{ color: activeDataset?.id === ds.id ? '#fff' : 'var(--text-secondary)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: activeDataset?.id === ds.id ? 'var(--accent)' : 'var(--text-primary)' }}>
                        {ds.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {ds.row_count?.toLocaleString()} rows · {ds.column_count} cols · {ds.file_type?.toUpperCase()}
                      </div>
                    </div>
                    {activeDataset?.id === ds.id && <Check size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
