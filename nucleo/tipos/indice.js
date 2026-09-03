// ============================================================
// ÍNDICE DE TIPOS — la lista explícita de todo lo que existe.
//
// Es a propósito un require por tipo y no un fs.readdirSync: este archivo se
// empaqueta con esbuild para el navegador (editor y storefront), y un bundler
// no puede seguir una lectura de disco en tiempo de ejecución. El precio es
// una línea por tipo; la ganancia es que el MISMO código corre en Node y en la
// tienda del merchant, que es el invariante I2.
//
// Agregar una sección = crear el archivo + agregar su línea acá. Nada más.
// En particular: ni una línea de app/editor/.
// ============================================================

"use strict";

module.exports = [
  require("./seccion"),
  require("./texto"),
  require("./imagen"),
  require("./imagen-texto"),
  require("./tabla-comparacion"),
  require("./estadisticas"),
  require("./garantia"),
  ...require("./piloto")
];
