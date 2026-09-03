// ============================================================
// CONSTRUIR RENDER — empaqueta nucleo/ para el navegador.
//
//   node scripts/construir-render.js              construye y escribe
//   node scripts/construir-render.js --verificar  falla si el disco quedó viejo
//
// Produce DOS salidas desde UNA entrada:
//
//   app/dist/render.editor.js                       (preview del editor)
//   extensions/tiendaiq-widgets/assets/tiq-render.js (storefront del merchant)
//
// Son byte-idénticas, y eso no es casualidad: es el invariante I2 hecho
// verificable. pruebas/nucleo-render.test.js compara los dos archivos entre sí
// y contra el render de Node. Mientras ese test pase, es imposible que el
// editor y la tienda dibujen distinto.
//
// El modo --verificar existe para CI: los bundles se commitean (el de assets
// tiene que viajar a Shopify), así que hay que poder detectar el commit en el
// que alguien tocó nucleo/ y se olvidó de reconstruir.
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const RAIZ = path.join(__dirname, "..");
const ENTRADA = path.join(RAIZ, "nucleo", "entrada-navegador.js");
const CSS_FUENTE = path.join(RAIZ, "nucleo", "render.css");

const SALIDAS = [
  { js: path.join(RAIZ, "app", "dist", "render.editor.js"), css: path.join(RAIZ, "app", "dist", "render.css") },
  {
    js: path.join(RAIZ, "extensions", "tiendaiq-widgets", "assets", "tiq-render.js"),
    css: path.join(RAIZ, "extensions", "tiendaiq-widgets", "assets", "tiq-render.css")
  }
];

const AVISO = "// Generado por scripts/construir-render.js — no editar a mano.\n";

// Sin minificar a propósito: estos archivos se leen cuando algo falla en la
// tienda de un merchant, y ahí un bundle ilegible cuesta horas.
async function construir() {
  const resultado = await esbuild.build({
    entryPoints: [ENTRADA],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "TiqRender",
    platform: "browser",
    target: ["es2019"],
    legalComments: "none",
    logLevel: "silent"
  });
  return {
    js: AVISO + resultado.outputFiles[0].text,
    css: fs.readFileSync(CSS_FUENTE, "utf8")
  };
}

function leerSiExiste(ruta) {
  try {
    return fs.readFileSync(ruta, "utf8");
  } catch {
    return null;
  }
}

async function escribir() {
  const { js, css } = await construir();
  for (const salida of SALIDAS) {
    fs.mkdirSync(path.dirname(salida.js), { recursive: true });
    fs.writeFileSync(salida.js, js);
    fs.writeFileSync(salida.css, css);
  }
  return { js, css };
}

// Devuelve la lista de archivos desactualizados. Vacía = todo al día.
async function verificar() {
  const { js, css } = await construir();
  const viejos = [];
  for (const salida of SALIDAS) {
    if (leerSiExiste(salida.js) !== js) viejos.push(path.relative(RAIZ, salida.js));
    if (leerSiExiste(salida.css) !== css) viejos.push(path.relative(RAIZ, salida.css));
  }
  return viejos;
}

module.exports = { construir, escribir, verificar, SALIDAS, ENTRADA };

if (require.main === module) {
  (async () => {
    if (process.argv.includes("--verificar")) {
      const viejos = await verificar();
      if (viejos.length) {
        console.error(`\n  ✖ hay artefactos desactualizados:\n      ${viejos.join("\n      ")}\n\n  corré: node scripts/construir-render.js\n`);
        process.exit(1);
      }
      console.log("  ✓ los bundles del render están al día");
      return;
    }
    const { js } = await escribir();
    const kb = (Buffer.byteLength(js) / 1024).toFixed(1);
    console.log(`  ✓ render empaquetado (${kb} KB) en:`);
    for (const salida of SALIDAS) console.log(`      ${path.relative(RAIZ, salida.js)}`);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
