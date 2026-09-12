"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");
const { readCopySlot } = require("./copy-slots");

const source = fs.readFileSync(path.join(__dirname, "sources", "reviews-carousel-v1", "section.liquid"), "utf8")
  .replace(/\r\n?/g, "\n");

function escapeText(value, limit = 900) {
  return String(value || "")
    .replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character])
    .slice(0, limit);
}

function adapt({ research, seed, occurrence = 1 }) {
  const instance = structuredClone(seed);
  const intro = readCopySlot(research, { section_id: "reviews-carousel", occurrence, field: "intro" })
    || research?.sectionCopy?.reviewsIntro;
  if (intro) instance.settings.intro = `<p>${escapeText(intro)}</p>`;
  const reviewItems = Array.isArray(research?.sectionCopy?.reviewItems) ? research.sectionCopy.reviewItems : [];
  instance.blocks.filter((block) => block.type === "review").forEach((block, index) => {
    const generated = readCopySlot(research, {
      section_id: "reviews-carousel", occurrence, block_type: "review", block_id: block.id, block_index: index, field: "quote"
    });
    const fallback = reviewItems[index]?.quote;
    if (generated || fallback) block.settings.quote = escapeText(generated || fallback);
  });
  return instance;
}

const outline = [
  {
    id: "reviews-content", label: "Contenido de reseñas", icon: "heading", children: [
      { id: "reviews-eyebrow", label: "Texto superior", icon: "text", fields: ["eyebrow"], previewSuffixes: ["__eyebrow"] },
      { id: "reviews-heading", label: "Título", icon: "heading", fields: ["heading"], previewSuffixes: ["__heading"] },
      { id: "reviews-intro", label: "Introducción", icon: "text", fields: ["intro"], previewSuffixes: ["__intro"] },
      { id: "reviews-rating", label: "Resumen de valoración", icon: "reviews", fields: ["rating_label", "rating_count"], previewSuffixes: ["__rating"] },
      { id: "review-items", label: "Tarjetas de reseña", icon: "reviews", blockType: "review" }
    ]
  },
  {
    id: "reviews-layout", label: "Layout y apariencia", icon: "section", fields: [
      "max_width", "desktop_columns", "mobile_columns", "card_gap", "padding_top", "padding_bottom", "side_padding",
      "mobile_padding_top", "mobile_padding_bottom", "mobile_side_padding", "background_color", "card_background",
      "heading_color", "text_color", "muted_color", "accent_color", "border_color", "card_radius"
    ]
  }
];

module.exports = createSectionDefinition({
  id: "reviews-carousel",
  version: 1,
  source,
  adaptation: adapt,
  outline,
  copySlots: { section: ["intro"], blocks: { review: ["quote"] } },
  contentSources: { blocks: { review: { image: "shopify", image_alt: "shopify" } } },
  catalog: {
    scale: "section",
    category: "Prueba social y confianza",
    description: "Carrusel de reseñas con valoración, tarjetas repetibles e imágenes independientes.",
    thumbnail: "reviews-carousel"
  },
  capabilities: {
    editableContent: true,
    editableStyles: true,
    editableStructure: true,
    duplicable: true,
    deletable: true,
    reorderable: true,
    allowMultipleInstances: true,
    responsive: ["desktop_columns", "mobile_columns", "card_gap", "mobile_padding_top", "mobile_padding_bottom", "mobile_side_padding"]
  }
});
