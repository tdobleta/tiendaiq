"use strict";

// El canvas del editor NO estaba vacío: se destruía y volvía a crearse en
// bucle, y el merchant sólo alcanzaba a ver la primera imagen del hero.
//
// Por eso acá no alcanza con comprobar que el punto de montaje existe (eso ya
// lo hace template-rendering-contract.test.js y pasaba con el bug puesto).
// Estas pruebas verifican dos cosas distintas:
//   1. ESTABILIDAD — que un reenvío idéntico del documento no recargue el
//      iframe. Es lo que rompía el bucle infinito.
//   2. CONTENIDO   — que lo que se pinta tenga la página real adentro.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const ASSET = path.join(__dirname, "..", "extensions", "tiendaiq-widgets", "assets", "piloto-pdp-01.js");
const codigo = fs.readFileSync(ASSET, "utf8");

function documento() {
  return {
    contract_version: 1,
    template: "piloto-pdp-01",
    source_fields: {
      product_gid: "gid://shopify/Product/1",
      title: "Pinza recogedora",
      variants: [{ id: "gid://shopify/ProductVariant/11", title: "Única" }]
    },
    content: {
      hero: { claim: "Recogé sin agacharte", bullets: ["Sin contacto", "Se lava con agua"] },
      offer: {
        heading: "Elegí tu pack",
        packs: [
          { id: "cantidad-1", label: "1 unidad", subtitle: "Inicio", quantity: 1, mechanism: "multi_quantity", variant_id: "gid://shopify/ProductVariant/11" },
          { id: "cantidad-3", label: "3 unidades", subtitle: "Ahorro", quantity: 3, mechanism: "multi_quantity", variant_id: "gid://shopify/ProductVariant/11" }
        ]
      },
      why: { eyebrow: "Por qué", heading: "Un movimiento y listo", body: "Pesa 180 gramos.", points: ["Cero contacto", "Una sola mano"] },
      timeline: { heading: "Tu paseo", intro: "Semana a semana", steps: [{ label: "Semana 1", heading: "Arranca", body: "Se nota enseguida." }] },
      faq: { heading: "Preguntas", items: [
        { question: "¿Sirve en pasto?", answer: "Sí." },
        { question: "¿Cómo se limpia?", answer: "Con agua." },
        { question: "¿Cuánto tarda el envío?", answer: "Se calcula en el checkout." }
      ] },
      media: { hero_media_id: "gid://shopify/MediaImage/91", gallery_media_ids: ["gid://shopify/MediaImage/91", "gid://shopify/MediaImage/92"] }
    },
    evidence: {}
  };
}

const URLS = {
  "gid://shopify/MediaImage/91": "https://cdn.shopify.com/uno.jpg",
  "gid://shopify/MediaImage/92": "https://cdn.shopify.com/dos.jpg"
};

// DOM mínimo: sólo lo que el renderer toca. Sin dependencias nuevas.
function nodo() {
  return {
    dataset: {}, disabled: false, textContent: "", src: "",
    classList: { toggle() {} },
    addEventListener() {}
  };
}

function montar({ cache = null } = {}) {
  const estado = { reloads: 0, guardado: cache, html: "", listeners: [] };
  const root = nodo();

  const sandbox = {
    window: {
      addEventListener(tipo, fn) { if (tipo === "message") estado.listeners.push(fn); },
      TIENDAIQ_DATA: undefined, TIENDAIQ_URLS: undefined,
      TIENDAIQ_PRODUCT_TITLE: undefined, TIENDAIQ_VARIANTS: undefined
    },
    document: {
      documentElement: { lang: "es" },
      getElementById: (id) => (id === "piloto-pdp-01" ? root : null)
    },
    location: { search: "?app=1", reload() { estado.reloads += 1; }, assign() {} },
    sessionStorage: {
      getItem: () => estado.guardado,
      setItem: (_k, v) => { estado.guardado = v; }
    },
    fetch: async () => ({ ok: true })
  };
  sandbox.window.location = sandbox.location;
  sandbox.globalThis = sandbox;

  Object.defineProperty(root, "innerHTML", {
    get: () => estado.html,
    set: (v) => { estado.html = v; }
  });
  root.querySelector = (sel) => (estado.html.includes(sel.replace(/[[\]]/g, "")) || true ? nodo() : null);
  root.querySelectorAll = () => [];

  vm.runInNewContext(codigo, sandbox);

  estado.postear = (payload) => estado.listeners.forEach((fn) => fn({ data: payload }));
  return estado;
}

const payload = (doc) => ({ tiendaiq: true, data: { piloto_pdp_01: doc }, urls: URLS });

