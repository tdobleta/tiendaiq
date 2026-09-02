"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const app = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "app", "editor-pagepilot.css"), "utf8");
const runtime = fs.readFileSync(path.join(__dirname, "..", "extensions", "tiendaiq-widgets", "assets", "piloto-pdp-01.js"), "utf8");

test("el preview abre como una superficie de trabajo y no conserva el stepper", () => {
  assert.match(app, /const enEditor = estado\.pantalla === "preview"/);
  assert.match(app, /document\.body\.classList\.toggle\("tiq-pe-editor-active", pantalla === "preview"\)/);
  assert.match(app, /if \(enEditor \|\| estado\.pantalla === "lista" \|\| estado\.pantalla === "plantillas"/);
  assert.match(app, /main class="pe-editor__centro" aria-label="Vista previa editable"/);
});

test("el workspace reserva paneles consistentes y el canvas no crea scroll horizontal", () => {
  assert.match(app, /const anchoTienda = 1200/);
  assert.match(app, /centro\.clientWidth - 48/);
  assert.match(css, /grid-template-columns:276px minmax\(0,1fr\) 332px/);
  assert.match(css, /\.pe-editor__centro\{display:flex;min-width:0;height:100%;overflow:hidden/);
  assert.match(css, /\.pe-canvas-shell\{transform-origin:top center\}/);
  assert.match(css, /\.pe-canvas-shell \.marco\{height:calc\(100dvh - 106px\)/);
});

test("Piloto 01 une árbol, canvas e inspector con ids reales de bloque", () => {
  assert.match(app, /const BLOQUES_PILOTO_01 = new Set/);
  assert.match(app, /function seleccionarBloquePiloto/);
  assert.match(app, /tiendaiqEditor: "highlight-block"/);
  assert.match(app, /tiendaiqEditor !== "select-block"/);
  assert.match(app, /if \(!esPiloto\) montarEdicionEnIframe\(marco\)/);
  assert.match(app, /if \(esPiloto\) return seleccionarBloquePiloto\(el\.dataset\.tree\)/);
  assert.match(runtime, /data-tiq-editor-label/);
  assert.match(runtime, /\.tiq-editor-active::before/);
});

test("la selección no dibuja etiquetas repetidas sobre los nodos hijos", () => {
  assert.match(runtime, /const sameParent = node\.parentElement\?\.closest/);
  assert.match(runtime, /node\.dataset\.tiqEditorBlock === id && !sameParent/);
});

test("Piloto 01 resuelve su propio contrato antes del editor histórico", () => {
  const inicio = app.indexOf("function abrirPanelEditor(editorId)");
  const fin = app.indexOf("function cerrarPanelSeccion", inicio);
  assert.ok(inicio >= 0 && fin > inicio, "no se encontró el controlador del inspector");
  const controlador = app.slice(inicio, fin);
  const ramaPiloto = controlador.indexOf("const esPilotoFijo = esPlantillaPdp01()");
  const legacy = controlador.indexOf("seccionesPagina()[editorId]");
  assert.ok(ramaPiloto >= 0 && legacy > ramaPiloto, "Piloto debe resolver su contrato antes de leer facetas legacy");
  assert.match(controlador, /BLOQUES_PILOTO_01\.has\(editorId\)/, "el inspector sólo acepta bloques declarados por la plantilla");
});

test("el preview se comunica sólo con el origen propio y no ejecuta el carrito", () => {
  assert.ok(!/postMessage\([^\n]*,\s*"\*"\)/.test(app), "el editor no debe publicar mensajes a cualquier origen");
  assert.match(app, /event\.origin !== window\.location\.origin/);
  assert.match(runtime, /if \(previewMode\) return;/);
  assert.match(runtime, /El canvas no es un storefront/);
});

test("el sistema visual tiene un único set de tokens y ninguna decoración gratuita", () => {
  assert.match(css, /Piloto workbench: one editor surface, one token system/);
  assert.match(css, /--p01-focus:#005bd3/);
  assert.match(css, /--p01-canvas:#f6f6f7/);
  assert.equal((css.match(/--p01-canvas:#f6f6f7/g) || []).length, 1, "los tokens base no se deben redefinir por capas");
  assert.ok(!css.includes("linear-gradient"), "el editor no usa gradientes decorativos");
  assert.ok(!css.includes("radial-gradient"), "el editor no usa fondos decorativos");
});

test("el árbol representa la página, no estados internos, y abre las cinco reseñas", () => {
  const treeStart = app.indexOf("function arbolPaginaHTML()");
  const treeEnd = app.indexOf("const source = locked", treeStart);
  const tree = app.slice(treeStart, treeEnd);
  assert.match(tree, /pe-tree--workbench/);
  assert.match(tree, /grupo\("Producto", producto/);
  assert.match(tree, /grupo\("Contenido", contenido/);
  assert.match(tree, /grupo\("Prueba social", reseñas/);
  assert.match(tree, /row\(`evidence:\$\{index\}`/);
  assert.ok(!tree.includes("Espacios del merchant"), "el menú no expone implementaciones internas");
  assert.ok(!tree.includes("Fuente real"), "el menú no usa etiquetas de validación como UI");
});

test("el inspector permite cinco reseñas directas con imagen y copy sin bloqueos visuales", () => {
  const panelStart = app.indexOf("function panelEvidenciaPdp01HTML()");
  const panelEnd = app.indexOf("function valorEvidenciaPdp01", panelStart);
  const panel = app.slice(panelStart, panelEnd);
  assert.match(panel, /Array\.from\(\{ length: 5 \}/);
  assert.match(panel, /data-p01-review-tab/);
  assert.match(panel, /data-p01-evidence-upload/);
  assert.match(panel, /Guardar reseñas/);
  assert.ok(!panel.includes("Confirmo que"), "las reseñas no se bloquean detrás de confirmaciones visuales");
});
