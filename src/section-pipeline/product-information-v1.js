"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");

const source = fs.readFileSync(path.join(__dirname, "sources", "product-information-v1", "section.liquid"), "utf8")
  .replace(/\r\n?/g, "\n");

function adapt({ seed }) {
  // La composición inicial es el preset de Shopify, sin reinterpretaciones.
  // Los datos vivos que el Liquid conecta por sí mismo (medios, variante y
  // precio) llegan por `product`; el copywriting tendrá una operación separada
  // y explícita sobre campos autorizados.
  return seed;
}

// Jerarquía semántica del editor. Describe la composición real de esta versión
// sin modificar ni reinterpretar el Liquid original de Shopify.
const outline = [
  {
    id: "product-gallery",
    label: "Galería del producto",
    icon: "gallery",
    fields: ["image_alt", "hero_image", "image_fit"],
    previewSuffixes: ["__media-column"]
  },
  {
    id: "product-details",
    label: "Detalles del producto",
    icon: "details",
    children: [
      {
        id: "reviews-number",
        label: "Calificación y reseñas",
        icon: "star",
        fields: ["rating_stars", "rating_text", "reviews_link"],
        previewSuffixes: ["__rating-row"]
      },
      {
        id: "product-title",
        label: "Título del producto",
        icon: "heading",
        fields: ["heading"],
        previewSuffixes: ["__title"]
      },
      {
        id: "value-proposition",
        label: "Propuesta de valor",
        icon: "text",
        fields: ["description"],
        previewSuffixes: ["__description"]
      },
      {
        id: "benefits",
        label: "Beneficios",
        icon: "benefits",
        blockType: "benefit"
      },
      {
        id: "purchase-options",
        label: "Opciones de compra",
        icon: "purchase",
        children: [
          {
            id: "bundle-heading",
            label: "Encabezado de packs",
            icon: "heading",
            fields: ["bundle_heading"],
            previewSuffixes: ["__bundle-heading"]
          },
          {
            id: "bundle-options",
            label: "Packs y descuentos",
            icon: "bundle",
            blockType: "bundle"
          },
          {
            id: "buy-buttons",
            label: "Añadir al carrito / Comprar",
            icon: "cart",
            fields: ["urgency_text", "button_label", "button_icon", "button_link"],
            previewSuffixes: ["__urgency", "__cta"]
          }
        ]
      },
      {
        id: "purchase-trust",
        label: "Garantías de compra",
        icon: "shield",
        blockType: "trust_item"
      },
      {
        id: "payment-icons",
        label: "Métodos de pago",
        icon: "payment",
        blockType: "payment"
      },
      {
        id: "information-tabs",
        label: "Información ampliada",
        icon: "tabs",
        blockType: "tab"
      }
    ]
  }
];

module.exports = createSectionDefinition({
  id: "product-information",
  version: 1,
  source,
  outline,
  adaptation: adapt
});
