"use strict";

const { requireTenantContext } = require("../../tenancy/tenant-context");
const { withTenantTransaction } = require("./with-tenant-transaction");

function mapPageSummary(row) {
  return {
    id: row.id,
    shopify_product_id: row.shopify_product_id || null,
    estado: row.estado,
    url_publica: row.url_publica || null,
    actualizado: row.actualizado || null,
    titulo: row.titulo || null,
    imagen: row.imagen || null
  };
}

function createPageRepository(pool) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("Se requiere un pool de Postgres");

  return Object.freeze({
    async save(context, id, data) {
      const tenant = requireTenantContext(context);
      await withTenantTransaction(pool, tenant, (client) => client.query(
        `INSERT INTO public.paginas (tienda, id, datos, actualizada) VALUES ($1, $2, $3, now())
         ON CONFLICT (tienda, id) DO UPDATE SET datos = $3, actualizada = now()`,
        [tenant.tenantId, id, data]
      ));
    },

    async findById(context, id) {
      const tenant = requireTenantContext(context);
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        "SELECT datos FROM public.paginas WHERE tienda = $1 AND id = $2",
        [tenant.tenantId, id]
      ));
      return result.rows[0]?.datos ?? null;
    },

    async list(context) {
      const tenant = requireTenantContext(context);
      const result = await withTenantTransaction(pool, tenant, (client) => client.query(
        `SELECT
           datos->>'id'                         AS id,
           datos->>'shopify_product_id'         AS shopify_product_id,
           datos->>'estado'                     AS estado,
           datos->>'url_publica'                AS url_publica,
           datos->>'actualizado'                AS actualizado,
           COALESCE(datos#>>'{data,facetas,hero,titulo}', datos#>>'{data,source_fields,title}') AS titulo,
           COALESCE(
             (datos->'urls') ->> (datos#>>'{data,facetas,hero,galeria,0}'),
             (datos->'urls') ->> (datos#>>'{data,content,media,hero_media_id}')
           ) AS imagen
         FROM public.paginas
         WHERE tienda = $1
         ORDER BY actualizada DESC`,
        [tenant.tenantId]
      ));
      return result.rows.map(mapPageSummary);
    }
  });
}

module.exports = { createPageRepository, mapPageSummary };
