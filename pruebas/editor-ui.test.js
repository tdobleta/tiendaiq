// ============================================================
// UI DEL EDITOR — controles, panel, árbol y librería.
//
// Todo lo que se testea acá son funciones puras que devuelven HTML o valores
// tipados. Esa decisión de diseño (nada de querySelector en la capa que arma la
// UI) es la que permite que el editor tenga tests sin meter jsdom ni un
// navegador en el proyecto, y que la conversión de tipos de formulario —donde
// de verdad se rompen los editores— esté cubierta.
//
// El bloque final es EL test de la Fase 2: se inventa un tipo que no existe en
// el registro y se comprueba que el panel, el árbol y la librería lo dibujan
// igual. Si ese test pasa, el editor de verdad no conoce ningún tipo, y sumar
// la sección número 40 no le cuesta nada.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { parsear, htmlCampo } = require("../app/editor/controles");
const { htmlPanel, htmlPanelVacio, htmlPanelDesconocido } = require("../app/editor/panel");
const { htmlArbol, etiquetaDe, contarHijos, iconoDe, ancestrosDe } = require("../app/editor/arbol");
const { htmlLibreria, htmlTarjeta, filtrar, normalizar, miniaturaDe } = require("../app/editor/libreria");
const { htmlMarca } = require("../app/editor/marca");
const { posicionFlota } = require("../app/editor/editor");
const { destinoScroll } = require("../app/editor/lienzo");
const registro = require("../nucleo/registro");
const documento = require("../nucleo/documento");
const { contexto } = require("../nucleo/resolver");

const campo = (extra) => ({ clave: "x", etiqueta: "X", ...extra });

describe("parsear: de partes de formulario a valor tipado", () => {
  test("texto plano y área", () => {
    assert.equal(parsear(campo({ tipo: "texto_plano" }), { valor: "hola" }), "hola");
    assert.equal(parsear(campo({ tipo: "texto_plano" }), {}), "");
  });

  test("richtext se sanea al guardar, no solo al renderizar", () => {
    const salida = parsear(campo({ tipo: "richtext" }), { valor: '<b>x</b><script>y()</script>' });
    assert.equal(salida.includes("<script"), false);
    assert.match(salida, /<b>x<\/b>/);
  });

  // Un campo vacío es "heredar", un 0 es un override. Confundirlos es el bug que
  // impide poner un padding en cero.
  test("un número vacío es null y un cero es cero", () => {
    assert.equal(parsear(campo({ tipo: "medida" }), { valor: "" }), null);
    assert.equal(parsear(campo({ tipo: "medida" }), { valor: "0" }), 0);
  });

  test("un número inválido no ensucia el documento", () => {
    assert.equal(parsear(campo({ tipo: "numero" }), { valor: "abc" }), null);
  });

  test("booleano", () => {
    assert.equal(parsear(campo({ tipo: "booleano" }), { marcado: true }), true);
    assert.equal(parsear(campo({ tipo: "booleano" }), {}), false);
  });

  test("token_color: referencia, personalizado y ninguno", () => {
    const c = campo({ tipo: "token_color" });
    assert.equal(parsear(c, { token: "@titulos" }), "@titulos");
    assert.equal(parsear(c, { token: "personalizado", hex: "#AABBCC" }), "#AABBCC");
    assert.equal(parsear(c, { token: "personalizado", hex: "rojo" }), null);
    assert.equal(parsear(c, { token: "" }), null);
  });

  test("color: 'sin color' gana al valor del selector", () => {
    const c = campo({ tipo: "color" });
    assert.equal(parsear(c, { hex: "#AABBCC", sin: true }), null);
    assert.equal(parsear(c, { hex: "#AABBCC" }), "#AABBCC");
  });

  test("imagen sin src es null; con src conserva el alt", () => {
    const c = campo({ tipo: "imagen" });
    assert.equal(parsear(c, { src: "", alt: "algo" }), null);
    assert.deepEqual(parsear(c, { src: "https://x/a.jpg", alt: "Camisa" }), { src: "https://x/a.jpg", alt: "Camisa" });
  });

  test("enlace sin url es null", () => {
    const c = campo({ tipo: "enlace" });
    assert.equal(parsear(c, { texto: "Comprar" }), null);
    assert.deepEqual(parsear(c, { url: "https://x", texto: "Comprar", nueva_pestana: true }),
      { url: "https://x", texto: "Comprar", nueva_pestana: true });
  });

  test("lista parsea cada item con los subcampos declarados", () => {
    const c = campo({
      tipo: "lista",
      item_campos: [{ clave: "autor", tipo: "texto_plano", etiqueta: "Autor" }, { clave: "puntaje", tipo: "numero", etiqueta: "Puntaje" }]
    });
    const salida = parsear(c, { items: [{ autor: { valor: "Ana" }, puntaje: { valor: "5" } }, { autor: { valor: "Luis" }, puntaje: {} }] });
    assert.deepEqual(salida, [{ autor: "Ana", puntaje: 5 }, { autor: "Luis", puntaje: null }]);
  });

  test("lista también parsea semillas y documentos con valores primitivos", () => {
    const c = campo({
      tipo: "lista",
      item_campos: [
        { clave: "texto", tipo: "texto_largo", etiqueta: "Texto" },
        { clave: "activo", tipo: "booleano", etiqueta: "Activo" },
        { clave: "imagen", tipo: "imagen", etiqueta: "Imagen" }
      ]
    });
    assert.deepEqual(
      parsear(c, { items: [
        { texto: "Respuesta", activo: true, imagen: { src: "https://cdn/x.jpg", alt: "Foto" } },
        { texto: "Otra", activo: false, imagen: null }
      ] }),
      [
        { texto: "Respuesta", activo: true, imagen: { src: "https://cdn/x.jpg", alt: "Foto" } },
        { texto: "Otra", activo: false, imagen: null }
      ]
    );
  });
});

