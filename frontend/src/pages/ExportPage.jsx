import React, { useState } from 'react';
import { Download, FileText, FileJson, Database, Code2, CheckCircle, Sheet, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import useStore from '../store';
import api from '../utils/api';
import DatasetSelector from '../components/shared/DatasetSelector';

function ExportCard({ icon: Icon, title, subtitle, format, onClick, color }) {
  const [clicked, setClicked] = useState(false);
  const handle = () => {
    onClick();
    setClicked(true);
    toast.success(`Preparing ${format} export...`);
    setTimeout(() => setClicked(false), 2000);
  };
  return (
    <button onClick={handle} style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px',
      background: 'var(--bg-surface)', border: '1.5px solid var(--border)',
      borderRadius: 'var(--radius-lg)', cursor: 'pointer', textAlign: 'left', width: '100%',
      transition: 'var(--transition)', color: 'var(--text-primary)',
      boxShadow: 'var(--shadow-sm)',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = `0 0 0 3px ${color}18, var(--shadow-md)`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {clicked ? <CheckCircle size={20} style={{ color: 'var(--success)' }} /> : <Icon size={20} style={{ color }} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="badge badge-gray">.{format.toLowerCase()}</span>
        <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
      </div>
    </button>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{subtitle}</div>
    </div>
  );
}

export default function ExportPage() {
  const { activeDataset } = useStore();

  if (!activeDataset) {
    return (
      <div className="page-content">
        <div className="page-header">
          <div>
            <div className="page-title">Export Center</div>
            <div className="page-subtitle">Download your data, scripts, and visualizations</div>
          </div>
          <DatasetSelector />
        </div>
        <div className="empty-state">
          <Download size={40} />
          <h3>No dataset selected</h3>
          <p>Select a dataset from the dropdown to see available export options.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content fade-in">
      <div className="page-header">
        <div>
          <div className="page-title">Export Center</div>
          <div className="page-subtitle">
            Exporting: <strong style={{ color: 'var(--accent)' }}>{activeDataset.name}</strong>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {activeDataset.row_count?.toLocaleString()} rows · {activeDataset.column_count} columns
            </span>
          </div>
        </div>
        <DatasetSelector />
      </div>

      <div style={{ display: 'flex', gap: 28, maxWidth: 800 }}>
        {/* Dataset */}
        <div style={{ flex: 1 }}>
          <SectionHeader title="Dataset" subtitle="Export raw or cleaned data" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ExportCard icon={FileText} title="CSV" subtitle="Universal format, opens in any tool" format="CSV" color="var(--success)" onClick={() => api.exportCSV(activeDataset.id)} />
            <ExportCard icon={Sheet} title="Excel" subtitle="Microsoft Excel spreadsheet" format="XLSX" color="var(--info)" onClick={() => api.exportXLSX(activeDataset.id)} />
            <ExportCard icon={FileJson} title="JSON" subtitle="Array format for APIs and JS apps" format="JSON" color="var(--warning)" onClick={() => api.exportJSON(activeDataset.id)} />
          </div>
        </div>

        {/* Code */}
        <div style={{ flex: 1 }}>
          <SectionHeader title="Generated Code" subtitle="Reproduce your transformations" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ExportCard icon={Database} title="SQL Script" subtitle="All applied operations as SQL" format="SQL" color="var(--accent)" onClick={() => api.exportSQL(activeDataset.id)} />
            <ExportCard icon={Code2} title="Python Script" subtitle="Pandas pipeline — all transformations" format="PY" color="#8b5cf6" onClick={() => api.exportPython(activeDataset.id)} />
          </div>

          <div style={{ marginTop: 20, padding: '14px 16px', background: 'var(--accent-dim)', border: '1.5px solid rgba(124,58,237,0.2)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>💡 Tip</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              The generated Python script uses <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>pandas</span> and reproduces every cleaning operation you applied in the Studio. Run it with <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>python script.py</span>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
