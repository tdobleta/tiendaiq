// ============================================================
// REGISTRO — que las definiciones de tipo estén bien formadas, y que el
// registro rechace las que no.
//
// El valor de estos tests no es cubrir los tres tipos semilla: es cubrir el
// GUARDIÁN. Dentro de unos meses va a haber decenas de tipos escritos por
// varias manos, y lo único que impide que uno mal declarado llegue a la tienda
// de un merchant es que el registro reviente al cargar. Cada rechazo de acá es
// un error que alguien no va a tener que depurar en producción.
//
// También está acá el test del render de humo: los tipos declaran su render y
// conviene saber que no tiran, aunque el orquestador del árbol sea Fase 1.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const registro = require("../nucleo/registro");
const { contexto } = require("../nucleo/resolver");
const documento = require("../nucleo/documento");

describe("catálogo", () => {
  test("los tipos semilla están registrados", () => {
    for (const tipo of ["imagen", "seccion", "texto", "galeria_producto", "titulo_producto", "precio_producto", "beneficios_producto", "packs_compra", "boton_carrito", "resena_destacada", "carrusel_resenas", "acordeon_faq", "linea_tiempo", "contador_oferta"]) {
      assert.equal(registro.existe(tipo), true, `falta el tipo ${tipo}`);
    }
  });

  test("cada tipo declara categoría conocida, icono y render", () => {
    for (const def of registro.todos()) {
      assert.ok(registro.CATEGORIAS.has(def.categoria), `${def.tipo}: categoría desconocida`);
      assert.equal(typeof def.icono, "string");
      assert.equal(typeof def.render, "function");
    }
  });

  test("ningún campo usa una clase fuera del conjunto cerrado", () => {
    for (const def of registro.todos()) {
      for (const campo of def.campos) {
        assert.ok(registro.TIPOS_CAMPO.has(campo.tipo), `${def.tipo}.${campo.clave}: clase "${campo.tipo}" fuera de TIPOS_CAMPO`);
      }
    }
  });

  test("las claves de campo no se repiten dentro de un tipo", () => {
    for (const def of registro.todos()) {
      const claves = def.campos.map((c) => c.clave);
      assert.equal(new Set(claves).size, claves.length, `${def.tipo}: hay claves repetidas`);
    }
  });

  test("todo campo con css declara qué emite, y todo mapa_css cubre sus opciones", () => {
    for (const def of registro.todos()) {
      for (const campo of def.campos) {
        if (campo.mapa_css) {
          assert.ok(campo.css, `${def.tipo}.${campo.clave}: mapa_css sin css`);
          for (const [valor] of campo.opciones) {
            assert.ok(valor in campo.mapa_css, `${def.tipo}.${campo.clave}: mapa_css no cubre "${valor}"`);
          }
        }
      }
    }
  });

  test("el responsive efectivo del campo manda sobre el del grupo", () => {
    const texto = registro.definicion("texto");
    assert.equal(texto.porClave.tamano.responsive, true, "hereda el grupo");
    assert.equal(texto.porClave.html.responsive, false, "el campo lo apaga a propósito");
  });

  test("catalogo() agrupa por categoría y no filtra la función de render", () => {
    const grupos = registro.catalogo();
    assert.ok(grupos.length >= 1);
    for (const grupo of grupos) {
      assert.equal(typeof grupo.nombre, "string");
      for (const item of grupo.items) assert.equal(item.render, undefined);
    }
  });

  test("el catálogo incluye composiciones como datos, sin convertirlas en tipos", () => {
    const composiciones = registro.catalogoComposiciones();
    assert.ok(composiciones.length >= 6);
    assert.ok(composiciones.some((item) => item.composicion_id === "hero_producto"));
    for (const id of ["resenas_producto", "faq_producto", "garantia_urgencia"]) {
      assert.ok(composiciones.some((item) => item.composicion_id === id), `falta la composición ${id}`);
    }
    assert.equal(registro.existe("composicion:hero_producto"), false);
    const producto = registro.catalogo().find((grupo) => grupo.id === "producto");
    assert.ok(producto.items.some((item) => item.composicion_id === "hero_producto"));
  });

  test("esquemaPanel() entrega lo que el panel necesita y nada más", () => {
    const panel = registro.esquemaPanel("texto");
    assert.equal(panel.tipo, "texto");
    assert.ok(panel.grupos.some((g) => g.id === "tipografia"));
    assert.equal(JSON.stringify(panel).includes("function"), false, "no debe viajar código al cliente");
  });
});

