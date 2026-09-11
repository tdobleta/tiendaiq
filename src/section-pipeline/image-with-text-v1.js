"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");
const { readCopySlot } = require("./copy-slots");

const source = fs.readFileSync(path.join(__dirname, "sources", "image-with-text-v1", "section.liquid"), "utf8")
  .replace(/\r\n?/g, "\n");

function adapt({ product, research, seed }) {
  const instance = structuredClone(seed);
  const rich = (value) => `<p>${String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]).slice(0, 1200)}</p>`;
  if (product?.title) instance.settings.heading = String(product.title).slice(0, 180);
  const generatedBody = readCopySlot(research, { section_id: "image-with-text", occurrence: 1, field: "body" });
  if (generatedBody || research?.sectionCopy?.imageWithTextBody) instance.settings.body = rich(generatedBody || research.sectionCopy.imageWithTextBody);
  else if (research?.summary) instance.settings.body = rich(research.summary);
  const media = Array.isArray(product?.media) ? product.media : product?.media?.nodes || [];
  const first = media[0];
  const url = first?.image?.url || first?.preview?.image?.url || first?.url || first?.src || "";
  if (url) instance.settings.image = url;
  if (product?.title) instance.settings.image_alt = String(product.title).slice(0, 180);
  return instance;
}

const outline = [
  {
    id: "content-group",
    label: "Grupo de contenido",
    icon: "group",
    children: [
      { id: "eyebrow", label: "Texto superior", icon: "text", fields: ["eyebrow"], previewSuffixes: ["__eyebrow"] },
      { id: "heading", label: "Título", icon: "heading", fields: ["heading"], previewSuffixes: ["__heading"] },
      { id: "body", label: "Texto", icon: "text", fields: ["body"], previewSuffixes: ["__body"] },
      { id: "button", label: "Botón", icon: "button", fields: ["button_label", "button_link", "button_style"], previewSuffixes: ["__button"] }
    ]
  },
  {
    id: "media-group",
    label: "Grupo de imagen",
    icon: "gallery",
    children: [
      { id: "image", label: "Imagen", icon: "image", fields: ["image", "image_alt", "media_aspect", "image_fit", "image_position"], previewSuffixes: ["__media"] }
    ]
  },
  {
    id: "section-layout",
    label: "Layout y apariencia",
    icon: "section",
    fields: [
      "max_width", "media_width", "column_gap", "reverse_desktop", "mobile_media_position",
      "padding_top", "padding_bottom", "side_padding", "mobile_gap", "mobile_padding_top",
      "mobile_padding_bottom", "mobile_side_padding", "background_color", "media_background",
      "heading_color", "text_color", "muted_color", "accent_color", "button_text_color", "media_radius"
    ],
    previewSuffixes: ["__inner"]
  }
];

module.exports = createSectionDefinition({
  id: "image-with-text",
  version: 1,
  source,
  adaptation: adapt,
  outline,
  copySlots: { section: ["body"] },
  contentSources: { section: { heading: "shopify", image: "shopify", image_alt: "shopify" } },
  catalog: {
    scale: "section",
    category: "Imagen y contenido",
    description: "Dos columnas con contenido, llamada a la acción e imagen adaptable.",
    thumbnail: "image-right"
  },
  capabilities: {
    editableContent: true,
    editableStyles: true,
    editableStructure: false,
    reorderable: true,
    allowMultipleInstances: true,
    responsive: ["mobile_media_position", "mobile_gap", "mobile_padding_top", "mobile_padding_bottom", "mobile_side_padding"]
  }
});
