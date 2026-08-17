"use strict";

const { Pool } = require("pg");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");

// Render owns the LOGIN credentials and can attach provider roles to them.
// We therefore never alter them. They only transport the connection and enter
// our NOLOGIN runtime roles through PostgreSQL's startup SET ROLE option.
const WEB_LOGIN_ROLE = "tiendaiq_web";
const WORKER_LOGIN_ROLE = "tiendaiq_worker";
const WEB_RUNTIME_ROLE = "tiendaiq_web_runtime";
const WORKER_RUNTIME_ROLE = "tiendaiq_worker_runtime";
// Version the capability identity so provider-managed legacy grants can remain
// present without carrying authority in current RLS policies.
const WORKER_CAPABILITY = "tiendaiq_worker_capability_v2";
const LOGIN_ROLES = [WEB_LOGIN_ROLE, WORKER_LOGIN_ROLE];
const RUNTIME_ROLES = [WEB_RUNTIME_ROLE, WORKER_RUNTIME_ROLE];
const OWNED_ROLES = [...RUNTIME_ROLES, WORKER_CAPABILITY];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function revokeMembership(client, { parent, member, grantor }) {
  try {
    await client.query(
      `REVOKE ${quoteIdentifier(parent)} FROM ${quoteIdentifier(member)} ` +
      `GRANTED BY ${quoteIdentifier(grantor)}`
    );
  } catch (error) {
    throw new Error(
      `No se pudo revocar ${member}->${parent} otorgado por ${grantor}: ${error.message}`
    );
  }
}

function isBootstrapAdministrationEdge(edge, bootstrapRole) {
  return edge.member === bootstrapRole &&
    edge.admin_option === true &&
    edge.inherit_option === false &&
    edge.set_option === false;
}