describe("dibujo de un campo", () => {
  test("lleva clave y clase de campo para que el lector sepa qué parsear", () => {
    const html = htmlCampo(campo({ tipo: "medida", unidad: "px", defecto: 16 }), 16);
    assert.match(html, /data-clave="x"/);
    assert.match(html, /data-tipo="medida"/);
    assert.match(html, /data-parte="valor"/);
    assert.match(html, />px</);
  });

  test("el micro-toggle refleja si el valor es propio o heredado", () => {
    const c = campo({ tipo: "medida", defecto: 16 });
    assert.match(htmlCampo(c, 16, { overrideado: false }), /aria-pressed="false"/);
    assert.match(htmlCampo(c, 24, { overrideado: true }), /aria-pressed="true"/);
  });

  test("un campo sin defecto no ofrece heredar", () => {
    assert.equal(htmlCampo(campo({ tipo: "texto_plano" }), "x").includes("data-heredar"), false);
  });

  test("el segmentado marca la opción activa", () => {
    const html = htmlCampo(campo({ tipo: "segmentado", opciones: [["a", "A"], ["b", "B"]], defecto: "a" }), "b");
    assert.match(html, /data-opcion="b" aria-checked="true"|aria-checked="true" data-opcion="b"/);
  });

  test("los valores del merchant se escapan antes de entrar al HTML", () => {
    const html = htmlCampo(campo({ tipo: "texto_plano" }), '"><img src=x onerror=alert(1)>');
    assert.equal(html.includes("onerror=alert(1)>"), false);
    assert.match(html, /&quot;&gt;&lt;img/);
  });

  test("el campo de imagen ofrece subida nativa además de URL", () => {
    const html = htmlCampo(campo({ tipo: "imagen" }), { src: "https://cdn.test/foto.jpg", alt: "Foto" });
    assert.match(html, /type="file"[^>]*data-subir-imagen/);
    assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
    assert.match(html, /placeholder="URL de la imagen"/);
  });
});

