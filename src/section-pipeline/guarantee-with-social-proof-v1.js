"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");

const source = fs.readFileSync(path.join(__dirname, "sources", "guarantee-with-social-proof-v1", "section.liquid"), "utf8")
  .replace(/\r\n?/g, "\n");

const outline = [
  {
    id: "guarantee-content", label: "Contenido de garantía", icon: "shield", children: [
      { id: "guarantee-eyebrow", label: "Texto superior", icon: "text", fields: ["eyebrow"], previewSuffixes: ["__eyebrow"] },
      { id: "guarantee-heading", label: "Título", icon: "heading", fields: ["heading"], previewSuffixes: ["__heading"] },
      { id: "guarantee-body", label: "Descripción", icon: "text", fields: ["body"], previewSuffixes: ["__body"] },
      { id: "guarantee-items", label: "Elementos de confianza", icon: "shield", blockType: "trust_item" },
      { id: "guarantee-cta", label: "Llamada a la acción", icon: "cart", fields: ["button_label", "button_link"], previewSuffixes: ["__button"] }
    ]
  },
  {
    id: "guarantee-layout", label: "Layout y apariencia", icon: "section", fields: [
      "max_width", "padding_top", "padding_bottom", "side_padding", "mobile_padding_top", "mobile_padding_bottom", "mobile_side_padding",
      "background_color", "card_background", "heading_color", "text_color", "muted_color", "accent_color", "border_color", "card_radius"
    ]
  }
];

module.exports = createSectionDefinition({
  id: "guarantee-with-social-proof",
  version: 1,
  source,
  adaptation: ({ seed }) => structuredClone(seed),
  outline,
  catalog: {
    scale: "section",
    category: "Prueba social y confianza",
    description: "Garantía reutilizable con elementos de confianza y llamada a la acción.",
    thumbnail: "guarantee-social-proof"
  },
  capabilities: {
    editableContent: true,
    editableStyles: true,
    editableStructure: true,
    duplicable: true,
    deletable: true,
    reorderable: true,
    allowMultipleInstances: true,
    responsive: ["mobile_padding_top", "mobile_padding_bottom", "mobile_side_padding"]
  }
});
