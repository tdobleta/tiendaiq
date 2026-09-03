// ============================================================
// DOCUMENTO — validación en el borde y migraciones.
//
// Todo lo que se guarda pasa por validar(). Estos tests son, en buena medida,
// el contrato con la IA: cada cosa que un modelo puede inventar (un tipo que no
// existe, una prop de más, un token imaginario, cien niveles de anidamiento)
// tiene acá su rechazo. Si un caso falta, ese caso llega a la base de datos.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const documento = require("../nucleo/documento");
const registro = require("../nucleo/registro");

// Documento de referencia: lo que produciría el editor con un par de bloques.
function ejemplo() {
  const doc = documento.crear({ tienda: "prueba.myshopify.com", titulo: "Camisa" });
  doc.arbol = [
    {
      id: "n_11111111",
      tipo: "seccion",
      props: { gap: 24, pad_arriba: 40 },
      props_movil: { pad_arriba: 20 },
      hijos: [
        { id: "n_22222222", tipo: "texto", props: { html: "<b>Hola</b>", etiqueta: "h2", tamano: 32, color: "@titulos" } },
        { id: "n_33333333", tipo: "imagen", props: { imagen: { src: "https://cdn.shopify.com/x.jpg", alt: "Camisa" } } }
      ]
    }
  ];
  return doc;
}

describe("crear y validar", () => {
  test("un documento recién creado es válido", () => {
    assert.equal(documento.esValido(documento.crear()), true);
  });

  test("el documento de referencia valida", () => {
    const validado = documento.validar(ejemplo());
    assert.equal(validado.arbol[0].hijos.length, 2);
  });

  test("validar devuelve una copia y no toca el original", () => {
    const original = ejemplo();
    const salida = documento.validar(original);
    salida.arbol[0].props.gap = 999;
    assert.equal(original.arbol[0].props.gap, 24);
  });

  test("crearNodo siembra contenido pero NO estilos", () => {
    const nodo = documento.crearNodo("texto");
    assert.match(nodo.id, /^n_[a-f0-9]{8}$/);
    assert.deepEqual(Object.keys(nodo.props), ["html"], "solo la semilla de contenido");
    assert.equal(nodo.props.tamano, undefined, "un estilo sembrado sería un override y rompería la herencia");
  });

  test("crearNodo de un contenedor trae hijos vacíos", () => {
    assert.deepEqual(documento.crearNodo("seccion").hijos, []);
  });
});

describe("rechazos", () => {
  const rechaza = (mutar, fragmento) => {
    const doc = ejemplo();
    mutar(doc);
    assert.throws(() => documento.validar(doc), (error) => {
      assert.equal(error.name, "DocumentoInvalido");
      assert.ok(
        error.errores.some((e) => e.includes(fragmento)),
        `ningún error menciona "${fragmento}". Errores: ${error.errores.join(" | ")}`
      );
      return true;
    });
  };

  test("un tipo de bloque que no existe", () => {
    rechaza((d) => { d.arbol[0].hijos[0].tipo = "carrusel_inventado"; }, "must be equal to one of the allowed values");
  });

  test("una prop que el tipo no declara", () => {
    rechaza((d) => { d.arbol[0].hijos[0].props.tamanio = 12; }, "additional properties");
  });

  test("un token de marca inexistente", () => {
    rechaza((d) => { d.arbol[0].hijos[0].props.color = "@inventado"; }, "/arbol/0/hijos/0/props/color");
  });

  test("un id de nodo repetido", () => {
    rechaza((d) => { d.arbol[0].hijos[1].id = d.arbol[0].hijos[0].id; }, "está repetido");
  });

  test("hijos en un tipo que no los admite", () => {
    rechaza((d) => { d.arbol[0].hijos[0].hijos = [{ id: "n_44444444", tipo: "texto", props: {} }]; }, "no admite hijos");
  });

  test("un valor fuera del rango declarado por el campo", () => {
    rechaza((d) => { d.arbol[0].hijos[0].props.tamano = 400; }, "must be <= 96");
  });

  test("una opción que no está entre las del campo", () => {
    rechaza((d) => { d.arbol[0].hijos[0].props.peso = "ultrablack"; }, "/arbol/0/hijos/0/props/peso");
  });

  test("un override móvil de un campo que no es responsive", () => {
    rechaza((d) => { d.arbol[0].hijos[0].props_movil = { html: "otro" }; }, "additional properties");
  });

  test("una versión desconocida", () => {
    rechaza((d) => { d.version = 99; }, "/version");
  });

  test("un árbol más profundo que el tope", () => {
    const doc = documento.crear();
    let nodo = { id: "n_a0000000", tipo: "seccion", props: {}, hijos: [] };
    doc.arbol = [nodo];
    for (let i = 1; i <= documento.MAX_PROFUNDIDAD + 1; i++) {
      const hijo = { id: `n_a${String(i).padStart(7, "0")}`, tipo: "seccion", props: {}, hijos: [] };
      nodo.hijos.push(hijo);
      nodo = hijo;
    }
    assert.throws(() => documento.validar(doc), /niveles de anidamiento/);
  });

  test("un árbol con más nodos que el tope", () => {
    const doc = documento.crear();
    doc.arbol = Array.from({ length: documento.MAX_NODOS + 1 }, (_, i) => ({
      id: `n_b${String(i).padStart(7, "0")}`, tipo: "texto", props: {}
    }));
    assert.throws(() => documento.validar(doc), /supera 500 nodos/);
  });

  test("una imagen sin src", () => {
    rechaza((d) => { d.arbol[0].hijos[1].props.imagen = { alt: "sin archivo" }; }, "/arbol/0/hijos/1/props/imagen");
  });

  test("una imagen no acepta javascript ni data como origen", () => {
    rechaza((d) => { d.arbol[0].hijos[1].props.imagen = { src: "javascript:alert(1)" }; }, "/arbol/0/hijos/1/props/imagen/src");
  });
});