describe("panel", () => {
  const esquema = registro.esquemaPanel("texto");
  const nodo = { id: "n_11111111", tipo: "texto", props: { tamano: 30 } };
  const valores = contexto(documento.crear()).valores(nodo);

  test("sin selección no muestra controles sueltos ni onboarding", () => {
    assert.match(htmlPanelVacio(), /Inspector/);
    assert.doesNotMatch(htmlPanelVacio(), /elegir|Seleccioná/i);
    assert.equal(htmlPanel({ esquema: null, nodo: null }).includes("ed-campo"), false);
  });

  test("dibuja todos los grupos y todos los campos del esquema", () => {
    const html = htmlPanel({ esquema, nodo, valores });
    for (const grupo of esquema.grupos) {
      assert.ok(html.includes(`data-grupo="${grupo.id}"`), `falta el grupo ${grupo.id}`);
      for (const c of grupo.campos) assert.ok(html.includes(`data-clave="${c.clave}"`), `falta el campo ${c.clave}`);
    }
  });

  test("el toggle escritorio/móvil aparece solo en los grupos responsive", () => {
    const html = htmlPanel({ esquema, nodo, valores, viewport: "movil" });
    const responsivos = esquema.grupos.filter((g) => g.responsive).length;
    assert.equal((html.match(/class="ed-vp"/g) || []).length, responsivos);
    assert.match(html, /data-viewport="movil" title="Editar para móvil" aria-pressed="true"/);
  });

  test("marca qué campos son overrides del nodo", () => {
    const html = htmlPanel({ esquema, nodo, valores, overrideado: (clave) => clave === "tamano" });
    const bloque = html.slice(html.indexOf('data-clave="tamano"') - 400, html.indexOf('data-clave="tamano"') + 200);
    assert.match(bloque, /data-heredar="tamano" aria-pressed="true"/);
  });

  test("un tipo desconocido deja el inspector operativo, sin controles falsos", () => {
    const html = htmlPanelDesconocido({ id: "n_12345678", tipo: "bloque_de_otra_version" });
    assert.match(html, /Bloque no disponible/);
    assert.match(html, /bloque_de_otra_version/);
    assert.match(html, /data-borrar-nodo/);
    assert.equal(html.includes("data-clave="), false);
  });
});

