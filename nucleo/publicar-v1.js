// ============================================================
// PUBLICACIÓN V1 — documento canónico para la tienda.
//
// Es una frontera nueva y no altera publicar.js: el publicador histórico
// sigue atendiendo páginas v0 hasta que el cambio de storefront quede
// verificado. Una vez que el editor v3 guarda un borrador, este módulo escribe
// ese mismo JSON en el metafield y apunta el producto a la plantilla TiendaIQ.
// ============================================================

"use strict";

const { gql } = require("../shopify");
const documento = require("./documento");

const MUTACION_METAFIELD = `mutation($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id }
    userErrors { field message }
  }
}`;

const MUTACION_SUFIJO = `mutation($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id handle templateSuffix onlineStoreUrl }
    userErrors { field message }
  }
}`;

function documentoParaPublicar(pagina) {
  const candidato = pagina?.documento_borrador || pagina?.documento_publicado;
  if (!candidato) throw new Error("La página no tiene un borrador v1 para publicar.");
  const validado = documento.validar(documento.migrar(candidato));
  const producto = pagina.shopify_product_id || validado.producto_id;
  if (pagina.id && validado.id !== pagina.id) {
    throw new Error("El documento v1 no coincide con la página que se quiere publicar.");
  }
  if (pagina.tienda && validado.tienda !== pagina.tienda) {
    throw new Error("El documento v1 no coincide con la tienda de la sesión.");
  }
  if (!producto || !/^gid:\/\/shopify\/Product\//.test(producto)) {
    throw new Error("El documento v1 no tiene un producto de Shopify asociado.");
  }
  if (validado.producto_id && validado.producto_id !== producto) {
    throw new Error("El documento v1 apunta a otro producto de Shopify.");
  }
  return { documento: validado, productoId: producto };
}

async function publicarDocumentoV1(pagina, sesion, log = () => {}) {
  const { documento: doc, productoId } = documentoParaPublicar(pagina);
  const respuestaMetafield = await gql(MUTACION_METAFIELD, {
    metafields: [{
      ownerId: productoId,
      namespace: "tiendaiq",
      key: "pagina",
      type: "json",
      value: JSON.stringify(doc)
    }]
  }, sesion);
  const erroresMetafield = respuestaMetafield?.metafieldsSet?.userErrors || [];
  if (erroresMetafield.length) throw new Error("Metafield: " + JSON.stringify(erroresMetafield));

  const respuestaProducto = await gql(MUTACION_SUFIJO, {
    product: { id: productoId, templateSuffix: "tiendaiq" }
  }, sesion);
  const erroresProducto = respuestaProducto?.productUpdate?.userErrors || [];
  if (erroresProducto.length) throw new Error("templateSuffix: " + JSON.stringify(erroresProducto));

  const producto = respuestaProducto.productUpdate.product || {};
  log("  documento  · v1 publicado con el renderer único");
  return {
    url: producto.onlineStoreUrl || `https://${sesion.tienda}/products/${producto.handle}`,
    documento: doc
  };
}

module.exports = { documentoParaPublicar, publicarDocumentoV1 };
