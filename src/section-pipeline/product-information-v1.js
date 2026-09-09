"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");

const source = fs.readFileSync(path.join(__dirname, "sources", "product-information-v1", "section.liquid"), "utf8");

function cleanText(value, max = 5000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function connection(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.nodes)) return value.nodes;
  if (Array.isArray(value?.edges)) return value.edges.map((edge) => edge?.node).filter(Boolean);
  return [];
}

function media(product) {
  return connection(product.media).length ? connection(product.media) : connection(product.images);
}

function verifiedBenefits(research) {
  return (Array.isArray(research.claims) ? research.claims : [])
    .filter((claim) => claim && claim.verified === true && claim.text && claim.source)
    .slice(0, 4);
}

function adapt({ product, research, seed }) {
  const title = cleanText(product.title || product.titulo, 180) || "Producto";
  const description = cleanText(research.summary || product.description || product.descripcion, 1200);
  const images = media(product).slice(0, 8);
  const variants = connection(product.variants);
  const claims = verifiedBenefits(research);

  seed.settings.heading = title;
  seed.settings.description = description
    ? `<p>${escapeHtml(description)}</p>`
    : `<p>Conocé ${escapeHtml(title)} y elegí la opción disponible que mejor se adapte a vos.</p>`;
  seed.settings.image_alt = cleanText(images[0]?.altText || images[0]?.alt || title, 180);

  // The preset is the design composition. Adaptation may replace its content,
  // but never remove its structural blocks or collapse the section.
  const safeBenefits = [
    "Información conectada con Shopify",
    variants.length === 1 ? "Opción de compra disponible" : `${variants.length || 1} opciones de compra disponibles`,
    "Contenido editable antes de publicar",
    "Pago procesado de forma segura"
  ];
  let benefitIndex = 0;
  let bundleIndex = 0;
  let trustIndex = 0;
  seed.blocks = seed.blocks.map((block) => {
    if (block.type === "benefit") {
      const verified = claims[benefitIndex]?.text;
      const text = cleanText(verified || safeBenefits[benefitIndex], 220);
      benefitIndex += 1;
      return { ...block, settings: { ...block.settings, text } };
    }
    if (block.type === "bundle") {
      const variant = variants[bundleIndex] || variants[0];
      const quantities = [1, 3, 5];
      const adapted = {
        ...block,
        settings: {
          ...block.settings,
          image_alt: cleanText(`${title} — ${block.settings.title}`, 180)
        }
      };
      if (variant?.id) adapted.binding = { variantId: variant.id, quantity: quantities[bundleIndex] || 1 };
      bundleIndex += 1;
      return adapted;
    }
    if (block.type === "trust_item") {
      const texts = ["Información de envío en el checkout", "Compra procesada por Shopify"];
      const adapted = { ...block, settings: { ...block.settings, text: texts[trustIndex] } };
      trustIndex += 1;
      return adapted;
    }
    if (block.type === "tab" && !research.rating?.verified) {
      const settings = {
        ...block.settings,
        rating_stars: "",
        rating_label: "Sin reseñas verificadas",
        reviewer_initials: "",
        reviewer_name: "",
        reviewer_date: "",
        reviewer_role: "",
        comparison_item_1: "Información conectada con Shopify",
        comparison_item_2: "Contenido editable antes de publicar",
        comparison_item_3: "Producto y variantes sincronizados",
        specification_text: description || "Información del producto disponible en Shopify"
      };
      if (settings.layout === "review") {
        settings.title = "Información";
        settings.content = "<p>Agregá aquí una reseña verificada antes de publicar.</p>";
      }
      return { ...block, settings };
    }
    return block;
  });

  // Never manufacture ratings, people or outcomes. A truthful neutral row
  // keeps the original composition intact until verified evidence exists.
  seed.settings.rating_stars = research.rating?.verified ? "★★★★★" : "✦";
  seed.settings.rating_text = research.rating?.verified ? cleanText(research.rating.label, 140) : "Producto conectado a Shopify";
  seed.settings.reviews_link = research.rating?.verified ? cleanText(research.rating.url, 500) : "";
  seed.settings.urgency_text = variants.some((variant) => variant.available !== false && variant.availableForSale !== false)
    ? "Disponible para comprar en tu tienda"
    : "Consultá la disponibilidad antes de comprar";
  return seed;
}

module.exports = createSectionDefinition({
  id: "product-information",
  version: 1,
  source,
  adaptation: adapt
});
