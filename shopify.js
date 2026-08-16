// ============================================================
// Cliente de la Admin API de Shopify (GraphQL).
//
// TODA llamada a Shopify pasa por acá, y TODA necesita una sesión:
//
//   sesion = { tienda: "xxx.myshopify.com", token: "shpat_..." }
//
// La sesión sale de tiendas.js (el merchant que instaló la app) o, para el
// CLI, de sesionDeEnv(). No hay fallback silencioso al .env: si una llamada
// no trae sesión, revienta. Es a propósito — en una app multi-tienda, un
// fallback silencioso significa tocarle la tienda equivocada a alguien.
// ============================================================

const fs = require("fs");
const path = require("path");

const API = "2026-07";

// En local las claves viven en .env; en Render (y cualquier host) viven en
// process.env. Se leen las dos, y GANA process.env: el .env solo rellena lo
// que falta.
//
// Antes era al revés y mordía: `DEV_MODE=0 node server.js` no apagaba nada
// porque el .env volvía a ponerlo en 1, y no había forma de levantar el
// server en modo producción para probarlo. Precedencia al revés = una
// variable que ponés a mano y el proceso ignora en silencio.
function leerEnv() {
  const env = { ...process.env };
  const ruta = path.join(__dirname, ".env");
  if (fs.existsSync(ruta)) {
    for (const linea of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
      const m = linea.match(/^([A-Z_]+)=(.*)$/);
      // Solo si el entorno real no la trae ya (cadena vacía incluida: poner
      // DEV_MODE="" es una forma legítima de decir "apagado").
      if (m && process.env[m[1]] === undefined) env[m[1]] = m[2].trim();
    }
  }
  // Espacios y saltos de línea colados al pegar en el panel del host rompen
  // OAuth y firmas de forma silenciosa. Se recortan todos.
  for (const k of Object.keys(env)) {
    if (typeof env[k] === "string") env[k] = env[k].trim();
  }
  return env;
}

const env = leerEnv();
const SHOPIFY_TIMEOUT_MS = Math.max(1000, Number(env.SHOPIFY_TIMEOUT_MS) || 30000);

function isPermanentHttpStatus(status) {
  return [400, 401, 402, 403, 404, 405, 406, 410, 411, 413, 414, 415, 422].includes(Number(status));
}

function retryAfterSeconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function rethrowAbort(error, signal) {
  if (signal?.aborted) throw signal.reason || error;
  if (error?.name === "AbortError" || error?.name === "TimeoutError") {
    const timeout = new Error(`Shopify no respondio dentro de ${SHOPIFY_TIMEOUT_MS} ms`);
    timeout.code = "SHOPIFY_TIMEOUT";
    throw timeout;
  }
  throw error;
}

// Sesión de la tienda del .env — solo para el CLI y las pruebas locales.
// El server nunca usa esto: resuelve la sesión del merchant que pregunta.
function sesionDeEnv() {
  const tienda = (env.SHOPIFY_STORE || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!tienda || !env.SHOPIFY_TOKEN) {
    throw new Error("El .env no tiene SHOPIFY_STORE / SHOPIFY_TOKEN (solo hace falta para el CLI).");
  }
  return { tienda, token: env.SHOPIFY_TOKEN };
}

async function gql(query, variables = {}, sesion, { signal } = {}) {
  if (!sesion?.tienda || !sesion?.token) {
    throw new Error("gql() necesita una sesión { tienda, token }. Sin sesión no se llama a Shopify.");
  }

  let r;
  try {
    r = await fetch(`https://${sesion.tienda}/admin/api/${API}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": sesion.token
      },
      body: JSON.stringify({ query, variables }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(SHOPIFY_TIMEOUT_MS)])
        : AbortSignal.timeout(SHOPIFY_TIMEOUT_MS)
    });
  } catch (error) {
    rethrowAbort(error, signal);
  }

  // 401 = el merchant desinstaló la app o rotó el token. Se distingue del
  // resto para que el server pueda borrar la tienda y pedir reinstalación.
  if (r.status === 401) {
    const e = new Error(`El token de ${sesion.tienda} ya no sirve (¿desinstalaron la app?)`);
    e.code = "TOKEN_INVALIDO";
    e.status = 401;
    e.nonRetryable = true;
    throw e;
  }

  // El cuerpo crudo de Shopify puede traer detalle sensible/ruidoso: se guarda
  // en e.detalle (para nuestros logs) pero NO en el mensaje que sube al cliente.
  if (!r.ok) {
    const e = new Error(`Shopify respondió ${r.status}`);
    e.status = r.status;
    e.nonRetryable = isPermanentHttpStatus(r.status);
    e.retryAfter = retryAfterSeconds(r.headers?.get?.("retry-after"));
    try {
      e.detalle = (await r.text()).slice(0, 500);
    } catch (error) {
      rethrowAbort(error, signal);
    }
    throw e;
  }

  let json;
  try {
    json = await r.json();
  } catch (error) {
    rethrowAbort(error, signal);
  }
  if (json.errors) {
    const e = new Error("Shopify devolvió errores de GraphQL");
    e.detalle = JSON.stringify(json.errors).slice(0, 500);
    throw e;
  }
  return json.data;
}

module.exports = {
  gql,
  env,
  API,
  SHOPIFY_TIMEOUT_MS,
  isPermanentHttpStatus,
  retryAfterSeconds,
  sesionDeEnv
};
