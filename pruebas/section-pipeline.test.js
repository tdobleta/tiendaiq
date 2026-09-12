"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const productInformation = require("../src/section-pipeline/product-information-v1");
const imageWithText = require("../src/section-pipeline/image-with-text-v1");
const { createProductPage, editorRegistry, instantiateSection, validatePage } = require("../src/section-pipeline/page-pipeline");
const { outlineTargets, renderSectionPage } = require("../src/section-pipeline/preview-renderer");
const { OUTPUT_SCHEMA, validateResearch } = require("../src/section-pipeline/research-product");
const { readCopySlot, normalizePersistedCopySlots } = require("../src/section-pipeline/copy-slots");
const { SectionContractError, createSectionDefinition, sha256, validateInstance } = require("../src/section-pipeline/section-contract");
const { build: buildStorefront } = require("../src/section-pipeline/compile-storefront");
const fs = require("node:fs");
const path = require("node:path");

test("el código Shopify es la fuente inmutable del diseño y del editor", () => {
  assert.equal(productInformation.sourceSha256, "31bb54920850b0b84438c515a3423e0c019c36ecf80d91eb6cc27d56f1123945");
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
  assert.equal(productInformation.contentSources.section.heading, "shopify");
  assert.equal(productInformation.contentSources.section.image_alt, "shopify");
  assert.equal(productInformation.contentSources.section.button_label, "template");
  assert.deepEqual(productInformation.contentSources.blocks.media_thumb, { image: "shopify", alt: "shopify" });
  assert.doesNotMatch(productInformation.source, /if hero_(?:max_width|column_gap|desktop_top|thumbnail_size)/);
  assert.doesNotMatch(productInformation.source, /\| replace:/);
});

test("la investigación de Claude debe devolver los contratos de copy nuevos", () => {
  assert.deepEqual(OUTPUT_SCHEMA.required, ["summary", "claims", "visualObservations", "sectionCopy", "copy_slots_v1"]);
});

test("el registro distingue definiciones, catálogo y capacidades", () => {
  const registry = editorRegistry();
  assert.deepEqual(registry.map((entry) => entry.id), ["product-information", "image-with-text", "image-with-timeline", "image-with-benefits", "benefits-spotlight", "testimonios-con-imagenes", "reviews-carousel", "guarantee-with-social-proof"]);
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
  assert.equal(registry[3].capabilities.editableStructure, true);
  assert.equal(registry[3].capabilities.allowMultipleInstances, true);
  assert.equal(registry[4].catalog.thumbnail, "benefits-spotlight");
  assert.deepEqual(registry[4].copySlots, { section: ["heading", "intro"], blocks: { benefit: ["heading", "body"] } });
  assert.equal(registry[4].capabilities.editableStructure, true);
  assert.deepEqual(registry[5].copySlots, { section: [], blocks: {} });
  assert.equal(registry[7].catalog.category, "Prueba social y confianza");
  assert.deepEqual(registry[7].copySlots, { section: [], blocks: {} });
});

test("Garantía con prueba social es reutilizable y sus elementos son bloques independientes", async () => {
  const guarantee = require("../src/section-pipeline/guarantee-with-social-proof-v1");
  const instance = guarantee.adapt({});
  assert.equal(instance.blocks.length, 3);
  assert.notEqual(instance.blocks[0].id, instance.blocks[1].id);
  const page = createProductPage({ product: { id: "gid://shopify/Product/1", title: "Producto" } });
  page.sections.push({ id: "section-guarantee", label: guarantee.schema.name, definition: { id: guarantee.id, version: guarantee.version, sourceSha256: guarantee.sourceSha256 }, instance });
  const html = await renderSectionPage(validatePage(page));
  assert.match(html, /Compra protegida/);
  assert.match(html, /data-tiq-block-id=/);
});

test("copy_slots_v1 aplica primero los slots autorizados y conserva el formato legado", () => {
  const research = validateResearch({
    summary: "Resumen",
    claims: [],
    visualObservations: [],
    sectionCopy: { imageWithTextBody: "Texto legado" },
    copy_slots_v1: {
      version: 1,
      slots: [{
        target: { section_id: "image-with-text", occurrence: 1, field: "body" },
        value: "Texto por slot",
        evidence: [{ kind: "shopify_description", reference: "product.description" }]
      }]
    }
  }, []);
  const instance = imageWithText.adapt({ title: "Producto" }, research);
  assert.match(instance.settings.body, /Texto por slot/);
  assert.equal(research.sectionCopy.imageWithTextBody, "Texto legado");
  assert.equal(research.copy_slots_v1.slots[0].target.field, "body");
});

