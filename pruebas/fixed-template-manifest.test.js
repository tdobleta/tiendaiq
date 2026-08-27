"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PINZA_PAGEPILOT_V1,
  PINZA_PAGEPILOT_EDITOR_CONTRACT_V1,
  fixedTemplateViewModel
} = require("../src/domain/fixed-template-manifest");
const { sanitizeFixedTemplateSource, sourceFingerprint } = require("../scripts/import-fixed-template-source");
const fs = require("node:fs");
const path = require("node:path");

function fixedTemplateSource(assetDirectory) {
  const runtime = fs.readFileSync(path.join(assetDirectory, "tiq-pinzapilot-v1.js"), "utf8");
  const encoded = runtime.match(/FIXED_TEMPLATE_SOURCE_BASE64 = "([A-Za-z0-9+/=]+)"/);
  assert.ok(encoded, "el runtime debe contener la fuente visual congelada");
  return Buffer.from(encoded[1], "base64").toString("utf8");
}

test("la plantilla fija conserva identidad y slots explícitos", () => {
  assert.equal(PINZA_PAGEPILOT_V1.id, "tiendaiq/pinza-pagepilot");
  assert.equal(PINZA_PAGEPILOT_V1.version, 1);
  assert.ok(PINZA_PAGEPILOT_V1.slots.product.includes("media"));
  assert.ok(PINZA_PAGEPILOT_V1.slots.evidence.includes("reviews"));
  assert.ok(PINZA_PAGEPILOT_V1.merchantEditablePaths.includes("facetas.faq.items[].respuesta"));
});

test("el contrato de editor conserva el diseño fijo y separa Shopify de evidencia", () => {
  assert.equal(PINZA_PAGEPILOT_EDITOR_CONTRACT_V1.mode, "fixed-slots");
  assert.equal(PINZA_PAGEPILOT_EDITOR_CONTRACT_V1.permissions.structure, false);
  assert.equal(PINZA_PAGEPILOT_EDITOR_CONTRACT_V1.permissions.layout, false);
  assert.equal(PINZA_PAGEPILOT_EDITOR_CONTRACT_V1.permissions.customCss, false);
  const product = PINZA_PAGEPILOT_EDITOR_CONTRACT_V1.groups.find((group) => group.id === "shopify-product");
  const evidence = PINZA_PAGEPILOT_EDITOR_CONTRACT_V1.groups.find((group) => group.id === "evidence");
  assert.equal(product.editable, false);
  assert.ok(product.slots.includes("product.media"));
  assert.equal(evidence.requiresAttestation, true);
  assert.equal(evidence.editable, false);
  const content = PINZA_PAGEPILOT_EDITOR_CONTRACT_V1.groups.find((group) => group.id === "approved-content");
  assert.deepEqual(content.slots, PINZA_PAGEPILOT_V1.merchantEditablePaths);
});

test("el importador quita hotlinks y scripts, sin rediseñar el HTML fijo", () => {
  const source = '<html><head><title>Fuente</title></head><body><main class="hero"><img src="https://service.pagepilot.ai/a.webp" data-image="https://service.pagepilot.ai/b.webp"><script>alert(1)</script></main></body></html>';
  const output = sanitizeFixedTemplateSource(source);
  assert.match(output, /class="hero"/);
  assert.doesNotMatch(output, /pagepilot\.ai/);
  assert.doesNotMatch(output, /<script/i);
  assert.equal(sourceFingerprint("abc").length, 64);
});

test("el view model conecta producto real y falla cerrado para evidencia sin atestación", () => {
  const data = {
    fuente: { titulo_crudo: "Producto Shopify", precio: "19.95", moneda: "ARS" },
    facetas: { hero: { titulo: "Título publicado", galeria: ["gid://shopify/MediaImage/1"] } },
    compliance: { claims_verified: false, review_source: "inventada", policy_source: "inventada" }
  };
  const view = fixedTemplateViewModel(data, { "gid://shopify/MediaImage/1": "https://cdn.shopify.com/a.webp" }, { variantId: 42 });
  assert.equal(view.product.title, "Producto Shopify");
  assert.equal(view.product.media.length, 1);
  assert.equal(view.product.variantId, "42");
  assert.equal(view.evidence.reviews, false);
  assert.equal(view.evidence.policies, false);
});

test("el artefacto distribuible no conserva hotlinks ni marcas de la fuente", () => {
  const assetDirectory = path.join(__dirname, "..", "extensions", "tiendaiq-widgets", "assets");
  const artifact = fixedTemplateSource(assetDirectory);
  assert.ok(fs.existsSync(path.join(assetDirectory, PINZA_PAGEPILOT_V1.sourceFile)));
  assert.equal(fs.readdirSync(assetDirectory).some((filename) => /\.(?:html|json)$/.test(filename)), false);
  assert.equal(sourceFingerprint(artifact), PINZA_PAGEPILOT_V1.sourceSha256);
  assert.doesNotMatch(artifact, /(?:pagepilot\.ai|Ventmar|Pinza Recogedora|Bloomberg|Cosmopolitan)/i);
  assert.doesNotMatch(artifact, /<script/i);
  assert.match(artifact, /class="hero"/);
  assert.match(artifact, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});
