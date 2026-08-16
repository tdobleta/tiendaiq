"use strict";

const { Client } = require("pg");

const EXPECTED_DATABASE = "tiendaiq_staging";
const EXPECTED_ROLES = Object.freeze({
  migration: "tiendaiq_migrator",
  web: "tiendaiq_web",
  worker: "tiendaiq_worker",
  webRuntime: "tiendaiq_web_runtime",
  workerRuntime: "tiendaiq_worker_runtime",
  legacyCapability: "tiendaiq_worker_capability",
  capability: "tiendaiq_worker_capability_v2"
});
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function localPostgresUrl(value, name) {
  if (!value) throw new Error(`Falta ${name}`);
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${name} no es una URL PostgreSQL`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${name} debe apuntar a PostgreSQL local`);
  }
  return url;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function databaseAndRole(url, expectedRole, name) {
  const database = decodeURIComponent(url.pathname.slice(1));
  const role = decodeURIComponent(url.username);
  if (database !== EXPECTED_DATABASE || role !== expectedRole) {
    throw new Error(`${name} debe usar ${expectedRole}@.../${EXPECTED_DATABASE}`);
  }
  return { database, role, password: decodeURIComponent(url.password) };
}

async function ensureLoginRole(admin, { role, password }) {
  const existing = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  if (existing.rowCount) return;
  const passwordClause = password ? ` PASSWORD ${quoteLiteral(password)}` : "";
  await admin.query(
    `CREATE ROLE ${quoteIdentifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS${passwordClause}`
  );
}

async function verifyLoginRole(url, expectedRole) {
  const client = new Client({ connectionString: url.toString(), ssl: false });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT current_user, rolsuper, rolbypassrls,
              EXISTS (
                SELECT 1
                FROM pg_auth_members membership
                JOIN pg_roles capability ON capability.oid = membership.roleid
                WHERE membership.member = pg_roles.oid
                  AND capability.rolname = $1
              ) AS direct_worker_capability
       FROM pg_roles WHERE rolname = current_user`,
      [EXPECTED_ROLES.capability]
    );
    const current = result.rows[0];
    if (!current || current.current_user !== expectedRole || current.rolsuper || current.rolbypassrls) {
      throw new Error(`El rol ${expectedRole} tiene privilegios incompatibles`);
    }
    if (current.direct_worker_capability) {
      throw new Error(`El login ${expectedRole} tiene una capacidad worker directa`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  if (process.env.ALLOW_DB_BOOTSTRAP !== "1") {
    throw new Error("Definí ALLOW_DB_BOOTSTRAP=1 para preparar la base desechable");
  }

  const adminUrl = localPostgresUrl(process.env.TEST_DATABASE_ADMIN_URL, "TEST_DATABASE_ADMIN_URL");
  const migrationUrl = localPostgresUrl(process.env.TEST_MIGRATION_DATABASE_URL, "TEST_MIGRATION_DATABASE_URL");
  const webUrl = localPostgresUrl(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
  const workerUrl = localPostgresUrl(process.env.TEST_WORKER_DATABASE_URL, "TEST_WORKER_DATABASE_URL");
  const migration = databaseAndRole(migrationUrl, EXPECTED_ROLES.migration, "TEST_MIGRATION_DATABASE_URL");
  const web = databaseAndRole(webUrl, EXPECTED_ROLES.web, "TEST_DATABASE_URL");
  const worker = databaseAndRole(workerUrl, EXPECTED_ROLES.worker, "TEST_WORKER_DATABASE_URL");

  if (decodeURIComponent(adminUrl.pathname.slice(1)) !== "postgres") {
    throw new Error("La conexión administrativa debe usar la base postgres");
  }

  const admin = new Client({ connectionString: adminUrl.toString(), ssl: false });
  await admin.connect();
  try {
    await ensureLoginRole(admin, migration);
    await ensureLoginRole(admin, web);
    await ensureLoginRole(admin, worker);
    for (const role of [EXPECTED_ROLES.webRuntime, EXPECTED_ROLES.workerRuntime]) {
      await admin.query(
        `CREATE ROLE ${quoteIdentifier(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
      ).catch((error) => {
        if (error.code !== "42710") throw error;
      });
    }

    for (const role of [EXPECTED_ROLES.legacyCapability, EXPECTED_ROLES.capability]) {
      const capability = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      if (!capability.rowCount) {
        await admin.query(
          `CREATE ROLE ${quoteIdentifier(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
        );
      }
    }
    for (const member of [
      EXPECTED_ROLES.migration,
      EXPECTED_ROLES.web,
      EXPECTED_ROLES.worker,
      EXPECTED_ROLES.webRuntime,
      EXPECTED_ROLES.workerRuntime
    ]) {
      for (const capability of [EXPECTED_ROLES.legacyCapability, EXPECTED_ROLES.capability]) {
        await admin.query(`REVOKE ${quoteIdentifier(capability)} FROM ${quoteIdentifier(member)}`);
      }
    }
    await admin.query(
      `GRANT ${quoteIdentifier(EXPECTED_ROLES.webRuntime)} TO ${quoteIdentifier(EXPECTED_ROLES.web)}`
    );
    await admin.query(
      `GRANT ${quoteIdentifier(EXPECTED_ROLES.workerRuntime)} TO ${quoteIdentifier(EXPECTED_ROLES.worker)}`
    );
    await admin.query(
      `GRANT ${quoteIdentifier(EXPECTED_ROLES.capability)} TO ${quoteIdentifier(EXPECTED_ROLES.workerRuntime)}`
    );

    const databaseResult = await admin.query(
      `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1`,
      [EXPECTED_DATABASE]
    );
    if (!databaseResult.rowCount) {
      await admin.query(
        `CREATE DATABASE ${quoteIdentifier(EXPECTED_DATABASE)} OWNER ${quoteIdentifier(EXPECTED_ROLES.migration)}`
      );
    } else if (databaseResult.rows[0].owner !== EXPECTED_ROLES.migration) {
      throw new Error(`La base existente no pertenece a ${EXPECTED_ROLES.migration}; usá una base desechable nueva`);
    }
  } finally {
    await admin.end();
  }

  await verifyLoginRole(webUrl, EXPECTED_ROLES.web);
  await verifyLoginRole(workerUrl, EXPECTED_ROLES.worker);
  console.log("  base desechable lista: logins, runtime roles y worker separados");
}

main().catch((error) => {
  console.error(`  preparación PostgreSQL fallida: ${error.message}`);
  process.exitCode = 1;
});
