// ============================================================
// MARCA — editor del branding del documento.
//
// Es una superficie de documento, no un tipo de nodo: por eso vive fuera del
// panel schema-driven. Los bloques siguen declarando sus campos en el registro;
// esta ventana solo modifica preset, tokens, radios y tipografías globales.
// ============================================================

"use strict";

const {
  CLAVES_TOKEN, NOMBRES_TOKEN, PRESETS, RADIOS, TIPOGRAFIAS,
  tokensDe, listaPresets
} = require("../../nucleo/tokens");

const esc = (valor) => String(valor === null || valor === undefined ? "" : valor)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const HEX = /^#[0-9a-f]{6}$/i;

function color(valor, alternativo = "#ffffff") {
  return HEX.test(valor || "") ? valor : alternativo;
}

function htmlMarca(branding = {}) {
  const resueltos = tokensDe(branding);
  const propios = branding.tokens || {};
  const presets = listaPresets();
  const presetActual = PRESETS[branding.preset] ? branding.preset : "verde";
  const radioActual = RADIOS[branding.radio] ? branding.radio : "pequeno";
  const tipografias = branding.tipografia || {};

  const tarjetas = presets.map((preset) =>
    `<button type="button" class="ed-marca__preset${preset.id === presetActual ? " es-activo" : ""}" ` +
    `data-branding-preset="${esc(preset.id)}" aria-pressed="${preset.id === presetActual}">` +
      `<span class="ed-marca__muestras">${preset.muestra.map((muestra) =>
        `<i style="background:${esc(muestra)}"></i>`).join("")}</span>` +
      `<span>${esc(preset.nombre)}</span>` +
    `</button>`
  ).join("");

  const tokens = CLAVES_TOKEN.map((clave) => {
    const propio = HEX.test(propios[clave] || "");
    const valor = propio ? propios[clave] : resueltos[clave];
    return `<label class="ed-marca__token">` +
      `<span class="ed-marca__token-cabecera">` +
        `<button type="button" class="ed-marca__heredar${propio ? " es-propio" : ""}" ` +
          `data-branding-heredar="${esc(clave)}" aria-pressed="${propio}" ` +
          `title="${propio ? "Volver al color del preset" : "Color heredado del preset"}"></button>` +
        `<span>${esc(NOMBRES_TOKEN[clave] || clave)}</span>` +
      `</span>` +
      `<span class="ed-marca__color"><i style="background:${esc(valor)}"></i>` +
        `<input type="color" value="${esc(color(valor))}" data-branding-token="${esc(clave)}" ` +
          `aria-label="${esc(NOMBRES_TOKEN[clave] || clave)}"></span>` +
    `</label>`;
  }).join("");

  const opcionesFuente = (clave, seleccionada, titulo) =>
    `<label class="ed-marca__select"><span>${titulo}</span><select data-branding-fuente="${esc(clave)}">` +
      Object.keys(TIPOGRAFIAS).map((id) => `<option value="${esc(id)}"${id === seleccionada ? " selected" : ""}>${esc(id[0].toUpperCase() + id.slice(1))}</option>`).join("") +
    `</select></label>`;

  return `<div class="ed-marca" role="dialog" aria-modal="true" aria-label="Marca">` +
    `<header class="ed-marca__cabecera"><div><h2>Marca</h2><p>La plantilla usa estos tokens en toda la página.</p></div>` +
      `<button type="button" class="ed-lib__cerrar" data-cerrar aria-label="Cerrar">×</button></header>` +
    `<section class="ed-marca__seccion"><h3>Preset</h3><div class="ed-marca__presets">${tarjetas}</div></section>` +
    `<section class="ed-marca__seccion"><h3>Colores</h3><div class="ed-marca__tokens">${tokens}</div></section>` +
    `<section class="ed-marca__seccion ed-marca__fila"><label class="ed-marca__select"><span>Esquinas</span><select data-branding-radio>` +
      Object.keys(RADIOS).map((id) => `<option value="${esc(id)}"${id === radioActual ? " selected" : ""}>${esc(id === "ninguno" ? "Rectas" : id === "pequeno" ? "Chicas" : "Grandes")}</option>`).join("") +
    `</select></label>${opcionesFuente("titulos", tipografias.titulos || "grotesca", "Fuente de títulos")}${opcionesFuente("cuerpo", tipografias.cuerpo || "sistema", "Fuente de cuerpo")}</section>` +
  `</div>`;
}

module.exports = { htmlMarca };
