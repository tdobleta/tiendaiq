"use strict";

const { Pool } = require("pg");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");

const WEB_ROLE = "tiendaiq_web";
const WORKER_ROLE = "tiendaiq_worker";
const WORKER_CAPABILITY = "tiendaiq_worker_capability";

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
      [[WEB_ROLE, WORKER_ROLE]]
    );
    const existing = new Set(roles.rows.map((row) => row.rolname));
    const missing = [WEB_ROLE, WORKER_ROLE].filter((role) => !existing.has(role));
    if (missing.length) {
      throw new Error(`Creá primero estas credenciales en Render: ${missing.join(", ")}`);
    }

    const capability = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [WORKER_CAPABILITY]);
    if (!capability.rowCount) {
      await client.query(
        `CREATE ROLE ${quoteIdentifier(WORKER_CAPABILITY)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
      );
    }
    const webMembership = await client.query(
      "SELECT pg_has_role($1, $2, 'member') AS member",
      [WEB_ROLE, WORKER_CAPABILITY]
    );
    if (webMembership.rows[0]?.member) {
      throw new Error(`${WEB_ROLE} ya heredó la capacidad worker; revocala con la credencial administrativa`);
    }
    await client.query(`GRANT ${quoteIdentifier(WORKER_CAPABILITY)} TO ${quoteIdentifier(WORKER_ROLE)}`);

    const verified = await client.query(
      `SELECT rolname, rolsuper, rolbypassrls,
              pg_has_role(rolname, $1, 'member') AS worker_capability
       FROM pg_roles WHERE rolname = ANY($2::text[]) ORDER BY rolname`,
      [WORKER_CAPABILITY, [WEB_ROLE, WORKER_ROLE]]
    );
    const invalid = verified.rows.find((row) =>
      row.rolsuper || row.rolbypassrls || (row.rolname === WEB_ROLE && row.worker_capability) ||
      (row.rolname === WORKER_ROLE && !row.worker_capability)
    );
    if (invalid) throw new Error(`Privilegios inválidos para ${invalid.rolname}`);
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
