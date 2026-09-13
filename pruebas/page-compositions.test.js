"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProductPage,
  editorRegistry,
  validatePage
} = require("../src/section-pipeline/page-pipeline");
const {
  DEFAULT_SECTION_PAGE_COMPOSITION_V1,
  SECTION_PAGE_BASE_COMPOSITION_V1,
  DEMO_SECTION_PAGE_COMPOSITION_V1,
  SECTION_PAGE_SOCIAL_COMPOSITION_V1,
  SECTION_PAGE_BENEFITS_COMPOSITION_V1,
  SECTION_PAGE_STORY_COMPOSITION_V1,
  resolvePageComposition
} = require("../src/section-pipeline/page-compositions");

const product = {
  id: "gid://shopify/Product/321",
  title: "Producto real de prueba",
  description: "Descripción del producto.",
  media: [{ id: "gid://shopify/MediaImage/321", url: "https://cdn.shopify.com/files/producto.jpg", alt: "Producto" }],
  variants: [{ id: "gid://shopify/ProductVariant/321", title: "Única", price: "40.00" }]
};

test("la plantilla real de página crea una composición versionada de secciones", () => {
  const page = createProductPage({ product, composition: "section-page-v1" });
  assert.deepEqual(
    page.sections.map((section) => section.definition.id),
    ["product-information", "image-with-text", "image-with-timeline", "testimonios-con-imagenes"]
  );
  assert.deepEqual(page.sections.map((section) => section.id), [
    "section-product-information",
    "section-image-with-text-1",
    "section-image-with-timeline-2",
    "section-testimonios-con-imagenes-3"
  ]);
  assert.equal(page.sections[1].instance.settings.heading, product.title);
  assert.equal(page.sections[2].instance.settings.image, product.media[0].url);
  assert.equal(page.sections[3].instance.blocks.length, 4);
  assert.equal(validatePage(page).sections.length, 4);
});

test("la plantilla base habilitada para nuevas pruebas nace con una sola sección", () => {
  const page = createProductPage({ product, composition: "section-page-base-v1" });
  assert.deepEqual(page.sections.map((section) => section.definition.id), ["product-information"]);
  assert.deepEqual(resolvePageComposition("section-page-base-v1"), SECTION_PAGE_BASE_COMPOSITION_V1);
});

test("el comportamiento anterior sigue disponible para páginas que piden una sola sección", () => {
  const page = createProductPage({ product });
  assert.equal(page.sections.length, 1);
  assert.equal(page.sections[0].definition.id, "product-information");
});

test("la composición publicada y el registro del editor comparten las mismas definiciones", () => {
  assert.deepEqual(resolvePageComposition("section-page-v1"), DEFAULT_SECTION_PAGE_COMPOSITION_V1);
  const ids = new Set(editorRegistry().map((entry) => entry.id));
  for (const section of DEFAULT_SECTION_PAGE_COMPOSITION_V1) assert.ok(ids.has(section.id));
});

test("las plantillas comerciales tienen composiciones distintas y válidas", () => {
  const cases = [
    ["section-page-social-v1", SECTION_PAGE_SOCIAL_COMPOSITION_V1],
    ["section-page-benefits-v1", SECTION_PAGE_BENEFITS_COMPOSITION_V1],
    ["section-page-story-v1", SECTION_PAGE_STORY_COMPOSITION_V1]
  ];
  for (const [key, expected] of cases) {
    assert.deepEqual(resolvePageComposition(key), expected);
    const page = createProductPage({ product, composition: key });
    assert.equal(page.sections[0].definition.id, "product-information");
    assert.ok(page.sections.length >= 4);
    assert.doesNotThrow(() => validatePage(page));
  }
});

test("la demostración carga una composición reusable adicional sin cambiar la plantilla real", () => {
  assert.deepEqual(DEMO_SECTION_PAGE_COMPOSITION_V1.map((section) => section.id), [
    "product-information", "image-with-text", "image-with-timeline", "image-with-benefits", "benefits-spotlight", "testimonios-con-imagenes"
  ]);
  assert.deepEqual(DEFAULT_SECTION_PAGE_COMPOSITION_V1.map((section) => section.id), [
    "product-information", "image-with-text", "image-with-timeline", "testimonios-con-imagenes"
  ]);
});