test("copy_slots_v1 registra targets desconocidos sin permitir que entren a una sección", () => {
  const research = validateResearch({
    summary: "Resumen",
    claims: [],
    visualObservations: [],
    copy_slots_v1: {
      version: 1,
      slots: [{
        target: { section_id: "image-with-text", occurrence: 1, field: "background_color" },
        value: "#000000",
        evidence: []
      }]
    }
  }, []);
  assert.equal(research.copy_slots_v1.slots.length, 0);
  assert.equal(research.copy_slots_v1.skipped[0].reason, "target_no_autorizado");
});

test("copy_slots_v1 puede apuntar a un bloque estable y mantiene fallback legado por índice", () => {
  const stable = validateResearch({
    summary: "Resumen",
    claims: [],
    visualObservations: [],
    copy_slots_v1: {
      version: 1,
      slots: [{
        target: { section_id: "reviews-carousel", occurrence: 1, block_type: "review", block_id: "block-2", field: "quote" },
        value: "Este texto pertenece al segundo bloque, aunque otro bloque se ordene antes.",
        evidence: []
      }]
    }
  }, []);
  assert.equal(readCopySlot(stable, {
    section_id: "reviews-carousel", occurrence: 1, block_type: "review", block_id: "block-2", block_index: 0, field: "quote"
  }), "Este texto pertenece al segundo bloque, aunque otro bloque se ordene antes.");

  const legacy = normalizePersistedCopySlots({
    version: 1,
    slots: [{
      target: { section_id: "reviews-carousel", occurrence: 1, block_type: "review", block_index: 1, field: "quote" },
      value: "Slot legado",
      evidence: []
    }]
  });
  assert.equal(readCopySlot({ copy_slots_v1: legacy }, {
    section_id: "reviews-carousel", occurrence: 1, block_type: "review", block_id: "block-2", block_index: 1, field: "quote"
  }), "Slot legado");
});

test("una página conserva la procedencia durable de cada slot generado", () => {
  const page = createProductPage({
    product: { id: "gid://shopify/Product/1", title: "Producto" },
    generatedAt: "2026-09-11T12:00:00.000Z",
    research: {
      copy_slots_v1: {
        version: 1,
        slots: [{
          target: { section_id: "product-information", occurrence: 1, field: "description" },
          value: "Una descripción basada en Shopify.",
          evidence: [{ kind: "shopify_description", reference: "product.description" }]
        }]
      }
    }
  });
  const slot = validatePage(page).copy_slots_v1.slots[0];
  assert.equal(slot.value, "Una descripción basada en Shopify.");
  assert.deepEqual(slot.evidence, [{ kind: "shopify_description", reference: "product.description" }]);
  assert.deepEqual(slot.provenance, {
    source: "ai",
    contract: "copy_slots_v1",
    prompt_version: "copy-slots-v1",
    generated_at: "2026-09-11T12:00:00.000Z"
  });
});

