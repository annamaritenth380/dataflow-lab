const BASE = '/api';
async function request(path, options = {}) {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json', ...options.headers }, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  health: () => request('/health'),

  // Datasets
  getDatasets:    ()           => request('/datasets'),
  getDataset:     (id)         => request(`/datasets/${id}`),
  getDatasetRows: (id, p = {}) => request(`/datasets/${id}/rows?${new URLSearchParams(p)}`),
  getColumnStats: (id, col)    => request(`/datasets/${id}/column-stats/${encodeURIComponent(col)}`),
  uploadDataset:  (fd)         => fetch(BASE + '/datasets/upload', { method: 'POST', body: fd }).then(r => r.json()),
  importFromUrl:  (url, name)  => request('/datasets/url', { method: 'POST', body: JSON.stringify({ url, name }) }),
  deleteDataset:  (id)         => request(`/datasets/${id}`, { method: 'DELETE' }),

  // Pipeline
  previewPipeline: (id, steps, limit = 50) =>
    request(`/clean/${id}/preview`, { method: 'POST', body: JSON.stringify({ steps, limit }) }),
  applyPipeline:   (id, steps) =>
    request(`/clean/${id}/apply`,   { method: 'POST', body: JSON.stringify({ steps }) }),
  undoApply:       (id, undoName) =>
    request(`/clean/${id}/undo-apply`, { method: 'POST', body: JSON.stringify({ undoName }) }),

  // Operation info (pre-execution description)
  getOpInfo: (id, opId, params) =>
    request(`/clean/${id}/op-info`, { method: 'POST', body: JSON.stringify({ opId, params }) }),

  // Profile + Rule Engine
  getProfile: (id) => request(`/clean/${id}/profile`),

  // History / misc
  getOperationHistory: (id)       => request(`/clean/${id}/history`),
  executeCustomSql:    (id, sql)  => request(`/clean/${id}/custom-sql`, { method: 'POST', body: JSON.stringify({ sql }) }),
  resetOriginal:       (id)       => request(`/clean/${id}/reset-original`, { method: 'POST' }),
  getSavedPipeline:    (id)       => request(`/clean/${id}/saved-pipeline`),
  savePipeline:        (id, steps)=> request(`/clean/${id}/saved-pipeline`, { method: 'PUT', body: JSON.stringify({ steps }) }),

  // Visualizations
  queryVisualization:  (id, cfg)  => request('/visualizations/query', { method: 'POST', body: JSON.stringify({ datasetId: id, config: cfg }) }),
  getVisualizations:   (id)       => request(`/visualizations${id ? '?datasetId='+id : ''}`),
  saveVisualization:   (data)     => request('/visualizations', { method: 'POST', body: JSON.stringify(data) }),
  updateVisualization: (id, data) => request(`/visualizations/${id}`, { method: 'PUT',  body: JSON.stringify(data) }),
  deleteVisualization: (id)       => request(`/visualizations/${id}`, { method: 'DELETE' }),
  getKPIs:             (id)       => request(`/visualizations/kpi/${id}`),

  // Dashboards / projects
  getProjects:   ()     => request('/projects'),
  createProject: (d)    => request('/projects', { method: 'POST', body: JSON.stringify(d) }),
  deleteProject: (id)   => request(`/projects/${id}`, { method: 'DELETE' }),
  getDashboards:   ()       => request('/dashboards'),
  getDashboard:    (id)     => request(`/dashboards/${id}`),
  createDashboard: (d)      => request('/dashboards',       { method: 'POST', body: JSON.stringify(d) }),
  updateDashboard: (id, d)  => request(`/dashboards/${id}`, { method: 'PUT',  body: JSON.stringify(d) }),
  deleteDashboard: (id)     => request(`/dashboards/${id}`, { method: 'DELETE' }),
  addWidget:    (dId, d)          => request(`/dashboards/${dId}/widgets`,       { method: 'POST', body: JSON.stringify(d) }),
  updateWidget: (dId, wId, d)     => request(`/dashboards/${dId}/widgets/${wId}`, { method: 'PUT',  body: JSON.stringify(d) }),
  deleteWidget: (dId, wId)        => request(`/dashboards/${dId}/widgets/${wId}`, { method: 'DELETE' }),

  // Export
  exportCSV:    (id) => window.open(BASE + `/export/dataset/${id}/csv`,           '_blank'),
  exportXLSX:   (id) => window.open(BASE + `/export/dataset/${id}/xlsx`,          '_blank'),
  exportJSON:   (id) => window.open(BASE + `/export/dataset/${id}/json`,          '_blank'),
  exportSQL:    (id) => window.open(BASE + `/export/dataset/${id}/sql-script`,    '_blank'),
  exportPython: (id) => window.open(BASE + `/export/dataset/${id}/python-script`, '_blank'),
};
export default api;
