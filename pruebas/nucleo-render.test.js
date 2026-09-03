// ============================================================
// RENDER — el HTML, el CSS responsive, y el invariante que sostiene todo (I2).
//
// El test que más importa de este archivo es el último bloque: comprueba que el
// bundle que se sirve en la tienda del merchant y el que usa el editor son el
// MISMO byte a byte, y que los dos producen exactamente el HTML que produce
// Node. Mientras ese test pase, es imposible que el preview del editor y la
// página real se separen — que es de donde viene todo el problema del editor
// anterior.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const { render } = require("../nucleo/render");
const registro = require("../nucleo/registro");
const documento = require("../nucleo/documento");
const constructor = require("../scripts/construir-render");

// Documento de referencia. Ids fijos a propósito: es el patrón contra el que se
// comparan Node y los dos bundles, así que no puede tener nada aleatorio.
const REFERENCIA = {
  version: 1,
  id: "pag_referencia",
  tienda: "prueba.myshopify.com",
  producto_id: null,
  titulo: "Camisa",
  branding: { preset: "verde", tokens: {}, radio: "pequeno", tipografia: { titulos: "grotesca", cuerpo: "sistema" } },
  seo: { descripcion: null, palabras_clave: [] },
  arbol: [
    {
      id: "n_10000001",
      tipo: "seccion",
      props: { gap: 24, pad_arriba: 48 },
      props_movil: { gap: 12, pad_arriba: 24 },
      hijos: [
        { id: "n_10000002", tipo: "texto", props: { html: "<b>Camisa</b> de oficina", etiqueta: "h2", tamano: 32 }, props_movil: { tamano: 22 } },
        { id: "n_10000003", tipo: "texto", props: { html: "Solo escritorio", mostrar_movil: false } },
        { id: "n_10000004", tipo: "imagen", props: { imagen: { src: "https://cdn.shopify.com/a.jpg", alt: "Camisa" }, relacion: "4-5" } }
      ]
    }
  ]
};