async function ensureRuntimeRole(client, role) {
  const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  if (!existing.rowCount) {
    await client.query(
      `CREATE ROLE ${quoteIdentifier(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
    );
  }
}

async function main() {
  if (process.env.ALLOW_ROLE_BOOTSTRAP !== "1") {
    throw new Error("Defini ALLOW_ROLE_BOOTSTRAP=1 para configurar roles de runtime");
  }
  const databaseUrl = process.env.MIGRATION_DATABASE_URL;
  if (!databaseUrl) throw new Error("Falta MIGRATION_DATABASE_URL");

  const pool = createPostgresPool({ databaseUrl, caCertificate: process.env.PG_CA_CERT, Pool });
  const client = await pool.connect();
  try {
    const logins = await client.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])", [LOGIN_ROLES]);
    const existing = new Set(logins.rows.map((row) => row.rolname));
    const missing = LOGIN_ROLES.filter((role) => !existing.has(role));
    if (missing.length) throw new Error(`Crea primero estas credenciales en Render: ${missing.join(", ")}`);

    await client.query("BEGIN");

    const bootstrapIdentity = await client.query("SELECT current_user AS role");
    const bootstrapRole = bootstrapIdentity.rows[0].role;

    for (const role of RUNTIME_ROLES) await ensureRuntimeRole(client, role);
    await ensureRuntimeRole(client, WORKER_CAPABILITY);

    const expectedPaths = new Set([
      `${WEB_LOGIN_ROLE}->${WEB_RUNTIME_ROLE}`,
      `${WORKER_LOGIN_ROLE}->${WORKER_RUNTIME_ROLE}`,
      `${WORKER_RUNTIME_ROLE}->${WORKER_CAPABILITY}`
    ]);
    const existingPaths = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent, grantor.rolname AS grantor
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       JOIN pg_roles AS grantor ON grantor.oid = membership.grantor
       WHERE member.rolname = ANY($1::text[])`,
      [OWNED_ROLES]
    );
    for (const { member, parent, grantor } of existingPaths.rows) {
      if (!expectedPaths.has(`${member}->${parent}`)) {
        await revokeMembership(client, { parent, member, grantor });
      }
    }

    // PostgreSQL 16+ grants a non-superuser role creator an administrative
    // membership in every role it creates. Render records that edge as granted
    // by its bootstrap `postgres` role, which our migrator cannot revoke. The
    // exact ADMIN-only edge is harmless for runtime: it cannot be inherited or
    // entered with SET ROLE. Every other capability member is still removed.
    const unexpectedCapabilityMembers = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent, grantor.rolname AS grantor,
              membership.admin_option, membership.inherit_option, membership.set_option
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       JOIN pg_roles AS grantor ON grantor.oid = membership.grantor
       WHERE parent.rolname = $1 AND member.rolname <> $2`,
      [WORKER_CAPABILITY, WORKER_RUNTIME_ROLE]
    );
    for (const edge of unexpectedCapabilityMembers.rows) {
      if (isBootstrapAdministrationEdge(edge, bootstrapRole)) continue;
      await revokeMembership(client, edge);
    }

    // Render's LOGIN roles use INHERIT. Per-membership inheritance must be
    // disabled so RESET ROLE cannot recover application DML privileges.
    await client.query(
      `GRANT ${quoteIdentifier(WEB_RUNTIME_ROLE)} TO ${quoteIdentifier(WEB_LOGIN_ROLE)} WITH INHERIT FALSE, SET TRUE`
    );
    await client.query(
      `GRANT ${quoteIdentifier(WORKER_RUNTIME_ROLE)} TO ${quoteIdentifier(WORKER_LOGIN_ROLE)} WITH INHERIT FALSE, SET TRUE`
    );
    await client.query(`GRANT ${quoteIdentifier(WORKER_CAPABILITY)} TO ${quoteIdentifier(WORKER_RUNTIME_ROLE)}`);

    const verified = await client.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin,
              rolcreatedb, rolcreaterole, rolreplication,
              pg_has_role(rolname, $1, 'member') AS worker_capability
       FROM pg_roles WHERE rolname = ANY($2::text[]) ORDER BY rolname`,
      [WORKER_CAPABILITY, OWNED_ROLES]
    );
    if (verified.rowCount !== OWNED_ROLES.length) {
      throw new Error("No se pudieron verificar todos los roles aislados");
    }
    const invalid = verified.rows.find((row) =>
      row.rolsuper || row.rolbypassrls || row.rolinherit || row.rolcanlogin ||
      row.rolcreatedb || row.rolcreaterole || row.rolreplication ||
      (row.rolname === WEB_RUNTIME_ROLE && row.worker_capability) ||
      (row.rolname === WORKER_RUNTIME_ROLE && !row.worker_capability)
    );
    if (invalid) throw new Error(`Privilegios invalidos para ${invalid.rolname}`);

    const paths = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent,
              membership.admin_option, membership.inherit_option, membership.set_option
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE member.rolname = ANY($1::text[])
          OR parent.rolname = $2
          OR (member.rolname = $3 AND parent.rolname = $4)
          OR (member.rolname = $5 AND parent.rolname = $6)
       ORDER BY member.rolname, parent.rolname`,
      [OWNED_ROLES, WORKER_CAPABILITY, WEB_LOGIN_ROLE, WEB_RUNTIME_ROLE, WORKER_LOGIN_ROLE, WORKER_RUNTIME_ROLE]
    );
    const runtimePaths = paths.rows.filter((edge) =>
      !isBootstrapAdministrationEdge(edge, bootstrapRole)
    );
    const actualPaths = new Set(runtimePaths.map(({ member, parent }) => `${member}->${parent}`));
    const missingPaths = [...expectedPaths].filter((path) => !actualPaths.has(path));
    const unexpectedPaths = [...actualPaths].filter((path) => !expectedPaths.has(path));
    if (missingPaths.length || unexpectedPaths.length) {
      throw new Error(
        `Grafo de membresias invalido para los roles runtime; faltantes=[${missingPaths.join(", ")}]; ` +
        `inesperadas=[${unexpectedPaths.join(", ")}]`
      );
    }
    const loginEdges = runtimePaths.filter(({ member, parent }) =>
      (member === WEB_LOGIN_ROLE && parent === WEB_RUNTIME_ROLE) ||
      (member === WORKER_LOGIN_ROLE && parent === WORKER_RUNTIME_ROLE)
    );
    if (loginEdges.some((edge) => edge.inherit_option !== false || edge.set_option !== true)) {
      throw new Error("Los logins de Render deben poder SET ROLE sin heredar privilegios runtime");
    }

    // A managed credential can also inherit a provider-owned parent role. A
    // correct login->runtime edge is insufficient: prove that the session
    // login has no effective application DML after RESET ROLE.
    const loginIsolation = await client.query(
      `SELECT login.rolname,
              pg_has_role(login.rolname, $2, 'USAGE') AS effective_worker_capability,
              EXISTS (
                SELECT 1
                FROM pg_class AS relation
                JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
                  AND namespace.nspname IN ('public', 'control_plane', 'app_data')
                  AND has_table_privilege(
                    login.rolname,
                    format('%I.%I', namespace.nspname, relation.relname),
                    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                  )
              ) AS effective_application_dml,
              EXISTS (
                SELECT 1
                FROM pg_namespace AS namespace
                WHERE namespace.nspname IN ('public', 'control_plane', 'app_data')
                  AND has_schema_privilege(login.rolname, namespace.oid, 'CREATE')
              ) AS effective_schema_create
       FROM pg_roles AS login
       WHERE login.rolname = ANY($1::text[])
       ORDER BY login.rolname`,
      [LOGIN_ROLES, WORKER_CAPABILITY]
    );
    const unsafeLogin = loginIsolation.rows.find((login) =>
      login.effective_worker_capability || login.effective_application_dml || login.effective_schema_create
    );
    if (unsafeLogin) {
      throw new Error(
        `El login gestionado ${unsafeLogin.rolname} conserva privilegios efectivos despues de RESET ROLE`
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log("  roles runtime listos: Render conecta y la app ejecuta con roles aislados");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`  preparacion de roles fallida: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { isBootstrapAdministrationEdge };
