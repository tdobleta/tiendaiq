// ============================================================
// GRUPOS BASE — los que casi todos los tipos repiten.
//
// Apariencia, espaciado, visibilidad y avanzado son iguales en las 39 secciones
// del competidor, y tienen que ser iguales en las nuestras: si cada bloque
// inventa su propio "padding", el merchant aprende el panel de nuevo en cada
// sección. Un tipo hace `...grupoEspaciado()` y hereda el panel entero.
//
// Todo campo declara cómo se traduce a CSS (`css`, `unidad`, `mapa_css`). Así
// el render de un tipo no hace cuentas de estilos: pide ctx.estilos(nodo, [...])
// y listo. Ese es el motivo de que agregar una sección sea barato.
// ============================================================

"use strict";

// Los tres pasos de esquinas salen del branding (--tiq-radio) salvo que el
// merchant elija uno propio. Es el equivalente a "Dynamic vs Custom".
const RADIO = {
  clave: "radio",
  tipo: "seleccion",
  etiqueta: "Esquinas",
  opciones: [["marca", "De la marca"], ["ninguno", "Rectas"], ["chico", "Chicas"], ["grande", "Grandes"]],
  defecto: "marca",
  css: "border-radius",
  mapa_css: { marca: "var(--tiq-radio)", ninguno: "0", chico: "6px", grande: "20px" }
};

const BORDE = {
  clave: "borde",
  tipo: "seleccion",
  etiqueta: "Borde",
  opciones: [["ninguno", "Ninguno"], ["fino", "Fino"], ["medio", "Medio"]],
  defecto: "ninguno",
  css: "border",
  mapa_css: { ninguno: "", fino: "1px solid var(--tiq-secundario)", medio: "2px solid var(--tiq-secundario)" }
};

const SOMBRA = {
  clave: "sombra",
  tipo: "seleccion",
  etiqueta: "Sombra",
  opciones: [["ninguna", "Ninguna"], ["suave", "Suave"], ["media", "Media"]],
  defecto: "ninguna",
  css: "box-shadow",
  mapa_css: { ninguna: "", suave: "0 1px 3px rgba(0,0,0,.08)", media: "0 6px 20px rgba(0,0,0,.12)" }
};

function alineacion(clave = "alineacion", etiqueta = "Alineación") {
  return {
    clave,
    tipo: "segmentado",
    etiqueta,
    opciones: [["izquierda", "Izquierda"], ["centro", "Centro"], ["derecha", "Derecha"]],
    defecto: "izquierda",
    css: "text-align",
    mapa_css: { izquierda: "left", centro: "center", derecha: "right" }
  };
}

function grupoApariencia({ fondo = true, borde = true, radio = true, sombra = false } = {}) {
  const campos = [];
  if (fondo) campos.push({ clave: "fondo", tipo: "token_color", etiqueta: "Color de fondo", defecto: null, css: "background-color" });
  if (borde) campos.push({ ...BORDE });
  if (radio) campos.push({ ...RADIO });
  if (sombra) campos.push({ ...SOMBRA });
  return { id: "apariencia", nombre: "Apariencia", responsive: true, campos };
}

function grupoEspaciado({ margen = false } = {}) {
  const campos = [
    { clave: "pad_arriba", tipo: "medida", etiqueta: "Arriba", unidad: "px", defecto: 0, min: 0, max: 240, css: "padding-top" },
    { clave: "pad_abajo", tipo: "medida", etiqueta: "Abajo", unidad: "px", defecto: 0, min: 0, max: 240, css: "padding-bottom" },
    { clave: "pad_izquierda", tipo: "medida", etiqueta: "Izquierda", unidad: "px", defecto: 0, min: 0, max: 240, css: "padding-left" },
    { clave: "pad_derecha", tipo: "medida", etiqueta: "Derecha", unidad: "px", defecto: 0, min: 0, max: 240, css: "padding-right" }
  ];
  if (margen) {
    campos.push({ clave: "margen_arriba", tipo: "medida", etiqueta: "Margen arriba", unidad: "px", defecto: 0, min: 0, max: 240, css: "margin-top" });
    campos.push({ clave: "margen_abajo", tipo: "medida", etiqueta: "Margen abajo", unidad: "px", defecto: 0, min: 0, max: 240, css: "margin-bottom" });
  }
  return { id: "espaciado", nombre: "Espaciado", responsive: true, campos };
}

// Visibilidad va como props normales (y no como un campo aparte del nodo) para
// que el panel no necesite ni un solo caso especial. Todo lo que el merchant
// edita es una prop; sin excepciones.
function grupoVisibilidad() {
  return {
    id: "visibilidad",
    nombre: "Visibilidad",
    responsive: false,
    campos: [
      { clave: "mostrar_escritorio", tipo: "booleano", etiqueta: "Mostrar en escritorio", defecto: true },
      { clave: "mostrar_movil", tipo: "booleano", etiqueta: "Mostrar en móvil", defecto: true }
    ]
  };
}

// La válvula de escape. Sin esto, el primer merchant con un pedido raro nos
// pide una feature; con esto, se resuelve solo con su CSS.
function grupoAvanzado() {
  return {
    id: "avanzado",
    nombre: "Avanzado",
    responsive: false,
    campos: [
      { clave: "clase", tipo: "texto_plano", etiqueta: "Clase CSS", defecto: "", ayuda: "Podés usar esta clase para aplicarle estilos propios al bloque. Separá varias con espacios." }
    ]
  };
}

// Los cuatro que cierran casi todos los tipos, en el orden en que se muestran.
function gruposComunes(opciones = {}) {
  return [
    grupoApariencia(opciones.apariencia),
    grupoEspaciado(opciones.espaciado),
    grupoVisibilidad(),
    grupoAvanzado()
  ];
}

// Las claves de estilo que aportan los grupos comunes, para pasarle a
// ctx.estilos() sin escribirlas a mano en cada tipo.
const CLAVES_APARIENCIA = ["fondo", "borde", "radio", "sombra"];
const CLAVES_ESPACIADO = ["pad_arriba", "pad_abajo", "pad_izquierda", "pad_derecha", "margen_arriba", "margen_abajo"];
const CLAVES_COMUNES = [...CLAVES_APARIENCIA, ...CLAVES_ESPACIADO];

module.exports = {
  RADIO, BORDE, SOMBRA, alineacion,
  grupoApariencia, grupoEspaciado, grupoVisibilidad, grupoAvanzado, gruposComunes,
  CLAVES_APARIENCIA, CLAVES_ESPACIADO, CLAVES_COMUNES
};
