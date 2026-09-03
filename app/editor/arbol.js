// ============================================================
// ÁRBOL — el panel izquierdo: la estructura de la página.
//
// Dos detalles que parecen menores y no lo son:
//
// 1. La etiqueta de una fila NO es el nombre del tipo, es el contenido. Una
//    lista de veinte filas que dicen "Texto" es inútil; una que dice "Camisa de
//    oficina" se lee de un vistazo. El nombre del tipo queda de respaldo para
//    los bloques sin texto.
//
// 2. Las secciones muestran cuántos bloques tienen adentro. Es la única forma
//    de saber qué hay en una sección colapsada sin abrirla.
//
// Todo es una cadena: el estado colapsado vive en el DOM (clase is-colapsado),
// no en el documento. Colapsar una sección no es un cambio del documento y no
// tiene que ensuciar el botón Guardar ni entrar al historial.
// ============================================================

"use strict";

const { esc } = require("./controles");

const CLAVES_TEXTO = ["html", "titulo", "titular", "texto", "nombre", "etiqueta_texto"];
const MAX_ETIQUETA = 34;

function sinEtiquetas(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function recortarEtiqueta(texto) {
  return texto.length > MAX_ETIQUETA ? texto.slice(0, MAX_ETIQUETA - 1) + "…" : texto;
}

// El texto más representativo del bloque, si tiene alguno. Esta parte mira
// solo las props del nodo: los contenedores suelen no tener copy propio y se
// resuelven en `etiquetaDe` con la rama de descendientes.
function etiquetaPropia(nodo, definicion, valores) {
  for (const clave of CLAVES_TEXTO) {
    const campo = definicion.porClave && definicion.porClave[clave];
    if (!campo) continue;
    const crudo = sinEtiquetas(valores ? valores[clave] : (nodo.props || {})[clave]);
    if (crudo) return recortarEtiqueta(crudo);
  }
  return null;
}

// Los wrappers de una página no tienen una etiqueta útil por sí mismos. Buscar
// el primer descendiente con contenido hace que una rama que antes decía nueve
// veces "Sección" se pueda escanear como "Un afeitado suave…" o "Galería de
// producto". Si toda la rama está vacía, el nombre del primer hijo sigue siendo
// mejor que repetir el nombre genérico del contenedor.
function etiquetaDe(nodo, definicion, valores, { definir = null, resolverValores = null, descendientes = false } = {}) {
  const propia = etiquetaPropia(nodo, definicion, valores);
  if (propia) return propia;
  if (descendientes && Array.isArray(nodo.hijos) && nodo.hijos.length && definir) {
    const buscar = (hijos) => {
      for (const hijo of hijos || []) {
        const defHijo = definir(hijo.tipo);
        const valoresHijo = resolverValores ? resolverValores(hijo) : null;
        const texto = etiquetaPropia(hijo, defHijo, valoresHijo);
        if (texto) return texto;
        const anidado = defHijo.admite_hijos ? buscar(hijo.hijos) : null;
        if (anidado) return anidado;
      }
      return null;
    };
    const encontrada = buscar(nodo.hijos);
    if (encontrada) return encontrada;
    const primerHijo = definir(nodo.hijos[0].tipo);
    if (primerHijo && primerHijo.nombre) return primerHijo.nombre;
  }
  return definicion.nombre;
}

function contarHijos(nodo) {
  let total = 0;
  for (const hijo of nodo.hijos || []) total += 1 + contarHijos(hijo);
  return total;
}

const CHEVRON = '<svg class="ed-arbol__chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

// Iconos mínimos, lineales y distintos por tipo. Son parte del cromo del
// editor, no del documento: cambiar un icono jamás ensucia ni versiona la
// página del merchant. Las claves vienen del registro y el fallback mantiene
// legible cualquier tipo nuevo mientras se le agrega su dibujo.
const ICONOS_ARBOL = {
  grupo: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M7 4.5h2M11.5 7v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  error: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5v4M8 11.5v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  seccion: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4l6-2 6 2-6 2-6-2zm0 4l6 2 6-2M2 12l6 2 6-2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  texto: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10M8 3v10M5 13h6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  imagen: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.5" cy="6" r="1" fill="currentColor"/><path d="M3.5 12l3.2-3 2.2 2 1.5-1.3 2.1 2.3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  "imagen-texto": '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2" width="5.5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9 4h5M9 7h5M9 10h3M9 13h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  galeria: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="2" width="9" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="4" width="9" height="10" rx="1" fill="var(--ed-panel)" stroke="currentColor" stroke-width="1.2"/></svg>',
  titulo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10M8 3v10M5 13h6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  precio: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5V2.5h6l5 5-6 6-5-5v-4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="5.5" cy="5.5" r=".8" fill="currentColor"/></svg>',
  beneficios: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l1.7 3.5 3.9.6-2.8 2.8.7 3.9L8 11.2l-3.5 1.8.7-3.9-2.8-2.8 3.9-.6L8 2.2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  packs: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="3" rx=".8" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="7" width="12" height="3" rx=".8" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="11" width="12" height="2" rx=".8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  carrito: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h2l1.2 7h7.5l1.5-5.2H5M6 13.2h.1M12 13.2h.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  resena: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.2h10v7H7l-3 2v-2H3z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5 5.7h6M5 8h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  carrusel: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="8" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 6l-1 2 1 2M14 6l1 2-1 2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  faq: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.3 6.2a1.8 1.8 0 113.1 1.2c-.9.8-1.4 1-1.4 2M8 11.7v.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  tiempo: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8l2.4 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  contador: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8l2 1.2M5 1.8h6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  tabla: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h12M2 9.5h12M6 2.5v11M10 2.5v11" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  estadisticas: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5V9.5h3v4M6.5 13.5V5.5h3v8M10.5 13.5V2.5h3v11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  garantia: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l5 2v3.8c0 3.1-2.1 5.1-5 6.2-2.9-1.1-5-3.1-5-6.2V4l5-2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 8l1.7 1.7 3.3-3.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const ICONO_FALLBACK = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 6h7M4.5 9h5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

function iconoDe(definicion) {
  return ICONOS_ARBOL[definicion && definicion.icono] || ICONO_FALLBACK;
}

function htmlFila(nodo, { definicion, valores, seleccion, oculto, colapsado = false, etiqueta = null }) {
  const tieneHijos = definicion.admite_hijos;
  const cantidad = contarHijos(nodo);
  const clases = [
    "ed-arbol__fila",
    nodo.id === seleccion ? "es-seleccionada" : "",
    oculto ? "es-oculta" : ""
  ].filter(Boolean).join(" ");

  return `<div class="${clases}" data-nodo="${esc(nodo.id)}" tabindex="0" role="treeitem" aria-selected="${nodo.id === seleccion}" draggable="true">` +
    (tieneHijos ? `<button type="button" class="ed-arbol__toggle" data-colapsar aria-expanded="${!colapsado}" title="${colapsado ? "Expandir" : "Contraer"}">${CHEVRON}</button>` : `<span class="ed-arbol__hueco"></span>`) +
    `<span class="ed-arbol__icono" data-icono="${esc(definicion.icono)}">${iconoDe(definicion)}</span>` +
    `<span class="ed-arbol__texto">${esc(etiqueta || etiquetaDe(nodo, definicion, valores))}</span>` +
    (tieneHijos && cantidad ? `<span class="ed-arbol__cuenta">${cantidad}</span>` : "") +
    `</div>`;
}

// `contexto` trae { definicion(tipo), valores(nodo), seleccion, estaOculto(nodo) }.
// El árbol no importa nada del núcleo: recibe todo lo que necesita. Eso lo hace
// trivial de testear y de reusar (por ejemplo, en una vista de solo lectura).
function htmlArbol(documento, ctx) {
  const rama = (nodos, nivel) => nodos.map((nodo) => {
    const definicion = ctx.definicion(nodo.tipo);
    const valores = ctx.valores ? ctx.valores(nodo) : null;
    const colapsado = definicion.admite_hijos && ctx.colapsados && ctx.colapsados.has(nodo.id);
    const fila = htmlFila(nodo, {
      definicion, valores,
      seleccion: ctx.seleccion,
      oculto: ctx.estaOculto ? ctx.estaOculto(nodo) : false,
      colapsado,
      etiqueta: etiquetaDe(nodo, definicion, valores, {
        descendientes: definicion.admite_hijos,
        definir: ctx.definicion,
        resolverValores: ctx.valores
      })
    });
    const hijos = definicion.admite_hijos
      ? `<div class="ed-arbol__hijos">${rama(nodo.hijos || [], nivel + 1)}` +
        `<button type="button" class="ed-arbol__agregar" data-agregar-en="${esc(nodo.id)}">+ Añadir bloque</button></div>`
      : "";
    return `<div class="ed-arbol__nodo${colapsado ? " es-colapsado" : ""}" data-nivel="${nivel}" data-nodo-contenedor="${esc(nodo.id)}">${fila}${hijos}</div>`;
  }).join("");

  return `<nav class="ed-arbol" aria-label="Estructura de la página" role="tree">` +
    `<header class="ed-arbol__cabecera"><h2>Página de producto</h2></header>` +
    `<div class="ed-arbol__cuerpo">${rama(documento.arbol || [], 0)}</div>` +
    `<button type="button" class="ed-arbol__agregar ed-arbol__agregar--raiz" data-agregar-seccion>+ Añadir sección</button>` +
    `</nav>`;
}

// Devuelve solo los ids de los padres de un nodo. El editor usa esta ruta para
// revelar una selección que nació en el iframe y expandir exactamente las
// ramas necesarias, sin abrir todo el árbol.
function ancestrosDe(documento, id) {
  const buscar = (nodos, padres) => {
    for (const nodo of nodos || []) {
      if (nodo.id === id) return padres;
      const encontrado = buscar(nodo.hijos, [...padres, nodo.id]);
      if (encontrado) return encontrado;
    }
    return null;
  };
  return buscar(documento && documento.arbol, []) || [];
}

module.exports = { htmlArbol, etiquetaDe, contarHijos, sinEtiquetas, iconoDe, ancestrosDe };
