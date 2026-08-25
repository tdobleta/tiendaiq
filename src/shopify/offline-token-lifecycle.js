"use strict";

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const REFRESH_GRANT_TYPE = "refresh_token";

function needsRefresh(credential, { now = Date.now(), skewMs = REFRESH_SKEW_MS } = {}) {
  const expires = Date.parse(credential?.accessExpiresAt || credential?.access_expires_at || "");
  return !Number.isFinite(expires) || expires <= now + Math.max(0, Number(skewMs) || 0);
}

function credentialFromRefreshResponse(data, { now = Date.now() } = {}) {
  const accessSeconds = Number(data?.expires_in);
  const refreshSeconds = Number(data?.refresh_token_expires_in);
  if (typeof data?.access_token !== "string" || !data.access_token ||
      typeof data?.refresh_token !== "string" || !data.refresh_token ||
      !Number.isFinite(accessSeconds) || accessSeconds <= 0 ||
      !Number.isFinite(refreshSeconds) || refreshSeconds <= 0) {
    const error = new Error("Shopify no devolvió credenciales renovables válidas");
    error.code = "SHOPIFY_REFRESH_INVALID_RESPONSE";
    error.status = 502;
    error.expose = false;
    throw error;
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: new Date(now + accessSeconds * 1000).toISOString(),
    refreshExpiresAt: new Date(now + refreshSeconds * 1000).toISOString()
  };
}

function refreshFailure(status) {
  const error = new Error("No se pudo renovar la autorización de Shopify");
  error.code = status === 400 || status === 401 ? "SHOPIFY_REAUTH_REQUIRED" : "SHOPIFY_REFRESH_FAILED";
  error.status = status === 400 || status === 401 ? 401 : 502;
  error.reauthRequired = status === 400 || status === 401;
  error.expose = false;
  return error;
}

async function refreshCredentialWithShopify({ shop, refreshToken, clientId, clientSecret, fetchImpl = globalThis.fetch, timeoutMs = 15000, now = Date.now() }) {
  const params = new URLSearchParams({
    client_id: String(clientId || ""),
    client_secret: String(clientSecret || ""),
    grant_type: REFRESH_GRANT_TYPE,
    refresh_token: String(refreshToken || "")
  });
  if (!clientId || !clientSecret || !refreshToken) {
    const error = new Error("La renovación Shopify no está configurada");
    error.code = "SHOPIFY_REFRESH_NOT_CONFIGURED";
    error.status = 503;
    error.expose = false;
    throw error;
  }
  let response;
  try {
    response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(Math.max(3000, Number(timeoutMs) || 15000))
    });
  } catch (cause) {
    const error = refreshFailure(503);
    error.cause = cause;
    throw error;
  }
  let data;
  try { data = await response.json(); } catch { throw refreshFailure(response.status || 502); }
  if (!response.ok) throw refreshFailure(response.status || 502);
  return credentialFromRefreshResponse(data, { now });
}

module.exports = {
  REFRESH_SKEW_MS,
  REFRESH_GRANT_TYPE,
  needsRefresh,
  credentialFromRefreshResponse,
  refreshCredentialWithShopify
};
