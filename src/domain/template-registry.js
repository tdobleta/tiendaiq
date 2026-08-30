"use strict";

// Registro de las plantillas de página que el producto conoce. Es una frontera
// de dominio, no un catálogo visual: el editor y el storefront migrarán a este
// contrato en pasos posteriores. Mientras tanto conserva `global.estilo` como
// alias para que las páginas ya publicadas no cambien de forma.
const TEMPLATE_REGISTRY = Object.freeze([
  Object.freeze({
    id: "tiendaiq/classic",
    version: 1,
    legacyStyle: "clasico",
    rendererKey: "classic",
    status: "active"
  }),
  Object.freeze({
    id: "tiendaiq/premium",
    version: 1,
    legacyStyle: "premium",
    rendererKey: "premium",
    status: "active"
  }),
  Object.freeze({
    id: "tiendaiq/performance-story",
    version: 1,
    legacyStyle: "performance-story",
    rendererKey: "performance-story",
    status: "active"
  }),
  // A fixed visual artifact imported from a merchant-provided source. Unlike
  // the older PagePilot aliases below, this is an actively maintained TiendaIQ
  // contract: only named data slots may change its frozen structure.
  Object.freeze({
    id: "tiendaiq/pinza-pagepilot",
    version: 1,
    legacyStyle: "pinza-pagepilot",
    rendererKey: "pinza-pagepilot",
    status: "frozen"
  }),
  // The only template offered for new Piloto product pages. Its source lives
  // in template-sources and the storefront only injects declared slots.
  Object.freeze({
    id: "piloto/pinza-pagepilot",
    version: 1,
    legacyStyle: "piloto-pinza",
    rendererKey: "piloto-pinza",
    status: "active"
  }),
  Object.freeze({
    id: "legacy/pagepilot",
    version: 1,
    legacyStyle: "pagepilot",
    rendererKey: "pagepilot",
    status: "frozen"
  }),
  Object.freeze({
    id: "legacy/pagepilot-blue",
    version: 1,
    legacyStyle: "pagepilot-blue",
    rendererKey: "pagepilot-blue",
    status: "frozen"
  })
]);

class TemplateContractError extends Error {
  constructor(message) {
    super(message);
    this.code = "PAGE_TEMPLATE_INVALID";
    this.status = 400;
  }
}

function descriptor(entry) {
  return Object.freeze({ id: entry.id, version: entry.version });
}

function byLegacyStyle(style) {
  return TEMPLATE_REGISTRY.find((entry) => entry.legacyStyle === style) || null;
}

function byDescriptor(value) {
  if (!value || typeof value !== "object") return null;
  return TEMPLATE_REGISTRY.find(
    (entry) => entry.id === value.id && entry.version === value.version
  ) || null;
}

// Las páginas guardadas antes de este registro sólo tienen `global.estilo`.
// Resolverlas no las reescribe ni les agrega metadata: la migración sólo se
// hará al editar/publicar con un contrato posterior y probado.
function resolveStoredTemplate(global = {}) {
  const fromDescriptor = byDescriptor(global.template);
  if (fromDescriptor) return fromDescriptor;
  if (typeof global.estilo === "string" && global.estilo.trim()) {
    return byLegacyStyle(global.estilo.trim());
  }
  return byLegacyStyle("clasico");
}

// Las entradas nuevas no aceptan strings desconocidos. Antes este caso caía
// silenciosamente a Clásico después de llamar al proveedor de IA, ocultando un
// error de producto y pudiendo gastar una generación que no correspondía.
function resolveTemplateForCreation(style = "clasico") {
  const normalized = typeof style === "string" && style.trim() ? style.trim() : "clasico";
  const entry = byLegacyStyle(normalized);
  if (!entry) throw new TemplateContractError("La plantilla solicitada no está soportada");
  // "frozen" conserva compatibilidad de lectura para páginas históricas, pero
  // no es una opción comercial ni puede iniciar trabajos nuevos. Así evitamos
  // que una generación nueva herede superficies de contenido que ya no
  // mantenemos ni certificamos.
  if (entry.status !== "active") {
    throw new TemplateContractError("La plantilla solicitada ya no está disponible para páginas nuevas");
  }
  return entry;
}

function templateMetadata(entry) {
  if (!entry || !TEMPLATE_REGISTRY.includes(entry)) {
    throw new TemplateContractError("La plantilla debe pertenecer al registro");
  }
  return Object.freeze({
    template: descriptor(entry),
    legacyStyle: entry.legacyStyle,
    rendererKey: entry.rendererKey,
    status: entry.status
  });
}

module.exports = Object.freeze({
  TEMPLATE_REGISTRY,
  TemplateContractError,
  resolveStoredTemplate,
  resolveTemplateForCreation,
  templateMetadata
});
