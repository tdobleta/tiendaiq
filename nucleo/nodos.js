// ============================================================
// NODOS — crear nodos e ids. Sin dependencias pesadas.
//
// Existe separado de documento.js por una razón concreta de peso: documento.js
// arrastra ajv (~300 KB sin minificar) porque es el que valida. El editor
// necesita crear nodos, pero NO necesita validar en el navegador: el validador
// vive en el borde del backend, que es la única autoridad y por donde pasa
// igual todo lo que se guarda.
//
// Meter el validador en el bundle del admin duplicaría la autoridad (dos copias
// que pueden desincronizarse) y triplicaría el peso a cambio de nada.
// ============================================================

"use strict";

const registro = require("./registro");

// Web Crypto y no node:crypto: este módulo se empaqueta para el navegador.
// globalThis.crypto existe en Node 18+ y en todo navegador que corra el admin.
function hexAleatorio(bytes) {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}

const nuevoId = () => "n_" + hexAleatorio(4);

// Un nodo nuevo NO lleva los defaults escritos en props: props guarda solo
// overrides (invariante I4). Lo único que se escribe es la semilla de contenido
// que declara el tipo, para que el bloque recién insertado se vea.
function crearNodo(tipo) {
  const definicion = registro.definicion(tipo);
  const nodo = { id: nuevoId(), tipo, props: { ...(definicion.semilla || {}) } };
  if (definicion.admite_hijos) nodo.hijos = [];
  return nodo;
}

module.exports = { hexAleatorio, nuevoId, crearNodo };
