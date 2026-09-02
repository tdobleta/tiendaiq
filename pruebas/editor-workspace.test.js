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
  assert.match(app, /const anchoTienda = isMobile \? 390 : 1200/);
  assert.match(app, /centro\.clientWidth - 40/);
  assert.match(app, /disponibleAltura = Math\.max\(420, centro\.clientHeight - 36\)/);
  assert.match(app, /<ui-modal id="tiq-piloto-editor-modal" variant="max">/);
  assert.match(app, /<ui-title-bar title="\$\{esc\("Editar página de producto/);
  assert.match(app, /tiq-piloto-editor-modal-content"><link rel="stylesheet" href="\/editor-pagepilot\.css">/);
  assert.match(css, /grid-template-columns: 300px minmax\(0, 1fr\) 320px/);
  assert.match(css, /#vista\s*\{[\s\S]*?max-width: none;[\s\S]*?padding: 0/);
  assert.match(css, /\.pe-editor__centro\s*\{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden/);
  assert.match(css, /\.pe-canvas-shell\s*\{[^}]*transform-origin: top center/);
  assert.match(css, /\.pe-canvas-shell \.marco\s*\{[\s\S]*?height: calc\(100dvh - 112px\)/);
  assert.match(css, /overflow-x: hidden/);
  assert.match(app, /function prepararFramePreview\(frame\)/);
});

test("la barra de Piloto conserva el modelo de editor maduro", () => {
  assert.match(app, /id="editor-modo-avanzado"/);
  assert.match(app, /id="editor-branding"/);
  assert.match(app, /data-viewport-tool="select"/);
  assert.match(app, /data-viewport-tool="fullscreen"/);
  assert.match(app, /id="editar-variantes"/);
  assert.match(app, /id="editor-acciones-menu"/);
  assert.match(app, /id="editor-cerrar"/);
  assert.match(css, /\.pe-mode-toggle/);
  assert.match(css, /\.pe-actions__menu/);
  assert.match(css, /#publicar::part\(button\)[^{]*\{[^}]*background: #008060/);
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

test("cada sección fija del inspector tiene una superficie real y consume settings", () => {
  assert.match(runtime, /const fixedTargets = \{/);
  assert.match(runtime, /"product-information": "\.phv4-panel"/);
  assert.match(runtime, /"product-gallery": "\.phv4-gallery"/);
  assert.match(runtime, /"featured-reviews": "\.phv4-opinion-carousel, \.phv4-review"/);
  assert.match(runtime, /const applyFixedSettings = \(section\) =>/);
  assert.match(runtime, /data-tiq-editor-setting-id/);
  assert.match(runtime, /settings\.width \?\? desktop\.width/);
  assert.match(runtime, /settings\.mobile_alignment \?\? mobile\.mobile_alignment/);
  assert.match(runtime, /section\.enabled === false/);
});

test("el cambio de Branding invalida el render firmado del preview", () => {
  assert.match(runtime, /payload\?\.branding \|\| "brand"/);
  assert.match(runtime, /root\.dataset\.tiqBranding = palette/);
});

test("la galería separa elementos agregables de bloques básicos seleccionables", () => {
  assert.match(app, /galeriaTab: "gallery"/);
  assert.match(app, /data-p01-gallery-tab="gallery"/);
  assert.match(app, /data-p01-gallery-tab="basic"/);
  assert.match(app, /data-p01-gallery-select/);
  assert.match(app, /estado\.galeriaTab = tabButton\.dataset\.p01GalleryTab/);
});

test("el árbol permite alternar grupos con etiqueta, flecha y teclado", () => {
  assert.match(app, /next\.querySelectorAll\("\.pe-tree__row--group"\)/);
  assert.match(app, /row\.addEventListener\("keydown"/);
  assert.match(app, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(app, /vista\.querySelectorAll\("\.pe-tree__row--group"\)/);
});

test("la ruta modal del editor restablece el scroll después de montar y recargar", () => {
  assert.match(app, /const resetEditorScroll = \(\) => \{ window\.scrollTo\(0, 0\)/);
  assert.match(app, /requestAnimationFrame\(resetEditorScroll\)/);
  assert.match(app, /setTimeout\(resetEditorScroll, 180\)/);
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
  assert.match(css, /--p01-focus:\s*#005bd3/);
  assert.match(css, /--p01-canvas:\s*#f6f6f7/);
  assert.equal((css.match(/--p01-canvas:\s*#f6f6f7/g) || []).length, 1, "los tokens base no se deben redefinir por capas");
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
