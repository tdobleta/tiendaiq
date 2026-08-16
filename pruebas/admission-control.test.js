"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { generationAdmissionPause, retryAfterSeconds } = require("../src/generation/admission-control");

test("la admision de generaciones queda cerrada si falta configuracion explicita", () => {
  const state = generationAdmissionPause({});

  assert.equal(state.paused, true);
  assert.equal(state.retryAfter, 60);
  assert.equal(state.code, "GENERATION_ADMISSION_PAUSED");
});

test("solo el valor 0 abre la admision y Retry-After queda acotado", () => {
  assert.equal(generationAdmissionPause({ GENERATION_ADMISSION_PAUSED: "1" }).paused, true);
  assert.equal(generationAdmissionPause({ GENERATION_ADMISSION_PAUSED: "0" }).paused, false);
  assert.equal(generationAdmissionPause({ GENERATION_ADMISSION_PAUSED: "true" }).paused, true);

  assert.equal(retryAfterSeconds("300"), 300);
  assert.equal(retryAfterSeconds("4"), 60);
  assert.equal(retryAfterSeconds("3601"), 60);
  assert.equal(retryAfterSeconds("abc"), 60);
});

test("el endpoint de generacion revisa la pausa antes de consultar plan o reservar cupo", () => {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  const pause = serverSource.indexOf("generationAdmissionPause(env)");
  const plan = serverSource.indexOf("const plan = await estadoPlan(sesion)");
  const enqueue = serverSource.indexOf("await encolarGeneracionDB");

  assert.ok(pause > 0, "server.js debe evaluar la pausa de admision");
  assert.ok(plan > pause, "la pausa debe ocurrir antes de consultar el plan");
  assert.ok(enqueue > pause, "la pausa debe ocurrir antes de encolar y reservar cupo");
});

test("el frontend muestra progreso solo despues de que la cola acepta el trabajo", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");
  const generationStart = appSource.indexOf("async function generar()");
  const recoveryStart = appSource.indexOf("async function recuperarGeneracionPendiente()");
  const generationSource = appSource.slice(generationStart, recoveryStart);
  const recoverySource = appSource.slice(recoveryStart, appSource.indexOf("// ---------- abrir", recoveryStart));

  assert.ok(generationStart > 0 && recoveryStart > generationStart, "deben existir ambos flujos de generacion");
  assert.ok(
    generationSource.indexOf("await aceptarGeneracionPendiente(pending)") < generationSource.indexOf('ir("generando")'),
    "la generacion nueva debe esperar la aceptacion de la cola"
  );
  assert.ok(
    recoverySource.indexOf("await aceptarGeneracionPendiente(pending)") < recoverySource.indexOf('ir("generando")'),
    "la recuperacion debe esperar la aceptacion de la cola"
  );
  assert.doesNotMatch(appSource, /en segundos|~35 segundos/i);
});
