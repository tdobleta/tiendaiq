"use strict";

const { isDeepStrictEqual } = require("node:util");
const { resolveStoredTemplate } = require("./template-registry");
const { PINZA_PAGEPILOT_V1, PILOTO_PINZA_PAGEPILOT_V1, PILOTO_PDP_01_V1 } = require("./fixed-template-manifest");
const { hashSource, validatePdp01, validatePdp01Editor, defaultPdp01Editor, Pdp01ValidationError } = require("../piloto/pdp01-contract");

class FixedTemplateEditError extends Error {
  constructor(message) {
    super(message);
    this.name = "FixedTemplateEditError";
    this.code = "FIXED_TEMPLATE_EDIT_INVALID";
    this.status = 422;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function at(object, path) {
  return path.reduce((current, key) => current == null ? undefined : current[key], object);
}

function put(object, path, value) {
  let current = object;
  for (let index = 0; index < path.length - 1; index += 1) current = current[path[index]];
  current[path.at(-1)] = value;
}

function assertText(value, label, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new FixedTemplateEditError(`${label} debe ser texto de hasta ${maxLength} caracteres`);
  }
}

function pinzaEditablePaths(persistedData) {
  const paths = [];
  const bullets = persistedData?.facetas?.hero?.bullets;
  if (Array.isArray(bullets)) {
    bullets.forEach((bullet, index) => {
      if (!isPlainObject(bullet) || typeof bullet.fuerte !== "string" || typeof bullet.resto !== "string") return;
      paths.push({ path: ["facetas", "hero", "bullets", index, "fuerte"], label: "El título de un beneficio", maxLength: 280 });
      paths.push({ path: ["facetas", "hero", "bullets", index, "resto"], label: "El detalle de un beneficio", maxLength: 560 });
    });
  }

  const faq = persistedData?.facetas?.faq;
  if (isPlainObject(faq) && typeof faq.titular === "string") {
    paths.push({ path: ["facetas", "faq", "titular"], label: "El título de preguntas frecuentes", maxLength: 280 });
  }
  if (isPlainObject(faq) && Array.isArray(faq.items)) {
    faq.items.forEach((item, index) => {
      if (!isPlainObject(item) || typeof item.pregunta !== "string" || typeof item.respuesta !== "string") return;
      paths.push({ path: ["facetas", "faq", "items", index, "pregunta"], label: "Una pregunta frecuente", maxLength: 560 });
      paths.push({ path: ["facetas", "faq", "items", index, "respuesta"], label: "Una respuesta frecuente", maxLength: 5000 });
    });
  }
  return paths;
}

function isPinzaTemplate(persistedData) {
  const template = resolveStoredTemplate(persistedData?.global || {});
  return [PINZA_PAGEPILOT_V1, PILOTO_PINZA_PAGEPILOT_V1].some(
    (candidate) => template?.id === candidate.id && template.version === candidate.version
  );
}

function isPdp01Template(persistedData) {
  const template = resolveStoredTemplate(persistedData?.global || {});
  return template?.id === PILOTO_PDP_01_V1.id && template.version === PILOTO_PDP_01_V1.version;
}

function applyPdp01Edit({ persistedData, submittedData }) {
  const persisted = clone(persistedData);
  const submitted = clone(submittedData);
  // Source and structural slots are immutable. Start with a byte-for-byte
  // comparison after replacing the sanctioned generated content subtree.
  const submittedDocument = submitted?.piloto_pdp_01;
  const persistedDocument = persisted?.piloto_pdp_01;
  if (!isPlainObject(submittedDocument) || !isPlainObject(persistedDocument)) throw new FixedTemplateEditError("La plantilla Piloto 01 requiere su contrato de contenido");
  // Migrate documents created before the section editor existed.  The
  // migration is deterministic and only adds the explicitly whitelisted
  // editor descriptor; it never unlocks source fields or commerce data.
  persistedDocument.editor = defaultPdp01Editor(persistedDocument.editor);
  submittedDocument.editor = defaultPdp01Editor(submittedDocument.editor);
  // First prove the caller did not alter anything outside the fixed document.
  submitted.piloto_pdp_01 = persistedDocument;
  if (!isDeepStrictEqual(submitted, persisted)) throw new FixedTemplateEditError("Piloto 01 sólo permite editar el copy autorizado; producto, medios, packs y evidencia se protegen automáticamente");
  const proposed = clone(submittedDocument);
  const comparisonDocument = clone(proposed);
  const persistedContent = persistedDocument.content;
  const comparisonContent = comparisonDocument.content || {};
  // The editor descriptor is mutable through its own schema.  Validate it
  // before masking the content tree so arbitrary HTML/CSS cannot piggyback on
  // a normal copy update.
  try { comparisonDocument.editor = validatePdp01Editor(proposed.editor); }
  catch (error) {
    if (error instanceof Pdp01ValidationError) throw new FixedTemplateEditError(error.message);
    throw error;
  }
  const comparisonEditor = clone(comparisonDocument.editor);
  if ((comparisonContent.hero?.bullets || []).length !== (persistedContent.hero?.bullets || []).length ||
      (comparisonContent.timeline?.steps || []).length !== (persistedContent.timeline?.steps || []).length ||
      (comparisonContent.faq?.items || []).length !== (persistedContent.faq?.items || []).length) {
    throw new FixedTemplateEditError("Piloto 01 no permite cambiar la estructura de sus secciones");
  }
  for (const [section, field] of [["quick", "items"], ["stories", "cards"]]) {
    const persistedItems = persistedContent?.[section]?.[field];
    const submittedItems = comparisonContent?.[section]?.[field];
    if (Array.isArray(persistedItems) && (!Array.isArray(submittedItems) || submittedItems.length !== persistedItems.length)) {
      throw new FixedTemplateEditError("Piloto 01 no permite cambiar la estructura de sus secciones");
    }
  }
  // Mask exactly the authorized leaves and compare every other byte. This is
  // deliberately independent from the later schema validation: a valid pack
  // is still not an editable pack.
  comparisonContent.hero.claim = persistedContent.hero.claim;
  comparisonContent.hero.bullets = clone(persistedContent.hero.bullets);
  comparisonContent.offer.heading = persistedContent.offer.heading;
  if (persistedContent.quick) comparisonContent.quick.items = clone(persistedContent.quick.items);
  comparisonContent.why.eyebrow = persistedContent.why.eyebrow;
  comparisonContent.why.heading = persistedContent.why.heading;
  comparisonContent.why.body = persistedContent.why.body;
  comparisonContent.why.points = clone(persistedContent.why.points);
  if (persistedContent.stories) {
    comparisonContent.stories.heading = persistedContent.stories.heading;
    comparisonContent.stories.intro = persistedContent.stories.intro;
    comparisonContent.stories.cards = clone(persistedContent.stories.cards);
  }
  comparisonContent.timeline.heading = persistedContent.timeline.heading;
  comparisonContent.timeline.intro = persistedContent.timeline.intro;
  comparisonContent.timeline.steps.forEach((step, index) => {
    step.heading = persistedContent.timeline.steps[index].heading;
    step.body = persistedContent.timeline.steps[index].body;
  });
  comparisonContent.faq.heading = persistedContent.faq.heading;
  if (Object.hasOwn(persistedContent.faq, "intro")) comparisonContent.faq.intro = persistedContent.faq.intro;
  comparisonContent.faq.items.forEach((item, index) => {
    item.question = persistedContent.faq.items[index].question;
    item.answer = persistedContent.faq.items[index].answer;
  });
  if (persistedContent.closing) comparisonContent.closing = clone(persistedContent.closing);
  if (persistedContent.newsletter) comparisonContent.newsletter = clone(persistedContent.newsletter);
  comparisonDocument.editor = persistedDocument.editor;
  if (!isDeepStrictEqual(comparisonDocument, persistedDocument)) {
    throw new FixedTemplateEditError("Piloto 01 sólo permite editar el copy autorizado; producto, medios, packs y evidencia se protegen automáticamente");
  }
  // Then prove that only explicit text leaves changed.  Starting from the
  // persisted content prevents a browser payload from changing packs, media,
  // evidence, source snapshots or the immutable label of a timeline step.
  const nextContent = clone(persistedDocument.content);
  nextContent.hero.claim = proposed.content?.hero?.claim;
  nextContent.hero.bullets = proposed.content?.hero?.bullets;
  nextContent.offer.heading = proposed.content?.offer?.heading;
  if (nextContent.quick) nextContent.quick.items = proposed.content?.quick?.items;
  nextContent.why.eyebrow = proposed.content?.why?.eyebrow;
  nextContent.why.heading = proposed.content?.why?.heading;
  nextContent.why.body = proposed.content?.why?.body;
  nextContent.why.points = proposed.content?.why?.points;
  if (nextContent.stories) {
    nextContent.stories.heading = proposed.content?.stories?.heading;
    nextContent.stories.intro = proposed.content?.stories?.intro;
    nextContent.stories.cards = proposed.content?.stories?.cards;
  }
  nextContent.timeline.heading = proposed.content?.timeline?.heading;
  nextContent.timeline.intro = proposed.content?.timeline?.intro;
  (nextContent.timeline.steps || []).forEach((step, index) => {
    step.heading = proposed.content?.timeline?.steps?.[index]?.heading;
    step.body = proposed.content?.timeline?.steps?.[index]?.body;
  });
  nextContent.faq.heading = proposed.content?.faq?.heading;
  if (Object.hasOwn(nextContent.faq, "intro")) nextContent.faq.intro = proposed.content?.faq?.intro;
  nextContent.faq.items = proposed.content?.faq?.items;
  if (nextContent.closing) nextContent.closing = proposed.content?.closing;
  if (nextContent.newsletter) nextContent.newsletter = proposed.content?.newsletter;
  const next = clone(persisted);
  next.piloto_pdp_01 = { ...persistedDocument, content: nextContent, evidence: clone(persistedDocument.evidence), editor: comparisonEditor };
  try {
    next.piloto_pdp_01 = validatePdp01(next.piloto_pdp_01, { origin: "merchant" });
  } catch (error) {
    if (error instanceof Pdp01ValidationError) throw new FixedTemplateEditError(error.message);
    throw error;
  }
  return next;
}

// Evidencia y archivos del merchant no viajan por el PUT genérico del editor.
// Tienen una vía estrecha propia, validada con el mismo contrato, para que una
// pantalla no pueda desbloquearse simplemente enviando más campos en `data`.
function applyPdp01Evidence({ persistedData, evidence }) {
  if (!isPdp01Template(persistedData)) throw new FixedTemplateEditError("La página no usa la plantilla Piloto 01");
  if (!isPlainObject(evidence)) throw new FixedTemplateEditError("La evidencia debe ser un objeto");
  for (const [slot, value] of Object.entries(evidence)) {
    if (slot === "testimonials") {
      if (!Array.isArray(value?.items) || !value.items.length) throw new FixedTemplateEditError("Las reseñas deben incluir al menos una tarjeta completa");
      for (const item of value.items) {
        if (!isPlainObject(item?.source) || !item.source.kind || !item.source.reference) {
          throw new FixedTemplateEditError("Cada reseña necesita sus datos completos");
        }
      }
      continue;
    }
    if (!isPlainObject(value?.source) || !value.source.kind || !value.source.reference) {
      throw new FixedTemplateEditError(`La evidencia ${slot} requiere una fuente verificable`);
    }
  }
  const next = clone(persistedData);
  next.piloto_pdp_01.evidence = clone(evidence || {});
  try {
    next.piloto_pdp_01 = validatePdp01(next.piloto_pdp_01, { origin: "merchant" });
  } catch (error) {
    if (error instanceof Pdp01ValidationError) throw new FixedTemplateEditError(error.message);
    throw error;
  }
  return next;
}

function attachPdp01MerchantMedia({ persistedData, mediaId }) {
  if (!isPdp01Template(persistedData)) return persistedData;
  if (!/^gid:\/\/shopify\/MediaImage\/\d+$/.test(String(mediaId || ""))) {
    throw new FixedTemplateEditError("La imagen subida no devolvió una media Shopify válida");
  }
  const next = clone(persistedData);
  const source = next.piloto_pdp_01.source_fields;
  source.media_ids = [...new Set([...(source.media_ids || []), String(mediaId)])];
  next.piloto_pdp_01.source_hash = hashSource(source);
  try {
    next.piloto_pdp_01 = validatePdp01(next.piloto_pdp_01, { origin: "merchant" });
  } catch (error) {
    if (error instanceof Pdp01ValidationError) throw new FixedTemplateEditError(error.message);
    throw error;
  }
  return next;
}

// A fixed template is not a generic document editor. Start from persisted
// data, permit a narrowly declared set of text leaves, and compare the rest
// byte-for-byte as structured data. The persisted descriptor selects policy;
// an incoming payload cannot opt itself into a looser template.
function applyTemplateBoundEdit({ persistedData, submittedData }) {
  if (!isPlainObject(submittedData)) {
    throw new FixedTemplateEditError("La página editada debe ser un objeto estructurado");
  }
  if (isPdp01Template(persistedData)) return applyPdp01Edit({ persistedData, submittedData });
  if (!isPinzaTemplate(persistedData)) return submittedData;

  const persisted = clone(persistedData);
  const submitted = clone(submittedData);
  const editable = pinzaEditablePaths(persisted);
  const comparison = clone(submitted);

  for (const entry of editable) {
    const proposed = at(submitted, entry.path);
    assertText(proposed, entry.label, entry.maxLength);
    put(comparison, entry.path, at(persisted, entry.path));
  }

  if (!isDeepStrictEqual(comparison, persisted)) {
    throw new FixedTemplateEditError("Esta plantilla fija sólo permite editar sus campos de contenido autorizados");
  }

  const next = clone(persisted);
  for (const entry of editable) put(next, entry.path, at(submitted, entry.path));
  return next;
}

module.exports = Object.freeze({
  FixedTemplateEditError,
  pinzaEditablePaths,
  isPdp01Template,
  applyPdp01Evidence,
  attachPdp01MerchantMedia,
  applyTemplateBoundEdit
});
