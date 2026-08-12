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

async function verifyProtectedTables(pool) {
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
    throw new Error("Aislamiento invalido: el rol runtime no puede ser dueno de tablas protegidas");
  }
}

async function verifyRuntimeRole(pool, { expectedRole, workerCapability }) {
  if (!expectedRole) throw new Error("El rol runtime esperado es obligatorio");

  const role = await pool.query(`
    SELECT current_user AS current_role,
           rolsuper AS superuser,
           rolbypassrls AS bypass_rls,
           rolinherit AS inherits_roles,
           pg_has_role(current_user, 'tiendaiq_worker_capability', 'member') AS worker_capability
    FROM pg_roles
    WHERE rolname = current_user
  `);
  const state = role.rows[0];
  if (!state || state.current_role !== expectedRole) {
    throw new Error(`Aislamiento invalido: se esperaba el rol ${expectedRole}`);
  }
  if (state.superuser || state.bypass_rls) {
    throw new Error("Aislamiento invalido: el rol de la aplicacion puede omitir RLS");
  }
  if (state.inherits_roles) {
    throw new Error("Aislamiento invalido: el rol runtime no puede heredar privilegios del proveedor");
  }
  if (state.worker_capability !== workerCapability) {
    throw new Error(workerCapability
      ? "Aislamiento invalido: el proceso worker no tiene capacidad de worker"
      : "Aislamiento invalido: el proceso web tiene capacidad de worker");
  }
}

async function verifyTenantIsolation(pool, { expectedRole = "tiendaiq_web_runtime" } = {}) {
  await verifyProtectedTables(pool);
  await verifyRuntimeRole(pool, { expectedRole, workerCapability: false });
  return {
    enabled: true,
    forced: true,
    protectedTables: PROTECTED_TABLES.length,
    roleBypassesRls: false,
    inheritsRoles: false,
    workerCapability: false
  };
}

async function verifyWorkerIsolation(pool, { expectedRole = "tiendaiq_worker_runtime" } = {}) {
  await verifyProtectedTables(pool);
  await verifyRuntimeRole(pool, { expectedRole, workerCapability: true });
  return {
    enabled: true,
    forced: true,
    protectedTables: PROTECTED_TABLES.length,
    roleBypassesRls: false,
    inheritsRoles: false,
    workerCapability: true
  };
}

module.exports = { PROTECTED_TABLES, verifyTenantIsolation, verifyWorkerIsolation };
