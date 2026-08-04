// ============================================================
// Sube los videos de la carpeta de inspiración a Cloudinary y escribe el
// manifiesto inspiracion.json (public_id + métricas) que lee el server.
//
//   node scripts/subir-inspiracion.js
//
// Requiere CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET en .env, y la carpeta
// de videos (INSPIRACION_DIR o ./inspiracion-organica). Se puede correr las
// veces que quieras: reescribe el manifiesto con lo que haya en la carpeta.
// ============================================================

const fs = require("fs");
const path = require("path");
const { env } = require("../shopify");
const { nubeConfigurada, subir } = require("../inspiracion-nube");

const DIR = env.INSPIRACION_DIR || path.join(__dirname, "..", "inspiracion-organica");
const RE = /\.(mp4|m4v|webm|mov)$/i;
const SALIDA = path.join(__dirname, "..", "inspiracion.json");

(async () => {
  if (!nubeConfigurada()) {
    console.error("✖ Faltan CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET en .env");
    process.exit(1);
  }
  let archivos;
  try {
    archivos = fs.readdirSync(DIR).filter((f) => RE.test(f));
  } catch (e) {
    console.error("✖ No pude leer la carpeta:", DIR, "-", e.message);
    process.exit(1);
  }
  if (!archivos.length) {
    console.error("✖ No hay videos en", DIR);
    process.exit(1);
  }

  console.log(`Subiendo ${archivos.length} videos desde ${DIR} …\n`);
  const manifiesto = [];
  for (const f of archivos) {
    const nums = (f.replace(RE, "").match(/\d+/g) || []).map((n) => parseInt(n, 10));
    // public_id estable-ish: métricas + hash corto del nombre (evita choques).
    const hash = require("crypto").createHash("md5").update(f).digest("hex").slice(0, 6);
    const slug = "insp_" + nums.slice(0, 3).join("_") + "_" + hash;
    process.stdout.write(`  ${f} … `);
    try {
      const r = await subir(path.join(DIR, f), slug);
      manifiesto.push({
        public_id: r.public_id,
        vistas: nums[0] || 0,
        likes: nums[1] || 0,
        comentarios: nums[2] || 0
      });
      console.log("ok");
    } catch (e) {
      console.log("ERROR:", e.message);
    }
  }

  fs.writeFileSync(SALIDA, JSON.stringify(manifiesto, null, 2));
  console.log(`\n✔ Listo: ${manifiesto.length}/${archivos.length} subidos → ${path.relative(process.cwd(), SALIDA)}`);
  console.log("  Commiteá inspiracion.json y deployá para que se vea en producción.");
})();
