// ============================================================
// Cifrado en reposo de los tokens de acceso de tienda (AES-256-GCM).
//
// El token (`shpat_…`) da control total de la Admin API de esa tienda. Guardarlo
// en claro en Postgres = un dump de la base expone todas las tiendas. Acá se
// cifra antes de persistir y se descifra al leer.
//
// Formato autodescriptivo: "enc:v1:<iv_b64>:<tag_b64>:<ct_b64>". El prefijo
// permite:
//   - distinguir cifrado de claro → `descifrarToken` tolera tokens en claro
//     (páginas viejas / transición sin downtime),
//   - versionar el esquema a futuro (v2…).
//
// Clave: env TOKEN_ENC_KEY = 32 bytes en base64. SIN la clave, el módulo pasa
// el token tal cual (modo claro, con aviso una vez) para no romper nada; el
// cifrado se ACTIVA recién cuando se carga la env. GCM da confidencialidad +
// integridad (detecta manipulación del ciphertext).
// ============================================================

const crypto = require("crypto");
const { env } = require("./shopify");

const PREFIJO = "enc:v1:";

let CLAVE = null;
let avisado = false;
(function cargarClave() {
  const b64 = (env.TOKEN_ENC_KEY || "").trim();
  if (!b64) return; // sin clave → modo claro (passthrough)
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENC_KEY inválida: deben ser 32 bytes en base64 (generá con `openssl rand -base64 32`).");
  }
  CLAVE = buf;
})();

const cifrado = () => CLAVE !== null;

function avisarUnaVez() {
  if (!avisado) {
    avisado = true;
    console.warn("⚠ TOKEN_ENC_KEY no seteada: los tokens de tienda se guardan SIN cifrar. Cargá la env para activar el cifrado en reposo.");
  }
}

// Cifra un token en claro. Sin clave → lo devuelve tal cual (passthrough).
function cifrarToken(plano) {
  if (plano == null) return plano;
  if (typeof plano === "string" && plano.startsWith(PREFIJO)) return plano; // ya cifrado
  if (!cifrado()) { avisarUnaVez(); return plano; }
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", CLAVE, iv);
  const ct = Buffer.concat([c.update(String(plano), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFIJO + iv.toString("base64") + ":" + tag.toString("base64") + ":" + ct.toString("base64");
}

// Descifra. Si el valor NO tiene el prefijo, es un token en claro (legacy) → se
// devuelve tal cual. Si tiene prefijo pero no hay clave, es un error de config.
function descifrarToken(valor) {
  if (valor == null || typeof valor !== "string" || !valor.startsWith(PREFIJO)) return valor;
  if (!cifrado()) {
    throw new Error("Hay tokens cifrados en la base pero falta TOKEN_ENC_KEY para descifrarlos.");
  }
  const [, , ivB64, tagB64, ctB64] = valor.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", CLAVE, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

// ¿Está en claro? (para el script de migración: cifra solo lo que falta).
const estaCifrado = (valor) => typeof valor === "string" && valor.startsWith(PREFIJO);

module.exports = { cifrarToken, descifrarToken, estaCifrado, cifradoActivo: cifrado };
