"use strict";

const { Liquid } = require("liquidjs");
const { resolveSection } = require("./page-pipeline");

function escapeAttribute(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function imageUrl(value) {
  if (typeof value === "string") return value;
  return value?.url || value?.src || value?.image?.url || value?.preview_image?.url || "";
}

function liquidNamedArguments(args) {
  const options = {};
  for (const argument of args) {
    if (Array.isArray(argument) && argument.length === 2) {
      options[argument[0]] = argument[1];
    } else if (argument && typeof argument === "object") {
      Object.assign(options, argument);
    }
  }
  return options;
}

function imageTag(value, ...args) {
  const options = liquidNamedArguments(args);
  const src = imageUrl(value);
  if (!src) return "";
  const attributes = {
    src,
    alt: options.alt || value?.alt || "",
    class: options.class,
    loading: options.loading,
    sizes: options.sizes,
    srcset: options.widths
      ? String(options.widths).split(",").map((width) => `${src} ${String(width).trim()}w`).join(", ")
      : null
  };
  return `<img ${Object.entries(attributes).filter(([, item]) => item).map(([key, item]) => `${key}="${escapeAttribute(item)}"`).join(" ")}>`;
}

function productForPreview(snapshot = {}) {
  const media = Array.isArray(snapshot.media) ? snapshot.media.map((item) => {
    const url = imageUrl(item);
    return { ...item, alt: item.alt || item.altText || snapshot.title || "", preview_image: { url } };
  }) : [];
  const variants = Array.isArray(snapshot.variants) ? snapshot.variants : [];
  const first = variants[0] || { id: "preview-variant", title: "Variante", price: "0", available: true };
  const cents = (value) => {
    const normalized = String(value ?? "0").replace(/[^0-9.,-]/g, "").replace(",", ".");
    const amount = Number(normalized);
    return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  };
  return {
    ...snapshot,
    media,
    featured_media: media[0] || null,
    selected_or_first_available_variant: {
      ...first,
      price: cents(first.price),
      compare_at_price: first.compareAtPrice == null ? null : cents(first.compareAtPrice),
      available: first.available !== false && first.availableForSale !== false
    },
    url: snapshot.url || "#"
  };
}

const engine = new Liquid({ strictVariables: false, strictFilters: false });
engine.registerFilter("image_url", imageUrl);
engine.registerFilter("image_tag", imageTag);
engine.registerFilter("placeholder_svg_tag", (_value, className = "") => `<svg class="${escapeAttribute(className)}" role="img" aria-label="Imagen pendiente" viewBox="0 0 16 10"><rect width="16" height="10" fill="#e6e8eb"/></svg>`);
engine.registerFilter("handleize", (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
engine.registerFilter("money", (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${(amount / 100).toFixed(2)}` : String(value || "");
});

function liquidWithoutSchema(source) {
  return String(source).replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/, "");
}

async function renderSectionPage(page) {
  const rendered = [];
  for (const section of page?.sections || []) {
    const definition = resolveSection(section.definition);
    if (!definition) {
      rendered.push(`<section class="tiq-missing-section" role="status">La sección ${escapeAttribute(section.label || section.id)} no está disponible.</section>`);
      continue;
    }
    const blocks = (section.instance.blocks || []).map((block) => ({
      ...block,
      binding: block.binding || {},
      shopify_attributes: `data-tiq-block-id="${escapeAttribute(block.id)}"`
    }));
    const html = await engine.parseAndRender(liquidWithoutSchema(definition.source), {
      section: { id: section.id, settings: section.instance.settings, blocks },
      product: productForPreview(page.productSnapshot),
      routes: { cart_add_url: "/cart/add" }
    });
    rendered.push(`<div data-tiq-section-id="${escapeAttribute(section.id)}">${html}</div>`);
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"><style>html,body{margin:0;min-height:100%;background:#fff;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;font-weight:400}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button,a{color:inherit}[data-tiq-section-id]{outline:1px solid transparent;outline-offset:-1px}[data-tiq-section-id]:hover{outline-color:#70a4ff}[data-tiq-block-id]{cursor:pointer}.tiq-missing-section{margin:24px;padding:18px;border:1px solid #d72c0d;border-radius:8px;color:#8e1f0b;font:14px system-ui}</style></head><body>${rendered.join("\n")}<script>document.addEventListener("click",function(event){var interactive=event.target.closest("button,input,select,textarea,label,a");if(interactive){if(interactive.tagName==="A")event.preventDefault();return}var block=event.target.closest("[data-tiq-block-id]");var section=event.target.closest("[data-tiq-section-id]");if(!section)return;parent.postMessage({type:"tiq-section-select",sectionId:section.dataset.tiqSectionId,blockId:block?block.dataset.tiqBlockId:null},"*")})<\/script></body></html>`;
}

module.exports = Object.freeze({ imageTag, imageUrl, liquidWithoutSchema, productForPreview, renderSectionPage });
