"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const timeline = require("../src/section-pipeline/image-with-timeline-v1");
const { createProductPage, instantiateSection, validatePage } = require("../src/section-pipeline/page-pipeline");
const { renderSectionPage } = require("../src/section-pipeline/preview-renderer");

test("Imagen con línea de tiempo es una composición reutilizable con etapas ordenables", () => {
  const instance = instantiateSection({ id: "image-with-timeline", version: 1 });
  assert.equal(instance.blocks.length, 3);
  assert.equal(new Set(instance.blocks.map((block) => block.id)).size, 3);
  assert.equal(timeline.capabilities.editableStructure, true);
  assert.equal(timeline.editor.blocks[0].type, "timeline_step");
  assert.ok(timeline.schema.settings.some((setting) => setting.id === "mobile_media_position"));
  assert.ok(timeline.schema.blocks[0].settings.some((setting) => setting.id === "body" && setting.type === "richtext"));
});

test("la adaptación de la línea de tiempo usa la imagen real y sólo slots de copy", async () => {
  const product = {
    id: "gid://shopify/Product/77",
    title: "Voltra Blade Pro",
    media: [{ url: "https://cdn.shopify.com/files/voltra.jpg", alt: "Voltra Blade Pro" }]
  };
  const instance = timeline.adapt(product, {
    summary: "Una rutina simple para el cuidado diario.",
    sectionCopy: {
      timelineIntro: "Una progresión pensada para el cuidado diario.",
      timelineSteps: [
        { heading: "Prepará tu rutina", body: "Empezá con un uso sencillo." },
        { heading: "Mantené la constancia", body: "SeguÍ el ritmo indicado." }
      ]
    }
  });
  assert.equal(instance.settings.image, "https://cdn.shopify.com/files/voltra.jpg");
  assert.equal(instance.settings.image_alt, "Voltra Blade Pro");
  assert.match(instance.settings.intro, /progresión pensada/);
  assert.equal(instance.blocks[0].settings.heading, "Prepará tu rutina");
  assert.match(instance.blocks[1].settings.body, /SeguÍ el ritmo/);
  assert.equal(instance.blocks.length, 3);
});

test("la línea de tiempo se renderiza con imagen, etapas y accesibilidad", async () => {
  const page = createProductPage({ product: { id: "gid://shopify/Product/88", title: "Producto de prueba" } });
  const section = {
    id: "section-timeline",
    label: "Imagen con línea de tiempo",
    definition: { id: timeline.id, version: timeline.version, sourceSha256: timeline.sourceSha256 },
    instance: timeline.adapt({ title: "Producto de prueba", media: [{ url: "https://cdn.shopify.com/files/recorrido.jpg" }] }, { summary: "Una guía progresiva." })
  };
  const html = await renderSectionPage(validatePage({ ...page, sections: [section] }));
  assert.match(html, /recorrido\.jpg/);
  assert.match(html, /Una guía progresiva/);
  assert.match(html, /Etapas del recorrido/);
  assert.match(html, /data-tiq-block-id/);
});
