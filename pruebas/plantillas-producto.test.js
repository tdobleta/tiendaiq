const test = require("node:test");
const assert = require("node:assert/strict");
const { PLANTILLAS_PRODUCTO, PLANTILLAS_DISPONIBLES, obtenerPlantilla, resumenContrato } = require("../plantillas-producto");

test("las plantillas publicadas tienen un contrato completo", () => {
  const ids = ["clasico", "premium", "greens", "bloom", "honey", "clarity", "aura", "legacy", "stone", "cotton", "atelier"];
  for (const id of ids) {
    const plantilla = obtenerPlantilla(id);
    assert.equal(plantilla.id, id);
    assert.equal(plantilla.version, 1);
    assert.ok(plantilla.intencion);
    assert.ok(plantilla.orden.length >= 5);
    assert.ok(plantilla.reglasCopy.length >= 3);
    assert.ok(plantilla.campos.some((campo) => campo.ruta === "facetas.hero.titulo"));
    assert.ok(plantilla.campos.some((campo) => campo.ruta === "facetas.hero.galeria"));
    assert.ok(["clasico", "premium", "atelier"].includes(plantilla.layout));
    assert.ok(plantilla.tema);
  }
  assert.equal(Object.keys(PLANTILLAS_PRODUCTO).length, ids.length);
});

test("una plantilla desconocida cae de forma segura a clasico", () => {
  assert.equal(obtenerPlantilla("no-existe").id, "clasico");
  assert.equal(obtenerPlantilla().id, "clasico");
});

test("el selector solo publica las plantillas con HTML integrado", () => {
  assert.deepEqual(Object.keys(PLANTILLAS_DISPONIBLES), ["atelier"]);
  assert.equal(PLANTILLAS_DISPONIBLES.atelier.imagen.includes("pagepilot.ai"), true);
});

test("el resumen que recibe la IA identifica la plantilla y sus campos", () => {
  const resumen = JSON.parse(resumenContrato(PLANTILLAS_PRODUCTO.premium));
  assert.equal(resumen.id, "premium");
  assert.ok(resumen.campos.some((campo) => campo.ruta === "facetas.faq"));
  assert.ok(resumen.reglasCopy.some((regla) => regla.includes("testimonios")));
});
