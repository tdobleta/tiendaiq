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
  })
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
      title: String(hero.titulo || source.titulo_crudo || ""),
      description: String(hero.subtitulo || source.descripcion_cruda || ""),
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

module.exports = Object.freeze({ PINZA_PAGEPILOT_V1, isHttpsUrl, fixedTemplateViewModel });
