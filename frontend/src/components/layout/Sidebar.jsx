import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Table2, Layers, LayoutTemplate,
  Code2, Download, Settings, BookOpen, ChevronLeft, ChevronRight, Zap
} from 'lucide-react';
import useStore from '../../store';

const NAV = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { divider: 'Analysis' },
  { path: '/explorer',          icon: Table2,         label: 'Data Explorer' },
  { path: '/studio',            icon: Layers,         label: 'Studio' },
  { path: '/dashboard-builder', icon: LayoutTemplate, label: 'Dashboards' },
  { divider: 'Output' },
  { path: '/code-generator', icon: Code2,     label: 'Code Generator' },
  { path: '/export',         icon: Download,  label: 'Export Center' },
  { divider: 'Help' },
  { path: '/settings', icon: Settings,  label: 'Settings' },
  { path: '/guide',    icon: BookOpen,   label: 'User Guide' },
];

export default function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed, activeDataset } = useStore();
  const w = sidebarCollapsed ? 56 : 228;

  return (
    <aside style={{
      width: w, background: '#fff',
      borderRight: '1.5px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 200ms ease', flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{ height: 'var(--topbar-height)', display: 'flex', alignItems: 'center', padding: '0 14px', borderBottom: '1.5px solid var(--border)', gap: 10, flexShrink: 0 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#7c3aed,#a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(124,58,237,0.35)' }}>
          <Zap size={15} color="#fff" strokeWidth={2.5} />
        </div>
        {!sidebarCollapsed && (
          <div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>DataFlow</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Lab</div>
          </div>
        )}
      </div>

      {/* Active dataset chip */}
      {activeDataset && !sidebarCollapsed && (
        <div style={{ margin: '10px 10px 2px', padding: '8px 10px', background: 'var(--accent-dim)', borderRadius: 8, border: '1.5px solid rgba(124,58,237,0.2)', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 2 }}>Active</div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeDataset.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{activeDataset.row_count?.toLocaleString()} rows</div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
        {NAV.map((item, i) => {
          if (item.divider) return (
            <div key={i} style={{ padding: sidebarCollapsed ? '10px 0 3px' : '10px 6px 3px' }}>
              {!sidebarCollapsed && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{item.divider}</div>}
              {sidebarCollapsed && <div style={{ height: 1, background: 'var(--border)' }} />}
            </div>
          );
          const Icon = item.icon;
          return (
            <NavLink key={item.path} to={item.path} end={item.exact}
              title={sidebarCollapsed ? item.label : undefined}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 9,
                padding: sidebarCollapsed ? '8px 13px' : '8px 10px',
                borderRadius: 8, color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                background: isActive ? 'var(--accent-dim)' : 'transparent',
                textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 700 : 500,
                marginBottom: 2, transition: 'var(--transition)', whiteSpace: 'nowrap',
              })}>
              {({ isActive }) => <><Icon size={15} style={{ flexShrink: 0, color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }} />{!sidebarCollapsed && item.label}</>}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse */}
      <div style={{ padding: '8px', borderTop: '1.5px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="btn-icon" style={{ width: '100%', justifyContent: 'center' }}>
          {sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>
    </aside>
  );
}
