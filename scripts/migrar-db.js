"use strict";

const path = require("path");
const { Pool } = require("pg");
const { env } = require("../shopify");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");
const { runMigrations } = require("../src/platform/postgres/migration-runner");

async function main() {
  const pool = createPostgresPool({
    databaseUrl: env.MIGRATION_DATABASE_URL || env.DATABASE_URL,
    caCertificate: env.PG_CA_CERT,
    Pool
  });
  const dryRun = process.argv.includes("--dry-run");
  try {
    const applied = await runMigrations(pool, {
      directory: path.join(__dirname, "..", "db", "migrations"),
      dryRun,
      log: (message) => console.log(`  ${message}`)
    });
    const action = dryRun ? "pendientes" : "aplicadas";
    console.log(`  migraciones ${action}: ${applied.length ? applied.join(", ") : "ninguna"}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`  migración fallida: ${error.message}`);
  process.exitCode = 1;
});
