// ============================================================
// PANEL — el panel derecho, generado desde el schema del tipo (I3).
//
// No hay una sola línea acá que mencione "texto", "imagen" o "sección". El
// panel pide registro.esquemaPanel(tipo) y dibuja lo que venga. Ese es el
// invariante entero: la sección número 40 cuesta lo mismo que la número 2.
//
// El toggle escritorio/móvil vive en la cabecera de cada GRUPO, no en cada
// campo, porque así lo espera quien viene del competidor y porque un toggle por
// campo llenaría el panel de ruido. Cambia el viewport de edición global: hay
// un solo lugar donde vive "qué estoy editando", y tanto el panel como el
// lienzo lo leen de ahí.
// ============================================================

"use strict";

const { htmlCampo, esc } = require("./controles");

const ICONO_ESCRITORIO = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1" y="2" width="14" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 14h4" stroke="currentColor" stroke-width="1.4"/></svg>';
const ICONO_MOVIL = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 12.5h2" stroke="currentColor" stroke-width="1.4"/></svg>';

function htmlToggleViewport(viewport) {
  const boton = (valor, icono, titulo) =>
    `<button type="button" class="ed-vp__boton${viewport === valor ? " es-activo" : ""}" ` +
    `data-viewport="${valor}" title="${titulo}" aria-pressed="${viewport === valor}">${icono}</button>`;
  return `<div class="ed-vp">${boton("escritorio", ICONO_ESCRITORIO, "Editar para escritorio")}` +
    `${boton("movil", ICONO_MOVIL, "Editar para móvil")}</div>`;
}

// Estado vacío: solo es una barrera de seguridad para un documento sin nodos.
// Una página normal selecciona su primer bloque al abrirse; no mostramos una
// pantalla de onboarding que compita con el inspector real.
function htmlPanelVacio() {
  return `<div class="ed-panel ed-panel--vacio">` +
    `<p class="ed-panel__titulo">Inspector</p>` +
    `</div>`;
}

// Un documento puede contener un tipo escrito por una versión más nueva del
// editor. No inventamos controles para sus props: mostramos el estado con una
// acción segura (el bloque puede seleccionarse y eliminarse) y dejamos intacto
// el resto de la página.
function htmlPanelDesconocido({ nodo, tipo } = {}) {
  const nombre = tipo || nodo?.tipo || "desconocido";
  return `<div class="ed-panel ed-panel--desconocido" data-nodo="${esc(nodo?.id || "")}">` +
    `<header class="ed-panel__cabecera"><h2 class="ed-panel__titulo">Bloque no disponible</h2></header>` +
    `<div class="ed-panel__estado" role="status"><strong>${esc(nombre)}</strong>` +
    `<p>Este bloque fue creado con una versión más nueva. Podés eliminarlo o actualizar la app para editarlo.</p></div>` +
    `<footer class="ed-panel__pie"><button type="button" class="ed-boton ed-boton--peligro" data-borrar-nodo>Eliminar bloque</button></footer>` +
    `</div>`;
}

// `esquema` viene de registro.esquemaPanel(tipo); `valores` es el resultado de
// resolver.contexto(...).valores(nodo) — es decir, el valor EFECTIVO, herencia
// ya aplicada. El control muestra lo que se ve en la página, no lo que está
// escrito en el nodo; el micro-toggle es el que cuenta cuál de los dos es.
function htmlPanel({ esquema, nodo, valores, overrideado = () => false, muestra = () => null, viewport = "escritorio" }) {
  if (!esquema || !nodo) return htmlPanelVacio();

  const grupos = esquema.grupos.map((grupo) => {
    const campos = grupo.campos.map((campo) =>
      htmlCampo(campo, valores[campo.clave], { overrideado: overrideado(campo.clave), muestra: muestra(campo.clave) })
    ).join("");

    return `<section class="ed-grupo" data-grupo="${esc(grupo.id)}">` +
      `<header class="ed-grupo__cabecera">` +
      `<h3 class="ed-grupo__titulo">${esc(grupo.nombre)}</h3>` +
      (grupo.responsive ? htmlToggleViewport(viewport) : "") +
      `</header>${campos}</section>`;
  }).join("");

  return `<div class="ed-panel" data-nodo="${esc(nodo.id)}" data-viewport="${esc(viewport)}">` +
    `<header class="ed-panel__cabecera"><h2 class="ed-panel__titulo">${esc(esquema.nombre)}</h2></header>` +
    grupos +
    `<footer class="ed-panel__pie"><button type="button" class="ed-boton ed-boton--peligro" data-borrar-nodo>Eliminar bloque</button></footer>` +
    `</div>`;
}

module.exports = { htmlPanel, htmlPanelVacio, htmlPanelDesconocido, htmlToggleViewport };
