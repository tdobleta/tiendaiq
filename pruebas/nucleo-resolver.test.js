// ============================================================
// RESOLVER — la cascada de estilos (invariante I4) y el saneado de HTML.
//
// Estos son los tests que más importa que no se rompan nunca. La cascada es lo
// que hace que el branding sirva de algo: si un día alguien "arregla" el
// resolver con un `if (props.gap)`, el merchant deja de poder poner un valor en
// cero y nadie se entera hasta que un cliente lo reporta. Por eso el 0 y el
// null tienen test propio.
//
// El saneado es la única puerta por la que texto del merchant o de la IA llega
// al storefront de una tienda real. Un agujero acá es un XSS en la tienda de
// otro, no en la nuestra.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { contexto, hayOverride, sanear } = require("../nucleo/resolver");
const documento = require("../nucleo/documento");

const doc = (branding) => ({ ...documento.crear(), branding });
const VERDE = { preset: "verde", tokens: {}, radio: "pequeno" };
const AZUL = { preset: "azul", tokens: {}, radio: "pequeno" };

const texto = (props = {}, props_movil = undefined) => {
  const nodo = { id: "n_aaaaaa01", tipo: "texto", props };
  if (props_movil) nodo.props_movil = props_movil;
  return nodo;
};

describe("cascada de valores (I4)", () => {
  test("sin props, un campo toma el defecto de su tipo", () => {
    const ctx = contexto(doc(VERDE));
    assert.equal(ctx.valores(texto()).tamano, 16);
  });

  test("un override de escritorio gana al defecto", () => {
    const ctx = contexto(doc(VERDE));
    assert.equal(ctx.valores(texto({ tamano: 24 })).tamano, 24);
  });

  test("en móvil, sin override propio, se hereda el de escritorio", () => {
    const ctx = contexto(doc(VERDE), { viewport: "movil" });
    assert.equal(ctx.valores(texto({ tamano: 24 })).tamano, 24);
  });

  test("el override móvil gana al de escritorio, y solo en móvil", () => {
    const nodo = texto({ tamano: 24 }, { tamano: 12 });
    assert.equal(contexto(doc(VERDE), { viewport: "movil" }).valores(nodo).tamano, 12);
    assert.equal(contexto(doc(VERDE)).valores(nodo).tamano, 24);
  });

  // El bug clásico: `if (props.pad_arriba)` deja pasar el 0 al defecto y el
  // merchant no puede sacar el espacio de arriba de un bloque.
  test("un override en 0 se respeta y NO cae al defecto", () => {
    const ctx = contexto(doc(VERDE));
    const nodo = { id: "n_aaaaaa02", tipo: "seccion", props: { gap: 0 }, hijos: [] };
    assert.equal(ctx.valores(nodo).gap, 0);
    assert.match(ctx.estilos(nodo, ["gap"]), /gap:0px/);
  });

  // "Ningún color" es una elección, no una ausencia.
  test("un override en null es 'sin valor' y no emite CSS", () => {
    const ctx = contexto(doc(VERDE));
    const nodo = texto({ color: null });
    assert.equal(ctx.valores(nodo).color, null);
    assert.equal(ctx.estilos(nodo, ["color"]), "");
  });

  test("un campo no responsive ignora lo que haya en props_movil", () => {
    const nodo = texto({ html: "escritorio" }, { html: "movil" });
    assert.equal(contexto(doc(VERDE), { viewport: "movil" }).valores(nodo).html, "escritorio");
  });
});

