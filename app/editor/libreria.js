// ============================================================
// LIBRERÍA — el modal "Añadir sección".
//
// Se arma entera desde registro.catalogo(): categorías, tarjetas y contadores.
// Ningún nombre de sección escrito acá. Cuando se sumen las 39, este archivo no
// se toca.
//
// El "1/1" de una sección que ya llegó a su límite se muestra igual, deshabilitada
// y con el contador a la vista, en vez de esconderla. Esconder opciones hace que
// el merchant busque una función que ya usó y crea que no existe.
// ============================================================

"use strict";

const { esc } = require("./controles");

function normalizar(texto) {
  // Sin acentos: buscar "seccion" tiene que encontrar "Sección".
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function filtrar(catalogo, { categoria = null, busqueda = "" } = {}) {
  const aguja = normalizar(busqueda);
  return catalogo
    .filter((grupo) => !categoria || grupo.id === categoria)
    .map((grupo) => ({
      ...grupo,
      items: grupo.items.filter((item) => !aguja || normalizar(item.nombre).includes(aguja))
    }))
    .filter((grupo) => grupo.items.length > 0);
}

// La librería no muestra rectángulos grises: cada tarjeta tiene una miniatura
// vectorial estable. No depende de una foto del producto ni de un renderer
// segundo; es una señal visual compacta del tipo de bloque y carga al instante
// incluso cuando el merchant todavía no eligió imágenes.
function miniaturaDe(item) {
  const icono = String(item.icono || "bloque");
  const trazos = {
    galeria: '<rect x="8" y="8" width="84" height="48" rx="4"/><circle cx="28" cy="24" r="5"/><path d="M12 50l18-16 12 9 12-12 34 19"/>',
    titulo: '<path d="M12 22h64M12 32h48M12 42h30"/>',
    precio: '<path d="M12 24h50M12 36h35"/><rect x="58" y="40" width="27" height="10" rx="5"/>',
    beneficios: '<circle cx="18" cy="18" r="5"/><path d="M30 18h52M12 34h12M30 34h52M18 50h6M30 50h40"/>',
    packs: '<rect x="10" y="13" width="80" height="12" rx="3"/><rect x="10" y="31" width="80" height="12" rx="3"/><rect x="10" y="49" width="80" height="8" rx="3"/>',
    carrito: '<rect x="12" y="16" width="76" height="26" rx="5"/><path d="M28 51h44"/>',
    resena: '<circle cx="22" cy="26" r="9"/><path d="M38 19h45M38 28h35M38 37h27"/>',
    carrusel: '<rect x="8" y="14" width="25" height="38" rx="4"/><rect x="38" y="14" width="25" height="38" rx="4"/><rect x="68" y="14" width="25" height="38" rx="4"/>',
    faq: '<path d="M12 18h76M12 34h76M12 50h76"/><path d="M78 14l5 4-5 4M78 30l5 4-5 4M78 46l5 4-5 4"/>',
    tiempo: '<path d="M18 18v36M18 23h68M18 38h55M18 53h42"/><circle cx="18" cy="18" r="4"/><circle cx="18" cy="38" r="4"/><circle cx="18" cy="53" r="4"/>',
    contador: '<rect x="14" y="22" width="72" height="24" rx="12"/><path d="M31 34h8M48 34h8M65 34h8"/>',
    imagen: '<rect x="10" y="10" width="38" height="48" rx="4"/><path d="M54 20h32M54 31h27M54 42h32M54 53h20"/>',
    tabla: '<path d="M10 16h80M10 30h80M10 44h80M10 58h80M10 16v42M38 16v42M64 16v42M90 16v42"/>',
    estadisticas: '<path d="M14 55V35M34 55V22M54 55V30M74 55V14M94 55V40"/>',
    garantia: '<path d="M50 10l30 10v18c0 14-12 22-30 29-18-7-30-15-30-29V20z"/><path d="M35 38l10 9 20-21"/>'
  };
  const cuerpo = trazos[icono] || '<rect x="12" y="14" width="76" height="40" rx="5"/><path d="M23 28h54M23 39h38"/>';
  return `<svg class="ed-lib__miniatura" viewBox="0 0 100 66" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${cuerpo}</g></svg>`;
}

function htmlTarjeta(item, { usados = 0 } = {}) {
  const limite = item.limite_por_pagina;
  const agotado = limite ? usados >= limite : false;
  const identificador = item.composicion_id
    ? `data-composicion="${esc(item.composicion_id)}"`
    : `data-tipo="${esc(item.tipo)}"`;
  return `<button type="button" class="ed-lib__tarjeta${agotado ? " es-agotada" : ""}" ` +
    `${identificador}${agotado ? " disabled" : ""}>` +
    `<span class="ed-lib__nombre">${esc(item.nombre)}</span>` +
    (limite ? `<span class="ed-lib__cupo">${usados}/${limite}</span>` : "") +
    `<span class="ed-lib__vista" data-vista="${esc(item.tipo)}">${miniaturaDe(item)}</span>` +
    `</button>`;
}

// `contarUsados(tipo)` lo provee el estado del editor: la librería no conoce el
// documento, solo pregunta cuántos hay.
function htmlLibreria(catalogo, { categoria = null, busqueda = "", contarUsados = () => 0 } = {}) {
  const visibles = filtrar(catalogo, { categoria, busqueda });
  const total = catalogo.reduce((suma, grupo) => suma + grupo.items.length, 0);

  const lateral = `<aside class="ed-lib__lateral">` +
    `<button type="button" class="ed-lib__cat${!categoria ? " es-activa" : ""}" data-categoria="">` +
    `<span>Todas</span><span class="ed-lib__cuenta">${total}</span></button>` +
    catalogo.map((grupo) =>
      `<button type="button" class="ed-lib__cat${categoria === grupo.id ? " es-activa" : ""}" data-categoria="${esc(grupo.id)}">` +
      `<span>${esc(grupo.nombre)}</span><span class="ed-lib__cuenta">${grupo.items.length}</span></button>`
    ).join("") +
    `</aside>`;

  const cuerpo = visibles.length
    ? visibles.map((grupo) =>
        `<section class="ed-lib__grupo">` +
        `<h3 class="ed-lib__titulo">${esc(grupo.nombre)}</h3>` +
        `<div class="ed-lib__grilla">${grupo.items.map((item) => htmlTarjeta(item, { usados: contarUsados(item.tipo, item) })).join("")}</div>` +
        `</section>`
      ).join("")
    : `<p class="ed-lib__vacio">No hay secciones que coincidan con “${esc(busqueda)}”.</p>`;

  return `<div class="ed-lib" role="dialog" aria-label="Añadir sección">` +
    `<header class="ed-lib__cabecera"><h2>Añadir sección</h2>` +
    `<button type="button" class="ed-lib__cerrar" data-cerrar aria-label="Cerrar">✕</button></header>` +
    `<input type="search" class="ed-lib__buscar" data-buscar placeholder="Buscar…" value="${esc(busqueda)}">` +
    `<div class="ed-lib__cuerpo">${lateral}<div class="ed-lib__lista">${cuerpo}</div></div>` +
    `</div>`;
}

module.exports = { htmlLibreria, htmlTarjeta, filtrar, normalizar, miniaturaDe };