describe("árbol", () => {
  const doc = documento.crear();
  doc.arbol = [{
    id: "n_11111111", tipo: "seccion", props: {}, hijos: [
      { id: "n_22222222", tipo: "texto", props: { html: "<b>Camisa</b> de oficina que no se arruga y dura años" } },
      { id: "n_33333333", tipo: "texto", props: { html: "" } }
    ]
  }];
  const ctx = contexto(doc);
  const opciones = { definicion: (t) => registro.definicion(t), valores: (n) => ctx.valores(n), seleccion: "n_22222222" };

  test("la fila se etiqueta con el contenido, no con el nombre del tipo", () => {
    const html = htmlArbol(doc, opciones);
    assert.match(html, /ed-arbol__texto">Camisa de oficina que no se arrug…</, "sin etiquetas HTML y recortada");
    assert.equal(html.includes("<b>"), false, "el formato del texto no puede entrar al árbol");
  });

  test("un bloque sin contenido cae al nombre del tipo", () => {
    assert.equal(etiquetaDe(doc.arbol[0].hijos[1], registro.definicion("texto"), { html: "" }), "Texto");
  });

  test("las etiquetas largas se recortan para que la fila siga siendo legible", () => {
    const larga = etiquetaDe({}, registro.definicion("texto"), { html: "x".repeat(200) });
    assert.ok(larga.length <= 34);
    assert.match(larga, /…$/);
  });

  test("las secciones muestran cuántos bloques tienen adentro", () => {
    assert.equal(contarHijos(doc.arbol[0]), 2);
    assert.match(htmlArbol(doc, opciones), /class="ed-arbol__cuenta">2</);
  });

  test("la fila seleccionada se marca", () => {
    assert.match(htmlArbol(doc, opciones), /class="ed-arbol__fila es-seleccionada" data-nodo="n_22222222"/);
  });

  test("un contenedor toma el primer contenido de su rama", () => {
    const html = htmlArbol(doc, opciones);
    const inicioFila = html.indexOf('data-nodo="n_11111111"');
    const inicioTexto = html.indexOf('class="ed-arbol__texto"', inicioFila);
    const filaSeccion = html.slice(inicioFila, inicioTexto + 120);
    assert.match(filaSeccion, /ed-arbol__texto">Camisa de oficina que no se arrug…</);
    assert.doesNotMatch(filaSeccion, />Sección</);
  });

  test("cada tipo tiene un icono SVG y el fallback no deja un cuadrado gris", () => {
    assert.match(iconoDe(registro.definicion("packs_compra")), /<svg/);
    assert.match(iconoDe({ icono: "tipo_nuevo" }), /<svg/);
    assert.match(htmlArbol(doc, opciones), /class="ed-arbol__icono"[^>]*data-icono="seccion"><svg/);
  });

  test("la ruta de un nodo devuelve solo sus padres, en orden", () => {
    assert.deepEqual(ancestrosDe(doc, "n_33333333"), ["n_11111111"]);
    assert.deepEqual(ancestrosDe(doc, "n_11111111"), []);
    assert.deepEqual(ancestrosDe(doc, "no-existe"), []);
  });

  test("la barra flotante cae debajo del bloque cuando no entra sobre el lienzo", () => {
    const lienzo = { top: 100, right: 1000, bottom: 800, left: 300 };
    const arriba = posicionFlota({ arriba: 110, izquierda: 340, alto: 20 }, lienzo, { ancho: 190, alto: 34 });
    assert.equal(arriba.debajo, true);
    assert.equal(arriba.top, 138);
    const normal = posicionFlota({ arriba: 360, izquierda: 950, alto: 80 }, lienzo, { ancho: 190, alto: 34 });
    assert.equal(normal.debajo, false);
    assert.equal(normal.top, 318);
    assert.equal(normal.left, 802, "no sale del borde derecho del lienzo");
  });

  test("el destino de scroll centra el nodo dentro del iframe", () => {
    assert.equal(destinoScroll(830, 600, { top: 1158, height: 100 }), 1738);
    assert.equal(destinoScroll(0, 600, { top: 20, height: 100 }), 0);
  });

  test("el cromo del editor define foco visible con el color de selección", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "app", "editor", "editor.css"), "utf8");
    assert.match(css, /:focus-visible/);
    assert.match(css, /outline:\s*2px solid var\(--ed-acento\)/);
  });

  test("solo los contenedores ofrecen añadir bloque adentro", () => {
    const html = htmlArbol(doc, opciones);
    assert.match(html, /data-agregar-en="n_11111111"/);
    assert.equal(html.includes('data-agregar-en="n_22222222"'), false);
  });

  test("las ramas pueden entrar cerradas sin cambiar el documento", () => {
    const html = htmlArbol(doc, { ...opciones, colapsados: new Set(["n_11111111"]) });
    assert.match(html, /class="ed-arbol__nodo es-colapsado"[^>]*data-nivel="0"/);
    assert.match(html, /data-colapsar aria-expanded="false" title="Expandir"/);
  });

  test("los botones de formato richtext tienen comandos conectables", () => {
    const html = htmlCampo(campo({ tipo: "richtext" }), "texto");
    assert.match(html, /data-formato="bold"/);
    assert.match(html, /data-formato="italic"/);
    assert.match(html, /data-formato="underline"/);
    assert.match(html, /data-formato="enlace"/);
    assert.equal(html.includes("🔗"), false);
  });

});

