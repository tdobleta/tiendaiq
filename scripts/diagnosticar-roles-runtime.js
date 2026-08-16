"use strict";

const { Pool } = require("pg");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");

const INSPECTED_ROLES = [
  "tiendaiq_web",
  "tiendaiq_worker",
  "tiendaiq_web_runtime",
  "tiendaiq_worker_runtime",
  "tiendaiq_worker_capability"
];

async function main() {
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
      `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit,
              rolcreatedb, rolcreaterole, rolreplication,
              pg_has_role(rolname, 'tiendaiq_worker_capability', 'member') AS worker_capability
       FROM pg_roles
       WHERE rolname = ANY($1::text[])
       ORDER BY rolname`,
      [INSPECTED_ROLES]
    );
    const memberships = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent, membership.admin_option
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE member.rolname = ANY($1::text[])
          OR parent.rolname = ANY($1::text[])
       ORDER BY member.rolname, parent.rolname`,
      [INSPECTED_ROLES]
    );

    console.log("Runtime roles:");
    console.table(roles.rows);
    console.log("Role memberships:");
    console.table(memberships.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Diagnostico de roles fallido: ${error.message}`);
  process.exitCode = 1;
});
