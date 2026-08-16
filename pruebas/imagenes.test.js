"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ambiguousMediaError,
  bucketUploadError,
  permanentMediaError,
  pollCreatedEffect,
  rethrowCreatedEffect
} = require("../imagenes");

test("los errores de validacion de media son terminales y permiten degradacion visual", () => {
  const error = permanentMediaError("imagen invalida", 422);
  assert.equal(error.status, 422);
  assert.equal(error.nonRetryable, true);
  assert.equal(error.allowDegraded, true);
});

test("el bucket distingue rechazo permanente de limite transitorio", () => {
  const invalid = bucketUploadError(422);
  const limited = bucketUploadError(429);
  assert.equal(invalid.nonRetryable, true);
  assert.equal(limited.nonRetryable, false);
  assert.equal(limited.status, 429);
});

test("un fallo al consultar un efecto ya creado queda ambiguo y no se reintenta", async () => {
  await assert.rejects(
    pollCreatedEffect(async () => {
      const error = new Error("Shopify temporalmente no disponible");
      error.status = 503;
      throw error;
    }, {
      attempts: 2,
      signal: new AbortController().signal,
      failed: "fallo permanente",
      pending: "estado remoto ambiguo"
    }),
    (error) => error.code === "SHOPIFY_MEDIA_AMBIGUOUS" && error.nonRetryable === true
  );
});

test("el sondeo devuelve el resultado confirmado sin esperas adicionales", async () => {
  let calls = 0;
  const result = await pollCreatedEffect(async () => {
    calls += 1;
    return { ready: true, failed: false, result: { url: "https://cdn.example/imagen.jpg" } };
  }, {
    attempts: 2,
    signal: new AbortController().signal,
    failed: "fallo permanente",
    pending: "estado remoto ambiguo"
  });
  assert.deepEqual(result, { url: "https://cdn.example/imagen.jpg" });
  assert.equal(calls, 1);
});

test("una cancelacion posterior a la mutacion se conserva como efecto ambiguo", () => {
  const controller = new AbortController();
  controller.abort(new Error("apagado del worker"));
  assert.throws(
    () => rethrowCreatedEffect(controller.signal.reason, controller.signal, "creacion ambigua"),
    (error) => error.code === "SHOPIFY_MEDIA_AMBIGUOUS" && error.nonRetryable === true
  );
});

test("un error remoto desconocido despues de crear media queda ambiguo", () => {
  assert.throws(
    () => rethrowCreatedEffect(new Error("conexion cerrada"), new AbortController().signal, "creacion ambigua"),
    (error) => error.code === "SHOPIFY_MEDIA_AMBIGUOUS" && error.nonRetryable === true
  );
});

test("un rechazo permanente confirmado conserva su clasificacion", () => {
  const rejected = permanentMediaError("imagen rechazada", 422);
  assert.throws(
    () => rethrowCreatedEffect(rejected, new AbortController().signal, "creacion ambigua"),
    (error) => error === rejected
  );
});

test("el constructor de ambiguedad nunca habilita degradacion silenciosa", () => {
  const error = ambiguousMediaError("resultado desconocido");
  assert.equal(error.nonRetryable, true);
  assert.equal(error.allowDegraded, undefined);
});
