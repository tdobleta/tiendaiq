"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");

const source = fs.readFileSync(path.join(__dirname, "sources", "product-information-v1", "section.liquid"), "utf8")
  .replace(/\r\n?/g, "\n");

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function plainText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function adapt({ product, research, seed }) {
  // La fuente Liquid y todos sus valores visuales permanecen inmutables. La
  // adaptación sólo escribe campos de contenido autorizados y respaldados por
  // el producto o por la investigación validada.
  const instance = structuredClone(seed);
  const title = plainText(product?.title || product?.titulo).slice(0, 180);
  const description = plainText(research?.summary || product?.description || product?.descripcion).slice(0, 1200);
  if (title) {
    instance.settings.heading = title;
    instance.settings.image_alt = title;
  }
  if (description) instance.settings.description = `<p>${escapeHtml(description)}</p>`;
  const benefits = Array.isArray(research?.sectionCopy?.productBenefits)
    ? research.sectionCopy.productBenefits.filter(Boolean).slice(0, 4)
    : [];
  if (benefits.length) {
    instance.blocks.filter((block) => block.type === "benefit").forEach((block, index) => {
      if (benefits[index]) block.settings.text = String(benefits[index]).slice(0, 180);
    });
  }
  return instance;
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
  copySlots: { section: ["description"], blocks: { benefit: ["text"] } },
  contentSources: {
    section: { heading: "shopify", image_alt: "shopify" },
    blocks: { media_thumb: { image: "shopify", alt: "shopify" } }
  },
  lockedFields: {
    section: ["heading", "image_alt"],
    blocks: { media_thumb: ["image", "alt"] }
  },
  adaptation: adapt,
  catalog: {
    scale: "section",
    category: "Producto",
    description: "Galería, información comercial, opciones de compra y confianza.",
    thumbnail: "product-information"
  },
  capabilities: {
    editableContent: true,
    editableStyles: true,
    editableStructure: false,
    duplicable: false,
    deletable: false,
    reorderable: false,
    protected: true,
    allowMultipleInstances: false,
    responsive: ["mobile_top", "mobile_bottom", "mobile_side"]
  }
});
