"use strict";
// Monitoreo CERO-DEPENDENCIAS. Reporta errores a Sentry por HTTP (si existe
// SENTRY_DSN) y emite métricas estructuradas. Sin DSN es solo console — así no
// rompemos el harness ni sumamos supply-chain (el proyecto es deliberadamente
// lean). La telemetría NUNCA debe tumbar el server: todo va en try/catch y los
// requests fallan en silencio.
const https = require("https");
const crypto = require("crypto");

const DSN = process.env.SENTRY_DSN || "";
const ENTORNO = process.env.NODE_ENV || "production";
const RELEASE = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "";

const IDENTIFIER_KEYS = /^(tienda|shop|shop_domain|tenant|tenant_id|dominio|email)$/i;
const SECRET_KEYS = /(authorization|cookie|password|secret|token|api[_-]?key|database[_-]?url|connection[_-]?string)/i;
const CONTENT_KEYS = /^(prompt|response|respuesta|payload|body|cuerpo)$/i;

function hashIdentifier(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function redactString(value) {
  return String(value)
    .replace(/\b[a-z0-9][a-z0-9-]*\.myshopify\.com\b/gi, "[shop]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:sk-ant-|shpat_)[A-Za-z0-9_-]+\b/g, "[secret]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi, "Bearer [secret]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database-url]");
}

function sanitizeTelemetry(value, key = "", depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (SECRET_KEYS.test(key) || CONTENT_KEYS.test(key)) return "[redacted]";
  if (IDENTIFIER_KEYS.test(key)) return hashIdentifier(value);
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return redactString(value);
  if (depth >= 6) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeTelemetry(item, key, depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeTelemetry(childValue, childKey, depth + 1, seen)
    ])
  );
}

let sentry = null;
if (DSN) {
  try {
    const u = new URL(DSN);
    const proyecto = u.pathname.replace(/^\/+/, "");
    if (u.username && u.host && proyecto) {
      sentry = { host: u.host, path: `/api/${proyecto}/store/`, key: u.username };
    }
  } catch { sentry = null; }
}

function enviarSentry(payload) {
  if (!sentry) return;
  try {
    const cuerpo = JSON.stringify(payload);
    const req = https.request(
      {
        host: sentry.host,
        path: sentry.path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(cuerpo),
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${sentry.key}, sentry_client=tiendaiq/1.0`
        }
      },
      (r) => r.resume()
    );
    req.on("error", () => {}); // la telemetría nunca rompe el server
    req.setTimeout(4000, () => req.destroy());
    req.end(cuerpo);
  } catch {}
}

// Reporta una excepción. Mantiene el console.error de siempre + Sentry si hay DSN.
function reportarError(err, ctx = {}) {
  const safeContext = sanitizeTelemetry(ctx);
  const message = redactString((err && err.message) || err);
  const stack = redactString(err && err.stack ? err.stack : String(err));
  console.error("✖", safeContext.donde || safeContext.tipo || "", message, safeContext.detalle ? `· ${safeContext.detalle}` : "");
  enviarSentry({
    event_id: crypto.randomBytes(16).toString("hex"),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    logger: "tiendaiq",
    server_name: "tiendaiq",
    environment: ENTORNO,
    release: RELEASE || undefined,
    tags: safeContext.tags || {},
    extra: { ...safeContext, stack },
    exception: { values: [{ type: (err && err.name) || "Error", value: message }] }
  });
}

// Evento de producto (AARRR): instalación, activación, publicación, suscripción.
// Sale como línea JSON (fácil de pipear a un analytics) + breadcrumb en Sentry.
function metrica(nombre, props = {}) {
  const safeProps = sanitizeTelemetry(props);
  try {
    console.log(JSON.stringify({ metrica: nombre, ts: new Date().toISOString(), ...safeProps }));
  } catch {}
  enviarSentry({
    event_id: crypto.randomBytes(16).toString("hex"),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "info",
    logger: "tiendaiq.metrica",
    environment: ENTORNO,
    message: nombre,
    tags: { metrica: nombre },
    extra: safeProps
  });
}

module.exports = { reportarError, metrica, sanitizeTelemetry, sentryActivo: !!sentry };
