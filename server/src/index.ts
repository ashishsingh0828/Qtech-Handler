import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { assertRuntimeConfig, env } from './config/env.ts';
import { prisma } from './lib/prisma.ts';
import { ensureSchema } from './lib/ensureSchema.ts';
import { errorMiddleware } from './lib/http.ts';
import { attachUser } from './middleware/auth.ts';
import { bootstrapPresetUsers } from './bootstrap.ts';
import { startJobs } from './lib/jobs.ts';
import authRoutes from './routes/auth.ts';
import userRoutes from './routes/users.ts';
import datasetRoutes from './routes/datasets.ts';
import rowRoutes from './routes/rows.ts';
import bulkRoutes from './routes/bulk.ts';
import metaRoutes from './routes/meta.ts';
import { rowActionRoutes, serviceCallRoutes } from './routes/actions.ts';

assertRuntimeConfig();

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(cookieParser());
app.use('/api/datasets/import', express.raw({ type: () => true, limit: '80mb' }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'Database unavailable', code: 'UNAVAILABLE' });
  }
});

app.use('/api', attachUser);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', metaRoutes);
app.use('/api/rows', rowActionRoutes);
app.use('/api/service-calls', serviceCallRoutes);
app.use('/api/rows', bulkRoutes);
datasetRoutes.use('/:datasetId/rows', rowRoutes);
app.use('/api/datasets', datasetRoutes);
app.use('/api', (_req, res) => {
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

ensureSchema()
  .then(() => bootstrapPresetUsers())
  .catch((error: unknown) => {
    console.error('Startup schema failed', error);
  })
  .then(() => {
    startJobs();
    const server = app.listen(env.port, () => {
      console.log(`QTECH API listening on ${env.port}`);
    });
    const shutdown = () => {
      server.close(() => {
        prisma.$disconnect().finally(() => process.exit(0));
      });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((error: unknown) => {
    console.error('Startup failed', error);
    prisma.$disconnect().finally(() => process.exit(1));
  });
