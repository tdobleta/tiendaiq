// ============================================================
// GRUPO — primitiva interna de composición.
//
// PagePilot no modela cada sección como una pieza monolítica: una sección es
// una composición de grupos y bloques (horizontal, vertical, repetible). Este
// tipo es la primera pieza de ese modelo en TiendaIQ. No aparece en la librería
// porque es una herramienta de composición; el merchant agrega la sección y
// trabaja sus bloques, mientras la IA y las plantillas pueden usar grupos para
// expresar la jerarquía visual real.
// ============================================================

"use strict";

const base = require("./_base");

function css(nodo, ctx, claves) { return ctx.estilos(nodo, claves); }

module.exports = {
  tipo: "grupo",
  nombre: "Grupo",
  categoria: "layout",
  icono: "grupo",
  visible_en_catalogo: false,
  admite_hijos: true,
  limite_por_pagina: null,
  grupos: [
    {
      id: "disposicion",
      nombre: "Disposición",
      responsive: true,
      campos: [
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
    ...base.gruposComunes({ apariencia: { sombra: false }, espaciado: { margen: false } })
  ],
  render(nodo, ctx) {
    const estilos = css(nodo, ctx, ["direccion", "gap", "alineacion", ...base.CLAVES_COMUNES]);
    return `<div class="tiq-grupo" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${ctx.hijos(nodo)}</div>`;
  }
};
