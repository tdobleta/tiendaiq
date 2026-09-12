"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const reviews = require("../src/section-pipeline/reviews-carousel-v1");
const { instantiateSection, createProductPage, validatePage } = require("../src/section-pipeline/page-pipeline");
const { renderSectionPage } = require("../src/section-pipeline/preview-renderer");

test("el carrusel de reseñas es una composición reutilizable con bloques e imágenes Shopify", () => {
  const instance = instantiateSection({ id: "reviews-carousel", version: 1 });
  assert.equal(instance.blocks.length, 4);
  assert.equal(new Set(instance.blocks.map((block) => block.id)).size, 4);
  assert.equal(reviews.capabilities.editableStructure, true);
  assert.equal(reviews.contentSources.blocks.review.image, "shopify");
  assert.deepEqual(reviews.copySlots.blocks.review, ["quote"]);
  assert.match(fs.readFileSync(require.resolve("../src/section-pipeline/sources/reviews-carousel-v1/section.liquid"), "utf8"), /data-tiq-reviews-next/);
});

test("el carrusel de reseñas adapta sólo slots de copy autorizados", async () => {
  const instance = reviews.adapt({}, {
    sectionCopy: { reviewsIntro: "Una introducción específica.", reviewItems: [{ quote: "Me ayudó a sostener mi rutina." }] }
  });
  assert.match(instance.settings.intro, /Una introducción específica/);
  assert.equal(instance.blocks[0].settings.quote, "Me ayudó a sostener mi rutina.");
  const page = createProductPage({ product: { id: "gid://shopify/Product/201", title: "Producto de prueba" } });
  const document = validatePage({ ...page, sections: [{
    id: "section-reviews-carousel",
    label: reviews.schema.name,
    definition: { id: reviews.id, version: reviews.version, sourceSha256: reviews.sourceSha256 },
    instance
  }] });
  const html = await renderSectionPage(document);
  assert.match(html, /Una introducción específica/);
  assert.match(html, /Me ayudó a sostener mi rutina/);
});
