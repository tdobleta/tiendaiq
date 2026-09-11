"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const productInformation = require("../src/section-pipeline/product-information-v1");
const imageWithText = require("../src/section-pipeline/image-with-text-v1");
const { createProductPage, editorRegistry, instantiateSection, validatePage } = require("../src/section-pipeline/page-pipeline");
const { outlineTargets, renderSectionPage } = require("../src/section-pipeline/preview-renderer");
const { validateResearch } = require("../src/section-pipeline/research-product");
const { SectionContractError, sha256, validateInstance } = require("../src/section-pipeline/section-contract");
const { build: buildStorefront } = require("../src/section-pipeline/compile-storefront");
const fs = require("node:fs");
const path = require("node:path");

test("el código Shopify es la fuente inmutable del diseño y del editor", () => {
  assert.equal(productInformation.sourceSha256, "e83983df67324428fd6c9b0455afd4ef32194d9bd4e8424f3c21f4199c3482f8");
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
  assert.deepEqual(productInformation.copySlots, { section: ["description"], blocks: { benefit: ["text"] } });
  assert.deepEqual(productInformation.contentSources.section, { heading: "shopify", image_alt: "shopify" });
  assert.deepEqual(productInformation.contentSources.blocks.media_thumb, { image: "shopify", alt: "shopify" });
  assert.doesNotMatch(productInformation.source, /if hero_(?:max_width|column_gap|desktop_top|thumbnail_size)/);
  assert.doesNotMatch(productInformation.source, /\| replace:/);
});

test("el registro distingue definiciones, catálogo y capacidades", () => {
  const registry = editorRegistry();
  assert.deepEqual(registry.map((entry) => entry.id), ["product-information", "image-with-text", "image-with-timeline", "image-with-benefits", "testimonios-con-imagenes"]);
  assert.equal(registry[0].capabilities.duplicable, false);
  assert.equal(registry[0].capabilities.protected, true);
  assert.equal(registry[0].capabilities.reorderable, false);
  assert.equal(registry[0].capabilities.allowMultipleInstances, false);
  assert.equal(registry[1].catalog.category, "Imagen y contenido");
  assert.equal(registry[1].capabilities.editableStructure, false);
  assert.equal(registry[1].capabilities.allowMultipleInstances, true);
  assert.ok(registry[1].capabilities.responsive.includes("mobile_gap"));
  assert.equal(registry[3].catalog.category, "Beneficios y características");
  assert.deepEqual(registry[2].copySlots.blocks.timeline_step, ["heading", "body"]);
  assert.equal(registry[1].contentSources.section.image, "shopify");
  assert.equal(registry[3].contentSources.section.image_alt, "shopify");
  assert.deepEqual(registry[4].copySlots, { section: [], blocks: {} });
  assert.equal(registry[3].capabilities.editableStructure, true);
  assert.equal(registry[3].capabilities.allowMultipleInstances, true);
});

test("Imagen con beneficios mantiene diseño, imagen vinculada y bloques repetibles", async () => {
  const benefits = require("../src/section-pipeline/image-with-benefits-v1");
  const product = { title: "Bolso Atelier", media: [{ url: "https://cdn.shopify.com/bolso.jpg" }] };
  const instance = benefits.adapt(product, { summary: "Una opción práctica para todos los días." });
  assert.equal(instance.settings.image, "https://cdn.shopify.com/bolso.jpg");
  assert.equal(instance.settings.intro, "<p>Una opción práctica para todos los días.</p>");
  assert.equal(instance.blocks.length, 3);
  const page = createProductPage({ product });
  page.sections.push({ id: "section-image-with-benefits", label: benefits.schema.name, definition: { id: benefits.id, version: benefits.version, sourceSha256: benefits.sourceSha256 }, instance });
  const valid = validatePage(page);
  const html = await renderSectionPage(valid);
  assert.match(html, /section-image-with-benefits/);
  assert.match(html, /Más simple cada día/);
});

test("Image with Text se adapta al producto sin modificar su fuente visual", async () => {
  const before = imageWithText.source;
  const product = {
    id: "gid://shopify/Product/123",
    title: "Bolso Atelier",
    description: "Cuero flexible con cierre metálico.",
    media: [{ id: "gid://shopify/MediaImage/1", url: "https://cdn.shopify.com/bolso.jpg", alt: "Bolso marrón" }],
    variants: [{ id: "gid://shopify/ProductVariant/2", title: "Marrón", price: "122.00" }]
  };
  const page = JSON.parse(JSON.stringify(createProductPage({ product })));
  page.sections.push({
    id: "section-image-with-text",
    label: imageWithText.schema.name,
    definition: { id: imageWithText.id, version: imageWithText.version, sourceSha256: imageWithText.sourceSha256 },
    instance: imageWithText.adapt(product, { summary: "Un bolso versátil para acompañar la rutina diaria." })
  });
  const valid = validatePage(page);
  const html = await renderSectionPage(valid);
  assert.equal(imageWithText.source, before);
  assert.equal(valid.sections[1].instance.settings.heading, "Bolso Atelier");
  assert.equal(valid.sections[1].instance.settings.image, "https://cdn.shopify.com/bolso.jpg");
  assert.match(html, /section-image-with-text/);
  assert.match(html, /Bolso Atelier/);
  assert.match(html, /Un bolso versátil/);
});

