"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { env } = require("../../shopify");
const { hashSource, sourceFieldsFromProduct, validatePdp01 } = require("./pdp01-contract");

const MODELO = env.MODELO_IA || "claude-sonnet-5";
const TIMEOUT = Math.max(30000, Number(env.ANTHROPIC_TIMEOUT_MS) || 120000);

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hero", "offer", "why", "timeline", "faq", "media"],
  properties: {
    hero: { type: "object", additionalProperties: false, required: ["claim", "bullets"], properties: { claim: { type: "string" }, bullets: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } }, quote: { type: "object", additionalProperties: false, required: ["text", "attribution"], properties: { text: { type: "string" }, attribution: { type: "string" } } } } },
    offer: { type: "object", additionalProperties: false, required: ["heading", "packs"], properties: { heading: { type: "string" }, packs: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["id", "label", "subtitle", "quantity", "mechanism", "variant_id"], properties: { id: { type: "string" }, label: { type: "string" }, subtitle: { type: "string" }, quantity: { type: "integer" }, mechanism: { enum: ["single_variant", "multi_quantity"] }, variant_id: { type: "string" }, badge: { type: "string" } } } }, accordions: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } } } },
    why: { type: "object", additionalProperties: false, required: ["eyebrow", "heading", "body", "points"], properties: { eyebrow: { type: "string" }, heading: { type: "string" }, body: { type: "string" }, points: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } } } },
    timeline: { type: "object", additionalProperties: false, required: ["heading", "intro", "steps"], properties: { heading: { type: "string" }, intro: { type: "string" }, steps: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["label", "heading", "body"], properties: { label: { type: "string" }, heading: { type: "string" }, body: { type: "string" } } } } } },
    faq: { type: "object", additionalProperties: false, required: ["heading", "items"], properties: { heading: { type: "string" }, items: { type: "array", minItems: 3, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } } } },
    media: { type: "object", additionalProperties: false, required: ["hero_media_id"], properties: { hero_media_id: { type: "string" }, comparison_media_id: { type: "string" }, community_media_id: { type: "string" }, gallery_media_ids: { type: "array", maxItems: 8, items: { type: "string" } } } }
  }
};

function imageForAnalysis(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("width", "1200");
    return parsed.toString();
  } catch { return url; }
}

function cleanJson(text) {
  let result = String(text || "").trim();
  const fence = result.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) result = fence[1].trim();
  if (result[0] !== "{") {
    const start = result.indexOf("{");
    const end = result.lastIndexOf("}");
    if (start >= 0 && end > start) result = result.slice(start, end + 1);
  }
  return JSON.parse(result);
}

async function generatePdp01(product, media, { idioma = "es", angulo = "" } = {}) {
  const source_fields = sourceFieldsFromProduct(product);
  if (!source_fields.media_ids.length) throw new Error("Piloto 01 necesita al menos una imagen real del producto para armar la plantilla.");

  const content = [];
  for (const item of media) {
    content.push({ type: "text", text: `media_id: ${item.media_id}` });
    content.push({ type: "image", source: { type: "url", url: imageForAnalysis(item.url) } });
  }
  content.push({ type: "text", text: JSON.stringify({
    idioma: idioma === "es" ? "español rioplatense, voseo" : idioma,
    angulo: angulo || "natural y directo",
    product: source_fields
  }) });

  const system = [
    "Sos un copywriter senior de ecommerce. Escribís el contenido abierto de la plantilla Piloto 01; la estructura y el diseño ya existen.",
    "Usá solamente hechos que estén en product o que sean visibles en las imágenes. No inventes ingredientes, resultados, certificaciones, descuentos, envíos, garantías, testimonios, reseñas, escasez ni cifras.",
    "NO incluyas título del producto, precios, símbolos de moneda, porcentajes, stock, disponibilidad, variantes ni nombres de medios: Shopify los muestra en vivo.",
    "No uses prueba social. Dejá hero.quote fuera. No agregues campos no pedidos.",
    "Los packs son únicamente presentaciones de la misma variante. Podés proponer cantidades 1, 2, 3 o 5; no prometas ahorro ni descuento. Cada pack debe referenciar un variant_id existente y usar mechanism multi_quantity.",
    "Asigná fotos solamente por media_id existente. Si no hay una foto pertinente para comparison_media_id o community_media_id, omití ese campo.",
    "Respondé exclusivamente JSON válido, sin markdown, y cumplí exactamente este schema:",
    JSON.stringify(outputSchema)
  ].join("\n\n");

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const flow = client.messages.stream({
    model: MODELO,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    output_config: { effort: env.ESFUERZO_IA || "medium" },
    system,
    messages: [{ role: "user", content }]
  }, { timeout: TIMEOUT, maxRetries: 1 });
  const response = await flow.finalMessage();
  if (response.stop_reason === "refusal") throw new Error("La IA no pudo generar esta página.");
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("La IA no devolvió el contenido de la plantilla.");
  const document = {
    contract_version: 1,
    template: "piloto-pdp-01",
    source_fields,
    source_hash: hashSource(source_fields),
    content: cleanJson(text),
    evidence: {}
  };
  return { data: validatePdp01(document, { origin: "ai" }), uso: response.usage };
}

module.exports = { generatePdp01, outputSchema };
