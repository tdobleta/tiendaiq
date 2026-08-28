"use strict";

const { Pool } = require("pg");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");
const { appRegistrationContract, appRegistrationDiagnostic } = require("../src/runtime/app-registration-contract");

async function readBoundRegistration({ databaseUrl, caCertificate, PoolImplementation = Pool }) {
  if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL es obligatoria");
  const pool = createPostgresPool({
    databaseUrl,
    caCertificate,
    Pool: PoolImplementation
  });
  try {
    const result = await pool.query(
      "SELECT registration_id FROM control_plane.app_registration_binding WHERE singleton = true"
    );
    const registrationId = result.rows?.[0]?.registration_id;
    const registration = appRegistrationContract({ SHOPIFY_APP_REGISTRATION_ID: registrationId });
    if (!registration.id) throw new Error("La base no contiene una identidad Shopify valida");
    // This identifier is intentionally non-secret. It is the immutable label
    // used by the runtime/DB contract, not a Shopify client id or credential.
    return Object.freeze({ registrationId: registration.id, diagnostic: appRegistrationDiagnostic(registration) });
  } finally {
    await pool.end();
  }
}

async function main() {
  const result = await readBoundRegistration({
    databaseUrl: process.env.MIGRATION_DATABASE_URL,
    caCertificate: process.env.PG_CA_CERT
  });
  console.log(JSON.stringify({ ok: true, ...result }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Diagnostico de registro Shopify fallido: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { readBoundRegistration };
