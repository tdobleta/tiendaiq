"use strict";

const { isDeepStrictEqual } = require("node:util");
const { resolveStoredTemplate } = require("./template-registry");
const { PINZA_PAGEPILOT_V1 } = require("./fixed-template-manifest");

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
  return template?.id === PINZA_PAGEPILOT_V1.id && template.version === PINZA_PAGEPILOT_V1.version;
}

// A fixed template is not a generic document editor. Start from persisted
// data, permit a narrowly declared set of text leaves, and compare the rest
// byte-for-byte as structured data. The persisted descriptor selects policy;
// an incoming payload cannot opt itself into a looser template.
function applyTemplateBoundEdit({ persistedData, submittedData }) {
  if (!isPlainObject(submittedData)) {
    throw new FixedTemplateEditError("La página editada debe ser un objeto estructurado");
  }
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
  applyTemplateBoundEdit
});
