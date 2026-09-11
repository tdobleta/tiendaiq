"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { env } = require("../../shopify");

const MODEL = env.MODELO_IA || "claude-sonnet-5";
const TIMEOUT = Math.max(30000, Number(env.ANTHROPIC_TIMEOUT_MS) || 120000);

const OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["summary", "claims", "visualObservations"],
  properties: {
    summary: { type: "string", maxLength: 700 },
    claims: {
      type: "array", maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        required: ["text", "source", "verified"],
        properties: {
          text: { type: "string", maxLength: 180 },
          source: { type: "string", enum: ["shopify_description"] },
          verified: { type: "boolean", const: true }
        }
      }
    },
    visualObservations: {
      type: "array", maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
        required: ["text", "mediaId"],
        properties: {
          text: { type: "string", maxLength: 180 },
          mediaId: { type: "string", maxLength: 200 }
        }
      }
    },
    sectionCopy: {
      type: "object",
      additionalProperties: false,
      properties: {
        productBenefits: {
          type: "array", maxItems: 4,
          items: { type: "string", maxLength: 180 }
        },
        imageWithTextBody: { type: "string", maxLength: 1200 },
        timelineIntro: { type: "string", maxLength: 700 },
        timelineSteps: {
          type: "array", maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["heading", "body"],
            properties: {
              heading: { type: "string", maxLength: 180 },
              body: { type: "string", maxLength: 700 }
            }
          }
        },
        benefitsIntro: { type: "string", maxLength: 700 },
        benefitItems: {
          type: "array", maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["heading", "body"],
            properties: {
              heading: { type: "string", maxLength: 180 },
              body: { type: "string", maxLength: 700 }
            }
          }
        }
      }
    },
    copy_slots_v1: {
      type: "object",
      additionalProperties: false,
      required: ["version", "slots"],
      properties: {
        version: { type: "integer", const: 1 },
        slots: {
          type: "array", maxItems: 64,
          items: {
            type: "object", additionalProperties: false,
            required: ["target", "value", "evidence"],
            properties: {
              target: {
                type: "object", additionalProperties: false,
                required: ["section_id", "occurrence", "field"],
                properties: {
                  section_id: { type: "string", maxLength: 80 },
                  occurrence: { type: "integer", minimum: 1, maximum: 12 },
                  block_type: { type: "string", maxLength: 80 },
                  block_index: { type: "integer", minimum: 0, maximum: 49 },
                  field: { type: "string", maxLength: 80 }
                }
              },
              value: { type: "string", maxLength: 1200 },
              evidence: {
                type: "array", maxItems: 4,
                items: {
                  type: "object", additionalProperties: false,
                  required: ["kind", "reference"],
                  properties: {
                    kind: { type: "string", enum: ["shopify_description", "shopify_media", "shopify_product"] },
                    reference: { type: "string", maxLength: 200 }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
});

const COPY_SLOT_MANIFEST = Object.freeze({
  "product-information": Object.freeze({ section: Object.freeze(["description"]), blocks: Object.freeze({ benefit: Object.freeze(["text"]) }) }),
  "image-with-text": Object.freeze({ section: Object.freeze(["body"]), blocks: Object.freeze({}) }),
  "image-with-timeline": Object.freeze({ section: Object.freeze(["intro"]), blocks: Object.freeze({ timeline_step: Object.freeze(["heading", "body"]) }) }),
  "image-with-benefits": Object.freeze({ section: Object.freeze(["intro"]), blocks: Object.freeze({ benefit: Object.freeze(["heading", "body"]) }) })
});

function mediaForAnalysis(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("width", "1200");
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
}

function copySlotKey(target = {}) {
  return [target.section_id, target.occurrence || 1, target.block_type || "section", target.block_index ?? "section", target.field].join("/");
}

function legacyCopySlots(sectionCopy) {
  const slots = [];
  const add = (section_id, field, value, extra = {}) => {
    if (typeof value === "string" && value.trim()) slots.push({ target: { section_id, occurrence: 1, field, ...extra }, value: value.trim(), evidence: [] });
  };
  add("product-information", "description", "");
  for (const [index, value] of (sectionCopy?.productBenefits || []).entries()) add("product-information", "text", value, { block_type: "benefit", block_index: index });
  add("image-with-text", "body", sectionCopy?.imageWithTextBody);
  add("image-with-timeline", "intro", sectionCopy?.timelineIntro);
  for (const [index, value] of (sectionCopy?.timelineSteps || []).entries()) {
    add("image-with-timeline", "heading", value?.heading, { block_type: "timeline_step", block_index: index });
    add("image-with-timeline", "body", value?.body, { block_type: "timeline_step", block_index: index });
  }
  add("image-with-benefits", "intro", sectionCopy?.benefitsIntro);
  for (const [index, value] of (sectionCopy?.benefitItems || []).entries()) {
    add("image-with-benefits", "heading", value?.heading, { block_type: "benefit", block_index: index });
    add("image-with-benefits", "body", value?.body, { block_type: "benefit", block_index: index });
  }
  return slots.filter((slot) => slot.target.field !== "description" || slot.value);
}

function normalizeCopySlots(value, fallbackSectionCopy = {}) {
  const raw = value?.copy_slots_v1;
  const hasNewContract = raw != null;
  const input = raw?.version === 1 && Array.isArray(raw.slots) ? raw.slots : (hasNewContract ? [] : legacyCopySlots(fallbackSectionCopy));
  const slots = [];
  const skipped = [];
  if (hasNewContract && (raw.version !== 1 || !Array.isArray(raw.slots))) {
    skipped.push({ target: null, reason: "contrato_invalido" });
  }
  const seen = new Set();
  for (const item of input) {
    const target = item?.target || {};
    const manifest = COPY_SLOT_MANIFEST[target.section_id];
    const allowedFields = target.block_type
      ? manifest?.blocks?.[target.block_type]
      : manifest?.section;
    const key = copySlotKey(target);
    const validTarget = manifest
      && Number.isInteger(target.occurrence || 1)
      && (target.occurrence || 1) >= 1
      && Array.isArray(allowedFields)
      && allowedFields.includes(target.field)
      && (!target.block_type || Number.isInteger(target.block_index));
    if (!validTarget) {
      skipped.push({ target, reason: "target_no_autorizado" });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ target, reason: "target_duplicado" });
      continue;
    }
    seen.add(key);
    const valueText = String(item?.value || "").trim();
    if (!valueText) {
      skipped.push({ target, reason: "valor_vacio" });
      continue;
    }
    const evidence = (Array.isArray(item?.evidence) ? item.evidence : [])
      .filter((entry) => ["shopify_description", "shopify_media", "shopify_product"].includes(entry?.kind) && entry?.reference)
      .slice(0, 4)
      .map((entry) => ({ kind: entry.kind, reference: String(entry.reference).slice(0, 200) }));
    slots.push({
      target: {
        section_id: target.section_id,
        occurrence: target.occurrence || 1,
        ...(target.block_type ? { block_type: target.block_type, block_index: target.block_index } : {}),
        field: target.field
      },
      value: valueText.slice(0, target.field === "body" || target.field === "description" ? 1200 : 700),
      evidence
    });
  }
  return Object.freeze({ version: 1, slots: Object.freeze(slots), skipped: Object.freeze(skipped) });
}

function validateResearch(value, mediaIds) {
  const allowedMedia = new Set(mediaIds);
  const summary = String(value?.summary || "").trim().slice(0, 700);
  const claims = (Array.isArray(value?.claims) ? value.claims : [])
    .filter((claim) => claim?.verified === true && claim.source === "shopify_description" && claim.text)
    .slice(0, 4)
    .map((claim) => ({ text: String(claim.text).trim().slice(0, 180), source: claim.source, verified: true }));
  const visualObservations = (Array.isArray(value?.visualObservations) ? value.visualObservations : [])
    .filter((item) => item?.text && allowedMedia.has(item.mediaId))
    .slice(0, 8)
    .map((item) => ({ text: String(item.text).trim().slice(0, 180), mediaId: item.mediaId }));
  const copyText = (text, max) => String(text || "").trim().slice(0, max);
  const copyItems = (items, maxItems) => (Array.isArray(items) ? items : [])
    .slice(0, maxItems)
    .map((item) => ({
      heading: copyText(item?.heading, 180),
      body: copyText(item?.body, 700)
    }))
    .filter((item) => item.heading || item.body);
  const sectionCopy = {
    productBenefits: (Array.isArray(value?.sectionCopy?.productBenefits) ? value.sectionCopy.productBenefits : [])
      .slice(0, 4).map((item) => copyText(item, 180)).filter(Boolean),
    imageWithTextBody: copyText(value?.sectionCopy?.imageWithTextBody, 1200),
    timelineIntro: copyText(value?.sectionCopy?.timelineIntro, 700),
    timelineSteps: copyItems(value?.sectionCopy?.timelineSteps, 4),
    benefitsIntro: copyText(value?.sectionCopy?.benefitsIntro, 700),
    benefitItems: copyItems(value?.sectionCopy?.benefitItems, 6)
  };
  const hasSectionCopy = sectionCopy.productBenefits.length
    || sectionCopy.imageWithTextBody
    || sectionCopy.timelineIntro
    || sectionCopy.timelineSteps.length
    || sectionCopy.benefitsIntro
    || sectionCopy.benefitItems.length;
  const normalizedCopySlots = normalizeCopySlots(value, sectionCopy);
  return Object.freeze({
    summary,
    claims: Object.freeze(claims),
    visualObservations: Object.freeze(visualObservations),
    sectionCopy: Object.freeze(hasSectionCopy ? {
      productBenefits: Object.freeze(sectionCopy.productBenefits),
      imageWithTextBody: sectionCopy.imageWithTextBody,
      timelineIntro: sectionCopy.timelineIntro,
      timelineSteps: Object.freeze(sectionCopy.timelineSteps),
      benefitsIntro: sectionCopy.benefitsIntro,
      benefitItems: Object.freeze(sectionCopy.benefitItems)
    } : {}),
    copy_slots_v1: normalizedCopySlots
  });
}

async function researchProduct(product, media, { idioma = "es", angulo = "" } = {}) {
  const mediaIds = media.map((item) => item.media_id);
  const content = media.slice(0, 8).flatMap((item) => [
    { type: "text", text: `media_id: ${item.media_id}` },
    { type: "image", source: { type: "url", url: mediaForAnalysis(item.url) } }
  ]);
  content.push({ type: "text", text: JSON.stringify({
    idioma,
    angulo,
    product: { title: product.title, description: product.description, vendor: product.vendor }
  }) });
  const system = [
    "Analizás un producto para completar únicamente el contenido editable de una sección de producto ya diseñada.",
    "El Liquid, el CSS, el JavaScript, la estructura, los precios, las variantes y el carrito están fuera de tu alcance.",
    "summary debe ser copy comercial sobrio basado en la descripción de Shopify y en observaciones visuales conservadoras.",
    "copy_slots_v1 contiene únicamente palabras para slots editoriales declarados por la composición. Cada target debe indicar section_id, occurrence, field y, si corresponde, block_type y block_index.",
    "copy_slots_v1 debe tener version 1 y una lista slots. Cada slot debe incluir target, value y evidence; evidence sólo puede citar shopify_description, shopify_media o shopify_product.",
    "Ejemplo de target permitido: {section_id:\"image-with-timeline\", occurrence:1, block_type:\"timeline_step\", block_index:0, field:\"heading\"}. Nunca uses un target para precio, variante, imagen, carrito, rating o estilos.",
    "sectionCopy es un formato legado compatible; si usás copy_slots_v1 no lo repitas.",
    "No cambies el título real del producto, imágenes, precio, variantes, estructura, nombres de bloques, reseñas, ratings, descuentos, envío, garantía ni métodos de pago.",
    "Si un slot no puede escribirse con respaldo suficiente, dejalo vacío u omitilo. No rellenes con frases genéricas que parezcan hechos del producto.",
    "Un claim sólo puede entrar en claims si está expresamente respaldado por la descripción de Shopify; source debe ser shopify_description.",
    "Las imágenes sólo permiten describir color, forma, piezas visibles, acabado y contexto. Nunca prueban materiales, resultados, certificaciones, salud, rendimiento, popularidad ni calidad.",
    "No inventes reseñas, estrellas, clientes, descuentos, escasez, entrega, garantía o métodos de pago.",
    "Cada observación visual debe citar el media_id exacto que la respalda. Respondé sólo el JSON solicitado."
  ].join("\n\n");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1800,
    system,
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content }]
  }, { timeout: TIMEOUT, maxRetries: 0 });
  const text = response.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("La investigación del producto no devolvió contenido.");
  return { research: validateResearch(parseJson(text), mediaIds), uso: response.usage };
}

module.exports = Object.freeze({ OUTPUT_SCHEMA, researchProduct, validateResearch });
