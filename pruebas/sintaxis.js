// ============================================================
// SINTAXIS — `node --check` sobre todos los .js del proyecto.
//
//   node pruebas/sintaxis.js
//
// Es el piso de todo: un paréntesis sin cerrar en cualquier módulo hace que
// el server no arranque, y como `main` deploya solo, eso llega a las tiendas
// de los merchants. Tarda menos de un segundo.
// ============================================================

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");

// Nada de esto es código nuestro que deba compilar: dependencias, datos, y
// los themes de nicho (que son copias de themes de Shopify, no fuente).
const CARPETAS_FUERA = new Set([
  "node_modules",
  ".git",
  ".github",
  "nichos",
  "estados",
  "tiendas",
  "paginas"
]);
const esThemeDeNicho = (nombre) => nombre.startsWith("theme-nicho-");

function archivosJs(dir) {
  const encontrados = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (CARPETAS_FUERA.has(entrada.name) || esThemeDeNicho(entrada.name)) continue;
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...archivosJs(ruta));
    else if (entrada.name.endsWith(".js")) encontrados.push(ruta);
  }
  return encontrados;
}

const archivos = archivosJs(RAIZ);
const rotos = [];

for (const archivo of archivos) {
  try {
    execFileSync(process.execPath, ["--check", archivo], { stdio: "pipe" });
  } catch (e) {
    rotos.push({ archivo: path.relative(RAIZ, archivo), detalle: String(e.stderr || e.message).trim() });
  }
}

if (rotos.length) {
  console.error(`\n  ✖ ${rotos.length} archivo(s) con errores de sintaxis:\n`);
  for (const r of rotos) console.error(`  ${r.archivo}\n${r.detalle}\n`);
  process.exitCode = 1;
} else {
  console.log(`  ✓ ${archivos.length} archivos .js sin errores de sintaxis`);
}
