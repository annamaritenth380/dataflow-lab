import React from 'react';
import { useLocation } from 'react-router-dom';
import { HelpCircle, Layers, Table2, LayoutDashboard, Code2, Download, Settings, BookOpen, LayoutTemplate } from 'lucide-react';
import useStore from '../../store';

const PAGE_META = {
  '/':                   { title: 'Dashboard',         subtitle: 'Manage your datasets and projects',              icon: LayoutDashboard },
  '/explorer':           { title: 'Data Explorer',     subtitle: 'Browse, filter, sort, and query your data',      icon: Table2 },
  '/studio':             { title: 'Studio',            subtitle: 'Clean data · Build visualizations · Pipeline',   icon: Layers },
  '/dashboard-builder':  { title: 'Dashboard Builder', subtitle: 'Combine charts and KPIs into dashboards',        icon: LayoutTemplate },
  '/code-generator':     { title: 'Code Generator',    subtitle: 'SQL and Python code from your operations',       icon: Code2 },
  '/export':             { title: 'Export Center',     subtitle: 'Download datasets, scripts, and charts',         icon: Download },
  '/settings':           { title: 'Settings',          subtitle: 'Configure DataFlow Lab preferences',             icon: Settings },
  '/guide':              { title: 'User Guide',        subtitle: 'Learn how to use DataFlow Lab',                  icon: BookOpen },
};

export default function Topbar() {
  const location = useLocation();
  const { activeDataset } = useStore();
  const meta = PAGE_META[location.pathname] || { title: 'DataFlow Lab', subtitle: '', icon: LayoutDashboard };
  const Icon = meta.icon;

  return (
    <header style={{
      height: 'var(--topbar-height)',
      background: 'var(--bg-surface)',
      borderBottom: '1.5px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', flexShrink: 0,
      boxShadow: '0 1px 3px rgba(124,58,237,0.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{meta.title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{meta.subtitle}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {activeDataset && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px', background: 'var(--accent-dim)', border: '1.5px solid rgba(124,58,237,0.2)', borderRadius: 99, fontSize: 12 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Active:</span>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{activeDataset.name}</span>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {activeDataset.row_count?.toLocaleString()} rows
            </span>
          </div>
        )}
        <button className="btn-icon" title="Help"><HelpCircle size={16} /></button>
      </div>
    </header>
  );
}
