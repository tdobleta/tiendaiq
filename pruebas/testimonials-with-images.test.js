"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const testimonials = require("../src/section-pipeline/testimonials-with-images-v1");
const { instantiateSection, createProductPage, validatePage } = require("../src/section-pipeline/page-pipeline");
const { renderSectionPage } = require("../src/section-pipeline/preview-renderer");
const fs = require("node:fs");

test("Testimonios con imágenes es una sección reutilizable con bloques independientes", async () => {
  const instance = instantiateSection({ id: "testimonios-con-imagenes", version: 1 });
  assert.equal(instance.blocks.length, 4);
  assert.equal(new Set(instance.blocks.map((block) => block.id)).size, 4);
  assert.equal(testimonials.capabilities.editableStructure, true);
  assert.equal(testimonials.editor.blocks[0].type, "testimonial");
  assert.ok(testimonials.schema.settings.some((setting) => setting.id === "mobile_columns"));
  assert.ok(testimonials.schema.blocks[0].settings.some((setting) => setting.id === "image" && setting.type === "image_picker"));
});

test("los testimonios se renderizan con imagen, texto y controles del carrusel", async () => {
  const page = createProductPage({ product: { id: "gid://shopify/Product/99", title: "Producto de prueba" } });
  const section = {
    id: "section-testimonials",
    label: "Testimonios con imágenes",
    definition: { id: testimonials.id, version: testimonials.version, sourceSha256: testimonials.sourceSha256 },
    instance: instantiateSection({ id: testimonials.id, version: testimonials.version })
  };
  section.instance.blocks[0].settings.image = "https://cdn.shopify.com/files/testimonio-1.jpg";
  section.instance.blocks[0].settings.author = "Ana";
  section.instance.blocks[0].settings.review = "Una experiencia excelente.";
  const document = validatePage({ ...page, sections: [section] });
  const html = await renderSectionPage(document);
  assert.match(html, /testimonio-1\.jpg/);
  assert.match(html, /Una experiencia excelente/);
  assert.match(html, /data-tiq-testimonials-next/);
  assert.match(html, /data-tiq-block-id/);
});

test("el editor expone acciones reales para la estructura de bloques reutilizables", () => {
  const editor = fs.readFileSync(require.resolve("../app/section-editor.js"), "utf8");
  assert.match(editor, /data-block-add/);
  assert.match(editor, /data-add-block-type/);
  assert.match(editor, /function openBlockLibrary\(\)/);
  assert.match(editor, /data-block-duplicate/);
  assert.match(editor, /data-block-delete/);
  assert.match(editor, /data-block-up/);
  assert.match(editor, /data-block-down/);
});