describe("estructura de la salida", () => {
  test("el documento de referencia es válido", () => {
    assert.equal(documento.esValido(REFERENCIA), true);
  });

  test("devuelve html y css, y envuelve todo con las variables de marca", () => {
    const { html, css } = render(REFERENCIA);
    assert.match(html, /^<div class="tiq-doc" style="--tiq-primario:#1D3B1D/);
    assert.match(html, /--tiq-radio:8px/);
    assert.equal(typeof css, "string");
  });

  // Las pilas tipográficas llevan comillas dobles. Sin escapar, cortan el
  // atributo style y TODAS las variables de marca desaparecen: la página cae a
  // la fuente por defecto del navegador y no hay ningún error que lo delate.
  test("el atributo style no se corta con las comillas de las tipografías", () => {
    const { html } = render(REFERENCIA);
    const atributo = /style="([^"]*)"/.exec(html)[1];
    assert.match(atributo, /--tiq-fuente-titulos:&quot;Archivo&quot;/, "la pila tipográfica entera, con sus comillas");
    assert.match(atributo, /--tiq-fuente-cuerpo:.*sans-serif;$/, "la última variable llega hasta el final");
    assert.equal(atributo.includes('"'), false, "una comilla cruda cortaría el atributo acá mismo");
  });

  test("los estilos de escritorio van en línea", () => {
    const { html } = render(REFERENCIA);
    assert.match(html, /font-size:32px/);
    assert.match(html, /gap:24px/);
    assert.match(html, /aspect-ratio:4 \/ 5/);
  });

  test("cada nodo lleva su data-nodo, que es lo que ancla el CSS y la selección", () => {
    const { html } = render(REFERENCIA);
    for (const id of ["n_10000001", "n_10000002", "n_10000004"]) {
      assert.ok(html.includes(`data-nodo="${id}"`), `falta data-nodo de ${id}`);
    }
  });

  test("los bloques de producto leen datos vivos del contexto sin duplicarlos en cada nodo", () => {
    const doc = {
      ...REFERENCIA,
      arbol: [
        { id: "n_60000001", tipo: "titulo_producto", props: {} },
        { id: "n_60000002", tipo: "precio_producto", props: {} },
        { id: "n_60000003", tipo: "boton_carrito", props: {} }
      ]
    };
    const html = render(doc, {
      producto: { title: "Remolacha diaria", price: "$24,90", variant_id: "gid://shopify/ProductVariant/1" }
    }).html;
    assert.match(html, /Remolacha diaria/);
    assert.match(html, /\$24,90/);
    assert.ok(html.includes('name="id" value="gid://shopify/ProductVariant/1"'));
  });

  test("una sección puede componerse con grupos anidados sin otro renderer", () => {
    const doc = {
      ...REFERENCIA,
      arbol: [{
        id: "n_61000001", tipo: "seccion", props: {}, hijos: [{
          id: "n_61000002", tipo: "grupo", props: { direccion: "horizontal", gap: 20 }, hijos: [
            { id: "n_61000003", tipo: "texto", props: { html: "Primera columna" } },
            { id: "n_61000004", tipo: "texto", props: { html: "Segunda columna" } }
          ]
        }]
      }]
    };
    assert.equal(documento.esValido(doc), true);
    const { html } = render(doc);
    assert.match(html, /class="tiq-grupo"[^>]*data-nodo="n_61000002"/);
    assert.match(html, /Primera columna/);
    assert.match(html, /Segunda columna/);
  });

  test("las primitivas de compra llegan al mismo formulario del carrito", () => {
    const doc = {
      ...REFERENCIA,
      arbol: [
        { id: "n_62000001", tipo: "selector_variantes", props: {} },
        { id: "n_62000002", tipo: "cantidad_producto", props: {} },
        { id: "n_62000003", tipo: "boton_carrito", props: {} }
      ]
    };
    const { html } = render(doc, { producto: {
      variantes: [
        { id: "gid://shopify/ProductVariant/1", titulo: "Negro", disponible: true },
        { id: "gid://shopify/ProductVariant/2", titulo: "Azul", disponible: false }
      ],
      variant_id: "gid://shopify/ProductVariant/1"
    } });
    assert.match(html, /data-tiq-variante/);
    assert.ok(html.includes('value="gid://shopify/ProductVariant/2"') && html.includes('disabled'), "la variante agotada queda deshabilitada");
    assert.match(html, /data-tiq-cantidad/);
    assert.match(html, /data-tiq-variante-form/);
    assert.match(html, /data-tiq-cantidad-form/);
  });
});

