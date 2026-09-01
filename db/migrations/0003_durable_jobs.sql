ALTER TABLE control_plane.jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS result JSONB,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_tenant_idempotency_idx
  ON control_plane.jobs (tenant_id, type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_reclaim_idx
  ON control_plane.jobs (status, locked_at)
  WHERE status = 'running';
