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

  const editRoute = serverSource.indexOf('ruta === "/api/texto/editar"');
  const generationRoute = serverSource.indexOf('// POST /api/paginas — el botón "Crear página con IA"');
  const pause = serverSource.indexOf("const admissionPause = generationAdmissionPause(env)", generationRoute);
  const shell = serverSource.indexOf("const base = await crearPaginaBase", generationRoute);
  const plan = serverSource.indexOf("const plan = await estadoPlan(sesion)", generationRoute);
  const enqueue = serverSource.indexOf("await encolarGeneracionDB", generationRoute);

  assert.ok(generationRoute > 0, "server.js debe tener la ruta de creación de páginas");
  assert.ok(editRoute > 0 && editRoute < generationRoute, "la edición asistida debe mantener su ruta separada");
  assert.match(serverSource.slice(editRoute, generationRoute), /return json\(res, 503, \{ error: admissionPause\.message/,
    "la IA de edición debe seguir cerrada si la compuerta está pausada");
  assert.ok(pause > generationRoute, "la ruta de creación debe evaluar la pausa de admisión");
  assert.ok(shell > pause, "con IA pausada la ruta de creación debe preparar la plantilla");
  assert.ok(plan > pause, "la pausa debe ocurrir antes de consultar el plan");
  assert.ok(enqueue > pause, "la pausa debe ocurrir antes de encolar y reservar cupo");
});

test("el frontend muestra progreso solo despues de que la cola acepta el trabajo y no secuestra rutas", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");
  const generationStart = appSource.indexOf("async function generar()");
  const generationEnd = appSource.indexOf("// ---------- abrir", generationStart);
  const routingStart = appSource.indexOf("async function rutear()");
  const routingEnd = appSource.indexOf("window.addEventListener(\"popstate\", rutear)", routingStart);
  const generationSource = appSource.slice(generationStart, generationEnd);
  const routingSource = appSource.slice(routingStart, routingEnd);

  assert.ok(generationStart > 0 && generationEnd > generationStart, "debe existir el flujo de generacion");
  assert.ok(
    generationSource.indexOf("await aceptarGeneracionPendiente(pending)") < generationSource.indexOf('ir("generando")'),
    "la generacion nueva debe esperar la aceptacion de la cola"
  );
  assert.doesNotMatch(routingSource, /recuperarGeneracionPendiente/,
    "una generacion pendiente no puede tomar control de Inicio, Paginas ni Bundles");
  assert.doesNotMatch(appSource, /en segundos|~35 segundos/i);
});
