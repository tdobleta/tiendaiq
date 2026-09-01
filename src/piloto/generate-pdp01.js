"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { env } = require("../../shopify");
const {
  PDP01_COPY_OUTPUT_SCHEMA,
  hashSource,
  sourceFieldsFromProduct,
  validatePdp01Copy,
  validatePdp01
} = require("./pdp01-contract");

const MODEL = env.MODELO_IA || "claude-sonnet-5";
const TIMEOUT = Math.max(30000, Number(env.ANTHROPIC_TIMEOUT_MS) || 120000);

function mediaForAnalysis(url) {
  try { const parsed = new URL(url); parsed.searchParams.set("width", "1200"); return parsed.toString(); } catch { return url; }
}
function parseJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
}
function copyFromModelJson(text) {
  return validatePdp01Copy(parseJson(text));
}
function quantityLabel(quantity) {
  return quantity === 1 ? "1 unidad" : `${quantity} unidades`;
}
function variantSubtitle(variant) {
  return /^(default title|default|única)$/iu.test(variant.title || "") ? "Presentación del producto" : variant.title;
}
function commerceFromSource(sourceFields) {
  const variant = sourceFields.variants[0];
  return {
    packs: [1, 3, 5].map((quantity) => ({
      id: `cantidad-${quantity}`,
      label: quantityLabel(quantity),
      subtitle: variantSubtitle(variant),
      quantity,
      mechanism: "multi_quantity",
      variant_id: variant.id
    })),
    media: {
      hero_media_id: sourceFields.media_ids[0],
      gallery_media_ids: sourceFields.media_ids.slice(0, 4)
    }
  };
}
function composePdp01Content(copy, sourceFields) {
  const safeCopy = validatePdp01Copy(copy);
  const commerce = commerceFromSource(sourceFields);
  return {
    hero: safeCopy.hero,
    offer: { heading: safeCopy.offer.heading, packs: commerce.packs },
    why: safeCopy.why,
    timeline: safeCopy.timeline,
    faq: safeCopy.faq,
    media: commerce.media
  };
}

async function generatePdp01(product, media, { idioma = "es", angulo = "" } = {}) {
  const source_fields = sourceFieldsFromProduct(product);
  if (!source_fields.media_ids.length) throw new Error("Piloto 01 necesita al menos una imagen real del producto.");
  const promptMedia = media.flatMap((item) => [
    { type: "text", text: `media_id: ${item.media_id}` },
    { type: "image", source: { type: "url", url: mediaForAnalysis(item.url) } }
  ]);
  promptMedia.push({ type: "text", text: JSON.stringify({
    idioma: idioma === "es" ? "español rioplatense, voseo" : idioma,
    angulo: angulo || "natural y directo", product: source_fields
  }) });
  const system = [
    "Sos un copywriter senior de ecommerce. Escribís solamente los textos abiertos de una plantilla fija llamada Piloto 01.",
    "Usá únicamente hechos presentes en product o visibles en las imágenes. No inventes ingredientes, resultados, certificaciones, descuentos, envíos, garantías, testimonios, reseñas, escasez ni cifras.",
    "No escribas título de producto, precios, porcentajes, símbolos de moneda, stock, disponibilidad, variantes, packs ni nombres de medios. Shopify los muestra vivos.",
    "No incluyas HTML, Markdown, links, datos de prueba ni campos fuera del JSON solicitado.",
    "Respondé exactamente el JSON estructurado solicitado. Es sólo copy: hero {claim, bullets}, offer {heading}, why {eyebrow, heading, body, points}, timeline {heading, intro, steps}, faq {heading, items}. Cada FAQ tiene question y answer; cada paso tiene label, heading y body.",
    "Mínimos: 2 bullets, 2 why.points, 2 timeline.steps, 3 FAQ. Máximos: 4 bullets y points, 4 timeline.steps, 8 FAQ."
  ].join("\n\n");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL, max_tokens: 4500, system,
    output_config: { format: { type: "json_schema", schema: PDP01_COPY_OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: promptMedia }]
  }, { timeout: TIMEOUT, maxRetries: 0 });
  const text = response.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("La IA no devolvió el contenido de Piloto 01.");
  const document = {
    contract_version: 1, template: "piloto-pdp-01", source_fields,
    source_hash: hashSource(source_fields), content: composePdp01Content(copyFromModelJson(text), source_fields), evidence: {}
  };
  return { data: validatePdp01(document, { origin: "ai" }), uso: response.usage };
}

module.exports = Object.freeze({ generatePdp01, copyFromModelJson, commerceFromSource, composePdp01Content });
