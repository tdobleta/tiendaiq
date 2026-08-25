-- Expiring offline credentials are intentionally separated from public.tiendas.
-- The worker may use an access token, but must never read or rotate refresh
-- credentials and must not receive SHOPIFY_CLIENT_SECRET.
CREATE TABLE IF NOT EXISTS control_plane.shopify_offline_credentials (
  tenant_id text PRIMARY KEY REFERENCES control_plane.tenants(id) ON DELETE CASCADE,
  access_ciphertext text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_ciphertext text NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  refresh_state text NOT NULL DEFAULT 'active'
    CHECK (refresh_state IN ('active', 'refreshing', 'reauth_required')),
  refresh_lease_id uuid,
  refresh_lease_until timestamptz,
  last_refresh_attempt_at timestamptz,
  last_refresh_success_at timestamptz,
  last_refresh_failure_code text,
  reauth_required_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

ALTER TABLE control_plane.shopify_offline_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.shopify_offline_credentials FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopify_offline_credentials_tenant_isolation
  ON control_plane.shopify_offline_credentials;
CREATE POLICY shopify_offline_credentials_tenant_isolation
  ON control_plane.shopify_offline_credentials
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS shopify_offline_credentials_migrator_admin
  ON control_plane.shopify_offline_credentials;
CREATE POLICY shopify_offline_credentials_migrator_admin
  ON control_plane.shopify_offline_credentials
  FOR ALL TO tiendaiq_migrator
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE control_plane.shopify_offline_credentials
  FROM PUBLIC, tiendaiq_web_runtime, tiendaiq_worker_runtime;

-- Web owns the complete credential lifecycle. Refresh tokens remain unavailable
-- to the worker even though both processes use the same tenant context.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE control_plane.shopify_offline_credentials
  TO tiendaiq_web_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE control_plane.shopify_offline_credentials
  TO tiendaiq_migrator;
GRANT SELECT (
  tenant_id, access_ciphertext, access_expires_at, credential_version,
  refresh_state, reauth_required_at, updated_at
) ON TABLE control_plane.shopify_offline_credentials
  TO tiendaiq_worker_runtime;

COMMENT ON TABLE control_plane.shopify_offline_credentials IS
  'Expiring Shopify offline access/refresh credentials. Refresh ciphertext is web-only.';
