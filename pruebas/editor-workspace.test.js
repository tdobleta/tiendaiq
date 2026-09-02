"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const app = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "app", "editor-pagepilot.css"), "utf8");

test("el preview abre como workspace y no conserva el stepper del asistente", () => {
  assert.match(app, /const enEditor = estado\.pantalla === "preview"/);
  assert.match(app, /document\.body\.classList\.toggle\("tiq-pe-editor-active", pantalla === "preview"\)/);
  assert.match(app, /if \(enEditor \|\| estado\.pantalla === "lista"/);
});

test("el workspace usa el ancho disponible y conserva el viewport real de Shopify", () => {
  assert.match(app, /const anchoTienda = 1200/);
  assert.match(app, /centro\.clientWidth - 28/);
  assert.match(css, /\.embebida\.tiq-pe-editor-active main\{ width:100%; max-width:none;/);
  assert.match(css, /\.tiq-pe-editor-active \.pe-editor\{ height:calc\(100vh - 62px\);/);
  assert.match(css, /grid-template-columns:264px minmax\(0,1fr\) 316px/);
});

test("Piloto 01 une árbol, canvas e inspector mediante un id de bloque real", () => {
  assert.match(app, /const BLOQUES_PILOTO_01 = new Set/);
  assert.match(app, /function seleccionarBloquePiloto/);
  assert.match(app, /tiendaiqEditor: "highlight-block"/);
  assert.match(app, /tiendaiqEditor !== "select-block"/);
  assert.match(app, /if \(!esPiloto\) montarEdicionEnIframe\(marco\)/);
  assert.match(app, /if \(esPiloto\) return seleccionarBloquePiloto\(el\.dataset\.tree\)/);
});

test("Piloto 01 no consulta el contrato histórico al abrir su inspector", () => {
  const inicio = app.indexOf("function abrirPanelEditor(editorId)");
  const fin = app.indexOf("function cerrarPanelSeccion", inicio);
  assert.ok(inicio >= 0 && fin > inicio, "no se encontró el controlador del inspector");
  const controlador = app.slice(inicio, fin);
  const ramaPiloto = controlador.indexOf("const esPilotoFijo = esPlantillaPdp01()");
  const legacy = controlador.indexOf("seccionesPagina()[editorId]");
  assert.ok(ramaPiloto >= 0 && legacy > ramaPiloto, "Piloto debe resolver su contrato antes de leer facetas legacy");
  assert.match(controlador, /BLOQUES_PILOTO_01\.has\(editorId\)/, "el inspector sólo acepta bloques declarados por la plantilla");
});

test("el puente del preview sólo conversa con el origen propio", () => {
  assert.ok(!/postMessage\([^\n]*,\s*"\*"\)/.test(app), "el editor no debe publicar mensajes a cualquier origen");
  assert.match(app, /event\.origin !== window\.location\.origin/);
  assert.match(css, /--piloto-space-1:4px/);
  assert.match(css, /--piloto-focus:#005bd3/);
  const sistemaFinal = css.slice(css.indexOf("PILOTO · Workspace system"));
  assert.ok(!sistemaFinal.includes("linear-gradient"), "el sistema final no conserva el gradiente decorativo anterior");
});

test("Piloto 01 tiene una superficie de trabajo propia, con preview y controles reales", () => {
  assert.match(app, /pe-appbar__wordmark/);
  assert.match(app, /editor-deshacer/);
  assert.match(app, /p01-control/);
  assert.match(css, /PILOTO 01 · Editor v2/);
  assert.match(css, /grid-template-columns:288px minmax\(0,1fr\) 344px/);
  assert.match(css, /height:calc\(100dvh - 64px\)/);
});
