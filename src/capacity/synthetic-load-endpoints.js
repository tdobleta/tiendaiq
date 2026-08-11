"use strict";

const crypto = require("crypto");

const SESSION_PATH = "/__load/session";
const JOB_PATH = "/__load/jobs";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

const MAX_WINDOW_MS = 2 * 60 * 60 * 1000;

function createSyntheticLoadHandler({ enabled, environment, token, expiresAt, readJson, now = Date.now }) {
  const requested = String(enabled || "") === "1";
  if (requested && environment !== "staging") {
    throw new Error("Los endpoints sinteticos solo pueden habilitarse con SYNTHETIC_LOAD_ENVIRONMENT=staging");
  }
  if (requested && String(token || "").length < 32) {
    throw new Error("SYNTHETIC_LOAD_TOKEN debe tener al menos 32 caracteres");
  }
  const expiresAtMs = Date.parse(String(expiresAt || ""));
  const currentTimeMs = now();
  if (requested && (!Number.isFinite(expiresAtMs) || expiresAtMs - currentTimeMs > MAX_WINDOW_MS)) {
    throw new Error("SYNTHETIC_LOAD_EXPIRES_AT debe ser una fecha valida dentro de las proximas 2 horas");
  }
  if (requested && typeof readJson !== "function") {
    throw new TypeError("readJson es obligatorio para habilitar carga sintetica");
  }

  const active = requested && environment === "staging";
  const expectedAuthorization = `Bearer ${token}`;

  return async function handleSyntheticLoad(req, res, url) {
    if (!active || ![SESSION_PATH, JOB_PATH].includes(url.pathname)) return false;
    if (now() >= expiresAtMs) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }

    if (!safeEqual(req.headers.authorization, expectedAuthorization)) {
      sendJson(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
      return true;
    }
    if (req.headers["x-tiendaiq-load-test"] !== "synthetic") {
      sendJson(res, 403, { error: "missing_load_test_marker" });
      return true;
    }

    const runId = String(req.headers["x-load-test-run-id"] || "").slice(0, 100);
    const sessionId = String(req.headers["x-load-test-session-id"] || "").slice(0, 100);
    if (!runId || !sessionId) {
      sendJson(res, 422, { error: "missing_load_test_identity" });
      return true;
    }

    if (url.pathname === SESSION_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
        return true;
      }
      sendJson(res, 200, { ok: true, synthetic: true, run_id: runId });
      return true;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      return true;
    }
    const payload = await readJson(req, 16_384);
    const idempotencyKey = String(req.headers["idempotency-key"] || "");
    if (
      payload?.type !== "synthetic-load-job" ||
      payload?.simulated !== true ||
      !payload?.request_id ||
      !idempotencyKey.startsWith("load:")
    ) {
      sendJson(res, 422, { error: "invalid_synthetic_job" });
      return true;
    }

    sendJson(res, 202, {
      accepted: true,
      synthetic: true,
      run_id: runId,
      request_id: String(payload.request_id).slice(0, 100)
    });
    return true;
  };
}

module.exports = { createSyntheticLoadHandler, SESSION_PATH, JOB_PATH, MAX_WINDOW_MS, safeEqual };
