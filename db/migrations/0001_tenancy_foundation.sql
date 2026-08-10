CREATE SCHEMA IF NOT EXISTS control_plane;
CREATE SCHEMA IF NOT EXISTS app_data;

CREATE TABLE IF NOT EXISTS control_plane.tenants (
  id              TEXT PRIMARY KEY,
  shop_domain     TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended', 'uninstalled', 'redacting', 'redacted')),
  isolation_mode  TEXT NOT NULL DEFAULT 'shared_rls'
                  CHECK (isolation_mode IN ('shared_rls', 'dedicated_database')),
  data_locator_id TEXT,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control_plane.inbox_events (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES control_plane.tenants(id),
  topic          TEXT NOT NULL,
  payload_hash   TEXT NOT NULL,
  payload        JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS control_plane.jobs (
  id             UUID PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES control_plane.tenants(id),
  type           TEXT NOT NULL,
  payload        JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 5,
  run_after      TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at      TIMESTAMPTZ,
  locked_by      TEXT,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_ready_idx
  ON control_plane.jobs (status, run_after)
  WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS control_plane.outbox_events (
  id             UUID PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES control_plane.tenants(id),
  type           TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS control_plane.privacy_requests (
  id             UUID PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('customers_data_request', 'customers_redact', 'shop_redact')),
  status         TEXT NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received', 'processing', 'completed', 'failed')),
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  last_error     TEXT
);

CREATE TABLE IF NOT EXISTS app_data.pages (
  tenant_id       TEXT NOT NULL,
  id              TEXT NOT NULL,
  product_gid     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'ready', 'publishing', 'published', 'needs_attention')),
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app_data.page_versions (
  tenant_id       TEXT NOT NULL,
  page_id         TEXT NOT NULL,
  version         INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL,
  document        JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, page_id, version),
  FOREIGN KEY (tenant_id, page_id) REFERENCES app_data.pages(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_data.publications (
  tenant_id       TEXT NOT NULL,
  id              UUID NOT NULL,
  page_id         TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending', 'writing_metafield', 'assigning_template', 'verifying', 'published', 'compensating', 'needs_attention')),
  remote_refs     JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, page_id) REFERENCES app_data.pages(tenant_id, id)
);

ALTER TABLE app_data.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.pages FORCE ROW LEVEL SECURITY;
ALTER TABLE app_data.page_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.page_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE app_data.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_data.publications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pages_tenant_isolation ON app_data.pages;
CREATE POLICY pages_tenant_isolation ON app_data.pages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS page_versions_tenant_isolation ON app_data.page_versions;
CREATE POLICY page_versions_tenant_isolation ON app_data.page_versions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS publications_tenant_isolation ON app_data.publications;
CREATE POLICY publications_tenant_isolation ON app_data.publications
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
