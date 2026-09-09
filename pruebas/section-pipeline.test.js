"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const productInformation = require("../src/section-pipeline/product-information-v1");
const { createProductPage } = require("../src/section-pipeline/page-pipeline");
const { outlineTargets, renderSectionPage } = require("../src/section-pipeline/preview-renderer");
const { validateResearch } = require("../src/section-pipeline/research-product");
const { SectionContractError, sha256, validateInstance } = require("../src/section-pipeline/section-contract");
const { build: buildStorefront } = require("../src/section-pipeline/compile-storefront");
const fs = require("node:fs");
const path = require("node:path");

test("el código Shopify es la fuente inmutable del diseño y del editor", () => {
  assert.equal(productInformation.sourceSha256, "dd6d5436895178952bc78e0f439499c060b4913e57cb11388762116f336ee83f");
  assert.equal(sha256(productInformation.source), productInformation.sourceSha256);
  assert.equal(productInformation.schema.settings.length, 38);
  assert.equal(productInformation.schema.settings.filter((setting) => setting.id).length, 37);
  assert.equal(productInformation.schema.blocks.length, 6);
  assert.equal(productInformation.seed.blocks.length, 19);
  assert.equal(productInformation.editor.groups.length, 1);
  assert.equal(productInformation.editor.blocks.length, 6);
  assert.equal(productInformation.editor.outline.length, 2);
  assert.equal(productInformation.editor.outline[0].id, "product-gallery");
  assert.deepEqual(productInformation.editor.outline[0].previewSuffixes, ["__media-column"]);
  assert.equal(productInformation.editor.outline[1].children.find((node) => node.id === "payment-icons").blockType, "payment");
  assert.doesNotMatch(productInformation.source, /if hero_(?:max_width|column_gap|desktop_top|thumbnail_size)/);
  assert.doesNotMatch(productInformation.source, /\| replace:/);
});

test("crear una página conserva exactamente cada valor del preset Shopify", () => {
  const before = productInformation.source;
  const page = createProductPage({
    product: {
      id: "gid://shopify/Product/123",
      title: "Bolso Atelier",
      description: "Cuero flexible con cierre metálico.",
      media: [{ id: "gid://shopify/MediaImage/1", url: "https://cdn.shopify.com/bolso.jpg", altText: "Bolso marrón" }],
      variants: [{ id: "gid://shopify/ProductVariant/2", title: "Marrón", price: "$122.00" }]
    },
    research: { summary: "Un bolso versátil para el uso diario.", claims: [] }
  });
  assert.equal(productInformation.source, before);
  assert.equal(page.sections.length, 1);
  assert.equal(page.tree[0].label, "Info principal producto");
  assert.deepEqual(page.sections[0].instance, productInformation.seed);
  assert.equal(page.sections[0].instance.settings.heading, "NAD PRO COMPLEX");
  assert.equal(page.sections[0].instance.settings.max_width, 940);
  assert.equal(page.sections[0].instance.settings.card_gap, 5);
  assert.equal(page.sections[0].instance.settings.thumbnail_size, 60);
  assert.equal(page.sections[0].instance.settings.background_color, "#11151c");
  assert.equal(page.sections[0].instance.settings.bundle_heading, "BUNDLE & SAVE");
  assert.equal(page.sections[0].instance.settings.rating_stars, "★★★★★");
  assert.equal(page.productSnapshot.media.length, 1);
  assert.equal(page.sections[0].instance.blocks.some((block) => block.type === "media_thumb"), false);
  assert.equal(page.sections[0].instance.blocks.length, 19);
  assert.equal(page.sections[0].instance.blocks.filter((block) => block.type === "bundle").length, 3);
  assert.equal(page.sections[0].instance.blocks.some((block) => block.binding), false);
});

test("producto e investigación no pueden alterar el preset inicial", () => {
  const page = createProductPage({
    product: { id: "gid://shopify/Product/1", title: "Producto", variants: [] },
    research: {
      rating: { verified: false, label: "4.9 basado en 900 reseñas" },
      claims: [{ text: "Resultado garantizado", verified: false, source: "modelo" }]
    }
  });
  const instance = page.sections[0].instance;
  assert.deepEqual(instance, productInformation.seed);
  assert.equal(instance.blocks.filter((block) => block.type === "benefit").length, 4);
  assert.equal(instance.blocks.length, 19);
  assert.equal(instance.blocks.some((block) => block.settings?.text === "Resultado garantizado"), false);
  assert.equal(instance.blocks.some((block) => block.settings?.text === "Resultado garantizado"), false);
  assert.throws(() => validateInstance({
    definition: productInformation,
    instance: { settings: { css_inventado: "display:none" }, blocks: [] }
  }), SectionContractError);
});

test("la vista del editor ejecuta la misma fuente Liquid con datos Shopify", async () => {
  const page = createProductPage({
    product: {
      id: "gid://shopify/Product/1",
      title: "Bolso Atelier",
      description: "Bolso urbano",
      media: { edges: [{ node: { id: "media-1", image: { url: "https://cdn.shopify.com/bolso.jpg" } } }] },
      variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/1", title: "Marrón", price: "122.00" } }] }
    }
  });
  const html = await renderSectionPage(page);
  assert.match(html, /NAD PRO COMPLEX/);
  assert.match(html, /https:\/\/cdn\.shopify\.com\/bolso\.jpg/);
  assert.match(html, /data-tiq-section-id="section-product-information"/);
  assert.match(html, /data-tiq-block-id=/);
  assert.match(html, /class="product-hero-section-product-information__bundle-image"/);
  assert.match(html, /class="product-hero-section-product-information__thumbnail-image"/);
  assert.match(html, /data-variant-id="gid:\/\/shopify\/ProductVariant\/1"/);
  assert.match(html, /class="product-hero-section-product-information__cta"[\s\S]*href="#"/);
  assert.match(html, /Fast Shipping/);
  assert.match(html, /60-Day Guarantee/);
  assert.doesNotMatch(html, /if\(!section\)return;event\.preventDefault\(\)/);
  assert.match(html, /var interactive=event\.target\.closest\("button,input,select,textarea,label,a"\)/);
  assert.match(html, /class="tiq-editor-highlight"/);
  assert.match(html, /outlineId:editable\.dataset\.tiqOutlineId\|\|null/);
  assert.match(html, /if\(interactive&&interactive\.tagName==="A"\)event\.preventDefault\(\)/);
});

