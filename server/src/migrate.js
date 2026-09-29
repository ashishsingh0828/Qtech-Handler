import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { env } from './config/env.js';

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'validator', 'service')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  original_filename TEXT,
  schema JSONB NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dataset_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dataset_rows_order ON dataset_rows (dataset_id, position);
CREATE INDEX IF NOT EXISTS dataset_rows_validated ON dataset_rows ((data->>'validated'));
CREATE INDEX IF NOT EXISTS dataset_rows_end_date ON dataset_rows ((data->>'end_date'));
CREATE INDEX IF NOT EXISTS dataset_rows_validation_due ON dataset_rows ((data->>'validation_due'));

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID,
  row_id UUID,
  actor_id UUID,
  actor_name TEXT,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_row ON audit_log (row_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_dataset ON audit_log (dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id UUID,
  actor_name TEXT,
  dataset_id UUID,
  row_id UUID,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_debounce ON notifications (actor_id, row_id, created_at DESC);
`;

const DEMO_USERS = [
  ['Asha Menon', 'admin@qtech.local', 'Admin#824610', 'admin'],
  ['Rohit Shah', 'manager@qtech.local', 'Manager#824610', 'manager'],
  ['Leela Iyer', 'validator@qtech.local', 'Validator#824610', 'validator'],
  ['Mohit Verma', 'service@qtech.local', 'Service#824610', 'service'],
];

export async function migrate() {
  await pool.query(SCHEMA);
  if (!env.seedDemo) return;
  const existing = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (existing.rows[0].count > 0) return;
  for (const [name, email, password, role] of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)`,
      [name, email, passwordHash, role],
    );
  }
  console.log('Seeded demo accounts for admin, manager, validator, and service.');
}