// Una semilla inválida es un bloque que el merchant inserta desde la librería y
// que rompe el guardado, con un error de validación que no menciona la librería
// por ningún lado. Se descubrió así: `packs_compra` sembraba `cantidad: 1`
// (número) en un campo declarado `texto_plano`. El tipo estaba bien, su ejemplo
// estaba mal, y ningún test lo miraba porque los dos vivían en el mismo archivo.
describe("la semilla de cada tipo produce un nodo válido", () => {
  const documento = require("../nucleo/documento");
  const nodos = require("../nucleo/nodos");

  for (const tipo of registro.tipos()) {
    test(`insertar "${tipo}" desde la librería da un documento guardable`, () => {
      const doc = documento.crear();
      doc.arbol = [nodos.crearNodo(tipo)];
      assert.doesNotThrow(() => documento.validar(doc));
    });
  }
});

describe("el guardián rechaza definiciones mal formadas", () => {
  const errores = (definicion) => {
    const acumulados = [];
    registro._normalizar(definicion, acumulados);
    return acumulados;
  };

  const base = {
    tipo: "prueba", nombre: "Prueba", categoria: "contenido", icono: "x",
    admite_hijos: false, limite_por_pagina: null, render: () => "",
    grupos: [{ id: "g", nombre: "G", campos: [{ clave: "a", tipo: "texto_plano", etiqueta: "A" }] }]
  };

  test("una definición correcta no produce errores", () => {
    assert.deepEqual(errores(base), []);
  });

  test("categoría inventada", () => {
    assert.match(errores({ ...base, categoria: "vibes" }).join(), /categoría desconocida/);
  });

  test("clase de campo inventada", () => {
    const roto = { ...base, grupos: [{ id: "g", nombre: "G", campos: [{ clave: "a", tipo: "colorcito", etiqueta: "A" }] }] };
    assert.match(errores(roto).join(), /clase de campo desconocida/);
  });

  test("un seleccion sin opciones", () => {
    const roto = { ...base, grupos: [{ id: "g", nombre: "G", campos: [{ clave: "a", tipo: "seleccion", etiqueta: "A" }] }] };
    assert.match(errores(roto).join(), /necesita opciones/);
  });

  test("un defecto que no está entre las opciones", () => {
    const roto = { ...base, grupos: [{ id: "g", nombre: "G", campos: [
      { clave: "a", tipo: "segmentado", etiqueta: "A", opciones: [["x", "X"]], defecto: "z" }
    ] }] };
    assert.match(errores(roto).join(), /no está entre las opciones/);
  });

  test("un mapa_css incompleto", () => {
    const roto = { ...base, grupos: [{ id: "g", nombre: "G", campos: [
      { clave: "a", tipo: "segmentado", etiqueta: "A", opciones: [["x", "X"], ["y", "Y"]], defecto: "x", css: "display", mapa_css: { x: "block" } }
    ] }] };
    assert.match(errores(roto).join(), /mapa_css no cubre y/);
  });

  test("la misma clave en dos grupos", () => {
    const roto = { ...base, grupos: [
      { id: "g1", nombre: "G1", campos: [{ clave: "a", tipo: "texto_plano", etiqueta: "A" }] },
      { id: "g2", nombre: "G2", campos: [{ clave: "a", tipo: "texto_plano", etiqueta: "A" }] }
    ] };
    assert.match(errores(roto).join(), /está repetida en dos grupos/);
  });

  test("sin render", () => {
    const { render, ...sinRender } = base;
    assert.match(errores(sinRender).join(), /falta la función render/);
  });

  test("un límite que no es un entero positivo", () => {
    assert.match(errores({ ...base, limite_por_pagina: 0 }).join(), /limite_por_pagina/);
  });
});

