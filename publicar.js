// ============================================================
// PUBLICADOR — sube la última página generada a la tienda.
//
//   node publicar.js
//
// Compliant con el App Store: NO escribe en el tema. Hace dos cosas:
//   1. Escribe el Producto Universal en el metafield tiendaiq.pagina
//   2. Asigna al producto el templateSuffix "tiendaiq"
//      (el campo que en el admin se ve como "Plantilla de tema")
//
// El render (tiendaiq.js/css) y la lectura del metafield ya no viven en un
// template escrito al tema, sino en el APP BLOCK del theme app extension
// (extensions/tiendaiq-widgets/blocks/pagina.liquid). El merchant crea una
// vez el template de producto "tiendaiq" con ese bloque; nosotros solo
// apuntamos el producto ahí con templateSuffix (escritura de PRODUCTO, no de
// tema → permitida sin exención).
//
// Idempotente: correrlo de nuevo pisa el metafield y reasigna el suffix.
// ============================================================

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { gql, sesionDeEnv } = require("./shopify");
const { assertFixedTemplatePublishable } = require("./src/shopify/fixed-template-publish-guard");

const RUTA_JSON = path.join(__dirname, "ultima-pagina.json");

// Los avatares de personas no forman parte del contrato de publicación.
// Nunca se elige ni se sube una imagen local como sustituto de una reseña.
// Si una publicación histórica conserva una URL, se omite del nuevo metafield;
// la limpieza de Files se hace aparte, desde un inventario revisado por tienda.
function prepararDatosPublicacion(data) {
  const dataTienda = JSON.parse(JSON.stringify(data));
  const reseña = dataTienda?.facetas?.hero?.resena_destacada;
  if (reseña && Object.prototype.hasOwnProperty.call(reseña, "avatar")) {
    reseña.avatar = null;
  }
  return dataTienda;
}

// ---------- mutaciones ----------

const M_METAFIELD = `mutation($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id }
    userErrors { field message }
  }
}`;

const M_SUFIJO = `mutation($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id handle templateSuffix onlineStoreUrl }
    userErrors { field message }
  }
}`;

// Publica una página en la tienda de `sesion`.
// `log` deja que el CLI escriba a consola y el server no.
async function publicarPagina(data, sesion, log = () => {}, { signal } = {}) {
  const idProducto = data.fuente.shopify_product_id;

  // This runs in the worker immediately before any remote mutation. It is the
  // authoritative guard even if a queued job was created before the catalog
  // changed or another API caller bypassed the web preflight.
  await assertFixedTemplatePublishable(data, sesion, { signal });

  const dataTienda = prepararDatosPublicacion(data);

  // --- 1. metafield con el Producto Universal ---
  const serializedData = JSON.stringify(dataTienda);
  const publishedHash = crypto.createHash("sha256").update(serializedData).digest("hex");
  const r1 = await gql(
    M_METAFIELD,
    {
      metafields: [
        {
          ownerId: idProducto,
          namespace: "tiendaiq",
          key: "pagina",
          type: "json",
          value: serializedData
        }
      ]
    },
    sesion,
    { signal }
  );
  if (r1.metafieldsSet.userErrors.length) {
    throw new Error("Metafield: " + JSON.stringify(r1.metafieldsSet.userErrors));
  }
  log(`  metafield  · tiendaiq.pagina escrito`);

  // --- 2. templateSuffix ---
  const r2 = await gql(
    M_SUFIJO,
    { product: { id: idProducto, templateSuffix: "tiendaiq" } },
    sesion,
    { signal }
  );
  if (r2.productUpdate.userErrors.length) {
    throw new Error("templateSuffix: " + JSON.stringify(r2.productUpdate.userErrors));
  }
  const p = r2.productUpdate.product;
  log(`  plantilla  · templateSuffix = "${p.templateSuffix}"`);

  return {
    url: p.onlineStoreUrl || `https://${sesion.tienda}/products/${p.handle}`,
    publishedHash
  };
}

// Revierte un producto a su página NATIVA: le saca el templateSuffix "tiendaiq"
// (vuelve a usar la plantilla product por defecto). NO borra el metafield: queda
// como dato (re-publicar lo reusa sin regenerar). Escritura de PRODUCTO, no de
// tema → permitida sin exención, igual que publicar.
async function despublicarPagina(data, sesion, { signal } = {}) {
  const idProducto = data.fuente.shopify_product_id;
  const r = await gql(
    M_SUFIJO,
    { product: { id: idProducto, templateSuffix: null } },
    sesion,
    { signal }
  );
  if (r.productUpdate.userErrors.length) {
    throw new Error("templateSuffix: " + JSON.stringify(r.productUpdate.userErrors));
  }
}

module.exports = { publicarPagina, despublicarPagina, prepararDatosPublicacion };

// ---------- CLI ----------

async function main() {
  if (!fs.existsSync(RUTA_JSON)) {
    throw new Error("No hay ultima-pagina.json. Corré antes: node adaptador.js <numero>");
  }
  const data = JSON.parse(fs.readFileSync(RUTA_JSON, "utf8"));
  console.log(`\n▸ Publicando: ${data.facetas.hero.titulo}`);
  const { url } = await publicarPagina(data, sesionDeEnv(), console.log);
  console.log(`\n✅ Publicada:\n   ${url}\n`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`\n✖ ${e.message}\n`);
    process.exit(1);
  });
}
