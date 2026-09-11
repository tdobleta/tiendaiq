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
    }
  }
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
    } : {})
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
    "sectionCopy contiene únicamente palabras para slots editoriales permitidos: beneficios, cuerpo de Imagen con texto, introducción y etapas de Timeline, e introducción y tarjetas de Beneficios.",
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
