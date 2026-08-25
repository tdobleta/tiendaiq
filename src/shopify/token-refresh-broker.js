"use strict";

const crypto = require("crypto");

const MAX_CLOCK_SKEW_MS = 60_000;
const seenNonces = new Map();

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function canonicalMessage({ timestamp, nonce, rawBody }) {
  return `${timestamp}.${nonce}.${rawBody}`;
}

function signRefreshRequest(secret, input) {
  return crypto.createHmac("sha256", String(secret || ""))
    .update(canonicalMessage(input))
    .digest("base64");
}

function rememberNonce(nonce, now) {
  for (const [value, expiry] of seenNonces) if (expiry <= now) seenNonces.delete(value);
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, now + MAX_CLOCK_SKEW_MS);
  return true;
}

function verifyRefreshRequest({ secret, rawBody, timestamp, nonce, signature, now = Date.now() }) {
  const ms = Number(timestamp);
  if (!secret || String(secret).length < 32 || !Number.isFinite(ms) || Math.abs(now - ms) > MAX_CLOCK_SKEW_MS ||
      !/^[a-f0-9-]{36}$/i.test(String(nonce || ""))) return false;
  const expected = signRefreshRequest(secret, { timestamp: String(timestamp), nonce, rawBody });
  if (!safeEqual(expected, signature)) return false;
  return rememberNonce(String(nonce), now);
}

function parseRefreshRequest(rawBody) {
  let body;
  try { body = JSON.parse(String(rawBody)); } catch { return null; }
  if (!body || typeof body !== "object" ||
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(body.shop || "")) ||
      !Number.isSafeInteger(body.credentialVersion) || body.credentialVersion < 1) return null;
  return { shop: String(body.shop), credentialVersion: body.credentialVersion };
}

async function requestRefreshFromBroker({ url, secret, shop, credentialVersion, fetchImpl = globalThis.fetch, now = Date.now() }) {
  const endpoint = new URL(String(url || ""));
  if (endpoint.protocol !== "https:" || endpoint.search || endpoint.hash) {
    const error = new Error("TOKEN_REFRESH_BROKER_URL debe ser una URL HTTPS canónica");
    error.code = "SHOPIFY_REFRESH_BROKER_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  const rawBody = JSON.stringify({ shop, credentialVersion });
  const timestamp = String(now);
  const nonce = crypto.randomUUID();
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TiendaIQ-Refresh-Timestamp": timestamp,
      "X-TiendaIQ-Refresh-Nonce": nonce,
      "X-TiendaIQ-Refresh-Signature": signRefreshRequest(secret, { timestamp, nonce, rawBody })
    },
    body: rawBody,
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    const error = new Error("El broker de renovación no confirmó Shopify");
    // 401 lo emite el broker sólo cuando Shopify confirmó que la autorización
    // expiró y exige reinstalación. Un fallo de autenticación entre runtimes
    // usa 403 para no convertir una mala configuración en falso reauth.
    error.code = response.status === 401
      ? "SHOPIFY_REAUTH_REQUIRED"
      : response.status === 403
        ? "SHOPIFY_REFRESH_BROKER_UNAUTHORIZED"
        : "SHOPIFY_REFRESH_BROKER_FAILED";
    error.status = response.status === 401 ? 401 : 503;
    throw error;
  }
}

module.exports = {
  MAX_CLOCK_SKEW_MS,
  signRefreshRequest,
  verifyRefreshRequest,
  parseRefreshRequest,
  requestRefreshFromBroker
};
