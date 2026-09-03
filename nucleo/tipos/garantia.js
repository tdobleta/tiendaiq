// GARANTÍA — mensaje de confianza sin prometer políticas no verificadas.

"use strict";

const base = require("./_base");

module.exports = {
  tipo: "garantia", nombre: "Garantía y devoluciones", categoria: "garantia", icono: "garantia",
  admite_hijos: false, limite_por_pagina: 1,
  semilla: { titulo: "Compra tranquila", texto: "Explicá de forma clara cómo acompañás al cliente si algo no sale bien." },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [
      { clave: "titulo", tipo: "texto_plano", etiqueta: "Título", defecto: "Compra tranquila" },
      { clave: "texto", tipo: "texto_largo", etiqueta: "Texto", defecto: "Explicá de forma clara cómo acompañás al cliente si algo no sale bien." },
      { clave: "enlace", tipo: "enlace", etiqueta: "Política completa", defecto: null }
    ] },
    { id: "tipografia", nombre: "Tipografía", responsive: true, campos: [
      { clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" },
      { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 15, min: 11, max: 24, css: "font-size" }
    ] },
    ...base.gruposComunes({ apariencia: { sombra: true }, espaciado: { margen: true } })
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo);
    const enlace = v.enlace && ctx.urlSegura(v.enlace.url) ? `<a href="${ctx.escapar(v.enlace.url)}"${v.enlace.nueva_pestana ? " target=\"_blank\" rel=\"noopener noreferrer\"" : ""}>${ctx.escapar(v.enlace.texto || "Ver política")}</a>` : "";
    return `<section class="tiq-garantia" data-nodo="${ctx.escapar(nodo.id)}" style="${ctx.estilos(nodo, ["color", "tamano", ...base.CLAVES_COMUNES])}"><h2>${ctx.escapar(v.titulo || "Compra tranquila")}</h2><p>${ctx.escapar(v.texto || "")}</p>${enlace}</section>`;
  }
};
