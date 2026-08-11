"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_NAME = "tiendaiq:schema-migrations";

function discoverMigrations(directory) {
  return fs.readdirSync(directory)
    .filter((name) => MIGRATION_NAME.test(name))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(directory, name), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      return Object.freeze({ name, sql, checksum });
    });
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function runMigrations(pool, { directory, dryRun = false, log = () => {} } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("Se requiere un pool de Postgres");
  if (!directory) throw new TypeError("Se requiere el directorio de migraciones");

  const migrations = discoverMigrations(directory);
  const client = await pool.connect();
  const pending = [];

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_NAME]);
    await ensureMigrationTable(client);
    const appliedResult = await client.query("SELECT name, checksum FROM public.schema_migrations");
    const applied = new Map(appliedResult.rows.map((row) => [row.name, row.checksum]));

    for (const migration of migrations) {
      const previousChecksum = applied.get(migration.name);
      if (previousChecksum && previousChecksum !== migration.checksum) {
        throw new Error(`La migración aplicada ${migration.name} cambió de contenido`);
      }
      if (!previousChecksum) pending.push(migration);
    }

    if (dryRun) return pending.map((migration) => migration.name);

    for (const migration of pending) {
      log(`aplicando ${migration.name}`);
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return pending.map((migration) => migration.name);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_NAME]);
    } finally {
      client.release();
    }
  }
}

module.exports = { discoverMigrations, runMigrations };
