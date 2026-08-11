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

    for (const role of RUNTIME_ROLES) await ensureRuntimeRole(client, role);
    await ensureRuntimeRole(client, WORKER_CAPABILITY);

    // These roles are ours, unlike the managed logins, so their membership is
    // safe to repair deterministically on every approved staging release.
    const capabilityMembers = await client.query(
      `SELECT member.rolname AS member
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE parent.rolname = $1 AND member.rolname <> $2`,
      [WORKER_CAPABILITY, WORKER_RUNTIME_ROLE]
    );
    for (const { member } of capabilityMembers.rows) {
      await client.query(`REVOKE ${quoteIdentifier(WORKER_CAPABILITY)} FROM ${quoteIdentifier(member)}`);
    }

    await client.query(`GRANT ${quoteIdentifier(WEB_RUNTIME_ROLE)} TO ${quoteIdentifier(WEB_LOGIN_ROLE)}`);
    await client.query(`GRANT ${quoteIdentifier(WORKER_RUNTIME_ROLE)} TO ${quoteIdentifier(WORKER_LOGIN_ROLE)}`);
    await client.query(`GRANT ${quoteIdentifier(WORKER_CAPABILITY)} TO ${quoteIdentifier(WORKER_RUNTIME_ROLE)}`);

    const verified = await client.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolinherit,
              pg_has_role(rolname, $1, 'member') AS worker_capability
       FROM pg_roles WHERE rolname = ANY($2::text[]) ORDER BY rolname`,
      [WORKER_CAPABILITY, RUNTIME_ROLES]
    );
    const invalid = verified.rows.find((row) =>
      row.rolsuper || row.rolbypassrls || row.rolinherit ||
      (row.rolname === WEB_RUNTIME_ROLE && row.worker_capability) ||
      (row.rolname === WORKER_RUNTIME_ROLE && !row.worker_capability)
    );
    if (invalid) throw new Error(`Privilegios invalidos para ${invalid.rolname}`);

    const paths = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE (member.rolname = $1 AND parent.rolname = $2)
          OR (member.rolname = $3 AND parent.rolname = $4)`,
      [WEB_LOGIN_ROLE, WEB_RUNTIME_ROLE, WORKER_LOGIN_ROLE, WORKER_RUNTIME_ROLE]
    );
    if (paths.rowCount !== 2) throw new Error("Faltan los enlaces login->runtime de Render");
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
