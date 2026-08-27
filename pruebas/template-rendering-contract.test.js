"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const widget = fs.readFileSync(path.join(root, "extensions", "tiendaiq-widgets", "assets", "tiendaiq.js"), "utf8");
const liquid = fs.readFileSync(path.join(root, "extensions", "tiendaiq-widgets", "blocks", "pagina.liquid"), "utf8");
const css = fs.readFileSync(path.join(root, "extensions", "tiendaiq-widgets", "assets", "tiendaiq.css"), "utf8");

test("el widget selecciona renderer por descriptor y conserva sólo fallback legacy", () => {
  assert.match(widget, /const DESCRIPTOR_RENDERER_KEYS = Object\.freeze/);
  assert.match(widget, /"tiendaiq\/classic@1": "classic"/);
  assert.match(widget, /"tiendaiq\/premium@1": "premium"/);
  assert.match(widget, /"tiendaiq\/performance-story@1": "performance-story"/);
  assert.match(widget, /"tiendaiq\/pinza-pagepilot@1": "pinza-pagepilot"/);
  assert.match(widget, /if \(key && DESCRIPTOR_RENDERER_KEYS\[key\]\) return DESCRIPTOR_RENDERER_KEYS\[key\]/);
  assert.match(widget, /const renderer = rendererKey\(g\);/);
  assert.doesNotMatch(widget, /if \(g && g\.estilo === "premium"\) return renderPremium/);
});

test("los fallbacks de imágenes no ejecutan HTML inline de datos del catálogo", () => {
  assert.match(widget, /document\.addEventListener\("error", \(event\) =>/);
  assert.match(widget, /data-tiq-fallback="media"/);
  assert.match(widget, /placeholder\.textContent = image\.dataset\.tiqFallbackLabel/);
  assert.match(widget, /data-tiq-fallback="asset"/);
  assert.doesNotMatch(widget, /onerror="/);
  assert.doesNotMatch(widget, /this\.outerHTML=this\.dataset/);
});

test("el SSR Liquid resuelve el mismo descriptor antes del alias legacy", () => {
  assert.match(liquid, /assign tq_renderer = g\.estilo \| default: 'clasico'/);
  assert.match(liquid, /g\.template\.id == 'tiendaiq\/classic' and g\.template\.version == 1/);
  assert.match(liquid, /g\.template\.id == 'tiendaiq\/premium' and g\.template\.version == 1/);
  assert.match(liquid, /g\.template\.id == 'tiendaiq\/performance-story' and g\.template\.version == 1/);
  assert.match(liquid, /g\.template\.id == 'tiendaiq\/pinza-pagepilot' and g\.template\.version == 1/);
  assert.match(liquid, /tq_renderer == 'premium'/);
  assert.match(liquid, /tq_renderer == 'performance-story'/);
  assert.match(liquid, /tq_renderer == 'pagepilot'/);
  assert.match(liquid, /tq_renderer == 'pinza-pagepilot'/);
});

test("Performance Story usa sólo datos del producto y no siembra claims comerciales", () => {
  const start = widget.indexOf("function renderPerformanceStory");
  const end = widget.indexOf("function iniciarTimers", start);
  const performanceStory = widget.slice(start, end);
  assert.match(widget, /function renderPerformanceStory\(data, opts = \{\}\)/);
  assert.match(widget, /const title = h\.titulo \|\| fuente\.titulo_crudo \|\| "Producto"/);
  assert.match(widget, /const details = \(Array\.isArray\(h\.acordeones\)/);
  assert.match(widget, /const questions = \(Array\.isArray\(f\.faq\?\.items\)/);
  assert.doesNotMatch(performanceStory, /(?:reseñas|garantía|Pocas unidades|Ya es viral|countdown)/i);
  assert.match(css, /#app \.tiq-ps \{/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
