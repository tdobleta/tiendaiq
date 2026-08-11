"use strict";

const { Pool } = require("pg");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");

const WEB_ROLE = "tiendaiq_web";
const WORKER_ROLE = "tiendaiq_worker";
const WORKER_CAPABILITY = "tiendaiq_worker_capability";
const RUNTIME_ROLES = [WEB_ROLE, WORKER_ROLE];
// Render assigns these memberships to managed credentials and does not permit
// a database owner to revoke them. NOINHERIT prevents their privileges from
// flowing into ordinary application statements. The default role must never
// retain the worker capability; that membership is removed separately below.
const PROVIDER_MANAGED_MEMBERSHIPS = [
  "pg_read_all_stats",
  "pg_signal_backend",
  "tiendaiq_staging_user"
];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function main() {
  if (process.env.ALLOW_ROLE_BOOTSTRAP !== "1") {
    throw new Error("Definí ALLOW_ROLE_BOOTSTRAP=1 para configurar roles de runtime");
  }
  const databaseUrl = process.env.MIGRATION_DATABASE_URL;
  if (!databaseUrl) throw new Error("Falta MIGRATION_DATABASE_URL");

  const pool = createPostgresPool({
    databaseUrl,
    caCertificate: process.env.PG_CA_CERT,
    Pool
  });
  const client = await pool.connect();
  try {
    const roles = await client.query(
      "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])",
      [RUNTIME_ROLES]
    );
    const existing = new Set(roles.rows.map((row) => row.rolname));
    const missing = RUNTIME_ROLES.filter((role) => !existing.has(role));
    if (missing.length) {
      throw new Error(`Creá primero estas credenciales en Render: ${missing.join(", ")}`);
    }

    const capability = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [WORKER_CAPABILITY]);
    if (!capability.rowCount) {
      await client.query(
        `CREATE ROLE ${quoteIdentifier(WORKER_CAPABILITY)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
      );
    }
    // Remove product memberships inherited through Render's default credential,
    // then reconstruct the one worker-only capability. Provider-managed roles
    // are handled through NOINHERIT below because Render owns their grants.
    const runtimeMemberships = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE member.rolname = ANY($1::text[])`,
      [RUNTIME_ROLES]
    );
    for (const { member, parent } of runtimeMemberships.rows) {
      if (PROVIDER_MANAGED_MEMBERSHIPS.includes(parent)) continue;
      await client.query(`REVOKE ${quoteIdentifier(parent)} FROM ${quoteIdentifier(member)}`);
    }

    for (const role of RUNTIME_ROLES) {
      await client.query(`ALTER ROLE ${quoteIdentifier(role)} NOINHERIT`);
    }

    const capabilityMembers = await client.query(
      `SELECT member.rolname AS member
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE parent.rolname = $1 AND member.rolname <> $2`,
      [WORKER_CAPABILITY, WORKER_ROLE]
    );
    for (const { member } of capabilityMembers.rows) {
      await client.query(`REVOKE ${quoteIdentifier(WORKER_CAPABILITY)} FROM ${quoteIdentifier(member)}`);
    }

    await client.query(`GRANT ${quoteIdentifier(WORKER_CAPABILITY)} TO ${quoteIdentifier(WORKER_ROLE)}`);

    const verified = await client.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolinherit,
              pg_has_role(rolname, $1, 'member') AS worker_capability
       FROM pg_roles WHERE rolname = ANY($2::text[]) ORDER BY rolname`,
      [WORKER_CAPABILITY, RUNTIME_ROLES]
    );
    const invalid = verified.rows.find((row) =>
      row.rolsuper || row.rolbypassrls || row.rolinherit ||
      (row.rolname === WEB_ROLE && row.worker_capability) ||
      (row.rolname === WORKER_ROLE && !row.worker_capability)
    );
    if (invalid) throw new Error(`Privilegios inválidos para ${invalid.rolname}`);
    const unexpectedMemberships = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE member.rolname = ANY($1::text[])
         AND parent.rolname <> ALL($4::text[])
         AND NOT (member.rolname = $2 AND parent.rolname = $3)`,
      [RUNTIME_ROLES, WORKER_ROLE, WORKER_CAPABILITY, PROVIDER_MANAGED_MEMBERSHIPS]
    );
    if (unexpectedMemberships.rowCount) {
      throw new Error(`Unexpected role membership for ${unexpectedMemberships.rows[0].member}`);
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log("  roles runtime listos: web aislado y worker con capacidad explícita");
}

main().catch((error) => {
  console.error(`  preparación de roles fallida: ${error.message}`);
  process.exitCode = 1;
});