describe("responsive: los valores de móvil viajan como CSS, no como otro HTML", () => {
  test("solo se emiten las propiedades que de verdad cambian en móvil", () => {
    const { css } = render(REFERENCIA);
    assert.match(css, /@media \(max-width:749px\)/);
    assert.match(css, /\[data-nodo="n_10000002"\]\{font-size:22px\}/);
    // El texto n_10000002 no overridea el color en móvil: no debe aparecer.
    assert.equal(/\[data-nodo="n_10000002"\]\{[^}]*color:/.test(css), false);
  });

  test("un documento sin overrides móviles no genera ni una regla", () => {
    const doc = { ...REFERENCIA, arbol: [{ id: "n_20000001", tipo: "texto", props: { html: "hola" } }] };
    assert.equal(render(doc).css, "");
  });

  test("un bloque oculto en móvil SIGUE en el HTML y se esconde por media query", () => {
    const { html, css } = render(REFERENCIA);
    assert.ok(html.includes('data-nodo="n_10000003"'), "sacarlo del HTML lo sacaría también del escritorio");
    assert.match(css, /@media \(max-width:749px\)\{[^]*\[data-nodo="n_10000003"\]\{display:none !important\}/);
  });

  test("un bloque oculto en escritorio se esconde con min-width", () => {
    const doc = { ...REFERENCIA, arbol: [{ id: "n_30000001", tipo: "texto", props: { html: "solo móvil", mostrar_escritorio: false } }] };
    const { html, css } = render(doc);
    assert.ok(html.includes('data-nodo="n_30000001"'));
    assert.match(css, /@media \(min-width:750px\)\{\[data-nodo="n_30000001"\]\{display:none !important\}\}/);
  });

  test("oculto en los dos viewports directamente no se pinta", () => {
    const doc = { ...REFERENCIA, arbol: [{ id: "n_40000001", tipo: "texto", props: { html: "x", mostrar_movil: false, mostrar_escritorio: false } }] };
    const { html, css } = render(doc);
    assert.equal(html.includes("n_40000001"), false);
    assert.equal(css, "");
  });

  test("las reglas se agrupan por media query, no una por nodo", () => {
    const { css } = render(REFERENCIA);
    assert.equal((css.match(/@media \(max-width:749px\)/g) || []).length, 1);
  });
});

describe("un bloque roto no puede tumbar la página de una tienda", () => {
  test("un tipo desconocido sale como comentario en la tienda y visible en el editor", () => {
    const doc = { ...REFERENCIA, arbol: [{ id: "n_50000001", tipo: "no_existe", props: {} }] };
    assert.match(render(doc, { modo: "tienda" }).html, /<!-- tiq: bloque "no_existe" omitido -->/);
    assert.match(render(doc, { modo: "editor" }).html, /class="tiq-error"/);
  });

  test("si el render de un tipo tira, el resto de la página se dibuja igual", (t) => {
    const definicion = registro.definicion("texto");
    const original = definicion.render;
    definicion.render = () => { throw new Error("boom"); };
    t.after(() => { definicion.render = original; });

    const { html } = render(REFERENCIA, { modo: "tienda" });
    assert.match(html, /<!-- tiq: bloque "texto" omitido -->/);
    assert.ok(html.includes("cdn.shopify.com/a.jpg"), "la imagen tenía que renderizarse igual");
  });
});

// ------------------------------------------------------------
// I2 — un solo renderer. Este es el bloque bloqueante.
// ------------------------------------------------------------

function evaluarBundle(js) {
  const entorno = { console };
  vm.createContext(entorno);
  vm.runInContext(js, entorno);
  return entorno.TiqRender;
}

describe("invariante I2: editor y tienda dibujan con el mismo código", () => {
  test("los dos bundles son byte-idénticos", async () => {
    const { js } = await constructor.construir();
    const enDisco = constructor.SALIDAS.map((s) => fs.readFileSync(s.js, "utf8"));
    assert.equal(enDisco[0], enDisco[1], "app/dist y assets/ tienen bundles distintos");
    assert.equal(enDisco[0], js);
  });

  test("el bundle produce exactamente el mismo HTML y CSS que Node", async () => {
    const { js } = await constructor.construir();
    const enNavegador = evaluarBundle(js);
    const esperado = render(REFERENCIA);
    const obtenido = enNavegador.render(REFERENCIA);

    assert.equal(obtenido.html, esperado.html);
    assert.equal(obtenido.css, esperado.css);
  });

  test("el bundle no arrastra ajv ni node:crypto a la tienda del merchant", async () => {
    const { js } = await constructor.construir();
    assert.equal(js.includes("ajv"), false, "validar es trabajo del backend, no del storefront");
    assert.equal(/require\(["']crypto["']\)/.test(js), false);
    assert.ok(Buffer.byteLength(js) < 120 * 1024, "el bundle creció demasiado para servirlo en cada visita");
  });

  test("los artefactos commiteados están al día con nucleo/", async () => {
    const viejos = await constructor.verificar();
    assert.deepEqual(viejos, [], "corré: node scripts/construir-render.js");
  });

  test("el CSS base no hardcodea colores: todo pasa por las variables de marca", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "nucleo", "render.css"), "utf8")
      .replace(/\/\*[^]*?\*\//g, "");
    assert.equal(/#[0-9a-f]{3,8}\b/i.test(css), false, "un color literal acá es un color que el branding no puede cambiar");
  });
});
