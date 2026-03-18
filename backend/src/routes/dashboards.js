import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';

const router = express.Router();

// ── Projects ─────────────────────────────────────────────
router.get('/projects', (req, res) => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json({ projects });
});

router.post('/projects', (req, res) => {
  const db = getDb();
  const { name, description } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)').run(id, name, description || '');
  res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(id) });
});

router.delete('/projects/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Dashboards ────────────────────────────────────────────
router.get('/dashboards', (req, res) => {
  const db = getDb();
  const dashboards = db.prepare('SELECT * FROM dashboards ORDER BY created_at DESC').all();
  res.json({ dashboards: dashboards.map(d => ({ ...d, layout: JSON.parse(d.layout_json || '[]'), filters: JSON.parse(d.filters_json || '[]') })) });
});

router.post('/dashboards', (req, res) => {
  const db = getDb();
  const { name, projectId } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO dashboards (id, project_id, name) VALUES (?, ?, ?)').run(id, projectId || null, name);
  const dash = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id);
  res.json({ dashboard: { ...dash, layout: [], filters: [] } });
});

router.get('/dashboards/:id', (req, res) => {
  const db = getDb();
  const dash = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id);
  if (!dash) return res.status(404).json({ error: 'Not found' });
  const widgets = db.prepare('SELECT * FROM dashboard_widgets WHERE dashboard_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json({
    dashboard: { ...dash, layout: JSON.parse(dash.layout_json || '[]'), filters: JSON.parse(dash.filters_json || '[]') },
    widgets: widgets.map(w => ({ ...w, config: JSON.parse(w.config_json || '{}'), position: JSON.parse(w.position_json || '{}') }))
  });
});

router.put('/dashboards/:id', (req, res) => {
  const db = getDb();
  const { name, layout, filters } = req.body;
  db.prepare('UPDATE dashboards SET name = ?, layout_json = ?, filters_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name, JSON.stringify(layout || []), JSON.stringify(filters || []), req.params.id);
  res.json({ success: true });
});

router.delete('/dashboards/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM dashboards WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Widgets ───────────────────────────────────────────────
router.post('/dashboards/:dashId/widgets', (req, res) => {
  const db = getDb();
  const { widgetType, visualizationId, config, position } = req.body;
  const id = uuidv4();
  db.prepare(`
    INSERT INTO dashboard_widgets (id, dashboard_id, widget_type, visualization_id, config_json, position_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.params.dashId, widgetType, visualizationId || null, JSON.stringify(config || {}), JSON.stringify(position || { x: 0, y: 0, w: 4, h: 3 }));
  const widget = db.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(id);
  res.json({ widget: { ...widget, config: JSON.parse(widget.config_json), position: JSON.parse(widget.position_json) } });
});

router.put('/dashboards/:dashId/widgets/:wId', (req, res) => {
  const db = getDb();
  const { config, position } = req.body;
  db.prepare('UPDATE dashboard_widgets SET config_json = ?, position_json = ? WHERE id = ?')
    .run(JSON.stringify(config || {}), JSON.stringify(position || {}), req.params.wId);
  res.json({ success: true });
});

router.delete('/dashboards/:dashId/widgets/:wId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM dashboard_widgets WHERE id = ?').run(req.params.wId);
  res.json({ success: true });
});

export default router;
