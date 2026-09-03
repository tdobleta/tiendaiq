// ============================================================
// RESOLVER — la cascada de estilos (invariante I4).
//
// Un nodo guarda SOLO lo que el merchant cambió. Todo lo demás se hereda:
//
//     props_movil[clave]   (solo si el viewport es móvil)
//       -> props[clave]
//         -> defecto del campo (que puede ser una referencia @token)
//           -> null  ("sin valor": no se emite la propiedad CSS)
//
// De acá sale el micro-toggle que se ve al lado de cada control en el panel:
// apagado = heredado, encendido = override. Por eso "presente" se decide con
// hasOwnProperty y NO con verdad/falsedad: `0` y `null` son overrides
// legítimos (0px de padding, "ningún color"). Preguntar `if (props.gap)` acá
// es el bug clásico que hace que el merchant no pueda poner un valor en cero.
//
// También vive acá el saneador de HTML. Es la única puerta por la que texto
// del merchant o de la IA llega al storefront de una tienda real: se emiten
// solo etiquetas de una lista blanca, reconstruidas, y todo lo demás se
// escapa. Nunca se re-emite el HTML de entrada tal cual.
// ============================================================

"use strict";

const { tokensDe, desreferenciar } = require("./tokens");
const registro = require("./registro");

const VIEWPORTS = ["escritorio", "movil"];

// Un valor está "presente" si la clave existe y no es undefined. null sí cuenta.
function presente(objeto, clave) {
  return !!objeto && Object.prototype.hasOwnProperty.call(objeto, clave) && objeto[clave] !== undefined;
}

// El corazón de I4. Devuelve el valor crudo (sin desreferenciar tokens).
function valorCrudo(nodo, campo, viewport) {
  if (viewport === "movil" && campo.responsive && presente(nodo.props_movil, campo.clave)) {
    return nodo.props_movil[campo.clave];
  }
  if (presente(nodo.props, campo.clave)) return nodo.props[campo.clave];
  return campo.defecto === undefined ? null : campo.defecto;
}

// ¿Este campo está overrideado en este viewport, o se hereda? Lo consume el
// panel para prender o apagar el micro-toggle, y para saber qué borrar cuando
// el merchant lo apaga.
function hayOverride(nodo, clave, viewport = "escritorio") {
  if (viewport === "movil") return presente(nodo.props_movil, clave);
  return presente(nodo.props, clave);
}

// El valor tal cual lo entiende el DOCUMENTO: "bold", "@titulos", "altas".
// A CSS se traduce recién al emitir estilos, no acá.
//
// La separación no es cosmética. El panel de propiedades muestra este valor
// para marcar la opción activa de un select: si acá se devolviera "700" en vez
// de "bold", el select no encontraría su opción y mostraría la primera. Lo
// mismo con "#1D3B1D" en vez de "@titulos", que haría que todo color de marca
// se viera como "Personalizado". Valores son datos; CSS es presentación.
function valorResuelto(nodo, campo, viewport) {
  const crudo = valorCrudo(nodo, campo, viewport);
  return crudo === undefined ? null : crudo;
}

// La traducción a CSS: token -> hex, y mapa del campo si lo declara
// (`altas` -> `uppercase`, `ajustado` -> `-0.02em`).
function aCss(valor, campo, tokens) {
  const resuelto = desreferenciar(valor, tokens);
  if (resuelto === null || resuelto === undefined) return null;
  if (campo.mapa_css && Object.prototype.hasOwnProperty.call(campo.mapa_css, resuelto)) {
    return campo.mapa_css[resuelto];
  }
  return resuelto;
}

// ---------- saneado de HTML ----------

const ETIQUETAS_SIMPLES = new Set(["b", "strong", "i", "em", "u", "s", "br", "p", "span", "ul", "ol", "li", "h2", "h3", "h4"]);
const PROTOCOLOS = /^(https?:|mailto:|tel:)/i;