describe("render de humo", () => {
  // El recorrido del árbol es Fase 1. Acá solo se comprueba que cada render
  // corre, respeta la visibilidad y no filtra HTML sin sanear.
  const ctxDe = (viewport) => {
    const ctx = contexto(documento.crear(), { viewport });
    return { ...ctx, hijos: () => "<!--hijos-->" };
  };

  test("sección renderiza un <section> con sus hijos", () => {
    const html = registro.definicion("seccion").render(
      { id: "n_11111111", tipo: "seccion", props: { gap: 20 }, hijos: [] }, ctxDe("escritorio")
    );
    assert.match(html, /^<section class="tiq-seccion/);
    assert.match(html, /gap:20px/);
    assert.match(html, /<!--hijos-->/);
  });

  test("texto respeta el nivel y sanea el contenido", () => {
    const html = registro.definicion("texto").render(
      { id: "n_22222222", tipo: "texto", props: { etiqueta: "h2", html: '<b>hola</b><script>x()</script>' } }, ctxDe("escritorio")
    );
    assert.match(html, /^<h2 /);
    assert.match(html, /<b>hola<\/b>/);
    assert.equal(html.includes("<script"), false);
  });

  test("imagen sin archivo no renderiza nada", () => {
    const html = registro.definicion("imagen").render({ id: "n_33333333", tipo: "imagen", props: {} }, ctxDe("escritorio"));
    assert.equal(html, "");
  });

  test("imagen y enlace rechazan protocolos inseguros", () => {
    const ctx = ctxDe("escritorio");
    const imagen = registro.definicion("imagen").render({
      id: "n_33333334", tipo: "imagen",
      props: { imagen: { src: "javascript:alert(1)", alt: "x" }, enlace: { url: "javascript:alert(1)" } }
    }, ctx);
    assert.equal(imagen, "");
    const segura = registro.definicion("imagen").render({
      id: "n_33333335", tipo: "imagen",
      props: { imagen: { src: "https://cdn.example/x.jpg", alt: "x" }, enlace: { url: "javascript:alert(1)" } }
    }, ctx);
    assert.equal(segura.includes('href="javascript:'), false);
    assert.match(segura, /<img/);
  });

  // Esconder en un solo viewport es CSS (ver nucleo/render.js). El render solo
  // se saltea el nodo cuando está oculto en los dos.
  test("un bloque oculto en los dos viewports devuelve cadena vacía", () => {
    const nodo = { id: "n_44444444", tipo: "texto", props: { html: "hola", mostrar_movil: false, mostrar_escritorio: false } };
    assert.equal(registro.definicion("texto").render(nodo, ctxDe("escritorio")), "");
  });

  test("un bloque oculto solo en móvil igual se renderiza", () => {
    const nodo = { id: "n_44444445", tipo: "texto", props: { html: "hola", mostrar_movil: false } };
    assert.notEqual(registro.definicion("texto").render(nodo, ctxDe("movil")), "");
  });

  test("la clase del merchant se escapa antes de entrar al atributo", () => {
    const nodo = { id: "n_55555555", tipo: "texto", props: { html: "x", clase: 'a" onload="y' } };
    const html = registro.definicion("texto").render(nodo, ctxDe("escritorio"));
    assert.equal(html.includes('onload="y"'), false);
  });

  test("todos los bloques Piloto renderizan su semilla sin romper el preview", () => {
    for (const def of registro.todos().filter((tipo) => tipo.tipo.endsWith("_producto") || ["packs_compra", "boton_carrito", "resena_destacada", "carrusel_resenas", "acordeon_faq", "linea_tiempo", "contador_oferta"].includes(tipo.tipo))) {
      const nodo = documento.crearNodo(def.tipo);
      const html = def.render(nodo, ctxDe("escritorio"));
      assert.equal(typeof html, "string", `${def.tipo} no devolvió HTML`);
    }
  });
});