test("cada control visual declara un destino semántico para hover y clic", () => {
  const targets = outlineTargets(productInformation.editor.outline, "section-product-information");
  assert.deepEqual(targets.find((target) => target.outlineId === "product-title"), {
    sectionId: "section-product-information",
    outlineId: "product-title",
    label: "Título del producto",
    suffix: "__heading"
  });
  assert.ok(targets.some((target) => target.outlineId === "product-gallery" && target.suffix === "__media-column"));
  assert.ok(targets.some((target) => target.outlineId === "buy-buttons" && target.suffix === "__cta"));
});

test("seleccionar dentro del lienzo no destruye ni vuelve a cargar el iframe", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/section-editor.js"), "utf8");
  assert.match(source, /function selectItem\(sectionId,blockId,outlineId\)/);
  assert.match(source, /state\.selectedOutline=outlineId\|\|null;renderSelection\(\)/);
  assert.match(source, /function renderSelection\(\)/);
  assert.match(source, /event\.source!==frame\?\.contentWindow/);
  assert.match(source, /selectItem\(event\.data\.sectionId,event\.data\.blockId\|\|null,event\.data\.outlineId\|\|null\)/);
  assert.doesNotMatch(source, /event\.data\.sectionId;state\.selectedBlock=.*shell\(\)/);
});

test("el navegador lateral usa la jerarquía semántica y sincroniza cada selección", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/section-editor.js"), "utf8");
  assert.match(source, /expandedSections:new Set\(\)/);
  assert.match(source, /expandedOutline:new Set\(\)/);
  assert.match(source, /data-expand-section=/);
  assert.match(source, /data-expand-outline=/);
  assert.match(source, /data-outline=/);
  assert.match(source, /outlineFields=outline\?\.fields\?sectionFields\.filter/);
  assert.match(source, /findBlockOutline/);
  assert.doesNotMatch(source, /<i>▫<\/i>/);
});

test("la vista aislada usa la pila tipográfica nativa de Shopify sin fuentes externas", async () => {
  const html = await renderSectionPage(createProductPage({
    product: { id: "gid://shopify/Product/1", title: "Producto", variants: [] }
  }));
  assert.doesNotMatch(html, /fonts\.googleapis|family=Inter/);
  assert.match(html, /font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14px;font-weight:400/);
  assert.match(html, /button,input,select,textarea\{font:inherit\}/);
  assert.match(html, /button,a\{color:inherit\}/);
});

test("el selector de imágenes ofrece carga real y galería de Shopify", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/section-editor.js"), "utf8");
  assert.match(source, /data-media-drop/);
  assert.match(source, /Arrastra y suelta o haz clic para seleccionar/);
  assert.match(source, /Subir imagen/);
  assert.match(source, /Seleccionar de la galería/);
  assert.match(source, /\/api\/paginas\/\$\{encodeURIComponent\(pageId\)\}\/imagenes/);
  assert.match(source, /<s-button variant="primary" id="se-publish"/);
  assert.doesNotMatch(source, /if\(field\.type==="image_picker"\)[^\n]+Pega una URL/);
});

test("la investigación visual conserva evidencia y descarta referencias inventadas", () => {
  const research = validateResearch({
    summary: "Bolso de líneas sobrias.",
    claims: [{ text: "Cierre metálico", source: "shopify_description", verified: true }],
    visualObservations: [
      { text: "Color marrón", mediaId: "media-1" },
      { text: "Dato sin imagen", mediaId: "inventada" }
    ]
  }, ["media-1"]);
  assert.equal(research.claims.length, 1);
  assert.deepEqual(research.visualObservations, [{ text: "Color marrón", mediaId: "media-1" }]);
});

test("el snippet de Shopify se compila desde la misma fuente visual", () => {
  const { output } = buildStorefront({ write: false });
  assert.match(output, new RegExp(productInformation.sourceSha256));
  assert.match(output, /tiq_section\.instance\.settings/);
  assert.match(output, /tiq_section\.instance\.blocks/);
  assert.doesNotMatch(output, /{%\s*schema\s*%}/);
  assert.doesNotMatch(output, /section\.settings|section\.blocks|block\.shopify_attributes/);
});

test("el contrato sanea richtext y rechaza enlaces o rangos peligrosos", () => {
  const instance = JSON.parse(JSON.stringify(productInformation.seed));
  instance.settings.description = '<p onclick="alert(1)">Seguro<script>alert(1)</script></p>';
  instance.settings.max_width = 99999;
  assert.throws(() => validateInstance({ definition: productInformation, instance }), SectionContractError);
  instance.settings.max_width = 1200;
  const valid = validateInstance({ definition: productInformation, instance });
  assert.doesNotMatch(valid.settings.description, /onclick|<script>/);
});
