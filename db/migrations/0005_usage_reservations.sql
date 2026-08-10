CREATE TABLE IF NOT EXISTS control_plane.usage_reservations (
  id               UUID PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES control_plane.tenants(id),
  job_id            UUID NOT NULL UNIQUE REFERENCES control_plane.jobs(id),
  operation_type    TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  period            TEXT NOT NULL,
  units             INTEGER NOT NULL DEFAULT 1 CHECK (units > 0),
  quota_limit       INTEGER CHECK (quota_limit IS NULL OR quota_limit >= 0),
  status            TEXT NOT NULL DEFAULT 'reserved'
                    CHECK (status IN ('reserved', 'committed', 'released')),
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at      TIMESTAMPTZ,
  released_at       TIMESTAMPTZ,
  UNIQUE (tenant_id, operation_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS usage_reservations_open_idx
  ON control_plane.usage_reservations (status, created_at)
  WHERE status = 'reserved';

ALTER TABLE control_plane.usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.usage_reservations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_reservations_tenant_isolation ON control_plane.usage_reservations;
CREATE POLICY usage_reservations_tenant_isolation ON control_plane.usage_reservations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
