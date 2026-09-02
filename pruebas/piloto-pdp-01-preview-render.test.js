"use strict";

// Piloto 01 monta una plantilla FIJA: la página que el merchant diseñó, saneada
// e incrustada en el runtime. Estas pruebas cubren las tres cosas que ya nos
// fallaron una vez cada una:
//
//   1. ESTABILIDAD — el canvas del editor se destruía y recargaba en bucle.
//      No estaba vacío: se reiniciaba. Una prueba de contenido no lo detecta.
//   2. ARTEFACTO   — que el diseño aprobado viaje entero y sin assets ajenos.
//   3. CACHÉ       — que los assets versionados entren al cache-busting.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

const RAIZ = path.join(__dirname, "..");
const RUNTIME = path.join(RAIZ, "extensions", "tiendaiq-widgets", "assets", "piloto-pdp-01.js");
const codigo = fs.readFileSync(RUNTIME, "utf8");
const { PILOTO_PDP_01_V1 } = require("../src/domain/fixed-template-manifest");
const { canonicalSource } = require("../scripts/build-piloto-pdp-01-template");

function artefacto() {
  const m = codigo.match(/const FIXED_TEMPLATE_SOURCE_BASE64 = "([^"]*)";/);
  assert.ok(m, "el runtime no trae el artefacto incrustado");
  return Buffer.from(m[1], "base64").toString("utf8");
}

// ---------------------------------------------------------------- estabilidad
// Se ejercita el arranque en frío. El renderer necesita un DOM completo para
// pintar, pero el puente tiene que aceptar el documento y nunca recargar la
// ventana: el montaje real se cubre desde el navegador.
function montarEnFrio() {
  const estado = { reloads: 0, guardado: null, listeners: [] };
  const sandbox = {
    window: { addEventListener: (t, fn) => { if (t === "message") estado.listeners.push(fn); }, TIENDAIQ_DATA: undefined },
    document: { documentElement: { lang: "es" }, getElementById: () => null },
    location: { search: "?app=1", origin: "https://tiendaiq.com", reload() { estado.reloads += 1; }, assign() {} },
    sessionStorage: { getItem: () => estado.guardado, setItem: (_k, v) => { estado.guardado = v; } },
    fetch: async () => ({ ok: true }),
    atob: (b) => Buffer.from(b, "base64").toString("binary"),
    DOMParser: function () { this.parseFromString = () => ({ body: { childNodes: [] } }); },
    TextDecoder: function () { this.decode = () => ""; }
  };
  sandbox.window.location = sandbox.location;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(codigo, sandbox);
  estado.postear = (p, origin = "https://tiendaiq.com") => estado.listeners.forEach((fn) => fn({ data: p, origin }));
  return estado;
}

const payload = (claim) => ({
  tiendaiq: true,
  urls: { "gid://shopify/MediaImage/1": "https://cdn.shopify.com/x.jpg" },
  data: { piloto_pdp_01: { template: "piloto-pdp-01", contract_version: 1, content: { hero: { claim } } } }
});

test("ESTABILIDAD · el reenvío del mismo documento no recarga el iframe", () => {
  // El editor postea al cargar y después de una edición. El runtime actualiza
  // su DOM internamente: `location.reload` jamás forma parte del camino.
  const app = montarEnFrio();
  app.postear(payload("uno"));
  assert.equal(app.reloads, 0, "el primer documento no puede recargar el preview");
  const primerGuardado = app.guardado;
  assert.ok(primerGuardado?.includes("uno"), "el documento queda disponible para el primer montaje");

  app.postear(payload("uno"));
  app.postear(payload("uno"));
  app.postear(payload("uno"));
  assert.equal(app.reloads, 0, "un documento idéntico no puede provocar recargas");
  assert.equal(app.guardado, primerGuardado, "un documento idéntico tampoco vuelve a montarse");
});

test("ESTABILIDAD · una edición real conserva la ventana y reemplaza el documento", () => {
  const app = montarEnFrio();
  app.postear(payload("uno"));
  app.postear(payload("dos"));
  assert.equal(app.reloads, 0, "cada cambio de contenido refresca sin recargar");
  assert.ok(app.guardado?.includes("dos"), "la edición nueva reemplaza el documento almacenado");
  app.postear(payload("dos"));
  assert.equal(app.reloads, 0, "y no vuelve a recargar con el mismo contenido");
});

