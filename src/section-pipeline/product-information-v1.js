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
  const variants = connection(product.variants).slice(0, 3);
  const claims = verifiedBenefits(research);

  seed.settings.heading = title;
  seed.settings.description = description
    ? `<p>${escapeHtml(description)}</p>`
    : `<p>Conocé ${escapeHtml(title)} y elegí la opción disponible que mejor se adapte a vos.</p>`;
  seed.settings.image_alt = cleanText(images[0]?.altText || images[0]?.alt || title, 180);

  // Testimonios, garantías, envíos, pagos y comparaciones del preset son sólo
  // demostrativos. Una página creada nunca los hereda como si fueran verdad.
  const preserved = seed.blocks.filter((block) => ![
    "media_thumb", "benefit", "bundle", "trust_item", "payment", "tab"
  ].includes(block.type));
  const gallery = images.map((image, index) => ({
    id: `media-${index + 1}`,
    type: "media_thumb",
    settings: {
      image: image.image?.url || image.preview?.image?.url || image.id || image.url || image.src || null,
      alt: cleanText(image.altText || image.alt || `${title} — imagen ${index + 1}`, 180),
      button_label: `Ver imagen ${index + 1} de ${title}`
    }
  }));
  const benefits = claims.map((claim, index) => ({
    id: `benefit-${index + 1}`,
    type: "benefit",
    settings: { icon_glyph: "✓", text: cleanText(claim.text, 220) }
  }));
  const bundles = variants.map((variant, index) => ({
    id: `bundle-${index + 1}`,
    type: "bundle",
    settings: {
      title: cleanText(variant.title || variant.name || `Opción ${index + 1}`, 100),
      subtitle: "Variante disponible en Shopify",
      price: cleanText(variant.price || variant.priceFormatted || "", 60),
      compare_at_price: cleanText(variant.compareAtPrice || "", 60),
      badge: "",
      selected: index === 0
    },
    binding: { variantId: variant.id, quantity: 1 }
  }));

  // Reviews remain absent without merchant evidence. A model is never allowed
  // to manufacture ratings, people or outcomes for conversion copy.
  seed.settings.rating_stars = research.rating?.verified ? "★★★★★" : "";
  seed.settings.rating_text = research.rating?.verified ? cleanText(research.rating.label, 140) : "";
  seed.settings.reviews_link = research.rating?.verified ? cleanText(research.rating.url, 500) : "";
  seed.settings.urgency_text = "";
  // La galería principal ya se enlaza directamente con product.media. No se
  // duplican sus imágenes como bloques falsos en el árbol del merchant.
  seed.blocks = [...benefits, ...bundles, ...preserved];
  return seed;
}

module.exports = createSectionDefinition({
  id: "product-information",
  version: 1,
  source,
  adaptation: adapt
});