test("la inserción usa el adaptador común del registro, no condiciones del navegador", () => {
  const instance = instantiateSection({ id: "image-with-text", version: 1 }, {
    title: "Bolso Atelier",
    media: [{ url: "https://cdn.shopify.com/bolso.jpg", alt: "Bolso marrón" }]
  });
  assert.equal(instance.settings.heading, "Bolso Atelier");
  assert.equal(instance.settings.image, "https://cdn.shopify.com/bolso.jpg");
  const editor = fs.readFileSync(path.join(__dirname, "../app/section-editor.js"), "utf8");
  assert.doesNotMatch(editor, /entry\.id==="image-with-text"/);
  assert.match(editor, /sections\/instantiate/);
});

test("crear una página conserva el diseño Shopify y adapta sólo contenido autorizado", () => {
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
  assert.notDeepEqual(page.sections[0].instance, productInformation.seed);
  assert.equal(page.sections[0].instance.settings.heading, "Bolso Atelier");
  assert.equal(page.sections[0].instance.settings.description, "<p>Un bolso versátil para el uso diario.</p>");
  assert.equal(page.sections[0].instance.settings.image_alt, "Bolso Atelier");
  assert.equal(page.sections[0].instance.settings.max_width, 940);
  assert.equal(page.sections[0].instance.settings.card_gap, 5);
  assert.equal(page.sections[0].instance.settings.thumbnail_size, 60);
  assert.equal(page.sections[0].instance.settings.background_color, "#11151c");
  assert.equal(page.sections[0].instance.settings.bundle_heading, "COMBOS Y AHORRA");
  assert.equal(page.sections[0].instance.settings.rating_stars, "★★★★★");
  assert.equal(page.productSnapshot.media.length, 1);
  assert.equal(page.sections[0].instance.blocks.some((block) => block.type === "media_thumb"), false);
  assert.equal(page.sections[0].instance.blocks.length, 19);
  assert.equal(page.sections[0].instance.blocks.filter((block) => block.type === "bundle").length, 3);
  assert.equal(page.sections[0].instance.blocks.some((block) => block.binding), false);
});

test("producto e investigación no pueden alterar estructura ni insertar claims sin evidencia", () => {
  const page = createProductPage({
    product: { id: "gid://shopify/Product/1", title: "Producto", variants: [] },
    research: {
      rating: { verified: false, label: "4.9 basado en 900 reseñas" },
      claims: [{ text: "Resultado garantizado", verified: false, source: "modelo" }]
    }
  });
  const instance = page.sections[0].instance;
  assert.equal(instance.settings.heading, "Producto");
  assert.equal(instance.settings.description, productInformation.seed.settings.description);
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
  assert.match(html, /Bolso Atelier/);
  assert.match(html, /https:\/\/cdn\.shopify\.com\/bolso\.jpg/);
  assert.match(html, /data-tiq-section-id="section-product-information"/);
  assert.match(html, /data-tiq-block-id=/);
  assert.match(html, /class="product-hero-section-product-information__bundle-image"/);
  assert.match(html, /class="product-hero-section-product-information__thumbnail-image"/);
  assert.match(html, /data-variant-id="gid:\/\/shopify\/ProductVariant\/1"/);
  assert.match(html, /class="product-hero-section-product-information__cta"[\s\S]*href="#"/);
  assert.match(html, /Envío rápido/);
  assert.match(html, /Garantía de 60 días/);
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
    suffix: "__title"
  });
  assert.ok(targets.some((target) => target.outlineId === "product-gallery" && target.suffix === "__media-column"));
  assert.ok(targets.some((target) => target.outlineId === "buy-buttons" && target.suffix === "__cta"));
  for (const target of targets) {
    assert.match(productInformation.source, new RegExp(`class="[^"]*\\{\\{ section_dom_id \\}\\}${target.suffix}`));
  }
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
  assert.match(source, /Imágenes del producto y archivos de Shopify/);
  assert.match(source, /state\.shopFiles=/);
  assert.match(source, /data-gallery-more>Cargar más/);
  assert.match(source, /loadShopFiles\(state\.shopFilesPageInfo\.endCursor\)/);
  assert.doesNotMatch(source, /state\.page\.productSnapshot=\{/);
  assert.match(source, /<s-button variant="primary" id="se-publish"/);
  assert.doesNotMatch(source, /if\(field\.type==="image_picker"\)[^\n]+Pega una URL/);
});

