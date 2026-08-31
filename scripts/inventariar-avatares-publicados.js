"use strict";

// Inventario estrictamente de lectura. No consulta Shopify ni elimina Files:
// cuenta páginas hoy publicadas que todavía conservan una URL de avatar en el
// JSON vigente. `app_data.page_versions` no es el almacenamiento activo de
// publicación: el runtime persiste las páginas en `public.paginas`.

const crypto = require("node:crypto");
const { Pool } = require("pg");
const { env } = require("../shopify");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");

const INVENTORY_QUERY = `
  SELECT
    tienda,
    id,
    actualizada,
    datos->>'estado' AS estado,
    COALESCE(
      datos #>> '{data,facetas,hero,resena_destacada,avatar}',
      datos #>> '{facetas,hero,resena_destacada,avatar}'
    ) AS avatar_url
  FROM public.paginas
  WHERE datos->>'estado' = 'publicada'
    AND COALESCE(
    datos #>> '{data,facetas,hero,resena_destacada,avatar}',
    datos #>> '{facetas,hero,resena_destacada,avatar}'
  ) ~* '^https?://'
  ORDER BY actualizada DESC, tienda, id
`;

// `app_data.page_versions` no participa del publish actual, pero se mide en el
// mismo inventario para saber si está acumulando historial o si es una
// estructura inerte. Sólo se devuelven conteos agregados.
const PAGE_VERSION_SUMMARY_QUERY = `
  SELECT
    COUNT(*)::integer AS total_versiones,
    (COUNT(*) FILTER (WHERE p.status = 'published'))::integer AS versiones_de_paginas_publicadas,
    (COUNT(*) FILTER (
      WHERE p.status = 'published'
        AND COALESCE(
          v.document #>> '{data,facetas,hero,resena_destacada,avatar}',
          v.document #>> '{facetas,hero,resena_destacada,avatar}'
        ) ~* '^https?://'
    ))::integer AS versiones_publicadas_con_avatar
  FROM app_data.page_versions v
  JOIN app_data.pages p
    ON p.tenant_id = v.tenant_id AND p.id = v.page_id
`;

function resumirReferencia(row, { includeUrls = false } = {}) {
  const url = String(row.avatar_url || "").trim();
  let host = null;
  try {
    host = new URL(url).hostname;
  } catch {
    host = "no-url";
  }
  const summary = {
    tienda: row.tienda,
    paginaId: row.id,
    actualizado: row.actualizada ? new Date(row.actualizada).toISOString() : null,
    estado: row.estado,
    host,
    referenciaHash: crypto.createHash("sha256").update(url).digest("hex").slice(0, 16)
  };
  if (includeUrls) summary.avatarUrl = url;
  return summary;
}

async function inventariarAvatares({ databaseUrl, caCertificate, PoolImplementation = Pool, includeUrls = false } = {}) {
  if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL es obligatoria");
  const pool = createPostgresPool({ databaseUrl, caCertificate, Pool: PoolImplementation });
  try {
    const [result, versionSummary] = await Promise.all([
      pool.query(INVENTORY_QUERY),
      pool.query(PAGE_VERSION_SUMMARY_QUERY)
    ]);
    const referencias = result.rows.map((row) => resumirReferencia(row, { includeUrls }));
    return {
      ok: true,
      modo: "solo_lectura",
      total: referencias.length,
      referencias,
      pageVersions: versionSummary.rows[0] || {
        total_versiones: 0,
        versiones_de_paginas_publicadas: 0,
        versiones_publicadas_con_avatar: 0
      }
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const includeUrls = process.argv.includes("--include-urls");
  if (includeUrls && process.env.ALLOW_AVATAR_URL_OUTPUT !== "1") {
    throw new Error("Para mostrar URLs completas definí ALLOW_AVATAR_URL_OUTPUT=1");
  }
  const inventory = await inventariarAvatares({
    databaseUrl: env.MIGRATION_DATABASE_URL,
    caCertificate: env.PG_CA_CERT,
    includeUrls
  });
  console.log(JSON.stringify(inventory, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Inventario de avatares fallido: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { INVENTORY_QUERY, PAGE_VERSION_SUMMARY_QUERY, inventariarAvatares, resumirReferencia };
