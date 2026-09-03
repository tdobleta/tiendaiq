// ============================================================
// COMERCIO — primitivas vivas de la compra.
//
// El documento decide copy y diseño; Shopify decide variantes y disponibilidad.
// Estas piezas son independientes para que una composición pueda ordenar
// selector, cantidad y CTA como PagePilot, sin congelar esos datos en la IA.
// ============================================================

"use strict";

const base = require("./_base");

function css(nodo, ctx, claves) { return ctx.estilos(nodo, claves); }
function envoltorio(nodo, ctx, clase, contenido, estilos = "") {
  return `<section class="${clase}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${contenido}</section>`;
}
function variantesDe(ctx) {
  const producto = ctx.producto || {};
  const lista = Array.isArray(producto.variantes) ? producto.variantes : producto.variants;
  return (Array.isArray(lista) ? lista : []).filter((v) => v && (v.id || v.variant_id || v.variantId));
}

const selector = {
  tipo: "selector_variantes", nombre: "Selector de variantes", categoria: "producto", icono: "variantes",
  admite_hijos: false, limite_por_pagina: 1, semilla: { etiqueta: "Elegí una opción", mostrar_si_unica: false },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [
      { clave: "etiqueta", tipo: "texto_plano", etiqueta: "Etiqueta", defecto: "Elegí una opción" },
      { clave: "mostrar_si_unica", tipo: "booleano", etiqueta: "Mostrar si hay una sola variante", defecto: false }
    ] },
    { id: "tipografia", nombre: "Tipografía", responsive: true, campos: [
      { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 14, min: 11, max: 24, css: "font-size" }
    ] },
    ...base.gruposComunes()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo);
    const variantes = variantesDe(ctx);
    const ocultar = variantes.length <= 1 && v.mostrar_si_unica !== true;
    if (ocultar && ctx.modo !== "editor") return "";
    const opciones = variantes.map((variante) => {
      const id = variante.id || variante.variant_id || variante.variantId;
      const titulo = variante.titulo || variante.title || "Variante";
      const disponible = variante.disponible !== false && variante.available !== false;
      const activo = String(id) === String(ctx.producto?.variante_id || ctx.producto?.variant_id || "");
      return `<option value="${ctx.escapar(String(id))}"${activo ? " selected" : ""}${disponible ? "" : " disabled"}>${ctx.escapar(String(titulo))}${disponible ? "" : " — Agotado"}</option>`;
    }).join("");
    const cuerpo = ocultar
      ? `<p class="tiq-selector-variantes__vacio">La variante se elige automáticamente.</p>`
      : `<label><span>${ctx.sanear(v.etiqueta || "Elegí una opción")}</span><select name="id" data-tiq-variante aria-label="${ctx.escapar(v.etiqueta || "Variante")}">${opciones || `<option value="">No hay variantes disponibles</option>`}</select></label>`;
    return envoltorio(nodo, ctx, "tiq-selector-variantes", cuerpo, css(nodo, ctx, ["tamano", ...base.CLAVES_COMUNES]));
  }
};

const cantidad = {
  tipo: "cantidad_producto", nombre: "Cantidad", categoria: "producto", icono: "cantidad",
  admite_hijos: false, limite_por_pagina: 1, semilla: { etiqueta: "Cantidad", valor: 1 },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [
      { clave: "etiqueta", tipo: "texto_plano", etiqueta: "Etiqueta", defecto: "Cantidad" },
      { clave: "valor", tipo: "numero", etiqueta: "Valor inicial", defecto: 1, min: 1, max: 99 }
    ] },
    { id: "tipografia", nombre: "Tipografía", responsive: true, campos: [
      { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 14, min: 11, max: 24, css: "font-size" }
    ] },
    ...base.gruposComunes()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo);
    const valor = Math.max(1, Math.min(99, Math.floor(Number(v.valor) || 1)));
    return envoltorio(nodo, ctx, "tiq-cantidad-producto", `<label><span>${ctx.sanear(v.etiqueta || "Cantidad")}</span><input type="number" data-tiq-cantidad min="1" max="99" step="1" value="${valor}" aria-label="${ctx.escapar(v.etiqueta || "Cantidad")}"></label>`, css(nodo, ctx, ["tamano", ...base.CLAVES_COMUNES]));
  }
};

module.exports = [selector, cantidad];
