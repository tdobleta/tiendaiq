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
  const stack = err && err.stack ? err.stack : String(err);
  console.error("✖", ctx.donde || ctx.tipo || "", (err && err.message) || err);
  enviarSentry({
    event_id: crypto.randomBytes(16).toString("hex"),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    logger: "tiendaiq",
    server_name: "tiendaiq",
    environment: ENTORNO,
    release: RELEASE || undefined,
    tags: ctx.tags || {},
    extra: { ...ctx, stack },
    exception: { values: [{ type: (err && err.name) || "Error", value: String((err && err.message) || err) }] }
  });
}

// Evento de producto (AARRR): instalación, activación, publicación, suscripción.
// Sale como línea JSON (fácil de pipear a un analytics) + breadcrumb en Sentry.
function metrica(nombre, props = {}) {
  try {
    console.log(JSON.stringify({ metrica: nombre, ts: new Date().toISOString(), ...props }));
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
    extra: props
  });
}

module.exports = { reportarError, metrica, sentryActivo: !!sentry };
