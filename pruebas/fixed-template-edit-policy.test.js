"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FixedTemplateEditError,
  applyTemplateBoundEdit
} = require("../src/domain/fixed-template-edit-policy");

function pageData() {
  return {
    global: {
      estilo: "pinza-pagepilot",
      template: { id: "tiendaiq/pinza-pagepilot", version: 1 },
      cta: "Agregar al carrito"
    },
    fuente: { titulo_crudo: "Producto de Shopify", precio: "199" },
    pool_imagenes: [{ media_id: "gid://shopify/MediaImage/1", tipo: "producto_limpio" }],
    compliance: { claims_verified: false, review_source: null },
    facetas: {
      hero: {
        titulo: "No editable desde Pinza",
        bullets: [
          { emoji: "✦", fuerte: "Forma clara", resto: "para elegir mejor" },
          { emoji: "✦", fuerte: "Datos reales", resto: "del producto Shopify" }
        ],
        galeria: ["gid://shopify/MediaImage/1"]
      },
      faq: {
        titular: "Preguntas frecuentes",
        items: [{ pregunta: "¿Cómo se usa?", respuesta: "Seguí las indicaciones del producto." }]
      }
    }
  };
}

function edited() {
  return structuredClone(pageData());
}

test("Pinza sólo persiste beneficios y FAQ autorizados", () => {
  const persisted = pageData();
  const submitted = edited();
  submitted.facetas.hero.bullets[0].fuerte = "Nuevo beneficio";
  submitted.facetas.hero.bullets[0].resto = "con un detalle real";
  submitted.facetas.faq.titular = "Dudas habituales";
  submitted.facetas.faq.items[0].pregunta = "¿Cómo lo preparo?";
  submitted.facetas.faq.items[0].respuesta = "Consultá el manual incluido.";

  const result = applyTemplateBoundEdit({ persistedData: persisted, submittedData: submitted });
  assert.equal(result.facetas.hero.bullets[0].fuerte, "Nuevo beneficio");
  assert.equal(result.facetas.faq.items[0].respuesta, "Consultá el manual incluido.");
  assert.equal(result.fuente.titulo_crudo, "Producto de Shopify");
  assert.deepEqual(persisted, pageData());
  assert.deepEqual(submitted.facetas.hero.galeria, ["gid://shopify/MediaImage/1"]);
});

test("Pinza rechaza cambios de identidad, Shopify, evidencia y estructura", () => {
  const cases = [
    (data) => { data.global.template.version = 2; },
    (data) => { data.fuente.precio = "1"; },
    (data) => { data.compliance.claims_verified = true; },
    (data) => { data.facetas.hero.galeria.push("gid://shopify/MediaImage/2"); },
    (data) => { data.facetas.hero.bullets.push({ emoji: "✦", fuerte: "Extra", resto: "No autorizado" }); },
    (data) => { data.facetas.faq.items[0].respuesta = { html: "<b>no</b>" }; }
  ];

  for (const mutate of cases) {
    const submitted = edited();
    mutate(submitted);
    assert.throws(
      () => applyTemplateBoundEdit({ persistedData: pageData(), submittedData: submitted }),
      (error) => error instanceof FixedTemplateEditError && error.status === 422 && error.code === "FIXED_TEMPLATE_EDIT_INVALID"
    );
  }
});

test("las plantillas no fijas conservan la edición existente", () => {
  const persisted = pageData();
  persisted.global = { estilo: "clasico" };
  const submitted = { global: { estilo: "clasico" }, facetas: { hero: { titulo: "Permitido" } } };
  assert.equal(applyTemplateBoundEdit({ persistedData: persisted, submittedData: submitted }), submitted);
});
