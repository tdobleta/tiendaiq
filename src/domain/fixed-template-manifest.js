"use strict";

// A fixed template is deliberately not a page-builder document. The source
// HTML/CSS is a versioned visual artifact; this manifest only names the values
// that may be injected into the already-defined slots.
const PINZA_PAGEPILOT_V1 = Object.freeze({
  id: "tiendaiq/pinza-pagepilot",
  version: 1,
  rendererKey: "pinza-pagepilot",
  sourceSha256: "1b401ccb2004bdef955d1c0a63c858e48860e2d78c27bf9378758156d00bfc93",
  sourceFile: "tiq-pinzapilot-v1.html",
  slots: Object.freeze({
    product: Object.freeze(["title", "description", "price", "compareAtPrice", "currency", "variantId", "media"]),
    content: Object.freeze(["hero", "timeline", "feature", "faq", "recommendations"]),
    evidence: Object.freeze(["reviews", "ugc", "policies", "comparison", "logos", "statistics", "payments"])
  }),
  // `slots` are values the frozen renderer may consume. They are deliberately
  // broader than merchant editing: product identity is Shopify-owned and
  // evidence must arrive through an attestation, never through the browser.
  merchantEditablePaths: Object.freeze([
    "facetas.hero.bullets[].fuerte",
    "facetas.hero.bullets[].resto",
    "facetas.faq.titular",
    "facetas.faq.items[].pregunta",
    "facetas.faq.items[].respuesta"
  ])
});

// El workspace de edición puede tener una experiencia rica, pero no convierte
// una plantilla fija en un page builder. Este contrato es la frontera que una
// futura API de editor puede exponer al admin: qué se puede editar, qué viene
// de Shopify y qué evidencia permanece apagada hasta ser verificable.
const PINZA_PAGEPILOT_EDITOR_CONTRACT_V1 = Object.freeze({
  template: Object.freeze({ id: PINZA_PAGEPILOT_V1.id, version: PINZA_PAGEPILOT_V1.version }),
  mode: "fixed-slots",
  permissions: Object.freeze({
    structure: false,
    layout: false,
    customCss: false,
    sourceBoundProduct: true,
    evidenceRequiresAttestation: true
  }),
  groups: Object.freeze([
    Object.freeze({
      id: "shopify-product",
      label: "Datos de Shopify",
      editable: false,
      slots: Object.freeze(["product.title", "product.description", "product.price", "product.variantId", "product.media"])
    }),
    Object.freeze({
      id: "approved-content",
      label: "Contenido autorizado",
      editable: true,
      slots: PINZA_PAGEPILOT_V1.merchantEditablePaths
    }),
    Object.freeze({
      id: "evidence",
      label: "Evidencia",
      editable: false,
      requiresAttestation: true,
      slots: Object.freeze(["evidence.reviews", "evidence.ugc", "evidence.policies", "evidence.comparison", "evidence.logos", "evidence.statistics"])
    })
  ])
});

function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function mediaFromPage(data = {}, urls = {}) {
  const gallery = Array.isArray(data?.facetas?.hero?.galeria) ? data.facetas.hero.galeria : [];
  return gallery
    .map((id) => ({ id, url: urls[id] }))
    .filter((media) => isHttpsUrl(media.url));
}

function fixedTemplateViewModel(data = {}, urls = {}, options = {}) {
  const source = data?.fuente || {};
  const global = data?.global || {};
  const hero = data?.facetas?.hero || {};
  const hasVerifiedClaims = data?.compliance?.claims_verified === true;

  return Object.freeze({
    template: Object.freeze({ id: PINZA_PAGEPILOT_V1.id, version: PINZA_PAGEPILOT_V1.version }),
    product: Object.freeze({
      // Product identity remains catalog-owned. A generated/persisted draft
      // cannot replace the title or description visible to a buyer.
      title: String(source.titulo_crudo || hero.titulo || ""),
      description: String(source.descripcion_cruda || hero.subtitulo || ""),
      price: source.precio ?? null,
      compareAtPrice: source.precio_comparativo ?? null,
      currency: String(source.moneda || ""),
      variantId: options.variantId == null ? null : String(options.variantId),
      money: options.money == null ? null : String(options.money),
      media: Object.freeze(mediaFromPage(data, urls))
    }),
    content: Object.freeze({
      hero: Object.freeze({ bullets: Array.isArray(hero.bullets) ? hero.bullets : [] }),
      timeline: data?.facetas?.texto_img_1 || null,
      feature: data?.facetas?.texto_img_2 || data?.facetas?.iconos || null,
      faq: data?.facetas?.faq || null,
      recommendations: data?.facetas?.recomendados || null,
      cta: String(global.cta || "Agregar al carrito")
    }),
    evidence: Object.freeze({
      // Never convert a declared URL/string into proof. Each presentation
      // module remains off until the published page has an actual attestation.
      reviews: hasVerifiedClaims && Boolean(data?.compliance?.review_source),
      ugc: hasVerifiedClaims && Boolean(data?.compliance?.ugc_source),
      policies: hasVerifiedClaims && Boolean(data?.compliance?.policy_source),
      comparison: hasVerifiedClaims && Boolean(data?.compliance?.comparison_source),
      logos: hasVerifiedClaims && Boolean(data?.compliance?.logo_source),
      statistics: hasVerifiedClaims && Boolean(data?.compliance?.statistics_source),
      payments: false
    })
  });
}

module.exports = Object.freeze({
  PINZA_PAGEPILOT_V1,
  PINZA_PAGEPILOT_EDITOR_CONTRACT_V1,
  isHttpsUrl,
  fixedTemplateViewModel
});
