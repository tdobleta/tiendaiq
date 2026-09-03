// ============================================================
// MIGRACIONES — cómo se lleva un documento viejo a la versión actual.
//
// Cada entrada es { desde, hasta, migrar(doc) -> doc }. nucleo/documento.js las
// aplica en cadena AL LEER, nunca al escribir.
//
// La regla: cuando un cambio de esquema puede romper documentos ya guardados,
// se sube VERSION en documento.js y se agrega acá el paso correspondiente, en
// el mismo PR. Nunca en dos. Un esquema nuevo sin su migración es una página
// publicada que deja de abrir en la tienda de alguien.
//
// v0 -> v1 convierte los documentos con `facetas` de la plantilla fija vieja
// en un árbol de nodos. Se mantiene acá (y no en documento.js) para que cada
// salto de versión sea una pieza aislada, testeable y reversible.
// ============================================================

"use strict";

module.exports = [require("./v0_a_v1")];
