"use strict";

// Administrative, idempotent migration for legacy plaintext Shopify tokens.
// Cross-tenant enumeration is deliberately restricted to the migrator role;
// neither the web process nor the worker may perform this operation.

const { Pool } = require("pg");
const { env } = require("../shopify");
const { cifrarToken, descifrarToken, estaCifrado, cifradoActivo } = require("../cripto-tokens");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");

async function main() {
  if (!cifradoActivo()) {
    throw new Error("TOKEN_ENC_KEY no esta configurada; la migracion no puede cifrar tokens");
  }
  if (!env.MIGRATION_DATABASE_URL) {
    throw new Error("MIGRATION_DATABASE_URL es obligatoria para una operacion transversal");
  }

  const pool = createPostgresPool({
    databaseUrl: env.MIGRATION_DATABASE_URL,
    caCertificate: env.PG_CA_CERT,
    Pool
  });

  let cifradas = 0;
  let omitidas = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT dominio, datos->>'token' AS token
         FROM public.tiendas
        WHERE datos ? 'token'
        FOR UPDATE`
    );

    for (const row of result.rows) {
      if (!row.token || estaCifrado(row.token)) {
        omitidas++;
        continue;
      }
      const encrypted = cifrarToken(descifrarToken(row.token));
      await client.query(
        `UPDATE public.tiendas
            SET datos = jsonb_set(datos, '{token}', to_jsonb($2::text), false),
                actualizada = now()
          WHERE dominio = $1`,
        [row.dominio, encrypted]
      );
      cifradas++;
    }
    await client.query("COMMIT");
    console.log(`Migracion terminada: ${cifradas} token(s) cifrados, ${omitidas} sin cambios.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migracion de tokens fallida:", error.message);
  process.exitCode = 1;
});
