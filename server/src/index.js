import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { assertRuntimeConfig, env } from './config/env.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { errorMiddleware } from './lib/http.js';
import { attachUser } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import datasetRoutes from './routes/datasets.js';
import rowRoutes from './routes/rows.js';
import notificationRoutes from './routes/notifications.js';

assertRuntimeConfig();

const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin: env.clientOrigin,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'Database unavailable', code: 'UNAVAILABLE' });
  }
});

app.use('/api', attachUser);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
datasetRoutes.use('/:datasetId/rows', rowRoutes);
app.use('/api/datasets', datasetRoutes);
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (env.nodeEnv === 'production' && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(errorMiddleware);

let server;

migrate()
  .then(() => {
    server = app.listen(env.port, () => {
      console.log(`QTECH API listening on ${env.port}`);
    });
  })
  .catch((error) => {
    console.error('Migration failed', error);
    pool.end().finally(() => process.exit(1));
  });

function shutdown() {
  if (!server) {
    pool.end().finally(() => process.exit(0));
    return;
  }
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
