"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { env } = require("../../shopify");
const { hashSource, sourceFieldsFromProduct, validatePdp01 } = require("./pdp01-contract");

const MODEL = env.MODELO_IA || "claude-sonnet-5";
const TIMEOUT = Math.max(30000, Number(env.ANTHROPIC_TIMEOUT_MS) || 120000);

function mediaForAnalysis(url) {
  try { const parsed = new URL(url); parsed.searchParams.set("width", "1200"); return parsed.toString(); } catch { return url; }
}
function parseJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
}
function contentFromModelJson(text) {
  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;

  // Older prompt wording asked for `content.hero`, which some models
  // faithfully interpreted as a top-level `{ content: { ... } }` envelope.
  // Accept that one unambiguous envelope, then validate the actual content
  // against the same narrow contract used for every other response.
  const keys = Object.keys(parsed);
  if (keys.length === 1 && keys[0] === "content" && parsed.content && typeof parsed.content === "object" && !Array.isArray(parsed.content)) {
    return parsed.content;
  }
  return parsed;
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
    "No escribas título de producto, precios, porcentajes, símbolos de moneda, stock, disponibilidad, variantes ni nombres de medios. Shopify los muestra vivos.",
    "No incluyas HTML, Markdown, links, datos de prueba ni campos fuera del JSON solicitado.",
    "Los packs son cantidades reales de la misma variante: elegí cantidades entre 1 y 5, sin prometer ahorro, y usá un variant_id existente con mechanism multi_quantity.",
    "Asigná fotos sólo por media_id existente. No agregues una asignación si ninguna foto es pertinente.",
    "Respondé un único objeto JSON raíz con estas claves: hero {claim, bullets}, offer {heading, packs}, why {eyebrow, heading, body, points}, timeline {heading, intro, steps}, faq {heading, items}, media {hero_media_id, gallery_media_ids}. No lo envuelvas dentro de una clave content. Cada FAQ tiene question y answer; cada paso tiene label, heading y body.",
    "Mínimos: 2 bullets, 2 why.points, 2 timeline.steps, 3 FAQ. Máximos: 4 bullets y points, 4 timeline.steps, 8 FAQ."
  ].join("\n\n");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL, max_tokens: 4500, system,
    messages: [{ role: "user", content: promptMedia }]
  }, { timeout: TIMEOUT, maxRetries: 0 });
  const text = response.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("La IA no devolvió el contenido de Piloto 01.");
  const document = {
    contract_version: 1, template: "piloto-pdp-01", source_fields,
    source_hash: hashSource(source_fields), content: contentFromModelJson(text), evidence: {}
  };
  return { data: validatePdp01(document, { origin: "ai" }), uso: response.usage };
}

module.exports = Object.freeze({ generatePdp01, contentFromModelJson });
