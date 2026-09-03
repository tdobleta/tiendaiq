// ============================================================
// TEXTO — párrafo o título con formato.
//
// El color NO es un hex: es una referencia a un token de marca (@parrafos por
// defecto). Ver nucleo/tokens.js para el porqué.
//
// `html` está marcado responsive:false a propósito: los estilos pueden cambiar
// entre móvil y escritorio, el contenido no. Dejar que el texto difiera por
// viewport parece flexible y en la práctica produce páginas donde el merchant
// corrige una frase y en el celular sigue la vieja.
// ============================================================

"use strict";

const base = require("./_base");

module.exports = {
  tipo: "texto",
  nombre: "Texto",
  categoria: "contenido",
  icono: "texto",
  admite_hijos: false,
  limite_por_pagina: null,

  // Solo contenido: un bloque recién insertado tiene que verse. Los estilos no
  // se siembran nunca (ver nucleo/registro.js).
  semilla: { html: "Escribí acá tu texto." },

  grupos: [
    {
      id: "tipografia",
      nombre: "Tipografía",
      responsive: true,
      campos: [
        { clave: "html", tipo: "richtext", etiqueta: "Texto", defecto: "", responsive: false, ia: true },
        {
          clave: "etiqueta", tipo: "seleccion", etiqueta: "Nivel",
          opciones: [["p", "Párrafo"], ["h2", "Título 2"], ["h3", "Título 3"], ["h4", "Título 4"]],
          defecto: "p", responsive: false
        },
        { clave: "color", tipo: "token_color", etiqueta: "Color de marca", defecto: "@parrafos", css: "color" },
        { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 16, min: 8, max: 96, css: "font-size" },
        {
          clave: "peso", tipo: "seleccion", etiqueta: "Grosor",
          opciones: [["regular", "Regular"], ["medium", "Medium"], ["semibold", "Semibold"], ["bold", "Bold"]],
          defecto: "regular", css: "font-weight",
          mapa_css: { regular: "400", medium: "500", semibold: "600", bold: "700" }
        },
        {
          clave: "interletrado", tipo: "segmentado", etiqueta: "Interletrado",
          opciones: [["ajustado", "Ajustado"], ["normal", "Normal"], ["amplio", "Amplio"]],
          defecto: "normal", css: "letter-spacing",
          mapa_css: { ajustado: "-0.02em", normal: "0", amplio: "0.06em" }
        },
        {
          clave: "caja", tipo: "seleccion", etiqueta: "Mayúsculas",
          opciones: [["normal", "Normal"], ["altas", "MAYÚSCULAS"], ["bajas", "minúsculas"]],
          defecto: "normal", css: "text-transform",
          mapa_css: { normal: "none", altas: "uppercase", bajas: "lowercase" }
        },
        { clave: "interlineado", tipo: "medida", etiqueta: "Altura de línea", unidad: "", defecto: null, min: 0.8, max: 3, css: "line-height" }
      ]
    },
    {
      id: "disposicion",
      nombre: "Disposición",
      responsive: true,
      campos: [
        {
          clave: "ancho", tipo: "segmentado", etiqueta: "Ancho",
          opciones: [["llenar", "Llenar"], ["ajustar", "Ajustar"]],
          defecto: "llenar", css: "width",
          mapa_css: { llenar: "100%", ajustar: "fit-content" }
        },
        base.alineacion()
      ]
    },
    ...base.gruposComunes()
  ],

  render(nodo, ctx) {
    if (!ctx.visible(nodo)) return "";
    const v = ctx.valores(nodo);
    const etiqueta = ["p", "h2", "h3", "h4"].includes(v.etiqueta) ? v.etiqueta : "p";
    const estilos = ctx.estilos(nodo, [
      "color", "tamano", "peso", "interletrado", "caja", "interlineado",
      "ancho", "alineacion", ...base.CLAVES_COMUNES
    ]);
    const clases = ["tiq-texto", ctx.escapar(v.clase || "")].filter(Boolean).join(" ");
    return `<${etiqueta} class="${clases}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${ctx.sanear(v.html)}</${etiqueta}>`;
  }
};
