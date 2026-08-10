ALTER TABLE control_plane.inbox_events
  ADD COLUMN IF NOT EXISTS shop_domain TEXT,
  ADD COLUMN IF NOT EXISTS api_version TEXT,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE control_plane.inbox_events
SET shop_domain = tenant_id
WHERE shop_domain IS NULL;

ALTER TABLE control_plane.inbox_events
  ALTER COLUMN shop_domain SET NOT NULL,
  ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE control_plane.inbox_events
  DROP CONSTRAINT IF EXISTS inbox_events_tenant_id_fkey;

ALTER TABLE control_plane.inbox_events
  ADD CONSTRAINT inbox_events_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES control_plane.tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inbox_events_ready_idx
  ON control_plane.inbox_events (status, run_after)
  WHERE status = 'received';

CREATE INDEX IF NOT EXISTS inbox_events_reclaim_idx
  ON control_plane.inbox_events (status, locked_at)
  WHERE status = 'processing';

ALTER TABLE control_plane.inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.inbox_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_events_tenant_isolation ON control_plane.inbox_events;
CREATE POLICY inbox_events_tenant_isolation ON control_plane.inbox_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS inbox_events_ingress ON control_plane.inbox_events;
CREATE POLICY inbox_events_ingress ON control_plane.inbox_events
  USING (shop_domain = current_setting('app.webhook_shop', true))
  WITH CHECK (shop_domain = current_setting('app.webhook_shop', true));

DROP POLICY IF EXISTS inbox_events_worker ON control_plane.inbox_events;
CREATE POLICY inbox_events_worker ON control_plane.inbox_events
  USING (current_setting('app.worker_id', true) <> '')
  WITH CHECK (current_setting('app.worker_id', true) <> '');

ALTER TABLE control_plane.privacy_requests
  ADD COLUMN IF NOT EXISTS webhook_id TEXT,
  ADD COLUMN IF NOT EXISTS subject_hash TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS privacy_requests_webhook_idx
  ON control_plane.privacy_requests (webhook_id)
  WHERE webhook_id IS NOT NULL;

ALTER TABLE control_plane.privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.privacy_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS privacy_requests_worker ON control_plane.privacy_requests;
CREATE POLICY privacy_requests_worker ON control_plane.privacy_requests
  USING (current_setting('app.worker_id', true) <> '')
  WITH CHECK (current_setting('app.worker_id', true) <> '');

DROP POLICY IF EXISTS privacy_requests_tenant_cleanup ON control_plane.privacy_requests;
CREATE POLICY privacy_requests_tenant_cleanup ON control_plane.privacy_requests
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
