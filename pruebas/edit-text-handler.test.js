"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { createEditTextHandler, validatePayload } = require("../src/jobs/edit-text-handler");

function job(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "edit.myshopify.com",
    attempts: 1,
    payload: {
      texto: "Texto original",
      instrucciones: "Más claro",
      modo: "rewrite",
      idioma: "es",
      contexto: "producto: Ejemplo",
      ...overrides.payload
    },
    ...overrides
  };
}

describe("EditTextHandler", () => {
  test("devuelve el texto como resultado durable y propaga la cancelación", async () => {
    const calls = [];
    const metrics = [];
    const handler = createEditTextHandler({
      async edit(input) {
        calls.push(input);
        return "Texto mejorado";
      },
      metrics: (...args) => metrics.push(args)
    });
    const controller = new AbortController();

    const result = await handler.run(job(), { signal: controller.signal });

    assert.deepEqual(result, { texto: "Texto mejorado" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal, controller.signal);
    assert.equal(metrics[0][0], "texto_editado");
    assert.equal(metrics[0][1].job_id, "11111111-1111-4111-8111-111111111111");
    assert.equal("texto" in metrics[0][1], false, "las métricas no deben registrar el prompt ni la salida");
  });

  test("un lease recuperado no repite una llamada cuyo resultado puede ser ambiguo", async () => {
    let calls = 0;
    const handler = createEditTextHandler({ edit: async () => { calls += 1; } });

    await assert.rejects(
      handler.run(job({ attempts: 2 })),
      (error) => error.nonRetryable === true && /no se repetirá/.test(error.message)
    );
    assert.equal(calls, 0);
  });

  test("rechaza payload inválido antes de llamar al proveedor", async () => {
    let calls = 0;
    const handler = createEditTextHandler({ edit: async () => { calls += 1; } });

    await assert.rejects(
      handler.run(job({ payload: { modo: "inventar" } })),
      (error) => error.nonRetryable === true && /modo/.test(error.message)
    );
    assert.equal(calls, 0);
  });
});

describe("validatePayload", () => {
  test("normaliza valores opcionales y conserva solo el contrato conocido", () => {
    assert.deepEqual(validatePayload({ texto: 42, idioma: "es-AR", extra: "no" }), {
      texto: "42",
      instrucciones: "",
      modo: "rewrite",
      idioma: "es-AR",
      contexto: ""
    });
  });

  test("impone límites de contenido", () => {
    assert.throws(() => validatePayload({ texto: "x".repeat(10_001) }), /límite/);
    assert.throws(() => validatePayload({ instrucciones: "x".repeat(2_001) }), /límite/);
    assert.throws(() => validatePayload({ contexto: "x".repeat(15_001) }), /límite/);
  });
});
