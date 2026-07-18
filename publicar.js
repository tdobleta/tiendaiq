// ============================================================
// PUBLICADOR — sube la última página generada a la tienda.
//
//   node publicar.js
//
// Hace las tres cosas del plan, en orden:
//   1. Instala la plantilla en el tema (css + js + liquid + avatar)
//   2. Escribe el Producto Universal en el metafield tiendaiq.pagina
//   3. Asigna al producto el templateSuffix "tiendaiq"
//      (el campo que en el admin se ve como "Plantilla de tema")
//
// Idempotente: correrlo de nuevo pisa los assets y el metafield.
// ============================================================

const fs = require("fs");
const path = require("path");
const { gql, sesionDeEnv } = require("./shopify");

const RUTA_JSON = path.join(__dirname, "ultima-pagina.json");
const DIR_PLANTILLA = path.join(__dirname, "plantilla-producto");
const DIR_AVATARES = path.join(DIR_PLANTILLA, "avatares");

// ---------- avatar ----------
// El JSON trae una ruta local (avatares/xx.png). En la tienda el archivo vive
// como asset del tema, así que: se sube con nombre saneado y el JSON publicado
// guarda solo ese nombre. Si el archivo local ya no existe (p. ej. se borró),
// se re-elige uno al azar de la carpeta.

function sanear(nombre) {
  const ext = path.extname(nombre).toLowerCase();
  const base = path
    .basename(nombre, ext)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `tiendaiq-avatar-${base}${ext}`;
}

function resolverAvatar(rutaEnJson) {
  let archivo = rutaEnJson ? path.join(DIR_PLANTILLA, rutaEnJson) : null;

  if (!archivo || !fs.existsSync(archivo)) {
    let candidatos = [];
    try {
      candidatos = fs.readdirSync(DIR_AVATARES).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
    } catch {
      return null;
    }
    if (!candidatos.length) return null;
    archivo = path.join(DIR_AVATARES, candidatos[Math.floor(Math.random() * candidatos.length)]);
  }

  return {
    nombreAsset: sanear(path.basename(archivo)),
    base64: fs.readFileSync(archivo).toString("base64")
  };
}

// ---------- mutaciones ----------

const Q_TEMA = `{
  themes(first: 1, roles: [MAIN]) { nodes { id name } }
}`;

const M_ARCHIVOS = `mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { field message }
  }
}`;

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
async function publicarPagina(data, sesion, log = () => {}) {
  const idProducto = data.fuente.shopify_product_id;

  // --- tema principal ---
  const tema = (await gql(Q_TEMA, {}, sesion)).themes.nodes[0];
  if (!tema) throw new Error("La tienda no tiene tema principal.");
  log(`  tema       · ${tema.name}`);

  // --- copia para la tienda: el avatar pasa a ser nombre de asset ---
  const dataTienda = JSON.parse(JSON.stringify(data));
  const avatar = resolverAvatar(data.facetas.hero.resena_destacada.avatar);
  dataTienda.facetas.hero.resena_destacada.avatar = avatar ? avatar.nombreAsset : null;

  // --- 1. archivos del tema ---
  const archivos = [
    {
      filename: "assets/tiendaiq.css",
      body: { type: "TEXT", value: fs.readFileSync(path.join(DIR_PLANTILLA, "styles.css"), "utf8") }
    },
    {
      filename: "assets/tiendaiq.js",
      body: { type: "TEXT", value: fs.readFileSync(path.join(DIR_PLANTILLA, "render.js"), "utf8") }
    },
    {
      filename: "templates/product.tiendaiq.liquid",
      body: { type: "TEXT", value: fs.readFileSync(path.join(__dirname, "tema", "product.tiendaiq.liquid"), "utf8") }
    }
  ];

  const r1 = await gql(M_ARCHIVOS, { themeId: tema.id, files: archivos }, sesion);
  if (r1.themeFilesUpsert.userErrors.length) {
    throw new Error("Archivos del tema: " + JSON.stringify(r1.themeFilesUpsert.userErrors));
  }
  log(`  tema       · ${r1.themeFilesUpsert.upsertedThemeFiles.length} archivos instalados`);

  // El avatar va en su propia llamada: si pesa demasiado para la API, la
  // página se publica igual (cae a la silueta) en vez de frenar todo.
  if (avatar) {
    try {
      const rA = await gql(
        M_ARCHIVOS,
        {
          themeId: tema.id,
          files: [{ filename: `assets/${avatar.nombreAsset}`, body: { type: "BASE64", value: avatar.base64 } }]
        },
        sesion
      );
      if (rA.themeFilesUpsert.userErrors.length) throw new Error(JSON.stringify(rA.themeFilesUpsert.userErrors));
      log(`  avatar     · ${avatar.nombreAsset}`);
    } catch (e) {
      dataTienda.facetas.hero.resena_destacada.avatar = null;
      log(`  avatar     · ⚠ no se pudo subir (${e.message.slice(0, 80)}) — la página sale con silueta`);
    }
  } else {
    log(`  avatar     · carpeta vacía — silueta`);
  }

  // --- 2. metafield con el Producto Universal ---
  const r2 = await gql(
    M_METAFIELD,
    {
      metafields: [
        {
          ownerId: idProducto,
          namespace: "tiendaiq",
          key: "pagina",
          type: "json",
          value: JSON.stringify(dataTienda)
        }
      ]
    },
    sesion
  );
  if (r2.metafieldsSet.userErrors.length) {
    throw new Error("Metafield: " + JSON.stringify(r2.metafieldsSet.userErrors));
  }
  log(`  metafield  · tiendaiq.pagina escrito`);

  // --- 3. templateSuffix ---
  const r3 = await gql(
    M_SUFIJO,
    { product: { id: idProducto, templateSuffix: "tiendaiq" } },
    sesion
  );
  if (r3.productUpdate.userErrors.length) {
    throw new Error("templateSuffix: " + JSON.stringify(r3.productUpdate.userErrors));
  }
  const p = r3.productUpdate.product;
  log(`  plantilla  · templateSuffix = "${p.templateSuffix}"`);

  return { url: p.onlineStoreUrl || `https://${sesion.tienda}/products/${p.handle}`, tema: tema.name };
}

module.exports = { publicarPagina };

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
