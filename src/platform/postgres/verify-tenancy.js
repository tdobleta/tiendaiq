"use strict";

const PROTECTED_TABLES = Object.freeze([
  ["public", "tiendas"],
  ["public", "paginas"],
  ["public", "estados_oauth"],
  ["control_plane", "tenants"],
  ["control_plane", "inbox_events"],
  ["control_plane", "jobs"],
  ["control_plane", "outbox_events"],
  ["control_plane", "privacy_requests"],
  ["control_plane", "usage_reservations"],
  ["app_data", "pages"],
  ["app_data", "page_versions"],
  ["app_data", "publications"]
]);

async function verifyTenantIsolation(pool) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("Se requiere un pool de Postgres");

  const values = PROTECTED_TABLES.flat();
  const tuples = PROTECTED_TABLES.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(", ");
  const table = await pool.query(`
    WITH expected(schema_name, table_name) AS (VALUES ${tuples})
    SELECT bool_and(c.oid IS NOT NULL AND c.relrowsecurity) AS enabled,
           bool_and(c.oid IS NOT NULL AND c.relforcerowsecurity) AS forced,
           count(c.oid) = count(*) AS all_present,
           coalesce(bool_or(c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)), false)
             AS owns_protected_table
    FROM expected e
    LEFT JOIN pg_namespace n ON n.nspname = e.schema_name
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
  `, values);
  const state = table.rows[0];
  if (!state?.all_present || !state?.enabled || !state?.forced) {
    throw new Error("Aislamiento incompleto: todas las tablas tenant-owned deben tener RLS habilitado y forzado");
  }
  if (state.owns_protected_table) {
    throw new Error("Aislamiento inválido: el rol web no puede ser dueño de tablas protegidas");
  }

  const role = await pool.query(`
    SELECT rolsuper AS superuser,
           rolbypassrls AS bypass_rls,
           pg_has_role(current_user, 'tiendaiq_worker_capability', 'member') AS worker_capability
    FROM pg_roles
    WHERE rolname = current_user
  `);
  if (role.rows[0]?.superuser || role.rows[0]?.bypass_rls) {
    throw new Error("Aislamiento inválido: el rol de la aplicación puede omitir RLS");
  }
  if (role.rows[0]?.worker_capability) {
    throw new Error("Aislamiento inválido: el proceso web tiene capacidad de worker");
  }

  return {
    enabled: true,
    forced: true,
    protectedTables: PROTECTED_TABLES.length,
    roleBypassesRls: false,
    workerCapability: false
  };
}

module.exports = { PROTECTED_TABLES, verifyTenantIsolation };
