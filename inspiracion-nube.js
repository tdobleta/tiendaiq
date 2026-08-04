// ============================================================
// Cloudinary para "Inspírate de los mejores".
//
// Por qué: la galería la ven los merchants en producción, así que los videos
// tienen que servirse rápido y con un thumbnail instantáneo (nunca negro).
// Cloudinary da CDN + genera el POSTER del video al vuelo (un frame como .jpg)
// y hace streaming. Sin SDK: upload firmado por REST con crypto/https nativos,
// y las URLs de entrega son solo strings.
//
// Config (env / .env): CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
// CLOUDINARY_API_SECRET. Si faltan, el server cae al modo local (carpeta).
// ============================================================

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { env } = require("./shopify");

const CLOUD = env.CLOUDINARY_CLOUD_NAME || "";
const KEY = env.CLOUDINARY_API_KEY || "";
const SECRET = env.CLOUDINARY_API_SECRET || "";

const nubeConfigurada = () => !!(CLOUD && KEY && SECRET);

// URL del video (auto formato/calidad, lo elige el CDN por dispositivo).
const urlVideo = (pid) =>
  `https://res.cloudinary.com/${CLOUD}/video/upload/f_auto,q_auto/${pid}.mp4`;

// URL del POSTER: un frame a los 0,5s recortado a 9:16 (vertical de TikTok).
// Esto es lo que hace que el thumbnail cargue al instante y jamás salga negro.
const urlPoster = (pid) =>
  `https://res.cloudinary.com/${CLOUD}/video/upload/so_0.5,c_fill,w_500,h_888,f_auto,q_auto/${pid}.jpg`;

// Firma de Cloudinary: sha1( params ordenados + api_secret ).
function firmar(params) {
  const base = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(base + SECRET).digest("hex");
}

// Sube un archivo de video (multipart/form-data firmado). Resuelve con la
// respuesta de Cloudinary ({ public_id, ... }).
function subir(archivo, publicId, folder = "inspiracion") {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const aFirmar = { folder, public_id: publicId, timestamp };
    const signature = firmar(aFirmar);
    const campos = { ...aFirmar, api_key: KEY, signature };

    const boundary = "----tiq" + crypto.randomBytes(8).toString("hex");
    const partes = [];
    for (const [k, v] of Object.entries(campos)) {
      partes.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
      );
    }
    partes.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(
          archivo
        )}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      )
    );
    partes.push(fs.readFileSync(archivo));
    partes.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const cuerpo = Buffer.concat(partes);

    const req = https.request(
      {
        method: "POST",
        hostname: "api.cloudinary.com",
        path: `/v1_1/${CLOUD}/video/upload`,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": cuerpo.length
        }
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(d);
            if (j.error) reject(new Error(j.error.message || "Cloudinary error"));
            else resolve(j);
          } catch (e) {
            reject(new Error("Respuesta inválida de Cloudinary: " + d.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(cuerpo);
    req.end();
  });
}

module.exports = { nubeConfigurada, urlVideo, urlPoster, subir };
