"use strict";

const crypto = require("crypto");
const { requireTenantContext } = require("../../tenancy/tenant-context");
const { withTenantTransaction } = require("./with-tenant-transaction");

function mapCredential(row, { includeRefresh = false } = {}) {
  if (!row) return null;
  const mapped = {
    tenantId: row.tenant_id,
    accessCiphertext: row.access_ciphertext,
    accessExpiresAt: row.access_expires_at,
    credentialVersion: Number(row.credential_version),
    refreshState: row.refresh_state,
    reauthRequiredAt: row.reauth_required_at || null,
    updatedAt: row.updated_at
  };
  if (includeRefresh) {
    mapped.refreshCiphertext = row.refresh_ciphertext;
    mapped.refreshExpiresAt = row.refresh_expires_at;
    mapped.refreshLeaseId = row.refresh_lease_id || null;
    mapped.refreshLeaseUntil = row.refresh_lease_until || null;
  }
  return mapped;
}

function createShopifyCredentialRepository(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("Se requiere un pool de Postgres");

  return Object.freeze({
    async get(context, { includeRefresh = false } = {}) {
      const tenant = requireTenantContext(context);
      const fields = includeRefresh
        ? "tenant_id, access_ciphertext, access_expires_at, refresh_ciphertext, refresh_expires_at, credential_version, refresh_state, refresh_lease_id, refresh_lease_until, reauth_required_at, updated_at"
        : "tenant_id, access_ciphertext, access_expires_at, credential_version, refresh_state, reauth_required_at, updated_at";
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        `SELECT ${fields} FROM control_plane.shopify_offline_credentials WHERE tenant_id = $1`,
        [tenant.tenantId]
      ));
      return mapCredential(result.rows[0], { includeRefresh });
    },

    async saveInstallation(context, credential) {
      const tenant = requireTenantContext(context);
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        `INSERT INTO control_plane.shopify_offline_credentials
           (tenant_id, access_ciphertext, access_expires_at, refresh_ciphertext, refresh_expires_at, credential_version, refresh_state, reauth_required_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, 'active', NULL, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           access_ciphertext = EXCLUDED.access_ciphertext,
           access_expires_at = EXCLUDED.access_expires_at,
           refresh_ciphertext = EXCLUDED.refresh_ciphertext,
           refresh_expires_at = EXCLUDED.refresh_expires_at,
           credential_version = control_plane.shopify_offline_credentials.credential_version + 1,
           refresh_state = 'active', refresh_lease_id = NULL, refresh_lease_until = NULL,
           reauth_required_at = NULL, last_refresh_failure_code = NULL, updated_at = now()
         RETURNING tenant_id, access_ciphertext, access_expires_at, refresh_ciphertext, refresh_expires_at,
                   credential_version, refresh_state, refresh_lease_id, refresh_lease_until, reauth_required_at, updated_at`,
        [tenant.tenantId, credential.accessCiphertext, credential.accessExpiresAt, credential.refreshCiphertext, credential.refreshExpiresAt]
      ));
      return mapCredential(result.rows[0], { includeRefresh: true });
    },

    async acquireRefreshLease(context, credentialVersion, { leaseSeconds = 30 } = {}) {
      const tenant = requireTenantContext(context);
      const leaseId = crypto.randomUUID();
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.shopify_offline_credentials
            SET refresh_state = 'refreshing', refresh_lease_id = $3,
                refresh_lease_until = now() + ($4::text || ' seconds')::interval,
                last_refresh_attempt_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND credential_version = $2 AND refresh_state <> 'reauth_required'
            AND (refresh_lease_until IS NULL OR refresh_lease_until < now())
          RETURNING tenant_id, access_ciphertext, access_expires_at, refresh_ciphertext, refresh_expires_at,
                    credential_version, refresh_state, refresh_lease_id, refresh_lease_until, reauth_required_at, updated_at`,
        [tenant.tenantId, credentialVersion, leaseId, Math.max(5, Math.min(120, Number(leaseSeconds) || 30))]
      ));
      return mapCredential(result.rows[0], { includeRefresh: true });
    },

    async completeRefresh(context, { credentialVersion, leaseId, accessCiphertext, accessExpiresAt, refreshCiphertext, refreshExpiresAt }) {
      const tenant = requireTenantContext(context);
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.shopify_offline_credentials
            SET access_ciphertext = $4, access_expires_at = $5,
                refresh_ciphertext = $6, refresh_expires_at = $7,
                credential_version = credential_version + 1, refresh_state = 'active',
                refresh_lease_id = NULL, refresh_lease_until = NULL,
                last_refresh_success_at = now(), last_refresh_failure_code = NULL,
                reauth_required_at = NULL, updated_at = now()
          WHERE tenant_id = $1 AND credential_version = $2 AND refresh_lease_id = $3
          RETURNING tenant_id, access_ciphertext, access_expires_at, refresh_ciphertext, refresh_expires_at,
                    credential_version, refresh_state, refresh_lease_id, refresh_lease_until, reauth_required_at, updated_at`,
        [tenant.tenantId, credentialVersion, leaseId, accessCiphertext, accessExpiresAt, refreshCiphertext, refreshExpiresAt]
      ));
      return mapCredential(result.rows[0], { includeRefresh: true });
    },

    async failRefresh(context, { credentialVersion, leaseId, code, reauthRequired = false }) {
      const tenant = requireTenantContext(context);
      await withTenantTransaction(pool, tenant, (client) => client.query(
        `UPDATE control_plane.shopify_offline_credentials
            SET refresh_state = CASE WHEN $4 THEN 'reauth_required' ELSE 'active' END,
                refresh_lease_id = NULL, refresh_lease_until = NULL,
                last_refresh_failure_code = $5,
                reauth_required_at = CASE WHEN $4 THEN now() ELSE reauth_required_at END,
                updated_at = now()
          WHERE tenant_id = $1 AND credential_version = $2 AND refresh_lease_id = $3`,
        [tenant.tenantId, credentialVersion, leaseId, Boolean(reauthRequired), String(code || "refresh_failed").slice(0, 80)]
      ));
    }
  });
}

module.exports = { createShopifyCredentialRepository, mapCredential };
