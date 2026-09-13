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

// Semilla deliberadamente mínima para validar el editor con una página nueva.
// La composición completa permanece disponible como contrato histórico, pero
// no se ofrece en el flujo comercial mientras se certifican las interacciones
// de agregar, anidar y reordenar secciones.
const SECTION_PAGE_BASE_COMPOSITION_V1 = Object.freeze([
  Object.freeze({ id: "product-information", version: 1, required: true })
]);

// La demostración expone una instancia adicional de una composición reusable
// para validar el flujo completo sin alterar todavía la plantilla de producción.
const DEMO_SECTION_PAGE_COMPOSITION_V1 = Object.freeze([
  ...DEFAULT_SECTION_PAGE_COMPOSITION_V1.slice(0, 3),
  Object.freeze({ id: "image-with-benefits", version: 1 }),
  Object.freeze({ id: "benefits-spotlight", version: 1 }),
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[3]
]);

// Catálogo inicial de composiciones comerciales. Cada opción reutiliza las
// mismas secciones versionadas del editor, pero cambia el orden narrativo de
// la página. Esto permite que "Plantilla" sea una decisión real del merchant
// y no una tarjeta visual que termina generando siempre el mismo documento.
const SECTION_PAGE_SOCIAL_COMPOSITION_V1 = Object.freeze([
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[0],
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[3],
  Object.freeze({ id: "reviews-carousel", version: 1 }),
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[1]
]);

const SECTION_PAGE_BENEFITS_COMPOSITION_V1 = Object.freeze([
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[0],
  Object.freeze({ id: "image-with-benefits", version: 1 }),
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[2],
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[3]
]);

const SECTION_PAGE_STORY_COMPOSITION_V1 = Object.freeze([
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[0],
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[1],
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[2],
  Object.freeze({ id: "image-with-benefits", version: 1 }),
  Object.freeze({ id: "reviews-carousel", version: 1 }),
  DEFAULT_SECTION_PAGE_COMPOSITION_V1[3]
]);

const COMPOSITIONS = Object.freeze({
  "section-page-v1": DEFAULT_SECTION_PAGE_COMPOSITION_V1,
  "section-page-base-v1": SECTION_PAGE_BASE_COMPOSITION_V1,
  "section-page-social-v1": SECTION_PAGE_SOCIAL_COMPOSITION_V1,
  "section-page-benefits-v1": SECTION_PAGE_BENEFITS_COMPOSITION_V1,
  "section-page-story-v1": SECTION_PAGE_STORY_COMPOSITION_V1
});

function resolvePageComposition(key = "section-page-v1") {
  const composition = COMPOSITIONS[key];
  if (!composition) throw new Error(`La composición de página "${key}" no existe`);
  return composition;
}

module.exports = Object.freeze({
  COMPOSITIONS,
  DEFAULT_SECTION_PAGE_COMPOSITION_V1,
  SECTION_PAGE_BASE_COMPOSITION_V1,
  DEMO_SECTION_PAGE_COMPOSITION_V1,
  SECTION_PAGE_SOCIAL_COMPOSITION_V1,
  SECTION_PAGE_BENEFITS_COMPOSITION_V1,
  SECTION_PAGE_STORY_COMPOSITION_V1,
  resolvePageComposition
});
