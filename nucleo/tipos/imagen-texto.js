// BLOQUE IMAGEN + TEXTO — contenido editorial con composición responsive.

"use strict";

const base = require("./_base");

function imagenSegura(ctx, imagen, alt) {
  if (!imagen || !ctx.urlSegura(imagen.src, { media: true })) return "";
  return `<img src="${ctx.escapar(imagen.src)}" alt="${ctx.escapar(imagen.alt || alt || "")}" loading="lazy" decoding="async">`;
}

module.exports = {
  tipo: "imagen_texto", nombre: "Imagen con texto", categoria: "imagen_contenido", icono: "imagen-texto",
  admite_hijos: false, limite_por_pagina: null,
  semilla: { titulo: "Un cambio visible desde el primer uso", texto: "Contá qué hace diferente a tu producto.", imagen: null },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [
      { clave: "titulo", tipo: "texto_plano", etiqueta: "Título", defecto: "Un cambio visible desde el primer uso" },
      { clave: "texto", tipo: "texto_largo", etiqueta: "Texto", defecto: "Contá qué hace diferente a tu producto." },
      { clave: "imagen", tipo: "imagen", etiqueta: "Imagen", defecto: null },
      { clave: "enlace", tipo: "enlace", etiqueta: "Enlace", defecto: null }
    ] },
    { id: "disposicion", nombre: "Disposición", responsive: true, campos: [
      { clave: "direccion", tipo: "segmentado", etiqueta: "Dirección", opciones: [["imagen-izquierda", "Imagen izquierda"], ["imagen-derecha", "Imagen derecha"]], defecto: "imagen-izquierda", css: "--tiq-imagen-texto-direccion", mapa_css: { "imagen-izquierda": "row", "imagen-derecha": "row-reverse" } },
      base.alineacion()
    ] },
    ...base.gruposComunes({ apariencia: { sombra: true }, espaciado: { margen: true } })
  ],
  render(nodo, ctx) {
    if (!ctx.visible(nodo)) return "";
    const v = ctx.valores(nodo);
    const titulo = ctx.sanear(v.titulo || "");
    const texto = ctx.sanear(v.texto || "");
    const imagen = imagenSegura(ctx, v.imagen, v.titulo);
    const enlace = v.enlace && ctx.urlSegura(v.enlace.url) ? `<a class="tiq-imagen-texto__cta" href="${ctx.escapar(v.enlace.url)}"${v.enlace.nueva_pestana ? " target=\"_blank\" rel=\"noopener noreferrer\"" : ""}>${ctx.escapar(v.enlace.texto || "Conocer más")}</a>` : "";
    return `<section class="tiq-imagen-texto" data-nodo="${ctx.escapar(nodo.id)}" style="${ctx.estilos(nodo, ["direccion", "alineacion", ...base.CLAVES_COMUNES])}"><div class="tiq-imagen-texto__imagen">${imagen || `<div class="tiq-imagen-texto__vacio">Imagen pendiente</div>`}</div><div class="tiq-imagen-texto__copy">${titulo ? `<h2>${titulo}</h2>` : ""}${texto ? `<p>${texto}</p>` : ""}${enlace}</div></section>`;
  }
};