test("ESTABILIDAD · el reenvío del mismo documento no recarga el iframe", () => {
  // El editor postea en cada onload del iframe (app/app.js -> marco.onload).
  // Con el bug, cada uno de esos reenvíos disparaba location.reload() y el
  // canvas quedaba reiniciándose para siempre.
  const cache = JSON.stringify({ data: { piloto_pdp_01: documento() }, urls: URLS });
  const app = montar({ cache });

  assert.equal(app.reloads, 0, "no debe recargar al montar con el documento cacheado");

  app.postear(payload(documento()));
  app.postear(payload(documento()));
  app.postear(payload(documento()));

  assert.equal(app.reloads, 0, "un documento idéntico no puede provocar ninguna recarga");
});

test("ESTABILIDAD · una edición real sí recarga, exactamente una vez", () => {
  const cache = JSON.stringify({ data: { piloto_pdp_01: documento() }, urls: URLS });
  const app = montar({ cache });

  const editado = documento();
  editado.content.hero.claim = "Otro titular";
  app.postear(payload(editado));

  assert.equal(app.reloads, 1, "un cambio de contenido debe refrescar el renderer una sola vez");

  app.postear(payload(editado));
  assert.equal(app.reloads, 1, "y no debe volver a recargar con ese mismo contenido");
});

test("CONTENIDO · el canvas pinta la página real, no un contenedor vacío", () => {
  const cache = JSON.stringify({ data: { piloto_pdp_01: documento() }, urls: URLS });
  const { html } = montar({ cache });

  assert.ok(html.length > 500, "el canvas no puede quedar prácticamente vacío");
  assert.match(html, /<main class="p01">/, "falta el contenedor de la plantilla");

  // Título del producto, que viene de Shopify y no de la IA.
  assert.match(html, /<h1>Pinza recogedora<\/h1>/);

  // Copy generado.
  assert.ok(html.includes("Recogé sin agacharte"), "falta el claim del hero");
  assert.ok(html.includes("Elegí tu pack"), "falta el encabezado de la oferta");
  assert.ok(html.includes("Un movimiento y listo"), "falta la sección why");

  // Galería con imágenes reales, no placeholders vacíos.
  const imgs = html.match(/<img[^>]+src="https:\/\/cdn\.shopify\.com\/[^"]+"/g) || [];
  assert.ok(imgs.length >= 2, `la galería debe traer imágenes reales, encontré ${imgs.length}`);
  assert.ok(!/src=""/.test(html), "ninguna imagen puede quedar con src vacío");

  // Cardinalidades del fixture, para que un render parcial no pase.
  assert.equal((html.match(/class="p01__pack"/g) || []).length, 2, "deben renderizarse los 2 packs");
  assert.equal((html.match(/<details>/g) || []).length, 3, "deben renderizarse las 3 preguntas");
  assert.equal((html.match(/<li>/g) || []).length, 4, "2 bullets del hero + 2 points del why");
});

test("CONTENIDO · sin evidencia verificable no se inventa prueba social", () => {
  const { html } = montar({ cache: JSON.stringify({ data: { piloto_pdp_01: documento() }, urls: URLS }) });
  assert.ok(!html.includes("p01__rating"), "no debe aparecer puntaje sin evidencia");
  assert.ok(!html.includes("p01__proof"), "no debe aparecer testimonio sin evidencia");
});

// Un asset que el preview pide con ?v= pero que no entra al cálculo del token
// queda cacheado para siempre: se deploya el arreglo y el merchant sigue
// viendo el archivo viejo. Es lo que ocultó el bucle de recarga durante un
// intento entero de arreglo, así que lo fijamos para el próximo asset.
test("CACHÉ · todo asset versionado del preview participa del cálculo de VERSION_ASSETS", () => {
  const raiz = path.join(__dirname, "..");
  const indice = fs.readFileSync(path.join(raiz, "plantilla-producto", "index.html"), "utf8");
  const servidor = fs.readFileSync(path.join(raiz, "server.js"), "utf8");

  const assets = [...indice.matchAll(/\/widgets\/([\w.-]+)\?v=/g)].map((m) => m[1]);
  assert.ok(assets.length >= 4, `esperaba varios assets versionados, encontré ${assets.length}`);

  const calculo = servidor.slice(servidor.indexOf("const VERSION_ASSETS"), servidor.indexOf("})();", servidor.indexOf("const VERSION_ASSETS")));
  const reescritura = servidor.match(/\.replace\(\/\(([^)]+)\)\\\?v=/);
  assert.ok(reescritura, "no encontré la reescritura de ?v= en la ruta /preview");

  for (const asset of new Set(assets)) {
    assert.ok(
      calculo.includes(`"${asset}"`),
      `${asset} se pide con ?v= pero no entra al cálculo de VERSION_ASSETS: cambiarlo no movería el token`
    );
    assert.ok(
      reescritura[1].includes(asset.replace(/\./g, "\\.")),
      `${asset} no se reescribe en /preview: quedaría clavado en la versión escrita a mano`
    );
  }
});
