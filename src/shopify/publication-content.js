"use strict";

const crypto = require("crypto");
const { storefrontProjection } = require("../piloto/pdp01-contract");
const { sectionPageProjection } = require("./section-page-publish-guard");

// Shopify receives a deliberate projection of a page, not the private editor
// record. Keeping this in one module is important: the hash stored in
// Postgres must be computed over exactly the same bytes that are sent to the
// metafield.
function preparePublishedData(data) {
  const dataTienda = JSON.parse(JSON.stringify(data || {}));
  if (dataTienda?.section_page) {
    dataTienda.section_page = sectionPageProjection(dataTienda);
  }
  if (dataTienda?.piloto_pdp_01) {
    dataTienda.piloto_pdp_01 = storefrontProjection(dataTienda.piloto_pdp_01);
    dataTienda.fuente = { shopify_product_id: dataTienda?.fuente?.shopify_product_id };
  }
  const reseña = dataTienda?.facetas?.hero?.resena_destacada;
  if (reseña && Object.prototype.hasOwnProperty.call(reseña, "avatar")) reseña.avatar = null;
  return dataTienda;
}

function publishedContentHash(data) {
  return crypto.createHash("sha256").update(JSON.stringify(preparePublishedData(data))).digest("hex");
}

module.exports = Object.freeze({ preparePublishedData, publishedContentHash });
