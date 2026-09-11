"use strict";

// Una composición es el contrato de una página, no una vista de demostración.
// Mantenerla fuera del editor permite que toda página nueva nazca con el mismo
// orden reproducible y que las secciones sigan siendo independientes después.
const DEFAULT_SECTION_PAGE_COMPOSITION_V1 = Object.freeze([
  Object.freeze({ id: "product-information", version: 1, required: true }),
  Object.freeze({ id: "image-with-text", version: 1 }),
  Object.freeze({ id: "image-with-timeline", version: 1 }),
  Object.freeze({ id: "testimonios-con-imagenes", version: 1 })
]);

// La demostración expone una instancia adicional de una composición reusable
// para validar el flujo completo sin alterar todavía la plantilla de producción.
const DEMO_SECTION_PAGE_COMPOSITION_V1 = Object.freeze([
  ...DEFAULT_SECTION_PAGE_COMPOSITION_V1.slice(0, 3),
  Object.freeze({ id: "image-with-benefits", version: 1 }),
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[3]
]);

const COMPOSITIONS = Object.freeze({
  "section-page-v1": DEFAULT_SECTION_PAGE_COMPOSITION_V1
});

function resolvePageComposition(key = "section-page-v1") {
  const composition = COMPOSITIONS[key];
  if (!composition) throw new Error(`La composición de página "${key}" no existe`);
  return composition;
}

module.exports = Object.freeze({
  COMPOSITIONS,
  DEFAULT_SECTION_PAGE_COMPOSITION_V1,
  DEMO_SECTION_PAGE_COMPOSITION_V1,
  resolvePageComposition
});
