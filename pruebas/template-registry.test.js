"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TemplateContractError,
  resolveStoredTemplate,
  resolveTemplateForCreation,
  templateMetadata
} = require("../src/domain/template-registry");

test("las plantillas activas resuelven a un descriptor versionado estable", () => {
  const expected = [
    ["clasico", "tiendaiq/classic", "classic", "active"],
    ["premium", "tiendaiq/premium", "premium", "active"],
    ["performance-story", "tiendaiq/performance-story", "performance-story", "active"],
    ["pinza-pagepilot", "tiendaiq/pinza-pagepilot", "pinza-pagepilot", "active"]
  ];

  for (const [style, id, rendererKey, status] of expected) {
    const metadata = templateMetadata(resolveTemplateForCreation(style));
    assert.deepEqual(metadata.template, { id, version: 1 });
    assert.equal(metadata.legacyStyle, style);
    assert.equal(metadata.rendererKey, rendererKey);
    assert.equal(metadata.status, status);
  }
});

test("las plantillas congeladas siguen siendo legibles, pero no se pueden crear", () => {
  for (const style of ["pagepilot", "pagepilot-blue"]) {
    assert.throws(
      () => resolveTemplateForCreation(style),
      (error) => error instanceof TemplateContractError
        && error.code === "PAGE_TEMPLATE_INVALID"
        && error.status === 400
    );
  }
});

test("un estilo desconocido falla antes de que el llamador pueda iniciar efectos externos", () => {
  assert.throws(
    () => resolveTemplateForCreation("plantilla-inventada"),
    (error) => error instanceof TemplateContractError && error.code === "PAGE_TEMPLATE_INVALID"
  );
});

test("los documentos heredados se resuelven sin mutarlos", () => {
  const global = { estilo: "pagepilot-blue", cta: "Comprar" };
  const before = JSON.stringify(global);
  const resolved = resolveStoredTemplate(global);

  assert.equal(resolved.id, "legacy/pagepilot-blue");
  assert.equal(JSON.stringify(global), before);
  assert.equal(Object.hasOwn(global, "template"), false);
});

test("un descriptor versionado tiene prioridad sobre el alias legacy", () => {
  const resolved = resolveStoredTemplate({
    estilo: "clasico",
    template: { id: "tiendaiq/premium", version: 1 }
  });

  assert.equal(resolved.id, "tiendaiq/premium");
  assert.equal(resolved.rendererKey, "premium");
});