describe("tokens de marca", () => {
  // valores() devuelve lo que dice el DOCUMENTO; la traducción a CSS es de
  // estilos(). El panel depende de esta separación: si valores() devolviera el
  // hex, todo color de marca se vería como "Personalizado" en el selector, y un
  // grosor "bold" llegaría como "700" y el select no encontraría su opción.
  test("valores() devuelve la referencia, no el hex", () => {
    assert.equal(contexto(doc(VERDE)).valores(texto()).color, "@parrafos");
    assert.equal(contexto(doc(VERDE)).valores(texto({ peso: "bold" })).peso, "bold");
  });

  test("estilos() sí desreferencia el token", () => {
    assert.match(contexto(doc(VERDE)).estilos(texto(), ["color"]), /color:#1D3B1D/);
    assert.match(contexto(doc(AZUL)).estilos(texto(), ["color"]), /color:#233247/);
  });

  test("cambiar el preset mueve el color sin tocar el nodo", () => {
    const nodo = texto();
    const antes = contexto(doc(VERDE)).estilos(nodo, ["color"]);
    const despues = contexto(doc(AZUL)).estilos(nodo, ["color"]);
    assert.notEqual(antes, despues);
    assert.deepEqual(nodo.props, {}, "el nodo no se tocó");
  });

  test("un override de token en el branding gana al preset", () => {
    const ctx = contexto(doc({ preset: "verde", tokens: { parrafos: "#123456" } }));
    assert.match(ctx.estilos(texto(), ["color"]), /color:#123456/);
  });

  test("un hex escrito directo en el nodo también vale", () => {
    assert.match(contexto(doc(VERDE)).estilos(texto({ color: "#ABCDEF" }), ["color"]), /color:#ABCDEF/);
  });

  test("comoCss() traduce un solo valor, para la muestra del panel", () => {
    assert.equal(contexto(doc(VERDE)).comoCss(texto(), "color"), "#1D3B1D");
    assert.equal(contexto(doc(VERDE)).comoCss(texto({ peso: "bold" }), "peso"), "700");
  });
});

describe("hayOverride — lo que prende y apaga el micro-toggle del panel", () => {
  test("distingue heredado de overrideado, incluso con 0 y null", () => {
    const nodo = texto({ tamano: 0, color: null }, { tamano: 11 });
    assert.equal(hayOverride(nodo, "tamano"), true);
    assert.equal(hayOverride(nodo, "color"), true);
    assert.equal(hayOverride(nodo, "peso"), false);
    assert.equal(hayOverride(nodo, "tamano", "movil"), true);
    assert.equal(hayOverride(nodo, "color", "movil"), false);
  });
});

describe("estilos", () => {
  test("traduce con mapa_css y agrega la unidad", () => {
    const ctx = contexto(doc(VERDE));
    const css = ctx.estilos(texto({ peso: "semibold", tamano: 18, caja: "altas" }), ["peso", "tamano", "caja"]);
    assert.match(css, /font-weight:600/);
    assert.match(css, /font-size:18px/);
    assert.match(css, /text-transform:uppercase/);
  });

  test("un mapa_css a cadena vacía no emite la propiedad", () => {
    const nodo = { id: "n_aaaaaa03", tipo: "texto", props: { borde: "ninguno" } };
    assert.equal(contexto(doc(VERDE)).estilos(nodo, ["borde"]), "");
  });
});

describe("visibilidad", () => {
  // visible() responde "¿este nodo llega al HTML?", no "¿se ve en esta pantalla?".
  // La tienda sirve un solo HTML a los dos tamaños: esconder en un viewport es
  // una media query (ver nucleo/render.js), y omitir el nodo lo sacaría de los
  // dos. Por eso oculto-en-móvil sigue devolviendo true.
  test("oculto en un solo viewport, el nodo igual se pinta", () => {
    const nodo = texto({ mostrar_movil: false });
    assert.equal(contexto(doc(VERDE), { viewport: "movil" }).visible(nodo), true);
    assert.equal(contexto(doc(VERDE)).visible(nodo), true);
  });

  test("oculto en los dos, no se pinta", () => {
    const nodo = texto({ mostrar_movil: false, mostrar_escritorio: false });
    assert.equal(contexto(doc(VERDE)).visible(nodo), false);
  });

  test("un tipo que no declara visibilidad siempre se pinta", () => {
    const nodo = { id: "n_aaaaaa04", tipo: "seccion", props: {}, hijos: [] };
    assert.equal(contexto(doc(VERDE)).visible(nodo), true);
  });
});

describe("saneado de HTML", () => {
  test("conserva el formato de la lista blanca", () => {
    assert.equal(sanear("<b>hola</b> <em>mundo</em><br>"), "<b>hola</b> <em>mundo</em><br>");
  });

  test("elimina scripts y su contenido queda como texto plano", () => {
    const salida = sanear('<script>alert(1)</script>');
    assert.equal(salida.includes("<script"), false);
    assert.equal(salida.includes("alert(1)"), true, "el contenido queda, pero escapado y sin etiqueta");
  });

  test("descarta los atributos de una etiqueta permitida", () => {
    assert.equal(sanear('<p onclick="robar()">x</p>'), "<p>x</p>");
  });

  test("un enlace javascript: pierde el href", () => {
    assert.equal(sanear('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
  });

  test("un enlace http se reconstruye con rel de seguridad", () => {
    const salida = sanear('<a href="https://ejemplo.com" onmouseover="x()">ir</a>');
    assert.match(salida, /^<a href="https:\/\/ejemplo\.com" rel="noopener nofollow" target="_blank">ir<\/a>$/);
  });

  test("un '<' suelto se escapa en vez de romper el HTML", () => {
    assert.equal(sanear("2 < 3 & 4"), "2 &lt; 3 &amp; 4");
  });

  test("no vuelve a escapar una entidad que ya estaba escrita", () => {
    assert.equal(sanear("Ben &amp; Jerry"), "Ben &amp; Jerry");
  });

  test("un valor que no es texto devuelve cadena vacía", () => {
    assert.equal(sanear(null), "");
    assert.equal(sanear(42), "");
  });
});
