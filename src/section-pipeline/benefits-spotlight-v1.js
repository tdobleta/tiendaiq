"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createSectionDefinition } = require("./section-contract");
const { readCopySlot } = require("./copy-slots");

const source = fs.readFileSync(path.join(__dirname, "sources", "benefits-spotlight-v1", "section.liquid"), "utf8").replace(/\r\n?/g, "\n");

function rich(value, max = 700) {
  return `<p>${String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]).slice(0, max)}</p>`;
}

function adapt({ product, research, seed, occurrence = 1 }) {
  const instance = structuredClone(seed);
  const media = Array.isArray(product?.media) ? product.media : product?.media?.nodes || [];
  const first = media[0];
  const url = first?.image?.url || first?.preview?.image?.url || first?.url || first?.src || "";
  if (url) instance.settings.image = url;
  if (product?.title) instance.settings.image_alt = String(product.title).slice(0, 180);

  const generatedHeading = readCopySlot(research, { section_id: "benefits-spotlight", occurrence, field: "heading" });
  const generatedIntro = readCopySlot(research, { section_id: "benefits-spotlight", occurrence, field: "intro" });
  const legacyHeading = research?.sectionCopy?.benefitsSpotlightHeading;
  const legacyIntro = research?.sectionCopy?.benefitsSpotlightIntro || research?.sectionCopy?.benefitsIntro;
  if (generatedHeading || legacyHeading) instance.settings.heading = String(generatedHeading || legacyHeading).slice(0, 180);
  if (generatedIntro || legacyIntro) instance.settings.intro = rich(generatedIntro || legacyIntro);
  else if (research?.summary) instance.settings.intro = rich(research.summary);

  const items = Array.isArray(research?.sectionCopy?.benefitsSpotlightItems) && research.sectionCopy.benefitsSpotlightItems.length
    ? research.sectionCopy.benefitsSpotlightItems
    : (research?.sectionCopy?.benefitItems || []);
  instance.blocks.filter((block) => block.type === "benefit").forEach((block, index) => {
    const item = items[index] || {};
    const heading = readCopySlot(research, { section_id: "benefits-spotlight", occurrence, block_type: "benefit", block_id: block.id, block_index: index, field: "heading" });
    const body = readCopySlot(research, { section_id: "benefits-spotlight", occurrence, block_type: "benefit", block_id: block.id, block_index: index, field: "body" });
    if (heading || item.heading) block.settings.heading = String(heading || item.heading).slice(0, 180);
    if (body || item.body) block.settings.body = rich(body || item.body);
  });
  return instance;
}

const outline = [
  {
    id: "spotlight-content", label: "Grupo de título", icon: "group", children: [
      { id: "spotlight-eyebrow", label: "Texto superior", icon: "text", fields: ["eyebrow"], previewSuffixes: ["__eyebrow"] },
      { id: "spotlight-heading", label: "Título", icon: "heading", fields: ["heading"], previewSuffixes: ["__heading"] },
      { id: "spotlight-intro", label: "Texto", icon: "text", fields: ["intro"], previewSuffixes: ["__intro"] }
    ]
  },
  { id: "spotlight-media", label: "Imagen central", icon: "gallery", fields: ["image", "image_alt", "image_fit"], previewSuffixes: ["__media"] },
  { id: "spotlight-benefits", label: "Beneficios repetibles", icon: "benefits", blockType: "benefit" },
  {
    id: "spotlight-layout", label: "Layout y apariencia", icon: "section", fields: [
      "max_width", "column_gap", "benefit_gap", "spotlight_padding", "mobile_gap", "mobile_spotlight_padding",
      "background_color", "card_background", "media_background", "heading_color", "text_color", "muted_color",
      "accent_color", "border_color", "background_image", "background_image_position", "background_image_repeat",
      "background_image_size", "background_image_attachment", "background_overlay_show", "background_overlay_color",
      "heading_align", "border_radius", "benefit_radius", "padding_top", "padding_bottom", "side_padding", "margin_top",
      "margin_bottom", "mobile_padding_top", "mobile_padding_bottom", "mobile_side_padding", "mobile_margin_top", "mobile_margin_bottom"
    ]
  }
];

module.exports = createSectionDefinition({
  id: "benefits-spotlight",
  version: 1,
  source,
  adaptation: adapt,
  outline,
  copySlots: { section: ["heading", "intro"], blocks: { benefit: ["heading", "body"] } },
  contentSources: { section: { image: "shopify", image_alt: "shopify" } },
  catalog: { scale: "section", category: "Beneficios y características", description: "Composición PagePilot con imagen central y beneficios repetibles alrededor.", thumbnail: "benefits-spotlight" },
  capabilities: { editableContent: true, editableStyles: true, editableStructure: true, duplicable: true, deletable: true, reorderable: true, allowMultipleInstances: true, responsive: ["mobile_gap", "mobile_spotlight_padding", "mobile_padding_top", "mobile_padding_bottom", "mobile_side_padding", "mobile_margin_top", "mobile_margin_bottom"] }
});