describe("librería", () => {
  test("cada tarjeta trae una miniatura vectorial, no un placeholder vacío", () => {
    const tarjeta = htmlTarjeta({ tipo: "hero", nombre: "Hero", icono: "galeria", limite_por_pagina: null });
    assert.match(tarjeta, /class="ed-lib__miniatura"/);
    assert.match(miniaturaDe({ icono: "garantia" }), /<svg/);
  });

  test("las composiciones se previsualizan con el renderer único", () => {
    const tarjeta = htmlTarjeta({ composicion_id: "hero_producto", tipo: "composicion:hero_producto", nombre: "Héroe", icono: "galeria", limite_por_pagina: null });
    assert.match(tarjeta, /data-mini-render="true"/);
    assert.match(tarjeta, /tiq-titulo-producto/);
    assert.match(tarjeta, /Producto de ejemplo/);
  });

  test("una tarjeta de composición identifica el árbol que va a insertar", () => {
    const tarjeta = htmlTarjeta({ composicion_id: "hero_producto", tipo: "composicion:hero_producto", nombre: "Héroe", icono: "galeria", limite_por_pagina: null });
    assert.match(tarjeta, /data-composicion="hero_producto"/);
    assert.equal(tarjeta.includes('data-tipo="composicion:hero_producto"'), false);
  });

  test("en modo secciones solo aparecen composiciones completas", () => {
    const html = htmlLibreria(catalogo, { modo: "secciones" });
    assert.match(html, /Añadir sección/);
    assert.match(html, /data-composicion="hero_producto"/);
    assert.equal(html.includes('data-tipo="titulo_producto"'), false);
  });

  test("en modo bloques no aparecen composiciones anidadas", () => {
    const html = htmlLibreria(catalogo, { modo: "bloques" });
    assert.match(html, /Añadir bloque/);
    assert.match(html, /data-tipo="titulo_producto"/);
    assert.equal(html.includes('data-composicion="hero_producto"'), false);
  });

  const catalogo = registro.catalogo();

  test("los grupos internos no aparecen como secciones para el merchant", () => {
    assert.equal(registro.existe("grupo"), true);
    assert.equal(catalogo.some((g) => g.items.some((item) => item.tipo === "grupo")), false);
  });

  test("busca sin acentos", () => {
    assert.equal(normalizar("Sección"), "seccion");
    assert.equal(filtrar(catalogo, { busqueda: "seccion" }).length, 1);
  });

  test("filtra por categoría", () => {
    const soloContenido = filtrar(catalogo, { categoria: "contenido" });
    assert.deepEqual(soloContenido.map((g) => g.id), ["contenido"]);
  });

  test("una búsqueda sin resultados lo dice", () => {
    assert.match(htmlLibreria(catalogo, { busqueda: "zzz" }), /No hay secciones que coincidan/);
  });

  // Esconder una sección agotada hace que el merchant crea que no existe.
  test("un bloque en su tope se muestra no interactivo y con el cupo a la vista", (t) => {
    const definicion = registro.definicion("imagen");
    definicion.limite_por_pagina = 1;
    t.after(() => { definicion.limite_por_pagina = null; });

    const html = htmlLibreria(registro.catalogo(), { contarUsados: (tipo) => (tipo === "imagen" ? 1 : 0) });
    assert.match(html, /data-tipo="imagen"/);
    assert.match(html, /aria-disabled="true"/);
    assert.match(html, /tabindex="-1"/);
    assert.match(html, /class="ed-lib__cupo">1\/1</);
  });
});

describe("marca", () => {
  test("dibuja presets, tokens y controles globales desde tokens del núcleo", () => {
    const html = htmlMarca({ preset: "azul", tokens: { titulos: "#112233" }, radio: "grande", tipografia: { titulos: "serif" } });
    assert.match(html, /data-branding-preset="azul"[^>]*aria-pressed="true"/);
    assert.match(html, /value="#112233"[^>]*data-branding-token="titulos"/);
    assert.match(html, /data-branding-heredar="titulos"[^>]*aria-pressed="true"/);
    assert.match(html, /data-branding-radio/);
    assert.match(html, /data-branding-fuente="titulos"/);
  });
});

