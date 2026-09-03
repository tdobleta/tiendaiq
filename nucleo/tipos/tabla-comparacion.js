// TABLA DE COMPARACIÓN — atributos del producto frente a una alternativa.

"use strict";

const base = require("./_base");

module.exports = {
  tipo: "tabla_comparacion", nombre: "Tabla comparativa", categoria: "beneficios", icono: "tabla",
  admite_hijos: false, limite_por_pagina: null,
  semilla: { titulo: "Por qué elegirlo", otro: "Alternativa", filas: [{ etiqueta: "Calidad", nosotros: true, otro: false }] },
  grupos: [
    { id: "contenido", nombre: "Comparación", responsive: false, campos: [
      { clave: "titulo", tipo: "texto_plano", etiqueta: "Título", defecto: "Por qué elegirlo" },
      { clave: "intro", tipo: "texto_largo", etiqueta: "Introducción", defecto: "" },
      { clave: "otro", tipo: "texto_plano", etiqueta: "Alternativa", defecto: "Alternativa" },
      { clave: "filas", tipo: "lista", etiqueta: "Filas", nombre_item: "Atributo", max_items: 12, item_campos: [
        { clave: "etiqueta", tipo: "texto_plano", etiqueta: "Atributo", defecto: "Calidad" },
        { clave: "nosotros", tipo: "booleano", etiqueta: "Nuestro producto", defecto: true },
        { clave: "otro", tipo: "booleano", etiqueta: "Alternativa", defecto: false }
      ], defecto: [] }
    ] },
    { id: "tipografia", nombre: "Tipografía", responsive: true, campos: [
      { clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" },
      { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 15, min: 11, max: 24, css: "font-size" }
    ] },
    ...base.gruposComunes({ apariencia: { sombra: false }, espaciado: { margen: true } })
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const filas = Array.isArray(v.filas) ? v.filas : [];
    const cuerpo = filas.map((fila) => `<tr><th scope="row">${ctx.escapar(fila.etiqueta || "Atributo")}</th><td aria-label="${v.titulo ? ctx.escapar(v.titulo) : "Producto"}">${fila.nosotros ? "✓" : "—"}</td><td aria-label="${ctx.escapar(v.otro || "Alternativa")}">${fila.otro ? "✓" : "✕"}</td></tr>`).join("");
    return `<section class="tiq-tabla-comparacion" data-nodo="${ctx.escapar(nodo.id)}" style="${ctx.estilos(nodo, ["color", "tamano", ...base.CLAVES_COMUNES])}"><h2>${ctx.escapar(v.titulo || "Por qué elegirlo")}</h2>${v.intro ? `<p>${ctx.sanear(v.intro)}</p>` : ""}<table><thead><tr><th></th><th>Nosotros</th><th>${ctx.escapar(v.otro || "Alternativa")}</th></tr></thead><tbody>${cuerpo}</tbody></table></section>`;
  }
};
