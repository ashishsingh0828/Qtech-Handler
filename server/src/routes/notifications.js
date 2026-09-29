import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireUser } from '../middleware/auth.js';
import { subscribe } from '../lib/notify.js';

const router = Router();

router.use(requireUser);

router.get('/', asyncHandler(async (req, res) => {
  const [items, unread] = await Promise.all([
    pool.query(
      `SELECT id, actor_name, dataset_id, row_id, kind, message, read_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 40`,
      [req.user.id],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id],
    ),
  ]);
  res.json({
    unread: unread.rows[0].count,
    items: items.rows.map((row) => ({
      id: row.id,
      actorName: row.actor_name,
      datasetId: row.dataset_id,
      rowId: row.row_id,
      kind: row.kind,
      message: row.message,
      read: Boolean(row.read_at),
      createdAt: row.created_at,
    })),
  });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await pool.query(
    `UPDATE notifications SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL`,
    [req.user.id],
  );
  res.json({ ok: true });
}));

router.post('/:id/read', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [req.params.id, req.user.id],
  );
  if (!result.rowCount) throw new HttpError(404, 'Notification not found.', 'NOT_FOUND');
  res.json({ ok: true });
}));

router.get('/stream', (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  const unsubscribe = subscribe(res, req.user);
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
