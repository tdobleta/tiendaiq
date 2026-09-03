// ESTADÍSTICAS — porcentajes editoriales con etiqueta de procedencia.

"use strict";

const base = require("./_base");

module.exports = {
  tipo: "estadisticas", nombre: "Estadísticas destacadas", categoria: "prueba_social", icono: "estadisticas",
  admite_hijos: false, limite_por_pagina: null,
  semilla: { titulo: "Lo que notaron quienes lo usaron", items: [{ porcentaje: 90, texto: "Notaron una mejora visible." }] },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [
      { clave: "imagen", tipo: "imagen", etiqueta: "Imagen", defecto: null },
      { clave: "titulo", tipo: "texto_plano", etiqueta: "Título", defecto: "Lo que notaron quienes lo usaron" },
      { clave: "items", tipo: "lista", etiqueta: "Resultados", nombre_item: "Resultado", max_items: 6, item_campos: [
        { clave: "porcentaje", tipo: "numero", etiqueta: "Porcentaje", defecto: 90, min: 0, max: 100 },
        { clave: "texto", tipo: "texto_largo", etiqueta: "Resultado", defecto: "Notaron una mejora visible." }
      ], defecto: [] }
    ] },
    { id: "estilo", nombre: "Estadísticas", responsive: true, campos: [
      { clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@primario", css: "color" },
      { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 15, min: 11, max: 24, css: "font-size" }
    ] },
    ...base.gruposComunes({ apariencia: { fondo: false, borde: false, radio: true, sombra: false }, espaciado: { margen: true } })
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const items = Array.isArray(v.items) ? v.items : [];
    const imagen = v.imagen ? `<div class="tiq-estadisticas__imagen">${ctx.urlSegura(v.imagen.src, { media: true }) ? `<img src="${ctx.escapar(v.imagen.src)}" alt="${ctx.escapar(v.imagen.alt || v.titulo || "")}" loading="lazy" decoding="async">` : ""}</div>` : "";
    return `<section class="tiq-estadisticas" data-nodo="${ctx.escapar(nodo.id)}" style="${ctx.estilos(nodo, ["color", "tamano", ...base.CLAVES_COMUNES])}">${imagen}<h2>${ctx.escapar(v.titulo || "Resultados")}</h2><div class="tiq-estadisticas__lista">${items.map((item) => { const porcentaje = Math.max(0, Math.min(100, Number(item.porcentaje) || 0)); return `<article><strong>${porcentaje}%</strong><div><span>${ctx.escapar(item.texto || "")}</span><i style="--tiq-porcentaje:${porcentaje}%"></i></div></article>`; }).join("")}</div></section>`;
  }
};
