// ============================================================
// IMAGEN — una foto del producto o subida por el merchant.
//
// La relación de aspecto es un campo y no algo que se deduzca del archivo: si
// el alto lo decide la imagen, cambiar una foto por otra descoloca la página
// entera. Fijando la relación, cambiar la foto no mueve nada.
//
// `alt` viaja en el propio valor de la imagen (no como campo aparte) para que
// sea imposible tener una imagen sin texto alternativo asociado en el modelo.
// ============================================================

"use strict";

const base = require("./_base");

module.exports = {
  tipo: "imagen",
  nombre: "Imagen",
  categoria: "imagen_contenido",
  icono: "imagen",
  admite_hijos: false,
  limite_por_pagina: null,

  grupos: [
    {
      id: "contenido",
      nombre: "Imagen",
      responsive: false,
      campos: [
        { clave: "imagen", tipo: "imagen", etiqueta: "Archivo", defecto: null },
        { clave: "enlace", tipo: "enlace", etiqueta: "Enlace al hacer clic", defecto: null }
      ]
    },
    {
      id: "disposicion",
      nombre: "Disposición",
      responsive: true,
      campos: [
        {
          clave: "relacion", tipo: "seleccion", etiqueta: "Relación de aspecto",
          opciones: [["original", "Original"], ["1-1", "Cuadrada"], ["4-5", "Vertical 4:5"], ["16-9", "Apaisada 16:9"]],
          defecto: "original", css: "aspect-ratio",
          mapa_css: { original: "", "1-1": "1 / 1", "4-5": "4 / 5", "16-9": "16 / 9" }
        },
        {
          clave: "ajuste", tipo: "segmentado", etiqueta: "Ajuste",
          opciones: [["cubrir", "Cubrir"], ["contener", "Contener"]],
          defecto: "cubrir", css: "object-fit",
          mapa_css: { cubrir: "cover", contener: "contain" }
        },
        { clave: "ancho_max", tipo: "medida", etiqueta: "Ancho máximo", unidad: "px", defecto: null, min: 40, max: 2000, css: "max-width" },
        base.alineacion()
      ]
    },
    ...base.gruposComunes({ apariencia: { sombra: true } })
  ],

  render(nodo, ctx) {
    if (!ctx.visible(nodo)) return "";
    const v = ctx.valores(nodo);
    if (!v.imagen || !v.imagen.src || !ctx.urlSegura(v.imagen.src, { media: true })) return "";

    const estilos = ctx.estilos(nodo, ["relacion", "ajuste", "ancho_max", ...base.CLAVES_COMUNES]);
    const clases = ["tiq-imagen", ctx.escapar(v.clase || "")].filter(Boolean).join(" ");
    const img =
      `<img class="${clases}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}"` +
      ` src="${ctx.escapar(v.imagen.src)}" alt="${ctx.escapar(v.imagen.alt || "")}" loading="lazy" decoding="async">`;

    if (v.enlace && v.enlace.url && ctx.urlSegura(v.enlace.url)) {
      return `<a class="tiq-imagen__enlace" href="${ctx.escapar(v.enlace.url)}"` +
        `${v.enlace.nueva_pestana ? ' target="_blank" rel="noopener"' : ""}>${img}</a>`;
    }
    return img;
  }
};
