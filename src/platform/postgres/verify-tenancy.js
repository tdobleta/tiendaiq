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
  ["control_plane", "compensation_recovery_audit"],
  ["app_data", "pages"],
  ["app_data", "page_versions"],
  ["app_data", "publications"]
]);

async function verifyProtectedTables(pool) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("Se requiere un pool de Postgres");

  const values = PROTECTED_TABLES.flat();
  const tuples = PROTECTED_TABLES.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(", ");
  const table = await pool.query(`
    WITH expected(schema_name, table_name) AS (VALUES ${tuples}),
    discovered AS (
      SELECT DISTINCT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname IN ('public', 'control_plane', 'app_data')
        AND (n.nspname = 'app_data' OR a.attname IN ('tenant_id', 'shop_domain', 'tienda', 'dominio'))
    ),
    protected AS (
      SELECT * FROM expected
      UNION
      SELECT * FROM discovered
    )
    SELECT bool_and(c.oid IS NOT NULL AND c.relrowsecurity) AS enabled,
           bool_and(c.oid IS NOT NULL AND c.relforcerowsecurity) AS forced,
           count(c.oid) FILTER (WHERE e.schema_name IS NOT NULL) = count(*) FILTER (WHERE e.schema_name IS NOT NULL)
             AS all_present,
           count(*) AS protected_count,
           coalesce(bool_or(c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)), false)
             AS owns_protected_table
    FROM protected p
    LEFT JOIN expected e ON e.schema_name = p.schema_name AND e.table_name = p.table_name
    LEFT JOIN pg_namespace n ON n.nspname = p.schema_name
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = p.table_name
  `, values);
  const state = table.rows[0];
  if (!state?.all_present || !state?.enabled || !state?.forced) {
    throw new Error("Aislamiento incompleto: todas las tablas tenant-owned deben tener RLS habilitado y forzado");
  }
  if (state.owns_protected_table) {
    throw new Error("Aislamiento invalido: el rol runtime no puede ser dueno de tablas protegidas");
  }
  return Number(state.protected_count || PROTECTED_TABLES.length);
}

async function verifyRuntimeRole(pool, { expectedRole, workerCapability }) {
  if (!expectedRole) throw new Error("El rol runtime esperado es obligatorio");

  const role = await pool.query(`
    SELECT current_user AS current_role,
           rolsuper AS superuser,
           rolbypassrls AS bypass_rls,
           rolinherit AS inherits_roles,
           rolcanlogin AS can_login,
           rolcreatedb AS can_create_db,
           rolcreaterole AS can_create_role,
           rolreplication AS can_replicate,
           pg_has_role(current_user, 'tiendaiq_worker_capability_v2', 'member') AS worker_capability
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
  if (state.can_login || state.can_create_db || state.can_create_role || state.can_replicate) {
    throw new Error("Aislamiento invalido: el rol runtime tiene atributos administrativos o LOGIN");
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
  const protectedTables = await verifyProtectedTables(pool);
  await verifyRuntimeRole(pool, { expectedRole, workerCapability: false });
  return {
    enabled: true,
    forced: true,
    protectedTables,
    roleBypassesRls: false,
    inheritsRoles: false,
    workerCapability: false
  };
}

async function verifyWorkerIsolation(pool, { expectedRole = "tiendaiq_worker_runtime" } = {}) {
  const protectedTables = await verifyProtectedTables(pool);
  await verifyRuntimeRole(pool, { expectedRole, workerCapability: true });
  return {
    enabled: true,
    forced: true,
    protectedTables,
    roleBypassesRls: false,
    inheritsRoles: false,
    workerCapability: true
  };
}

module.exports = { PROTECTED_TABLES, verifyTenantIsolation, verifyWorkerIsolation };
