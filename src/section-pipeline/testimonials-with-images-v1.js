"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");

const source = fs.readFileSync(path.join(__dirname, "sources", "testimonios-con-imagenes-v1", "section.liquid"), "utf8")
  .replace(/\r\n?/g, "\n");

function adapt({ seed }) {
  // Los testimonios son contenido editorial de la plantilla. Claude no los
  // inventa ni los reemplaza durante la creación de la página.
  return structuredClone(seed);
}

const outline = [
  {
    id: "testimonials-header",
    label: "Encabezado de testimonios",
    icon: "heading",
    fields: ["eyebrow", "heading", "intro"],
    previewSuffixes: ["__eyebrow", "__heading", "__intro"]
  },
  {
    id: "testimonial-cards",
    label: "Tarjetas de testimonios",
    icon: "reviews",
    blockType: "testimonial"
  },
  {
    id: "testimonials-layout",
    label: "Layout y apariencia",
    icon: "section",
    fields: [
      "max_width", "desktop_columns", "mobile_columns", "card_gap", "padding_top",
      "padding_bottom", "side_padding", "mobile_padding_top", "mobile_padding_bottom",
      "mobile_side_padding", "background_color", "card_background", "heading_color",
      "text_color", "muted_color", "accent_color", "border_color", "card_radius"
    ]
  }
];

module.exports = createSectionDefinition({
  id: "testimonios-con-imagenes",
  version: 1,
  source,
  adaptation: adapt,
  outline,
  copySlots: {},
  catalog: {
    scale: "section",
    category: "Prueba social y confianza",
    description: "Carrusel reutilizable de testimonios con una imagen independiente por tarjeta.",
    thumbnail: "testimonials"
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