test("la adaptación rechaza cambios fuera de copySlots y de datos derivados declarados", () => {
  const unsafe = createSectionDefinition({
    id: "scope-check",
    version: 1,
    source: imageWithText.source,
    adaptation: ({ seed }) => ({ ...seed, settings: { ...seed.settings, background_color: "#000000" } })
  });
  assert.throws(() => unsafe.adapt({}), /campo de sección no autorizado/);
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

test("Beneficios destacados replica la composición central de PagePilot y conserva bloques independientes", async () => {
  const spotlight = require("../src/section-pipeline/benefits-spotlight-v1");
  const product = { title: "Bolso Atelier", media: [{ url: "https://cdn.shopify.com/bolso.jpg" }] };
  const research = {
    summary: "Una pieza cómoda para acompañar tu jornada.",
    copy_slots_v1: {
      version: 1,
      slots: [
        { target: { section_id: "benefits-spotlight", occurrence: 1, field: "heading" }, value: "Una presencia más segura durante el día", evidence: [] },
        { target: { section_id: "benefits-spotlight", occurrence: 1, field: "intro" }, value: "Diseñado para acompañar tu ritmo.", evidence: [] },
        { target: { section_id: "benefits-spotlight", occurrence: 1, block_type: "benefit", block_id: "block-1", block_index: 0, field: "heading" }, value: "Más simple cada mañana", evidence: [] }
      ],
      skipped: []
    }
  };
  const instance = spotlight.adapt(product, research);
  assert.equal(instance.settings.image, "https://cdn.shopify.com/bolso.jpg");
  assert.equal(instance.settings.heading, "Una presencia más segura durante el día");
  assert.match(instance.settings.intro, /Diseñado para acompañar/);
  assert.equal(instance.blocks.length, 4);
  assert.equal(instance.blocks[0].settings.position, "left-top");
  assert.equal(instance.blocks[3].settings.position, "right-bottom");
  assert.equal(spotlight.editor.outline.find((node) => node.id === "spotlight-benefits").blockType, "benefit");
  const page = createProductPage({ product });
  page.sections.push({ id: "section-benefits-spotlight", label: spotlight.schema.name, definition: { id: spotlight.id, version: spotlight.version, sourceSha256: spotlight.sourceSha256 }, instance });
  const html = await renderSectionPage(validatePage(page));
  assert.match(html, /tiq-benefits-spotlight/);
  assert.match(html, /Una presencia más segura/);
  assert.match(html, /data-tiq-block-id=/);
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

test("una segunda instancia no reutiliza el copy de la primera ocurrencia", () => {
  const research = {
    summary: "Descripción de Shopify",
    copy_slots_v1: {
      version: 1,
      slots: [{
        target: { section_id: "image-with-text", occurrence: 1, field: "body" },
        value: "Copy de la primera sección",
        evidence: []
      }],
      skipped: []
    }
  };
  const first = instantiateSection(
    { id: "image-with-text", version: 1 },
    { title: "Producto", description: "Descripción de Shopify" },
    research,
    "es",
    { occurrence: 1 }
  );
  const second = instantiateSection(
    { id: "image-with-text", version: 1 },
    { title: "Producto", description: "Descripción de Shopify" },
    research,
    "es",
    { occurrence: 2 }
  );
  assert.match(first.settings.body, /Copy de la primera sección/);
  assert.match(second.settings.body, /Descripción de Shopify/);
  assert.doesNotMatch(second.settings.body, /Copy de la primera sección/);
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

test("el idioma seleccionado localiza el copy fijo de la plantilla sin cambiar datos Shopify", () => {
  const product = {
    id: "gid://shopify/Product/locale-test",
    title: "Producto de prueba",
    description: "Descripción del producto.",
    media: [{ url: "https://cdn.shopify.com/producto.jpg", altText: "Producto" }]
  };
  const english = createProductPage({ product, idioma: "en" }).sections[0].instance;
  assert.equal(english.settings.heading, "Producto de prueba");
  assert.equal(english.settings.rating_text, "Rated 4.9 ‘Excellent’");
  assert.equal(english.settings.bundle_heading, "BUNDLE & SAVE");
  assert.equal(english.settings.button_label, "ADD TO CART");
  assert.deepEqual(english.blocks.filter((block) => block.type === "benefit").map((block) => block.settings.text), [
    "Helps support the prostate",
    "Balances hormones",
    "Increases stamina",
    "Improves blood flow"
  ]);
  assert.deepEqual(english.blocks.filter((block) => block.type === "tab").map((block) => block.settings.title), [
    "Reviews",
    "Comparison",
    "Specifications"
  ]);

  const portuguese = createProductPage({ product, idioma: "pt-BR" }).sections[0].instance;
  assert.equal(portuguese.settings.button_label, "ADICIONAR AO CARRINHO");
  assert.equal(portuguese.blocks.find((block) => block.type === "trust_item").settings.text, "Envio rápido");

  const fallback = createProductPage({ product, idioma: "fr" }).sections[0].instance;
  assert.equal(fallback.settings.button_label, "AÑADIR AL CARRITO");
});

test("una página persistida con la huella anterior se migra al registro vigente", () => {
  const page = JSON.parse(JSON.stringify(createProductPage({
    product: { id: "gid://shopify/Product/123", title: "Producto migrable" }
  })));
  page.sections[0].definition.sourceSha256 = "huella-liquid-anterior";

  const migrated = validatePage(page);
  assert.equal(migrated.sections[0].definition.sourceSha256, productInformation.sourceSha256);
  assert.equal(migrated.sections[0].instance.settings.heading, "Producto migrable");
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
  assert.match(html, /class="product-hero-section-product-information__cta-form"[\s\S]*action="\/cart\/add"/);
  assert.match(html, /name="id" value="gid:\/\/shopify\/ProductVariant\/1"/);
  assert.match(html, /name="quantity" value="1" data-cart-quantity/);
  assert.match(html, /<button type="submit"[\s\S]*class="product-hero-section-product-information__cta"/);
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
