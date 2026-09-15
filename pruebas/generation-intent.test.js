"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { generationIntentFingerprint } = require("../src/domain/generation-intent");

const base = {
  producto_id: "gid://shopify/Product/42",
  idioma: "es",
  angulo: "Rutina simple",
  estilo: "section-page-v1"
};

test("la misma intención de generación produce la misma huella", () => {
  assert.equal(generationIntentFingerprint(base), generationIntentFingerprint({ ...base }));
  assert.equal(generationIntentFingerprint({ ...base, angulo: "  Rutina simple  " }), generationIntentFingerprint(base));
});

test("cambiar producto, idioma, ángulo o plantilla cambia la huella", () => {
  for (const change of [
    { producto_id: "gid://shopify/Product/99" },
    { idioma: "en" },
    { angulo: "Oferta premium" },
    { estilo: "piloto-pdp-01" }
  ]) {
    assert.notEqual(generationIntentFingerprint(base), generationIntentFingerprint({ ...base, ...change }));
  }
});

test("la recuperación del editor exige pageId y no usa productId como sustituto", () => {
  const app = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
  assert.match(app, /completed\.result\?\.pageId \|\| pending\.pageId \|\| null/);
  assert.doesNotMatch(app, /String\(pending\.body\.producto_id\)\.split\("\/"\)\.pop\(\)/);
});

test("los jobs públicos de generación llevan el pageId durable", () => {
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.match(server, /pageId: job\.payload\?\.pageId \|\| null/);
  assert.match(server, /intentionFingerprint/);
});
