import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import DashboardPage from './pages/DashboardPage';
import ExplorerPage from './pages/ExplorerPage';
import StudioPage from './pages/StudioPage';
import DashboardBuilderPage from './pages/DashboardBuilderPage';
import CodeGeneratorPage from './pages/CodeGeneratorPage';
import ExportPage from './pages/ExportPage';
import { SettingsPage, GuidePage } from './pages/SettingsAndGuide';
import './styles/global.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <div className="main-content">
          <Topbar />
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Routes>
              <Route path="/"                   element={<DashboardPage />} />
              <Route path="/explorer"           element={<ExplorerPage />} />
              <Route path="/studio"             element={<StudioPage />} />
              <Route path="/dashboard-builder"  element={<DashboardBuilderPage />} />
              <Route path="/code-generator"     element={<CodeGeneratorPage />} />
              <Route path="/export"             element={<ExportPage />} />
              <Route path="/settings"           element={<SettingsPage />} />
              <Route path="/guide"              element={<GuidePage />} />
            </Routes>
          </div>
        </div>
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#ffffff',
            color: '#1e1535',
            border: '1.5px solid #e2ddf0',
            fontFamily: 'Plus Jakarta Sans, sans-serif',
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(124,58,237,0.12)',
          },
          success: { iconTheme: { primary: '#059669', secondary: '#fff' } },
          error:   { iconTheme: { primary: '#dc2626', secondary: '#fff' } },
        }}
      />
    </BrowserRouter>
  );
}
