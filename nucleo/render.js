// ============================================================
// RENDER — el único lugar del sistema que produce HTML (invariante I2).
//
// Este archivo corre en Node (pruebas, publicación) y en el navegador (preview
// del editor y storefront del merchant), compilado por scripts/construir-render.js.
// Si algún día hay una segunda función que arme el HTML de un bloque, el editor
// y la tienda se separan y el merchant deja de confiar en el preview. Ese es
// exactamente el estado del que venimos.
//
// -------- responsive: por qué devuelve { html, css } --------
//
// La tienda sirve UN solo HTML a celulares y a escritorios. Entonces los
// valores de móvil no pueden resolverse "al renderizar": tienen que viajar como
// CSS. Por eso el render emite estilos de escritorio en línea y una hoja con
// las diferencias de móvil scopeadas por [data-nodo="..."].
//
// La consecuencia buena es que el preview del editor no simula nada: muestra el
// mismo HTML y el mismo CSS que la tienda, y cambiar de vista es cambiar el
// ancho del iframe. Un preview que "simula móvil" resolviendo otras variables
// miente tarde o temprano.
//
// Lo mismo vale para ocultar: un bloque escondido en móvil SÍ está en el HTML,
// escondido por media query. Sacarlo del HTML lo sacaría también del escritorio.
// ============================================================

"use strict";

const { contexto, escapar } = require("./resolver");
const registro = require("./registro");
const { variablesCss } = require("./tokens");

// Mismo corte que usa Dawn, el tema base de Shopify. Que coincida importa: si
// nuestro breakpoint y el del tema del merchant difieren, hay una franja de
// anchos donde la página se ve rota y nadie entiende por qué.
const PUNTO_QUIEBRE = 750;

const MEDIA_MOVIL = `@media (max-width:${PUNTO_QUIEBRE - 1}px)`;
const MEDIA_ESCRITORIO = `@media (min-width:${PUNTO_QUIEBRE}px)`;

// Un bloque roto no puede tumbar la página de una tienda con tráfico. En la
// tienda desaparece dejando rastro en el HTML; en el editor se ve, porque ahí
// el que mira es el merchant y necesita saber que algo pasa.
function marcaDeError(nodo, modo, error) {
  if (modo !== "editor") return `<!-- tiq: bloque "${nodo && nodo.tipo}" omitido -->`;
  const detalle = error ? String(error.message || error) : "tipo desconocido";
  return `<div class="tiq-error" data-nodo="${nodo && nodo.id}">Bloque "${nodo && nodo.tipo}" no se pudo dibujar: ${detalle}</div>`;
}

// Las reglas de móvil de un nodo: solo lo que de verdad cambia. Emitir todas
// las propiedades otra vez haría una hoja enorme y, peor, pisaría en móvil
// valores que el bloque estaba heredando bien.
function reglasDeNodo(nodo, ctxMovil, valoresEscritorio) {
  const definicion = registro.definicion(nodo.tipo);
  const reglas = [];
  const selector = `[data-nodo="${nodo.id}"]`;

  const claves = Object.keys(nodo.props_movil || {}).filter((clave) => {
    const campo = definicion.porClave[clave];
    return campo && campo.css;
  });
  const declaraciones = claves.length ? ctxMovil.estilos(nodo, claves) : "";
  if (declaraciones) reglas.push({ media: MEDIA_MOVIL, texto: `${selector}{${declaraciones}}` });

  // Ocultar es CSS, no ausencia de HTML (ver cabecera).
  if (valoresEscritorio.mostrar_movil === false) {
    reglas.push({ media: MEDIA_MOVIL, texto: `${selector}{display:none !important}` });
  }
  if (valoresEscritorio.mostrar_escritorio === false) {
    reglas.push({ media: MEDIA_ESCRITORIO, texto: `${selector}{display:none !important}` });
  }

  return reglas;
}

// Agrupa las reglas por media query para no repetir el bloque @media por nodo.
function hojaDe(reglas) {
  if (!reglas.length) return "";
  const porMedia = new Map();
  for (const regla of reglas) {
    if (!porMedia.has(regla.media)) porMedia.set(regla.media, []);
    porMedia.get(regla.media).push(regla.texto);
  }
  return [...porMedia.entries()].map(([media, textos]) => `${media}{${textos.join("")}}`).join("");
}

// Renderiza un documento completo. Devuelve { html, css }: los dos se sirven
// juntos, tanto en el editor como en la tienda.
function render(documento, { modo = "tienda", producto = null, urls = null, carritoUrl = "/cart/add" } = {}) {
  if (!documento || typeof documento !== "object") throw new Error("render: documento inválido");

  const escritorio = contexto(documento, { viewport: "escritorio" });
  const movil = contexto(documento, { viewport: "movil" });
  const reglas = [];

  function unNodo(nodo) {
    if (!nodo || !registro.existe(nodo.tipo)) return marcaDeError(nodo, modo);
    const valores = escritorio.valores(nodo);
    if (!escritorio.visible(nodo)) return "";   // oculto en los dos viewports
    try {
      const html = registro.definicion(nodo.tipo).render(nodo, ctx);
      if (html) reglas.push(...reglasDeNodo(nodo, movil, valores));
      return html;
    } catch (error) {
      return marcaDeError(nodo, modo, error);
    }
  }

  function listaDeNodos(nodos) {
    return (nodos || []).map(unNodo).join("");
  }

  // El contexto que reciben los tipos: el de escritorio, más el recorrido de
  // hijos. Los tipos nunca ven el árbol; solo piden ctx.hijos(nodo).
  // El documento sigue siendo la única fuente de copy y estilos; el producto
  // es contexto de lectura para bloques nativos (título, precio, variantes).
  // Mantenerlo fuera del árbol evita duplicar datos de Shopify en cada nodo.
  const ctx = {
    ...escritorio, modo, producto, urls, carritoUrl,
    hijos: (nodo) => listaDeNodos(nodo.hijos)
  };

  const cuerpo = listaDeNodos(documento.arbol);
  // El escapado NO es decorativo: las pilas tipográficas llevan comillas dobles
  // ("Archivo", "Helvetica Neue"), y sin escapar cortan el atributo style en la
  // primera. El síntoma es traicionero: las variables de marca desaparecen y la
  // página entera cae a la fuente por defecto del navegador, sin ningún error.
  const html = `<div class="tiq-doc" style="${escapar(variablesCss(documento.branding))}">${cuerpo}</div>`;

  return { html, css: hojaDe(reglas) };
}

// Render de un nodo suelto, para que el editor pueda repintar solo lo que
// cambió en vez de reconstruir la página entera en cada tecla.
function renderNodo(documento, nodo, { modo = "editor", producto = null, urls = null, carritoUrl = "/cart/add" } = {}) {
  const completo = render({ ...documento, arbol: [nodo] }, { modo, producto, urls, carritoUrl });
  const desde = completo.html.indexOf(">") + 1;
  return { html: completo.html.slice(desde, completo.html.lastIndexOf("</div>")), css: completo.css };
}

module.exports = { render, renderNodo, PUNTO_QUIEBRE, MEDIA_MOVIL, MEDIA_ESCRITORIO };
