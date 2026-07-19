// ============================================================
// IMÁGENES — subir archivos del merchant como media del producto.
//
// El editor deja elegir fotos del pool del producto; esto agrega la otra
// mitad: subir una foto nueva desde la compu. Se sube como MEDIA DEL
// PRODUCTO en Shopify (no como File suelto) a propósito: así entra al pool
// como cualquier otra foto y el Liquid publicado la resuelve solo con
// product.media, sin tocar nada más.
//
// Flujo (el estándar de Shopify):
//   1. stagedUploadsCreate  → URL temporal de subida
//   2. POST multipart       → los bytes van a ese bucket
//   3. productCreateMedia   → el archivo pasa a ser media del producto
//   4. poll hasta READY     → recién ahí hay URL de imagen
// ============================================================

const { gql } = require("./shopify");

const M_STAGED = `mutation($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`;

const M_CREAR_MEDIA = `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { ... on MediaImage { id status } }
    mediaUserErrors { field message }
  }
}`;

const Q_MEDIA = `query($id: ID!) {
  node(id: $id) {
    ... on MediaImage { id status preview { image { url } } }
  }
}`;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Sube una imagen (base64) como media del producto. Devuelve { media_id, url }.
async function subirImagenProducto(sesion, productoGid, nombre, mime, base64) {
  if (!/^image\//.test(mime)) throw new Error("Solo se pueden subir imágenes.");
  const buf = Buffer.from(base64, "base64");
  if (buf.length > 10 * 1024 * 1024) throw new Error("La imagen supera los 10 MB.");
  const archivo = String(nombre || "imagen.jpg").replace(/[^\w.\-]+/g, "-").slice(-80);

  // 1. lugar de subida
  const r1 = await gql(
    M_STAGED,
    {
      input: [
        {
          filename: archivo,
          mimeType: mime,
          httpMethod: "POST",
          resource: "IMAGE",
          fileSize: String(buf.length)
        }
      ]
    },
    sesion
  );
  if (r1.stagedUploadsCreate.userErrors?.length) {
    throw new Error("Subida: " + JSON.stringify(r1.stagedUploadsCreate.userErrors));
  }
  const destino = r1.stagedUploadsCreate.stagedTargets[0];

  // 2. los bytes
  const form = new FormData();
  for (const p of destino.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buf], { type: mime }), archivo);
  const r2 = await fetch(destino.url, { method: "POST", body: form });
  if (!r2.ok) throw new Error(`El bucket de Shopify rechazó la subida (HTTP ${r2.status}).`);

  // 3. media del producto
  const r3 = await gql(
    M_CREAR_MEDIA,
    {
      productId: productoGid,
      media: [{ originalSource: destino.resourceUrl, mediaContentType: "IMAGE", alt: "" }]
    },
    sesion
  );
  if (r3.productCreateMedia.mediaUserErrors?.length) {
    throw new Error("Media: " + JSON.stringify(r3.productCreateMedia.mediaUserErrors));
  }
  const mediaId = r3.productCreateMedia.media[0]?.id;
  if (!mediaId) throw new Error("Shopify no devolvió la media creada.");

  // 4. esperar a que procese (suele tardar 1-3 segundos)
  for (let i = 0; i < 15; i++) {
    const n = (await gql(Q_MEDIA, { id: mediaId }, sesion)).node;
    if (n?.status === "READY" && n.preview?.image?.url) {
      return { media_id: mediaId, url: n.preview.image.url };
    }
    if (n?.status === "FAILED") throw new Error("Shopify no pudo procesar la imagen.");
    await dormir(1000);
  }
  throw new Error("La imagen quedó procesándose; probá recargar en unos segundos.");
}

module.exports = { subirImagenProducto };