function urlSegura(valor, { media = false } = {}) {
  const url = typeof valor === "string" ? valor.trim() : "";
  if (!url || /[\u0000-\u001f\u007f\s<>"']/.test(url)) return false;
  if (url.startsWith("/")) return true;
  return media ? /^https?:/i.test(url) : /^(https?:|mailto:|tel:)/i.test(url);
}

// Escapa texto. El `&` solo se escapa cuando no es ya una entidad, para no
// convertir el "&amp;" que escribió el merchant en "&amp;amp;".
function escapar(texto) {
  return String(texto)
    .replace(/&(?!#?\w+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Recibe una etiqueta cruda y devuelve la versión permitida RECONSTRUIDA, o ""
// si no está en la lista blanca. Reconstruir (y no devolver el original) es lo
// que impide que se cuele un `onclick=` dentro de una etiqueta permitida.
function etiquetaPermitida(cruda) {
  const cierre = /^<\/\s*([a-z0-9]+)\s*>$/i.exec(cruda);
  if (cierre) {
    const nombre = cierre[1].toLowerCase();
    if (nombre === "a") return "</a>";
    return ETIQUETAS_SIMPLES.has(nombre) ? `</${nombre}>` : "";
  }

  const apertura = /^<\s*([a-z0-9]+)([^>]*)>$/i.exec(cruda);
  if (!apertura) return "";
  const nombre = apertura[1].toLowerCase();

  if (ETIQUETAS_SIMPLES.has(nombre)) return nombre === "br" ? "<br>" : `<${nombre}>`;

  if (nombre === "a") {
    const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(apertura[2]);
    const url = (href && (href[2] ?? href[3]) || "").trim();
    if (!PROTOCOLOS.test(url)) return "<a>";
    return `<a href="${escapar(url)}" rel="noopener nofollow" target="_blank">`;
  }

  return "";
}

// Texto rico del merchant o de la IA -> HTML seguro.
function sanear(html) {
  if (typeof html !== "string" || !html) return "";
  const etiquetas = /<[^>]*>/g;
  let salida = "";
  let ultimo = 0;
  let m;
  while ((m = etiquetas.exec(html)) !== null) {
    salida += escapar(html.slice(ultimo, m.index));
    salida += etiquetaPermitida(m[0]);
    ultimo = m.index + m[0].length;
  }
  // Lo que queda (incluido un "<" suelto al final) se escapa entero.
  salida += escapar(html.slice(ultimo));
  return salida;
}

// ---------- contexto de render ----------

// Un contexto es todo lo que necesita el render de un tipo para hacer su
// trabajo sin saber nada del documento ni del árbol. Se arma una vez por
// render y se pasa hacia abajo. El recorrido del árbol y `hijos` los agrega
// nucleo/render.js (Fase 1); acá vive lo que depende solo del nodo.
function contexto(documento, { viewport = "escritorio" } = {}) {
  if (!VIEWPORTS.includes(viewport)) throw new Error(`viewport desconocido: ${viewport}`);
  const tokens = tokensDe(documento && documento.branding);
  const cache = new Map();

  function valores(nodo) {
    const enCache = cache.get(nodo);
    if (enCache) return enCache;
    const definicion = registro.definicion(nodo.tipo);
    const salida = {};
    for (const campo of definicion.campos) salida[campo.clave] = valorResuelto(nodo, campo, viewport);
    cache.set(nodo, salida);
    return salida;
  }

  // Declaraciones CSS a partir de los campos pedidos. Un campo sin `css` o con
  // valor null no emite nada: así "ningún color" es de verdad ningún color y
  // no `background:null`.
  function estilos(nodo, claves) {
    const definicion = registro.definicion(nodo.tipo);
    const resueltos = valores(nodo);
    const partes = [];
    for (const clave of claves) {
      const campo = definicion.porClave[clave];
      if (!campo || !campo.css) continue;
      const valor = aCss(resueltos[clave], campo, tokens);
      if (valor === null || valor === undefined || valor === "") continue;
      partes.push(`${campo.css}:${valor}${campo.unidad || ""}`);
    }
    return partes.join(";");
  }

  // ¿Este nodo llega al HTML? Sí mientras esté visible en AL MENOS un viewport.
  //
  // La tienda sirve un solo HTML a celulares y a escritorios, así que esconder
  // un bloque en móvil es trabajo de una media query, no de omitirlo del HTML:
  // omitirlo lo sacaría también del escritorio. nucleo/render.js emite esas
  // reglas. Acá solo se decide el caso trivial: oculto en los dos = no se pinta.
  //
  // La visibilidad sale de props como todo lo demás (grupoVisibilidad en
  // tipos/_base.js), así el panel no necesita ningún caso especial.
  function visible(nodo) {
    const resueltos = valores(nodo);
    const enEscritorio = !("mostrar_escritorio" in resueltos) || resueltos.mostrar_escritorio !== false;
    const enMovil = !("mostrar_movil" in resueltos) || resueltos.mostrar_movil !== false;
    return enEscritorio || enMovil;
  }

  // Un solo valor ya traducido a CSS. Lo necesita el panel para pintar la
  // muestra de color al lado del selector de tokens.
  const comoCss = (nodo, clave) => aCss(valores(nodo)[clave], registro.definicion(nodo.tipo).porClave[clave], tokens);

  return { viewport, tokens, valores, estilos, comoCss, visible, sanear, escapar, urlSegura };
}

module.exports = {
  VIEWPORTS, presente, valorCrudo, valorResuelto, aCss, hayOverride,
  sanear, escapar, urlSegura, contexto
};
