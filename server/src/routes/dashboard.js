import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import { dateLabel, greeting, todayISO } from '../lib/time.js';
import { presentDataset } from '../lib/present.js';
import { requireUser } from '../middleware/auth.js';
import { env } from '../config/env.js';

const router = Router();

router.use(requireUser);

const DATASET_LIST = `
  SELECT d.*, u.name AS uploader_name
  FROM datasets d
  LEFT JOIN users u ON u.id = d.uploaded_by
  ORDER BY d.updated_at DESC
`;

async function targetDataset(today, whereSql) {
  const result = await pool.query(
    `SELECT dataset_id
     FROM dataset_rows
     WHERE ${whereSql}
     GROUP BY dataset_id
     ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
     LIMIT 1`,
    [today],
  );
  return result.rows[0]?.dataset_id || null;
}

router.get('/', asyncHandler(async (req, res) => {
  const today = todayISO();
  const [metrics, datasets, overdue, amcDue, active, pending] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM datasets) AS datasets,
         (SELECT COUNT(*)::int FROM dataset_rows
            WHERE COALESCE(data->>'validated', '') <> 'Yes'
              AND COALESCE(data->>'validation_due', '') <> ''
              AND data->>'validation_due' < $1) AS validation_overdue,
         (SELECT COUNT(*)::int FROM dataset_rows
            WHERE COALESCE(data->>'end_date', '') <> ''
              AND data->>'end_date' < $1) AS amc_due,
         (SELECT COUNT(*)::int FROM dataset_rows
            WHERE COALESCE(data->>'end_date', '') <> ''
              AND data->>'end_date' >= $1) AS active_amc,
         (SELECT COUNT(*)::int FROM dataset_rows
            WHERE data->>'validated' = 'Yes'
              AND COALESCE(data->>'verified', '') <> 'Verified OK') AS pending_reviews`,
      [today],
    ),
    pool.query(DATASET_LIST),
    targetDataset(today, `COALESCE(data->>'validated', '') <> 'Yes' AND COALESCE(data->>'validation_due', '') <> '' AND data->>'validation_due' < $1`),
    targetDataset(today, `COALESCE(data->>'end_date', '') <> '' AND data->>'end_date' < $1`),
    targetDataset(today, `COALESCE(data->>'end_date', '') <> '' AND data->>'end_date' >= $1`),
    targetDataset(today, `data->>'validated' = 'Yes' AND COALESCE(data->>'verified', '') <> 'Verified OK'`),
  ]);
  const metric = metrics.rows[0];
  res.json({
    greeting: greeting(),
    dateLabel: dateLabel(),
    timezone: env.timezone,
    today,
    metrics: {
      validationOverdue: metric.validation_overdue,
      amcDue: metric.amc_due,
      activeAmc: metric.active_amc,
      pendingReviews: metric.pending_reviews,
      datasets: metric.datasets,
      targets: {
        validation_overdue: overdue,
        amc_due: amcDue,
        active_amc: active,
        pending_verification: pending,
      },
    },
    datasets: datasets.rows.map(presentDataset),
  });
}));

export default router;
