"use strict";

const { requireTenantContext } = require("../../tenancy/tenant-context");

async function withTenantTransaction(pool, context, work) {
  const tenant = requireTenantContext(context);
  if (!pool || typeof pool.connect !== "function") throw new TypeError("Se requiere un pool de Postgres");
  if (typeof work !== "function") throw new TypeError("Se requiere una funcion de trabajo");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.tenantId]);
    const result = await work(client, tenant);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { withTenantTransaction };
