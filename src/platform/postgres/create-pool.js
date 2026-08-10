"use strict";

function withoutUrlSslOptions(databaseUrl) {
  const url = new URL(databaseUrl);
  // pg parses connectionString after the explicit options and lets URL SSL
  // parameters overwrite them. Render URLs include sslmode=require, which
  // would otherwise discard the explicit CA and validation policy below.
  for (const key of [...url.searchParams.keys()]) {
    if (/^ssl(?:mode|cert|key|rootcert|password)?$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

function createPostgresPool({ databaseUrl, caCertificate, privateNetwork = false, Pool }) {
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria para conectar Postgres");
  if (typeof Pool !== "function") throw new TypeError("Se requiere el constructor Pool de pg");

  const local = /localhost|127\.0\.0\.1|sslmode=disable/.test(databaseUrl);
  if (privateNetwork && /sslmode=(?!disable)/.test(databaseUrl)) {
    throw new Error("PG_PRIVATE_NETWORK=1 requiere la URL interna de Render, sin sslmode externo");
  }
  // Render can use a CA available in the host system trust store. Keep
  // verification strict and allow an explicit private CA when one is required.
  const ssl = (local || privateNetwork) ? false : caCertificate
    ? { rejectUnauthorized: true, ca: caCertificate }
    : { rejectUnauthorized: true };

  return new Pool({
    connectionString: withoutUrlSslOptions(databaseUrl),
    ssl,
    max: Math.max(2, Number(process.env.PG_POOL_MAX) || 10),
    connectionTimeoutMillis: Math.max(1000, Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000),
    idleTimeoutMillis: 30000
  });
}

module.exports = { createPostgresPool };
