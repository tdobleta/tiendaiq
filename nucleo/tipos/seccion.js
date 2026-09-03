// ============================================================
// SECCIÓN — el contenedor genérico. Es el único tipo que sabe de "ancho de
// página" y el que da el ritmo vertical del documento.
//
// Casi todo lo que en el catálogo se llama "sección" es esto con hijos
// distintos adentro. Tenerlo como tipo propio (en vez de que cada sección
// reimplemente su contenedor) es lo que hace que el espaciado de la página
// sea consistente sin que nadie lo cuide a mano.
// ============================================================

"use strict";

const base = require("./_base");

module.exports = {
  tipo: "seccion",
  nombre: "Sección",
  categoria: "layout",
  icono: "seccion",
  admite_hijos: true,
  limite_por_pagina: null,

  grupos: [
    {
      id: "disposicion",
      nombre: "Disposición",
      responsive: true,
      campos: [
        {
          clave: "ancho", tipo: "segmentado", etiqueta: "Ancho de la sección",
          opciones: [["pagina", "Página"], ["completo", "Completo"]],
          defecto: "pagina", responsive: false
        },
        {
          clave: "ancho_contenido", tipo: "segmentado", etiqueta: "Ancho del contenido",
          opciones: [["pagina", "Página"], ["completo", "Completo"]],
          defecto: "pagina", responsive: false
        },
        {
          clave: "direccion", tipo: "segmentado", etiqueta: "Dirección",
          opciones: [["vertical", "Vertical"], ["horizontal", "Horizontal"]],
          defecto: "vertical", css: "flex-direction",
          mapa_css: { vertical: "column", horizontal: "row" }
        },
        { clave: "gap", tipo: "medida", etiqueta: "Separación", unidad: "px", defecto: 16, min: 0, max: 120, css: "gap" },
        base.alineacion()
      ]
    },
    ...base.gruposComunes({ apariencia: { sombra: true }, espaciado: { margen: true } })
  ],

  render(nodo, ctx) {
    if (!ctx.visible(nodo)) return "";
    const v = ctx.valores(nodo);
    const estilos = ctx.estilos(nodo, ["direccion", "gap", "alineacion", ...base.CLAVES_COMUNES]);
    const clases = [
      "tiq-seccion",
      `tiq-seccion--${v.ancho}`,
      `tiq-seccion--contenido-${v.ancho_contenido}`,
      ctx.escapar(v.clase || "")
    ].filter(Boolean).join(" ");
    return `<section class="${clases}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${ctx.hijos(nodo)}</section>`;
  }
};
