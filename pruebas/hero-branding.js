// Prueba LOCAL de calidad del hero de marca (no toca producción).
//
//   node pruebas/hero-branding.js <imagen-o-url> [salida.png]
//
// Necesita un proveedor de recorte configurado por env:
//   REMOVEBG_API_KEY=xxxx   (o)   REMBG_URL=http://localhost:7000/api/remove
// y `npm i sharp`. Escribe el resultado para que lo mires con el ojo.

const fs = require("fs");
const path = require("path");
const { generarHeroDeMarca, componer, quitarFondo } = require("../hero-branding");

async function bajarLocalOUrl(entrada) {
  if (/^https?:\/\//i.test(entrada)) {
    const r = await fetch(entrada);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  return fs.readFileSync(entrada);
}

async function main() {
  const entrada = process.argv[2];
  const salida = process.argv[3] || "hero-marca.png";
  if (!entrada) {
    console.error("Uso: node pruebas/hero-branding.js <imagen-o-url> [salida.png]");
    process.exit(1);
  }
  if (!process.env.REMOVEBG_API_KEY && !process.env.REMBG_URL) {
    console.error("Falta proveedor de recorte: seteá REMOVEBG_API_KEY o REMBG_URL.");
    process.exit(1);
  }

  const buf = await bajarLocalOUrl(entrada);
  console.log("Recortando fondo…");
  const recortado = await quitarFondo(buf);
  if (!recortado) {
    console.error("El proveedor no devolvió recorte.");
    process.exit(1);
  }
  console.log("Componiendo sobre backdrop de marca…");
  const png = await componer(recortado);
  fs.writeFileSync(path.resolve(salida), png);
  console.log("Listo →", path.resolve(salida));
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  });
}
