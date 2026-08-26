"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const widget = fs.readFileSync(path.join(root, "extensions", "tiendaiq-widgets", "assets", "tiendaiq.js"), "utf8");
const liquid = fs.readFileSync(path.join(root, "extensions", "tiendaiq-widgets", "blocks", "pagina.liquid"), "utf8");

test("el widget selecciona renderer por descriptor y conserva sólo fallback legacy", () => {
  assert.match(widget, /const DESCRIPTOR_RENDERER_KEYS = Object\.freeze/);
  assert.match(widget, /"tiendaiq\/classic@1": "classic"/);
  assert.match(widget, /"tiendaiq\/premium@1": "premium"/);
  assert.match(widget, /if \(key && DESCRIPTOR_RENDERER_KEYS\[key\]\) return DESCRIPTOR_RENDERER_KEYS\[key\]/);
  assert.match(widget, /const renderer = rendererKey\(g\);/);
  assert.doesNotMatch(widget, /if \(g && g\.estilo === "premium"\) return renderPremium/);
});

test("el SSR Liquid resuelve el mismo descriptor antes del alias legacy", () => {
  assert.match(liquid, /assign tq_renderer = g\.estilo \| default: 'clasico'/);
  assert.match(liquid, /g\.template\.id == 'tiendaiq\/classic' and g\.template\.version == 1/);
  assert.match(liquid, /g\.template\.id == 'tiendaiq\/premium' and g\.template\.version == 1/);
  assert.match(liquid, /tq_renderer == 'premium'/);
  assert.match(liquid, /tq_renderer == 'pagepilot'/);
});
