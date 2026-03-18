import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import 'express-async-errors';

import datasetsRouter from './routes/datasets.js';
import cleaningRouter from './routes/cleaning.js';
import visualizationsRouter from './routes/visualizations.js';
import dashboardsRouter from './routes/dashboards.js';
import exportRouter from './routes/export.js';
import { getDb } from './db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure data directory exists
mkdirSync(path.join(__dirname, '../data'), { recursive: true });
mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });

// Initialize DB
getDb();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api/datasets', datasetsRouter);
app.use('/api/clean', cleaningRouter);
app.use('/api/visualizations', visualizationsRouter);
app.use('/api/export', exportRouter);
app.use('/api', dashboardsRouter);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '1.0.0', name: 'DataFlow Lab' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 DataFlow Lab Backend running at http://localhost:${PORT}`);
  console.log(`📊 API ready. Frontend at http://localhost:5173\n`);
});