test("el editor conserva estado limpio, filtra la biblioteca y guarda con revisión", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/section-editor.js"), "utf8");
  assert.match(source, /savedFingerprint/);
  assert.match(source, /function syncDirty\(\)/);
  assert.match(source, /expected_revision:expectedRevision/);
  assert.match(source, /data-library-category/);
  assert.match(source, /function filterLibrary\(\)/);
  assert.match(source, /No encontramos secciones con esos filtros/);
  assert.match(source, /event\.key\.toLowerCase\(\)==="s"/);
  assert.match(source, /window\.addEventListener\("beforeunload"/);
  assert.match(source, /previewAbort\?\.abort\(\)/);
  assert.match(source, /function formatRichText\(button\)/);
  assert.match(source, /data-rich="spark"[^>]+disabled/);
});

test("el inspector comunica el origen de cada campo desde el contrato de la sección", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/section-editor.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../app/section-editor.css"), "utf8");
  assert.match(source, /function copySlot\(entry,scope,block,fieldId\)/);
  assert.match(source, /function contentSource\(entry,scope,block,fieldId\)/);
  assert.match(source, /function fieldOrigin\(entry,scope,block,fieldId\)/);
  assert.match(source, /se__origin-badge--\$\{origin\.kind\}/);
  assert.match(source, /Los cambios que hagas aquí son ediciones manuales/);
  assert.match(css, /se__origin-badge--shopify/);
  assert.match(css, /se__origin-badge--ai/);
  assert.match(css, /se__origin-badge--template/);
});

test("la investigación visual conserva evidencia y descarta referencias inventadas", () => {
  const research = validateResearch({
    summary: "Bolso de líneas sobrias.",
    claims: [{ text: "Cierre metálico", source: "shopify_description", verified: true }],
    visualObservations: [
      { text: "Color marrón", mediaId: "media-1" },
      { text: "Dato sin imagen", mediaId: "inventada" }
    ],
    sectionCopy: {
      productBenefits: ["Cierre seguro", "<script>no entra</script>"],
      timelineIntro: "Una historia clara.",
      timelineSteps: [{ heading: "Paso uno", body: "Detalle del paso." }]
    }
  }, ["media-1"]);
  assert.equal(research.claims.length, 1);
  assert.deepEqual(research.visualObservations, [{ text: "Color marrón", mediaId: "media-1" }]);
  assert.deepEqual(research.sectionCopy.productBenefits, ["Cierre seguro", "<script>no entra</script>"]);
  assert.equal(research.sectionCopy.timelineSteps[0].heading, "Paso uno");
});

test("el snippet de Shopify se compila desde la misma fuente visual", () => {
  const { output, artifacts, router } = buildStorefront({ write: false });
  assert.match(output, new RegExp(productInformation.sourceSha256));
  assert.match(output, /tiq_section\.instance\.settings/);
  assert.match(output, /tiq_section\.instance\.blocks/);
  assert.doesNotMatch(output, /{%\s*schema\s*%}/);
  assert.doesNotMatch(output, /section\.settings|section\.blocks|block\.shopify_attributes/);
  const imageArtifact = artifacts.find((artifact) => artifact.definition.id === "image-with-text");
  assert.ok(imageArtifact);
  assert.match(imageArtifact.output, new RegExp(imageWithText.sourceSha256));
  assert.match(imageArtifact.output, /tiq_section\.instance\.settings/);
  assert.doesNotMatch(imageArtifact.output, /{%\s*schema\s*%}/);
  assert.match(router.output, /render 'tiq-product-information-v1'/);
  assert.match(router.output, /render 'tiq-image-with-text-v1'/);
  const block = fs.readFileSync(path.join(__dirname, "../extensions/tiendaiq-widgets/blocks/pagina.liquid"), "utf8");
  assert.match(block, /render 'tiq-section-router'/);
  assert.doesNotMatch(block, /tq_section\.definition\.id == 'image-with-text'/);
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

test("el contrato rechaza ids duplicados y límites de bloques", () => {
  const duplicate = JSON.parse(JSON.stringify(productInformation.seed));
  duplicate.blocks[1].id = duplicate.blocks[0].id;
  assert.throws(() => validateInstance({ definition: productInformation, instance: duplicate }), /duplicado/);
  const excessive = JSON.parse(JSON.stringify(productInformation.seed));
  while (excessive.blocks.length <= 50) excessive.blocks.push({ ...excessive.blocks[0], id: `extra-${excessive.blocks.length}` });
  assert.throws(() => validateInstance({ definition: productInformation, instance: excessive }), /máximo 50/);
  const permissiveSchema = { ...productInformation, schema: { ...productInformation.schema, max_blocks: 75 } };
  assert.throws(() => validateInstance({ definition: permissiveSchema, instance: excessive }), /máximo 50/);
});
