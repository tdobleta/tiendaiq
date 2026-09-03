// ============================================================
// LIENZO — el preview, dentro de un iframe.
//
// El iframe no es un detalle técnico, es la condición para que el preview no
// mienta: aísla los estilos del admin de los de la página. Sin él, el CSS de
// Polaris se filtra en el preview, el merchant ajusta hasta que "se ve bien" y
// en la tienda queda distinto.
//
// Cambiar entre escritorio y móvil es cambiar el ANCHO del iframe. No se
// re-renderiza nada distinto: el html y el css son los mismos que sirve la
// tienda (ver nucleo/render.js), así que la media query hace su trabajo sola.
// Un preview que "simula" móvil con otras variables es un preview que miente.
//
// El documento del iframe se escribe UNA vez y después solo se reemplaza el
// cuerpo y la hoja de estilos. Reescribirlo entero en cada tecla perdería la
// posición del scroll, que es de las cosas que más molestan al editar una
// página larga.
// ============================================================

"use strict";

const ANCHOS = { escritorio: null, movil: 390 };

// La hoja base de los bloques se sirve desde el mismo origen que el admin.
// Es un parámetro y no una constante porque el arnés de desarrollo la abre
// desde otra ruta, y porque el día que haya CDN el cambio es de una línea.
const CSS_POR_DEFECTO = "/dist/render.css";

// Centro de desplazamiento del nodo dentro del viewport del iframe. Se separa
// de la API del DOM para poder comprobar el contrato aunque no haya un
// navegador en la suite: un clic del árbol siempre debe producir un scroll
// positivo hacia el bloque y nunca una posición negativa.
function destinoScroll(actual, altoVentana, rect) {
  const centro = Math.max(24, (altoVentana - rect.height) / 2);
  return Math.max(0, actual + rect.top - centro);
}

const plantillaCon = (css) =>
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<link rel="stylesheet" href="' + css + '">' +
  '<style id="tiq-responsive"></style>' +
  '<style>body{margin:0}' +
  '[data-nodo]{outline-offset:-1px}' +
  '[data-nodo]:hover{outline:1px dashed rgba(0,0,0,.25)}' +
  '.tiq-sel{outline:2px solid #1a73e8 !important;outline-offset:-2px}' +
  '</style></head><body></body></html>';

function crearLienzo(contenedor, { alSeleccionar = () => {}, alDesplazar = () => {}, rutaCss = CSS_POR_DEFECTO } = {}) {
  const marco = contenedor.ownerDocument.createElement("iframe");
  marco.className = "ed-lienzo__marco";
  marco.setAttribute("title", "Vista previa de la página");
  contenedor.appendChild(marco);

  let doc = null;
  let seleccionActual = null;
  let nodoPorVer = null;

  function preparar() {
    doc = marco.contentDocument;
    doc.open();
    doc.write(plantillaCon(rutaCss));
    doc.close();

    // Un clic en el preview selecciona el bloque. Se cancela la navegación:
    // dentro del editor, un enlace que se sigue saca al merchant de la página.
    doc.addEventListener("click", (evento) => {
      const enlace = evento.target.closest && evento.target.closest("a");
      if (enlace) evento.preventDefault();
      const elemento = evento.target.closest && evento.target.closest("[data-nodo]");
      alSeleccionar(elemento ? elemento.dataset.nodo : null);
    });
    // La barra flotante vive fuera del iframe. Escuchar el scroll interno es
    // lo que la mantiene pegada al bloque cuando el merchant recorre una
    // página larga dentro del preview.
    doc.defaultView.addEventListener("scroll", alDesplazar, { passive: true });
  }

  function pintar({ html, css, seleccion }) {
    if (!doc) preparar();
    const vista = doc.defaultView;
    const scrollX = vista?.scrollX || 0;
    const scrollY = vista?.scrollY || 0;
    doc.body.innerHTML = html;
    doc.getElementById("tiq-responsive").textContent = css;
    marcar(seleccion);
    const idPorVer = nodoPorVer;
    nodoPorVer = null;
    if (idPorVer) desplazarA(idPorVer, "auto");
    else if (vista?.scrollTo) {
      // Editar repinta el cuerpo del iframe. Recuperar la posición anterior
      // evita que cada tecla devuelva al merchant al comienzo de la página.
      try { vista.scrollTo({ left: scrollX, top: scrollY, behavior: "auto" }); }
      catch { vista.scrollTo(scrollX, scrollY); }
    }
  }

  function marcar(id) {
    if (!doc) return;
    seleccionActual = id;
    for (const el of doc.querySelectorAll(".tiq-sel")) el.classList.remove("tiq-sel");
    const elegido = id && doc.querySelector(`[data-nodo="${id}"]`);
    if (elegido) elegido.classList.add("tiq-sel");
    return elegido || null;
  }

  // Dónde está el bloque seleccionado, en coordenadas del documento del admin.
  // Lo usa la barra flotante para colocarse encima sin vivir dentro del iframe
  // (adentro heredaría los estilos de la página del merchant).
  function rectangulo(id) {
    if (!doc) return null;
    const elemento = doc.querySelector(`[data-nodo="${id || seleccionActual}"]`);
    if (!elemento) return null;
    const dentro = elemento.getBoundingClientRect();
    const marcoRect = marco.getBoundingClientRect();
    return {
      arriba: marcoRect.top + dentro.top,
      izquierda: marcoRect.left + dentro.left,
      ancho: dentro.width,
      alto: dentro.height
    };
  }

  function fijarViewport(viewport) {
    const ancho = ANCHOS[viewport];
    marco.style.width = ancho ? `${ancho}px` : "100%";
    marco.style.flex = ancho ? `0 0 ${ancho}px` : "1 1 auto";
    marco.classList.toggle("es-movil", !!ancho);
  }

  function desplazarA(id, behavior = "smooth") {
    if (!doc || !id) return null;
    const elemento = doc.querySelector(`[data-nodo="${id}"]`);
    if (!elemento) return null;
    const vista = doc.defaultView;
    const rect = elemento.getBoundingClientRect();
    const altoVentana = vista?.innerHeight || marco.clientHeight || 0;
    const actual = vista?.scrollY || 0;
    const destino = destinoScroll(actual, altoVentana, rect);
    if (vista?.scrollTo) {
      try { vista.scrollTo({ top: destino, left: vista.scrollX || 0, behavior }); }
      catch { vista.scrollTo(vista.scrollX || 0, destino); }
    } else if (elemento.scrollIntoView) {
      elemento.scrollIntoView({ block: "center", behavior });
    }
    return elemento;
  }

  function verNodo(id) {
    nodoPorVer = id || null;
    return desplazarA(id);
  }

  return { pintar, marcar, rectangulo, fijarViewport, verNodo, marco };
}

module.exports = { crearLienzo, ANCHOS, CSS_POR_DEFECTO, destinoScroll };