test("PUENTE · descarta mensajes de otro origen", () => {
  const app = montarEnFrio();
  app.postear(payload("ajeno"), "https://un-origen-ajeno.example");
  assert.equal(app.guardado, null, "un origen externo no puede modificar el preview");
  assert.equal(app.reloads, 0);
});

// ------------------------------------------------------------------ artefacto
test("ARTEFACTO · el runtime lleva la plantilla aprobada entera", () => {
  const html = artefacto();

  assert.equal(
    crypto.createHash("sha256").update(html).digest("hex"),
    PILOTO_PDP_01_V1.sourceSha256,
    "el artefacto incrustado no es el que declara el manifiesto"
  );

  // Las 8 secciones del diseño y sus hojas de estilo.
  assert.equal((html.match(/<section/g) || []).length, 8, "faltan secciones de la plantilla");
  assert.equal((html.match(/<style>/g) || []).length, 18, "faltan bloques de estilo de la plantilla");
  assert.ok(html.includes("phv4"), "falta el hero del diseño");
  assert.ok(html.includes("scp-postcart"), "faltan las secciones posteriores");

  // Los ganchos que el binder necesita para inyectar datos.
  for (const gancho of ["phv4-main-image", "phv4-thumb", "phv4-claim", "phv4-check", "phv4-pack-title", "phv4-atc", "scp-why-copy", "scp-journey-head", "scp-timeline"]) {
    assert.ok(html.includes(gancho), `el artefacto perdió el gancho ${gancho}`);
  }
});

