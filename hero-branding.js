// ============================================================
//  HERO DE MARCA — recorta el producto de la foto del proveedor y lo pone
//  sobre un backdrop propio (cálido, coherente con la paleta de la plantilla).
//  Objetivo: matar la sensación "asset de AliExpress" del hero.
//
//  DISEÑO SEGURO (a propósito):
//   - El recorte de fondo NO corre un modelo pesado dentro del proceso Node
//     (Render free tier = 512MB → OOM tira toda la app). Es PLUGGABLE:
//       · REMOVEBG_API_KEY  → usa la API de remove.bg (sin deps pesadas).
//       · REMBG_URL         → usa un rembg self-hosted como microservicio aparte.
//       · ninguno           → devuelve null (el caller conserva la foto original).
//   - `sharp` es optionalDependency y se requiere lazy: si no está, el módulo
//     no rompe el arranque del server; simplemente no genera hero de marca.
//   - Todo el flujo es fail-safe: cualquier error → null → foto original.
//
//  NO está cableado al pipeline vivo todavía (ver README/pendiente): primero
//  se prueba la calidad local con `node pruebas/hero-branding.js <imagen>`.
// ============================================================

// Tamaño del lienzo cuadrado del hero (coincide con aspect-ratio 1/1 del CSS).
const LIENZO = 1200;

// Backdrop cálido: crema → oro suave, coherente con --fondo-suave/--acento.
function svgBackdrop(s) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
       <defs><radialGradient id="b" cx="50%" cy="38%" r="78%">
         <stop offset="0%" stop-color="#fdf7ec"/>
         <stop offset="100%" stop-color="#f2e6cf"/>
       </radialGradient></defs>
       <rect width="${s}" height="${s}" fill="url(#b)"/>
     </svg>`
  );
}

// Sombra de contacto suave bajo el producto (le da peso, no flota).
function svgSombra(s) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
       <defs><radialGradient id="g" cx="50%" cy="50%" r="50%">
         <stop offset="0%" stop-color="#5b4a2e" stop-opacity="0.28"/>
         <stop offset="70%" stop-color="#5b4a2e" stop-opacity="0"/>
       </radialGradient></defs>
       <ellipse cx="${s / 2}" cy="${Math.round(s * 0.82)}" rx="${Math.round(s * 0.30)}" ry="${Math.round(s * 0.055)}" fill="url(#g)"/>
     </svg>`
  );
}

// Descarga una URL a Buffer (Node 20 tiene fetch global).
async function bajar(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("bajar imagen: HTTP " + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// Recorte de fondo pluggable. Devuelve un PNG con transparencia (Buffer) o
// null si no hay proveedor configurado / falla.
async function quitarFondo(buffer) {
  const key = process.env.REMOVEBG_API_KEY;
  if (key) {
    const form = new FormData();
    form.append("image_file", new Blob([buffer]), "in.png");
    form.append("size", "auto");
    const r = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": key },
      body: form
    });
    if (!r.ok) throw new Error("remove.bg: HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    return Buffer.from(await r.arrayBuffer());
  }
  const rembg = process.env.REMBG_URL; // ej. http://localhost:7000/api/remove
  if (rembg) {
    const form = new FormData();
    form.append("file", new Blob([buffer]), "in.png");
    const r = await fetch(rembg, { method: "POST", body: form });
    if (!r.ok) throw new Error("rembg: HTTP " + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  return null; // sin proveedor → no se puede recortar
}

// Compone el producto recortado sobre el backdrop, centrado y con sombra.
async function componer(pngRecortado, s = LIENZO) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    throw new Error("sharp no está instalado (optionalDependency). Corré: npm i sharp");
  }
  const pad = Math.round(s * 0.13); // aire alrededor del producto
  const caja = s - pad * 2;
  const prod = await sharp(pngRecortado)
    .resize(caja, caja, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const meta = await sharp(prod).metadata();
  const left = Math.round((s - (meta.width || caja)) / 2);
  // Leve desplazamiento hacia arriba: deja lugar a la sombra abajo.
  const top = Math.round((s - (meta.height || caja)) / 2) - Math.round(s * 0.02);

  return sharp(svgBackdrop(s))
    .composite([
      { input: svgSombra(s) },
      { input: prod, left, top: Math.max(0, top) }
    ])
    .png()
    .toBuffer();
}

// API principal: dada la URL de la foto del proveedor, devuelve el hero de
// marca como { mime, base64 } listo para subirImagenProducto(), o null si no
// se pudo (sin proveedor de recorte, error, etc.) → el caller usa la original.
async function generarHeroDeMarca(urlOriginal) {
  try {
    const original = await bajar(urlOriginal);
    const recortado = await quitarFondo(original);
    if (!recortado) return null; // sin recorte no hay valor (el backdrop quedaría tapado)
    const compuesto = await componer(recortado);
    return { mime: "image/png", base64: compuesto.toString("base64") };
  } catch (e) {
    console.warn("[hero-branding] no se generó hero de marca:", e.message);
    return null;
  }
}

module.exports = { generarHeroDeMarca, quitarFondo, componer, svgBackdrop, svgSombra };
