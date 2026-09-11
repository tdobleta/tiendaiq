"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");

const source = fs.readFileSync(path.join(__dirname, "sources", "image-with-timeline-v1", "section.liquid"), "utf8")
  .replace(/\r\n?/g, "\n");

function adapt({ product, research, seed }) {
  const instance = structuredClone(seed);
  const rich = (value) => `<p>${String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]).slice(0, 700)}</p>`;
  const media = Array.isArray(product?.media) ? product.media : product?.media?.nodes || [];
  const first = media[0];
  const url = first?.image?.url || first?.preview?.image?.url || first?.url || first?.src || "";
  if (url) instance.settings.image = url;
  if (product?.title) instance.settings.image_alt = String(product.title).slice(0, 180);
  const timelineCopy = Array.isArray(research?.sectionCopy?.timelineSteps) ? research.sectionCopy.timelineSteps : [];
  if (research?.sectionCopy?.timelineIntro) instance.settings.intro = rich(research.sectionCopy.timelineIntro);
  else if (research?.summary) instance.settings.intro = rich(research.summary);
  instance.blocks.filter((block) => block.type === "timeline_step").forEach((block, index) => {
    const copy = timelineCopy[index];
    if (!copy) return;
    if (copy.heading) block.settings.heading = String(copy.heading).slice(0, 180);
    if (copy.body) block.settings.body = rich(copy.body);
  });
  return instance;
}

const outline = [
  {
    id: "timeline-content",
    label: "Contenido de la sección",
    icon: "heading",
    children: [
      { id: "timeline-eyebrow", label: "Texto superior", icon: "text", fields: ["eyebrow"], previewSuffixes: ["__eyebrow"] },
      { id: "timeline-heading", label: "Título", icon: "heading", fields: ["heading"], previewSuffixes: ["__heading"] },
      { id: "timeline-intro", label: "Introducción", icon: "text", fields: ["intro", "timeline_label"], previewSuffixes: ["__intro"] },
      { id: "timeline-steps", label: "Etapas del recorrido", icon: "benefits", blockType: "timeline_step" }
    ]
  },
  {
    id: "timeline-media",
    label: "Imagen",
    icon: "gallery",
    fields: ["image", "image_alt", "image_fit"],
    previewSuffixes: ["__media"]
  },
  {
    id: "timeline-layout",
    label: "Layout y apariencia",
    icon: "section",
    fields: [
      "max_width", "media_width", "column_gap", "step_gap", "mobile_media_position", "padding_top",
      "padding_bottom", "side_padding", "mobile_gap", "mobile_padding_top", "mobile_padding_bottom",
      "mobile_side_padding", "background_color", "media_background", "card_background", "heading_color",
      "text_color", "muted_color", "accent_color", "line_color", "card_radius"
    ]
  }
];

module.exports = createSectionDefinition({
  id: "image-with-timeline",
  version: 1,
  source,
  adaptation: adapt,
  outline,
  copySlots: { section: ["intro"], blocks: { timeline_step: ["heading", "body"] } },
  contentSources: { section: { image: "shopify", image_alt: "shopify" } },
  catalog: {
    scale: "section",
    category: "Beneficios y características",
    description: "Imagen de producto con etapas repetibles para explicar un recorrido progresivo.",
    thumbnail: "image-timeline"
  },
  capabilities: {
    editableContent: true,
    editableStyles: true,
    editableStructure: true,
    duplicable: true,
    deletable: true,
    reorderable: true,
    allowMultipleInstances: true,
    responsive: ["mobile_media_position", "mobile_gap", "mobile_padding_top", "mobile_padding_bottom", "mobile_side_padding"]
  }
});
