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

function outlineTargets(nodes, sectionId, targets = []) {
  for (const node of nodes || []) {
    for (const suffix of node.previewSuffixes || []) {
      targets.push({ sectionId, outlineId: node.id, label: node.label, suffix });
    }
    outlineTargets(node.children, sectionId, targets);
  }
  return targets;
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function renderSectionPage(page) {
  const rendered = [];
  const targets = [];
  const blockLabels = [];
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
    outlineTargets(definition.editor.outline, section.id, targets);
    for (const block of blocks) {
      const blockDefinition = definition.editor.blocks.find((item) => item.type === block.type);
      blockLabels.push({ sectionId: section.id, blockId: block.id, label: blockDefinition?.name || block.type });
    }
    const html = await engine.parseAndRender(liquidWithoutSchema(definition.source), {
      section: { id: section.id, settings: section.instance.settings, blocks },
      product: productForPreview(page.productSnapshot),
      routes: { cart_add_url: "/cart/add" }
    });
    rendered.push(`<div data-tiq-section-id="${escapeAttribute(section.id)}">${html}</div>`);
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14px;font-weight:400}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button,a{color:inherit}[data-tiq-editable]{cursor:pointer}.tiq-editor-highlight{position:fixed;z-index:2147483646;display:none;border:1.5px solid #b6c1d1;border-radius:3px;pointer-events:none}.tiq-editor-highlight>span{position:absolute;left:-1.5px;top:-22px;max-width:240px;padding:3px 7px;border:1px solid #b6c1d1;border-radius:5px 5px 0 0;background:#edf5ff;color:#1f537e;font:500 11px/14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tiq-missing-section{margin:24px;padding:18px;border:1px solid #d72c0d;border-radius:8px;color:#8e1f0b;font:14px system-ui}</style></head><body>${rendered.join("\n")}<div class="tiq-editor-highlight" aria-hidden="true"><span></span></div><script>(function(){var targets=${scriptJson(targets)};var labels=${scriptJson(blockLabels)};function section(id){var all=document.querySelectorAll("[data-tiq-section-id]");for(var i=0;i<all.length;i++)if(all[i].dataset.tiqSectionId===id)return all[i];return null}targets.forEach(function(target){var root=section(target.sectionId);if(!root)return;root.querySelectorAll("[class]").forEach(function(element){for(var i=0;i<element.classList.length;i++)if(element.classList[i].endsWith(target.suffix)){element.dataset.tiqEditable="";element.dataset.tiqOutlineId=target.outlineId;element.dataset.tiqLabel=target.label;break}})});labels.forEach(function(item){var root=section(item.sectionId);if(!root)return;root.querySelectorAll("[data-tiq-block-id]").forEach(function(element){if(element.dataset.tiqBlockId===item.blockId){element.dataset.tiqEditable="";element.dataset.tiqLabel=item.label}})});var highlight=document.querySelector(".tiq-editor-highlight");var caption=highlight.querySelector("span");function show(element){var rect=element.getBoundingClientRect();highlight.style.display="block";highlight.style.left=rect.left+"px";highlight.style.top=rect.top+"px";highlight.style.width=rect.width+"px";highlight.style.height=rect.height+"px";caption.textContent=element.dataset.tiqLabel||"Elemento";caption.style.top=rect.top<24?"-1.5px":"-22px"}document.addEventListener("mouseover",function(event){var editable=event.target.closest("[data-tiq-editable]");if(editable)show(editable)});document.addEventListener("mouseout",function(event){var editable=event.target.closest("[data-tiq-editable]");if(editable&&(!event.relatedTarget||!editable.contains(event.relatedTarget)))highlight.style.display="none"});window.addEventListener("scroll",function(){highlight.style.display="none"},true);document.addEventListener("click",function(event){var editable=event.target.closest("[data-tiq-editable]");var sectionElement=event.target.closest("[data-tiq-section-id]");if(editable&&sectionElement)parent.postMessage({type:"tiq-section-select",sectionId:sectionElement.dataset.tiqSectionId,blockId:editable.dataset.tiqBlockId||null,outlineId:editable.dataset.tiqOutlineId||null},"*");var interactive=event.target.closest("button,input,select,textarea,label,a");if(interactive&&interactive.tagName==="A")event.preventDefault()})})()<\/script></body></html>`;
}

module.exports = Object.freeze({ imageTag, imageUrl, liquidWithoutSchema, outlineTargets, productForPreview, renderSectionPage });
