"use strict";

const { Pool } = require("pg");
const { env } = require("../shopify");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");
const { requireAppRegistration, appRegistrationDiagnostic } = require("../src/runtime/app-registration-contract");

const CONFIRMATION = "BIND_ONE_SHOPIFY_APP_REGISTRATION";

async function main() {
  if (String(process.env.APP_REGISTRATION_BIND_CONFIRMATION || "") !== CONFIRMATION) {
    throw new Error(`Confirmacion requerida: ${CONFIRMATION}`);
  }
  const registration = requireAppRegistration(env);
  if (!env.MIGRATION_DATABASE_URL) throw new Error("MIGRATION_DATABASE_URL es obligatoria");
  const pool = createPostgresPool({
    databaseUrl: env.MIGRATION_DATABASE_URL,
    caCertificate: env.PG_CA_CERT,
    Pool
  });
  try {
    await pool.query("SELECT control_plane.bind_app_registration($1)", [registration.id]);
    console.log(JSON.stringify({ ok: true, appRegistration: appRegistrationDiagnostic(registration) }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Vinculacion de registro Shopify fallida: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { CONFIRMATION, main };
