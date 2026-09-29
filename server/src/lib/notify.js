import { pool } from '../db.js';

const subscribers = new Set();

export function subscribe(res, user) {
  const entry = { res, user };
  subscribers.add(entry);
  return () => subscribers.delete(entry);
}

export function publish(event) {
  const payload = `event: notice\ndata: ${JSON.stringify(event)}\n\n`;
  for (const entry of subscribers) {
    if (entry.user.role !== 'admin' && entry.user.role !== 'manager') continue;
    try {
      entry.res.write(payload);
    } catch {
      subscribers.delete(entry);
    }
  }
}

export async function notifyManagers({ actor, datasetId, rowId, kind, message }) {
  const recent = await pool.query(
    `SELECT 1
     FROM notifications
     WHERE actor_id = $1
       AND row_id IS NOT DISTINCT FROM $2
       AND created_at > NOW() - INTERVAL '60 seconds'
     LIMIT 1`,
    [actor.id, rowId || null],
  );
  if (recent.rowCount) return;

  const recipients = await pool.query(
    `SELECT id
     FROM users
     WHERE active = TRUE
       AND role IN ('admin', 'manager')
       AND id <> $1`,
    [actor.id],
  );
  if (!recipients.rowCount) {
    publish({ message, datasetId, rowId, actorName: actor.name, kind, createdAt: new Date().toISOString() });
    return;
  }

  const values = [];
  const placeholders = recipients.rows.map((user, index) => {
    const base = index * 7;
    values.push(user.id, actor.id, actor.name, datasetId, rowId || null, kind, message);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });
  await pool.query(
    `INSERT INTO notifications (user_id, actor_id, actor_name, dataset_id, row_id, kind, message)
     VALUES ${placeholders.join(', ')}`,
    values,
  );
  publish({
    message,
    datasetId,
    rowId,
    actorName: actor.name,
    kind,
    createdAt: new Date().toISOString(),
  });
}
