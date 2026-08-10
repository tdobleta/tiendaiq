"use strict";

function createPostgresPool({ databaseUrl, caCertificate, Pool }) {
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para conectar Postgres");
  if (typeof Pool !== "function") throw new TypeError("Se requiere el constructor Pool de pg");

  const local = /localhost|127\.0\.0\.1|sslmode=disable/.test(databaseUrl);
  // Render can use a CA available in the host system trust store. Keep
  // verification strict and allow an explicit private CA when one is required.
  const ssl = local ? false : caCertificate
    ? { rejectUnauthorized: true, ca: caCertificate }
    : { rejectUnauthorized: true };

  return new Pool({
    connectionString: databaseUrl,
    ssl,
    max: Math.max(2, Number(process.env.PG_POOL_MAX) || 10),
    connectionTimeoutMillis: Math.max(1000, Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000),
    idleTimeoutMillis: 30000
  });
}

module.exports = { createPostgresPool };
