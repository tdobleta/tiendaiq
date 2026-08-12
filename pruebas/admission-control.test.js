"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { generationAdmissionPause, retryAfterSeconds } = require("../src/generation/admission-control");

test("la admision de generaciones queda abierta por defecto", () => {
  const state = generationAdmissionPause({});

  assert.equal(state.paused, false);
  assert.equal(state.retryAfter, 60);
  assert.equal(state.code, "GENERATION_ADMISSION_PAUSED");
});

test("la pausa de admision exige bandera explicita y Retry-After acotado", () => {
  assert.equal(generationAdmissionPause({ GENERATION_ADMISSION_PAUSED: "1" }).paused, true);
  assert.equal(generationAdmissionPause({ GENERATION_ADMISSION_PAUSED: "0" }).paused, false);
  assert.equal(generationAdmissionPause({ GENERATION_ADMISSION_PAUSED: "true" }).paused, false);

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
