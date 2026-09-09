"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");

const source = fs.readFileSync(path.join(__dirname, "sources", "product-information-v1", "section.liquid"), "utf8");

function adapt({ seed }) {
  // La composición inicial es el preset de Shopify, sin reinterpretaciones.
  // Los datos vivos que el Liquid conecta por sí mismo (medios, variante y
  // precio) llegan por `product`; el copywriting tendrá una operación separada
  // y explícita sobre campos autorizados.
  return seed;
}

module.exports = createSectionDefinition({
  id: "product-information",
  version: 1,
  source,
  adaptation: adapt
});