// ------------------------------------------------------------
// EL test de la Fase 2
// ------------------------------------------------------------

describe("el editor no conoce ningún tipo", () => {
  // Un tipo que no existe en el registro, con un campo (`lista`) que ningún
  // tipo semilla usa. Si el panel, el árbol y la librería lo dibujan bien sin
  // que se toque una línea de app/editor/, entonces sumar secciones es gratis.
  const inventado = registro._normalizar({
    tipo: "carrusel_resenas",
    nombre: "Carrusel de reseñas",
    categoria: "prueba_social",
    icono: "resenas",
    admite_hijos: false,
    limite_por_pagina: null,
    render: () => "",
    grupos: [{
      id: "contenido", nombre: "Contenido", responsive: false, campos: [
        { clave: "titulo", tipo: "texto_plano", etiqueta: "Título", defecto: "Lo que dicen" },
        {
          clave: "resenas", tipo: "lista", etiqueta: "Reseñas", nombre_item: "Reseña",
          item_campos: [
            { clave: "autor", tipo: "texto_plano", etiqueta: "Autor" },
            { clave: "texto", tipo: "texto_largo", etiqueta: "Comentario" },
            { clave: "puntaje", tipo: "numero", etiqueta: "Puntaje", min: 1, max: 5 }
          ]
        }
      ]
    }, {
      id: "apariencia", nombre: "Apariencia", responsive: true, campos: [
        { clave: "fondo", tipo: "token_color", etiqueta: "Fondo", defecto: null, css: "background-color" }
      ]
    }]
  }, []);

  const nodo = {
    id: "n_99999999", tipo: "carrusel_resenas",
    props: { titulo: "Lo que dicen nuestras clientas", resenas: [{ autor: "Ana", texto: "Excelente", puntaje: 5 }] }
  };
  const esquema = { tipo: inventado.tipo, nombre: inventado.nombre, admite_hijos: false, grupos: inventado.grupos };
  const valores = {};
  for (const c of inventado.campos) valores[c.clave] = nodo.props[c.clave] !== undefined ? nodo.props[c.clave] : c.defecto;

  test("el panel dibuja sus grupos, su lista y sus subcampos", () => {
    const html = htmlPanel({ esquema, nodo, valores, viewport: "escritorio" });
    assert.match(html, /Carrusel de reseñas/);
    assert.match(html, /data-clave="resenas"/);
    assert.match(html, /data-subcampo="autor"/);
    assert.match(html, /value="Ana"/);
    assert.match(html, /Agregar reseña/);
    assert.equal((html.match(/class="ed-vp"/g) || []).length, 1, "solo el grupo responsive");
  });

  test("el árbol lo etiqueta con su contenido", () => {
    const doc = { ...documento.crear(), arbol: [nodo] };
    const html = htmlArbol(doc, { definicion: () => inventado, valores: () => valores, seleccion: null });
    assert.match(html, /Lo que dicen nuestras clientas/);
  });

  test("la librería lo ofrece en su categoría", () => {
    const catalogo = [{
      id: "prueba_social", nombre: "Prueba social y confianza",
      items: [{ tipo: inventado.tipo, nombre: inventado.nombre, icono: inventado.icono, admite_hijos: false, limite_por_pagina: null }]
    }];
    const html = htmlLibreria(catalogo, {});
    assert.match(html, /data-tipo="carrusel_resenas"/);
    assert.match(html, /Prueba social y confianza/);
  });

  test("sus valores se leen igual que los de cualquier tipo semilla", () => {
    const lista = inventado.porClave.resenas;
    assert.deepEqual(
      parsear(lista, { items: [{ autor: { valor: "Ana" }, texto: { valor: "Excelente" }, puntaje: { valor: "5" } }] }),
      [{ autor: "Ana", texto: "Excelente", puntaje: 5 }]
    );
  });
});
