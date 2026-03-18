import { create } from 'zustand';

export const useStore = create((set, get) => ({
  // Active dataset
  activeDataset: null,
  setActiveDataset: (dataset) => set({ activeDataset: dataset }),

  // Dataset list
  datasets: [],
  setDatasets: (datasets) => set({ datasets }),
  addDataset: (dataset) => set(s => ({ datasets: [dataset, ...s.datasets] })),
  removeDataset: (id) => set(s => ({ datasets: s.datasets.filter(d => d.id !== id) })),

  // Projects
  projects: [],
  setProjects: (projects) => set({ projects }),

  // Visualizations
  visualizations: [],
  setVisualizations: (vizs) => set({ visualizations: vizs }),
  addVisualization: (viz) => set(s => ({ visualizations: [viz, ...s.visualizations] })),

  // Dashboards
  dashboards: [],
  setDashboards: (dashboards) => set({ dashboards }),

  // UI state
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  // Code generator state
  generatedSQL: '',
  generatedPython: '',
  setGeneratedCode: (sql, python) => set({ generatedSQL: sql, generatedPython: python }),
  appendCode: (sql, python) => set(s => ({
    generatedSQL: s.generatedSQL ? s.generatedSQL + '\n\n' + sql : sql,
    generatedPython: s.generatedPython ? s.generatedPython + '\n' + python : python,
  })),
}));

export default useStore;
