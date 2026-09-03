// ============================================================
// ENTRADA DEL NAVEGADOR — lo que se empaqueta para el editor y la tienda.
//
// A propósito NO incluye nucleo/documento.js: ese módulo arrastra ajv y
// node:crypto, que en el storefront de un merchant serían ~120 KB de código
// que nadie ejecuta. Validar es trabajo del backend, en el borde; el navegador
// solo dibuja.
//
// Si alguna vez hay que agregar un require acá, primero preguntarse si eso
// tiene que viajar a la tienda de todos los merchants.
// ============================================================

"use strict";

const { render, renderNodo, PUNTO_QUIEBRE } = require("./render");
const registro = require("./registro");
const resolver = require("./resolver");
const tokens = require("./tokens");

module.exports = {
  render,
  renderNodo,
  PUNTO_QUIEBRE,

  // Lo que necesita el editor para armar la UI sin conocer ningún tipo.
  catalogo: registro.catalogo,
  esquemaPanel: registro.esquemaPanel,
  tipos: registro.tipos,
  definicion: registro.definicion,

  // Para el micro-toggle heredado/override del panel.
  hayOverride: resolver.hayOverride,

  // Para el panel de branding.
  presets: tokens.listaPresets,
  variablesCss: tokens.variablesCss,
  CLAVES_TOKEN: tokens.CLAVES_TOKEN,
  NOMBRES_TOKEN: tokens.NOMBRES_TOKEN
};