describe("límites por página", () => {
  test("los bloques estructurales únicos declaran su límite", () => {
    assert.deepEqual(
      registro.todos().filter((d) => d.limite_por_pagina !== null).map((d) => d.tipo).sort(),
      ["boton_carrito", "contador_oferta", "carrusel_resenas", "galeria_producto", "garantia", "packs_compra", "precio_producto", "titulo_producto"].sort()
    );
  });

  test("un tipo con límite rechaza el segundo bloque", (t) => {
    // El límite se prueba forzándolo sobre un tipo real: lo que importa validar
    // es NUESTRA lógica de conteo, no el dato que declare tal o cual sección.
    const definicion = registro.definicion("imagen");
    definicion.limite_por_pagina = 1;
    t.after(() => { definicion.limite_por_pagina = null; });

    const doc = ejemplo();
    doc.arbol[0].hijos.push({ id: "n_44444444", tipo: "imagen", props: { imagen: { src: "https://x/b.jpg" } } });
    assert.throws(() => documento.validar(doc), /"imagen" admite 1 por página y hay 2/);
  });
});

describe("migraciones", () => {
  test("un documento en la versión actual pasa sin tocarse", () => {
    const doc = ejemplo();
    assert.equal(documento.migrar(doc), doc);
  });

  test("una versión sin camino de migración falla con un mensaje claro", () => {
    assert.throws(() => documento.migrar({ version: 99, arbol: [] }), /no hay migración desde la versión 99/);
  });

  test("un documento v0 con facetas se convierte a un árbol v1 válido", () => {
    const viejo = {
      id: "pag_real_anonima",
      tienda: "ejemplo.myshopify.com",
      shopify_product_id: "gid://shopify/Product/123",
      urls: { media_hero: "https://cdn.example.com/hero.jpg" },
      data: {
        template: "piloto-pdp-01",
        source_fields: { title: "Producto de prueba", product_gid: "gid://shopify/Product/123" },
        facetas: {
          hero: {
            urgencia: "Pensado para todos los días",
            titulo: "Producto de prueba",
            subtitulo: "Una propuesta clara y cómoda.",
            bullets: [{ emoji: "✓", fuerte: "Fácil", resto: "de usar" }],
            galeria: ["media_hero"],
            puntaje: 4.9,
            resenas_count: 1453
          },
          faq: {
            titular: "Preguntas frecuentes",
            items: [{ pregunta: "¿Cómo se usa?", respuesta: "Seguí las instrucciones del producto." }]
          }
        },
        secciones: [{ id: "s_1", tipo: "beneficios", titulo: "Beneficios", puntos: ["Uno", "Dos"] }]
      }
    };

    const migrado = documento.migrar(viejo);
    assert.equal(migrado.version, 1);
    assert.equal(migrado.id, viejo.id);
    assert.equal(migrado.producto_id, viejo.shopify_product_id);
    assert.ok(migrado.arbol.length >= 3);
    assert.equal(documento.esValido(migrado), true);
    const html = require("../nucleo/render").render(migrado).html;
    assert.match(html, /Producto de prueba/);
    assert.match(html, /hero\.jpg/);
  });

  test("la migración no muta el registro v0 y es determinista", () => {
    const viejo = { data: { facetas: { hero: { titulo: "A", galeria: [] } } } };
    const primero = documento.migrar(viejo);
    const segundo = documento.migrar(viejo);
    assert.deepEqual(primero, segundo);
    assert.equal(Object.prototype.hasOwnProperty.call(viejo, "version"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(viejo.data, "version"), false);
  });
});

describe("el esquema se genera desde el registro", () => {
  test("los tipos del esquema son exactamente los del registro", () => {
    assert.deepEqual(documento.esquema.$defs.nodo.properties.tipo.enum, registro.tipos());
  });

  test("agregar un campo al registro se refleja en el esquema sin tocar documento.js", () => {
    const props = documento.esquema.$defs.nodo.allOf
      .find((rama) => rama.if.properties.tipo.const === "texto").then.properties.props.properties;
    for (const campo of registro.definicion("texto").campos) {
      assert.ok(props[campo.clave], `el esquema no cubre el campo "${campo.clave}"`);
    }
  });
});