test("ARTEFACTO · no distribuye scripts ni assets de otra tienda", () => {
  const html = artefacto();
  assert.equal((html.match(/<script/gi) || []).length, 0, "el artefacto no puede traer scripts de origen");
  assert.ok(!/https?:\/\/cdn\.shopify\.com/i.test(html), "el artefacto no puede hotlinkear la CDN de otra tienda");
  assert.ok(!/url\((['"]?)https?:/i.test(html), "ningún fondo CSS puede apuntar afuera");
  // La regla que reescribía la tipografía de toda la tienda del merchant.
  assert.ok(!/html,body,body :is\(/.test(html), "el artefacto no puede reestilar el tema del merchant");
});

test("ARTEFACTO · el copy de origen no viaja: queda como slot vacío", () => {
  const html = artefacto();
  assert.ok((html.match(/Contenido del producto/g) || []).length > 50, "el saneador debe haber vaciado el copy de origen");
  assert.ok(!/remolacha/i.test(html), "no puede viajar el producto de la página de referencia");
});

test("BINDER · apaga con estilo inline, no con el atributo hidden", () => {
  // El artefacto no declara [hidden]{display:none} y su CSS trae display de
  // autor en varias secciones: ocultar con el atributo no alcanzaría y la
  // evidencia sin fuente seguiría visible.
  assert.match(codigo, /style\.setProperty\("display", "none", "important"\)/);
  assert.ok(!/\.hidden = true/.test(codigo), "no debe ocultarse con el atributo hidden");
});

test("BINDER · las secciones posteriores usan media Shopify y no alteran el hero", () => {
  assert.match(codigo, /setEditorialImage\("\.scp-compare-photo img", c\.media\?\.comparison_media_id/);
  assert.match(codigo, /setEditorialImage\("\.scp-faq-v3-media img", c\.media\?\.gallery_media_ids/);
  assert.match(codigo, /const detalles = all\(root, "\.scp-faq-v3-list details"\)/);
  assert.ok(!/const detalles = all\(root, "details"\)/.test(codigo), "el FAQ posterior no puede pisar los acordeones del hero");
  assert.match(codigo, /\.scp-point > p/);
  assert.match(codigo, /newsletter\.setAttribute\("action", "\/contact#contact_form"\)/);
});

test("BINDER · el CTA de compra no conserva el texto saneado de la fuente", () => {
  assert.match(codigo, /const setAtcLabel = \(label\) =>/);
  assert.match(codigo, /setAtcLabel\(ok \? "Añadir al carrito" : "Sin stock"\)/);
  assert.match(codigo, /\.phv4-subscribe, \.phv4-payment-icons/);
});

test("BINDER · conserva la composición completa con slots editoriales reales", () => {
  assert.match(codigo, /const quickFacts = c\.quick\?\.items/);
  assert.match(codigo, /const storyMedia = c\.media\?\.story_media_ids/);
  assert.match(codigo, /const storyImageMedia = storyMedia\.length \? storyCards\.map/);
  assert.match(codigo, /const stories = c\.stories/);
  assert.match(codigo, /const closing = c\.closing/);
  assert.match(codigo, /c\.newsletter\?\.heading/);
  assert.ok(!/\.scp-community"\)\.forEach\(hide\)/.test(codigo), "el cierre editorial no puede apagarse si el documento lo completa");
  assert.match(codigo, /Cada bloque de la plantilla siempre se conserva/);
  assert.match(codigo, /Conocé el producto/);
  assert.match(codigo, /Sobre este producto/);
  assert.match(codigo, /ensureOfferTimer/);
  assert.match(codigo, /\.scp-story-next"\)\?\.addEventListener\("click"/);
  assert.match(codigo, /button\.addEventListener\("click", \(\) => \{/);
});

test("BINDER · mantiene las cinco tarjetas de reseña y no inventa prueba social", () => {
  assert.match(codigo, /const savedReviews = Array\.isArray\(ev\.testimonials\?\.items\)/);
  assert.match(codigo, /Array\.from\(\{ length: 5 \}/);
  assert.match(codigo, /slides\.forEach\(\(slide, index\) => \{/);
  assert.match(codigo, /savedReviews\.length \? show : hide/);
  assert.ok(!/if \(i > 0\) return hide\(slide\)/.test(codigo), "la plantilla no puede colapsar cinco tarjetas en una");
});

test("EDITOR · el runtime sólo marca y comunica bloques dentro del preview", () => {
  assert.match(codigo, /if \(previewMode\) \{\s*const editorBlocks/s);
  assert.match(codigo, /data-tiq-editor-block/);
  assert.match(codigo, /window\.parent\?\.postMessage\(\{ tiendaiqEditor: "select-block"/);
  assert.match(codigo, /event\.data\?\.tiendaiqEditor !== "highlight-block"/);
  assert.match(codigo, /\.tiq-editor-active/);
});

test("EDITOR · la selección usa el foco sobrio del sistema, sin halo decorativo", () => {
  assert.match(codigo, /--tiq-editor-focus:#005bd3/);
  assert.match(codigo, /outline:2px solid var\(--tiq-editor-focus\)/);
  assert.ok(!/#5740ff|rgba\(87,64,255/.test(codigo), "el canvas no debe conservar el foco violeta experimental");
  assert.ok(!/box-shadow:0 0 0 5px/.test(codigo), "la selección no debe encerrar el contenido con un halo pesado");
});

// ---------------------------------------------------------------------- caché
test("CACHÉ · todo asset versionado del preview participa de VERSION_ASSETS", () => {
  const indice = fs.readFileSync(path.join(RAIZ, "plantilla-producto", "index.html"), "utf8");
  const servidor = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");
  const assets = [...indice.matchAll(/\/widgets\/([\w.-]+)\?v=/g)].map((m) => m[1]);
  assert.ok(assets.length >= 4, `esperaba varios assets versionados, encontré ${assets.length}`);

  const calculo = servidor.slice(servidor.indexOf("const VERSION_ASSETS"), servidor.indexOf("})();", servidor.indexOf("const VERSION_ASSETS")));
  const reescritura = servidor.match(/\.replace\(\/\(([^)]+)\)\\\?v=/);
  assert.ok(reescritura, "no encontré la reescritura de ?v= en la ruta /preview");

  for (const asset of new Set(assets)) {
    assert.ok(calculo.includes(`"${asset}"`), `${asset} se pide con ?v= pero no entra al cálculo de VERSION_ASSETS`);
    assert.ok(reescritura[1].includes(asset.replace(/\./g, "\\.")), `${asset} no se reescribe en /preview`);
  }
});

test("BUILD · la revisión visual es estable entre Windows y el checkout canónico", () => {
  const canonical = "<section>\n  <p>Producto</p>\n</section>\n";
  assert.equal(canonicalSource(canonical.replace(/\n/g, "\r\n")), canonical);
  assert.equal(canonicalSource(canonical), canonical);
});
