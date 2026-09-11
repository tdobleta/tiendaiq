"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const imageWithText = require("../src/section-pipeline/image-with-text-v1");
const { createProductPage } = require("../src/section-pipeline/page-pipeline");
const { applyPageTransition } = require("../src/section-pipeline/page-transition");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function page() {
  return createProductPage({
    product: {
      id: "gid://shopify/Product/123",
      title: "Bolso Atelier",
      media: [{ id: "gid://shopify/MediaImage/1", url: "https://cdn.shopify.com/bolso.jpg" }],
      variants: [{ id: "gid://shopify/ProductVariant/1", title: "Única", price: "122.00" }]
    }
  });
}

function imageSection(id = "section-image") {
  return {
    id,
    label: imageWithText.schema.name,
    definition: { id: imageWithText.id, version: imageWithText.version, sourceSha256: imageWithText.sourceSha256 },
    instance: clone(imageWithText.seed)
  };
}

test("guardar exige la revisión abierta e incrementa exactamente una vez", () => {
  const persisted = page();
  const candidate = clone(persisted);
  candidate.sections[0].instance.settings.description = "<p>Descripción editada</p>";
  const saved = applyPageTransition({ persisted, candidate, expectedRevision: 0 });
  assert.equal(saved.revision, 1);
  assert.equal(saved.sections[0].instance.settings.description, "<p>Descripción editada</p>");
  assert.throws(
    () => applyPageTransition({ persisted: saved, candidate, expectedRevision: 0 }),
    (error) => error.code === "SECTION_PAGE_REVISION_CONFLICT"
  );
});

test("producto, evidencia e identidad comercial permanecen bajo control del servidor", () => {
  for (const mutate of [
    (candidate) => { candidate.productId = "gid://shopify/Product/otro"; },
    (candidate) => { candidate.productSnapshot.title = "Producto ajeno"; },
    (candidate) => { candidate.evidence.verifiedClaims.push({ text: "Inventado" }); }
  ]) {
    const persisted = page();
    const candidate = clone(persisted);
    mutate(candidate);
    assert.throws(() => applyPageTransition({ persisted, candidate, expectedRevision: 0 }), /editor no puede modificar/);
  }
});

test("la procedencia de los slots de IA es propiedad del servidor", () => {
  const persisted = createProductPage({
    product: { id: "gid://shopify/Product/123", title: "Bolso Atelier" },
    research: {
      copy_slots_v1: {
        version: 1,
        slots: [{
          target: { section_id: "product-information", occurrence: 1, field: "description" },
          value: "Descripción generada.",
          evidence: [{ kind: "shopify_description", reference: "product.description" }]
        }]
      }
    }
  });
  const candidate = clone(persisted);
  candidate.copy_slots_v1.slots[0].provenance.source = "manual";
  assert.throws(
    () => applyPageTransition({ persisted, candidate, expectedRevision: 0 }),
    /editor no puede modificar copy_slots_v1/
  );
});

test("los campos Shopify protegidos no pueden reemplazarse desde el editor", () => {
  const persisted = page();
  const candidate = clone(persisted);
  candidate.sections[0].instance.settings.heading = "Título inventado";
  assert.throws(() => applyPageTransition({ persisted, candidate, expectedRevision: 0 }), /controla el campo heading/);
});

test("el servidor impide borrar o duplicar la sección obligatoria", () => {
  const persisted = page();
  const deleted = clone(persisted);
  deleted.sections = [imageSection()];
  assert.throws(() => applyPageTransition({ persisted, candidate: deleted, expectedRevision: 0 }), /obligatoria/);

  const duplicated = clone(persisted);
  const copy = clone(duplicated.sections[0]);
  copy.id = "section-product-information-copy";
  duplicated.sections.push(copy);
  assert.throws(() => applyPageTransition({ persisted, candidate: duplicated, expectedRevision: 0 }), /una sola instancia/);
});

test("una sección reutilizable se inserta y duplica con ids independientes", () => {
  const persisted = page();
  const inserted = clone(persisted);
  inserted.sections.push(imageSection("section-image-a"));
  const firstSave = applyPageTransition({ persisted, candidate: inserted, expectedRevision: 0 });
  assert.equal(firstSave.sections.length, 2);

  const duplicated = clone(firstSave);
  const copy = clone(duplicated.sections[1]);
  copy.id = "section-image-b";
  copy.instance.settings.heading = "Solo la copia";
  duplicated.sections.push(copy);
  const secondSave = applyPageTransition({ persisted: firstSave, candidate: duplicated, expectedRevision: 1 });
  assert.equal(secondSave.revision, 2);
  assert.equal(secondSave.sections[1].instance.settings.heading, imageWithText.seed.settings.heading);
  assert.equal(secondSave.sections[2].instance.settings.heading, "Solo la copia");
});

test("los bloques de una composición protegida no pueden reordenarse ni cambiar de tipo", () => {
  const persisted = page();
  const candidate = clone(persisted);
  candidate.sections[0].instance.blocks.reverse();
  assert.throws(() => applyPageTransition({ persisted, candidate, expectedRevision: 0 }), /estructura interna/);
});

test("las secciones reutilizables se pueden reordenar y la principal permanece protegida", () => {
  const persisted = page();
  const inserted = clone(persisted);
  inserted.sections.push(imageSection("section-image-a"));
  const saved = applyPageTransition({ persisted, candidate: inserted, expectedRevision: 0 });
  const reordered = clone(saved);
  [reordered.sections[0], reordered.sections[1]] = [reordered.sections[1], reordered.sections[0]];
  assert.throws(() => applyPageTransition({ persisted: saved, candidate: reordered, expectedRevision: 1 }), /no se puede reordenar/);
});
