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
const WORKER_CAPABILITY = "tiendaiq_worker_capability";
const LOGIN_ROLES = [WEB_LOGIN_ROLE, WORKER_LOGIN_ROLE];
const RUNTIME_ROLES = [WEB_RUNTIME_ROLE, WORKER_RUNTIME_ROLE];
const OWNED_ROLES = [...RUNTIME_ROLES, WORKER_CAPABILITY];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
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

    for (const role of RUNTIME_ROLES) await ensureRuntimeRole(client, role);
    await ensureRuntimeRole(client, WORKER_CAPABILITY);

    const expectedPaths = new Set([
      `${WEB_LOGIN_ROLE}->${WEB_RUNTIME_ROLE}`,
      `${WORKER_LOGIN_ROLE}->${WORKER_RUNTIME_ROLE}`,
      `${WORKER_RUNTIME_ROLE}->${WORKER_CAPABILITY}`
    ]);
    const existingPaths = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE member.rolname = ANY($1::text[])`,
      [OWNED_ROLES]
    );
    for (const { member, parent } of existingPaths.rows) {
      if (!expectedPaths.has(`${member}->${parent}`)) {
        await client.query(`REVOKE ${quoteIdentifier(parent)} FROM ${quoteIdentifier(member)}`);
      }
    }

    // The capability role is ours even when Render owns the member role. It
    // must never remain attached to a provider role or to the web path.
    const unexpectedCapabilityMembers = await client.query(
      `SELECT member.rolname AS member
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE parent.rolname = $1 AND member.rolname <> $2`,
      [WORKER_CAPABILITY, WORKER_RUNTIME_ROLE]
    );
    for (const { member } of unexpectedCapabilityMembers.rows) {
      await client.query(`REVOKE ${quoteIdentifier(WORKER_CAPABILITY)} FROM ${quoteIdentifier(member)}`);
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
              membership.inherit_option, membership.set_option
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
    const actualPaths = new Set(paths.rows.map(({ member, parent }) => `${member}->${parent}`));
    const missingPaths = [...expectedPaths].filter((path) => !actualPaths.has(path));
    const unexpectedPaths = [...actualPaths].filter((path) => !expectedPaths.has(path));
    if (missingPaths.length || unexpectedPaths.length) {
      throw new Error(
        `Grafo de membresias invalido para los roles runtime; faltantes=[${missingPaths.join(", ")}]; ` +
        `inesperadas=[${unexpectedPaths.join(", ")}]`
      );
    }
    const loginEdges = paths.rows.filter(({ member, parent }) =>
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

main().catch((error) => {
  console.error(`  preparacion de roles fallida: ${error.message}`);
  process.exitCode = 1;
});
