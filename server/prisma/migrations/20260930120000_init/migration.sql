DO $$
DECLARE
  target text;
  id_type text;
  next_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY['users', 'datasets', 'notifications']
  LOOP
    SELECT c.data_type INTO id_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = target AND c.column_name = 'id';
    IF id_type IS NOT NULL AND id_type <> 'uuid' THEN
      next_name := target || '_legacy_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
      EXECUTE format('ALTER TABLE %I RENAME TO %I', target, next_name);
    END IF;
  END LOOP;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'VALIDATOR';
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
UPDATE users SET name = COALESCE(NULLIF(btrim(name), ''), 'User');
UPDATE users SET role = CASE lower(coalesce(role, ''))
  WHEN 'admin' THEN 'ADMIN'
  WHEN 'manager' THEN 'MANAGER'
  WHEN 'validator' THEN 'VALIDATOR'
  WHEN 'service' THEN 'SERVICE'
  WHEN '' THEN 'VALIDATOR'
  ELSE CASE
    WHEN role IN ('ADMIN', 'MANAGER', 'VALIDATOR', 'SERVICE') THEN role
    ELSE 'VALIDATOR'
  END
END;
UPDATE users SET is_active = COALESCE(active, TRUE);
UPDATE users SET active = is_active;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN', 'MANAGER', 'VALIDATOR', 'SERVICE'));

CREATE TABLE IF NOT EXISTS datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  original_filename TEXT,
  schema JSONB,
  uploaded_by UUID,
  created_by UUID,
  row_count INTEGER NOT NULL DEFAULT 0,
  column_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS column_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS row_count INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'datasets' AND column_name = 'uploaded_by'
  ) THEN
    UPDATE datasets SET created_by = uploaded_by WHERE created_by IS NULL AND uploaded_by IS NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS dataset_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  serial_no TEXT,
  customer_name TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_duplicate_suspect BOOLEAN NOT NULL DEFAULT FALSE,
  validated_by_id UUID,
  validated_at TIMESTAMPTZ,
  verified_by_id UUID,
  verified_at TIMESTAMPTZ,
  amc_status TEXT,
  assigned_validator_id UUID,
  assigned_service_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS serial_no TEXT;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS is_duplicate_suspect BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS validated_by_id UUID;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS verified_by_id UUID;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS amc_status TEXT;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS assigned_validator_id UUID;
ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS assigned_service_id UUID;

CREATE TABLE IF NOT EXISTS column_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  group_key TEXT NOT NULL,
  semantic_tag TEXT,
  data_type TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (dataset_id, key)
);

CREATE TABLE IF NOT EXISTS service_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id UUID NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'Open',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID,
  row_id UUID,
  actor_id UUID,
  actor_name TEXT,
  action TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE audit_log ALTER COLUMN summary SET DEFAULT '';
ALTER TABLE audit_log ALTER COLUMN summary DROP NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id UUID,
  actor_name TEXT,
  dataset_id UUID,
  row_id UUID,
  kind TEXT DEFAULT '',
  type TEXT,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE notifications SET type = COALESCE(type, 'notice') WHERE type IS NULL;
ALTER TABLE notifications ALTER COLUMN type SET NOT NULL;

CREATE TABLE IF NOT EXISTS job_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
