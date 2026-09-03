// ============================================================
// CONSTRUIR EDITOR — empaqueta app/editor/ para el admin.
//
//   node scripts/construir-editor.js              construye y escribe
//   node scripts/construir-editor.js --verificar  falla si el disco quedó viejo
//
// Salida: app/dist/editor.js + app/dist/editor.css
//
// Es un bundle SEPARADO del de la tienda a propósito. El editor arrastra el
// árbol, el panel, la librería y los 16 controles: nada de eso tiene por qué
// viajar al storefront de un merchant en cada visita. El del storefront lo hace
// scripts/construir-render.js y pesa 39 KB.
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const RAIZ = path.join(__dirname, "..");
const ENTRADA = path.join(RAIZ, "app", "editor", "editor.js");
const CSS_FUENTE = path.join(RAIZ, "app", "editor", "editor.css");
const SALIDA_JS = path.join(RAIZ, "app", "dist", "editor.js");
const SALIDA_CSS = path.join(RAIZ, "app", "dist", "editor.css");

const AVISO = "// Generado por scripts/construir-editor.js — no editar a mano.\n";

async function construir() {
  const resultado = await esbuild.build({
    entryPoints: [ENTRADA],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "TiqEditor",
    platform: "browser",
    target: ["es2019"],
    legalComments: "none",
    logLevel: "silent"
  });
  return { js: AVISO + resultado.outputFiles[0].text, css: fs.readFileSync(CSS_FUENTE, "utf8") };
}

const leerSiExiste = (ruta) => { try { return fs.readFileSync(ruta, "utf8"); } catch { return null; } };

async function escribir() {
  const { js, css } = await construir();
  fs.mkdirSync(path.dirname(SALIDA_JS), { recursive: true });
  fs.writeFileSync(SALIDA_JS, js);
  fs.writeFileSync(SALIDA_CSS, css);
  return { js, css };
}

async function verificar() {
  const { js, css } = await construir();
  const viejos = [];
  if (leerSiExiste(SALIDA_JS) !== js) viejos.push(path.relative(RAIZ, SALIDA_JS));
  if (leerSiExiste(SALIDA_CSS) !== css) viejos.push(path.relative(RAIZ, SALIDA_CSS));
  return viejos;
}

module.exports = { construir, escribir, verificar, SALIDA_JS, SALIDA_CSS, ENTRADA };

if (require.main === module) {
  (async () => {
    if (process.argv.includes("--verificar")) {
      const viejos = await verificar();
      if (viejos.length) {
        console.error(`\n  ✖ artefactos del editor desactualizados:\n      ${viejos.join("\n      ")}\n\n  corré: node scripts/construir-editor.js\n`);
        process.exit(1);
      }
      console.log("  ✓ el bundle del editor está al día");
      return;
    }
    const { js } = await escribir();
    console.log(`  ✓ editor empaquetado (${(Buffer.byteLength(js) / 1024).toFixed(1)} KB) en app/dist/editor.js`);
  })().catch((error) => { console.error(error); process.exit(1); });
}
