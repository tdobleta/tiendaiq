"use strict";

const crypto = require("crypto");
const { normalizeShopDomain } = require("../tenancy/tenant-context");

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function uuidFromHash(hash) {
  const h = String(hash).padEnd(32, "0").slice(0, 32).split("");
  h[12] = "4";
  h[16] = "8";
  return `${h.slice(0, 8).join("")}-${h.slice(8, 12).join("")}-${h.slice(12, 16).join("")}-${h.slice(16, 20).join("")}-${h.slice(20).join("")}`;
}

function sanitizePayload(topic, payload) {
  const shopId = payload?.shop_id == null ? null : String(payload.shop_id);
  if (topic === "app_subscriptions/update") {
    return {
      app_subscription: {
        status: payload?.app_subscription?.status || null,
        id: payload?.app_subscription?.admin_graphql_api_id || payload?.app_subscription?.id || null
      }
    };
  }
  if (topic === "customers/data_request" || topic === "customers/redact") {
    const customerId = payload?.customer?.id ?? payload?.customer_id ?? null;
    return { shop_id: shopId, customer_ref: customerId == null ? null : sha256(String(customerId)) };
  }
  if (topic === "app/uninstalled" || topic === "shop/redact") {
    return { shop_id: shopId };
  }
  return { ignored: true };
}

function verifyAndNormalizeWebhook(rawBody, headers, secret) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError("El webhook debe verificarse sobre bytes crudos");
  if (!secret) throw new Error("Falta SHOPIFY_CLIENT_SECRET para verificar webhooks");
  const signature = headers["x-shopify-hmac-sha256"] || "";
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  if (!safeEqual(expected, signature)) {
    const error = new Error("Firma de webhook inválida");
    error.status = 401;
    throw error;
  }

  const topic = String(headers["x-shopify-topic"] || "").trim().toLowerCase();
  const shopDomain = normalizeShopDomain(headers["x-shopify-shop-domain"] || "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain) || !topic) {
    const error = new Error("Cabeceras de webhook inválidas");
    error.status = 400;
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    const error = new Error("Payload de webhook inválido");
    error.status = 400;
    throw error;
  }
  const payloadHash = sha256(rawBody);
  const suppliedId = String(headers["x-shopify-webhook-id"] || "").trim();
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId)
    ? suppliedId.toLowerCase()
    : uuidFromHash(sha256(`${shopDomain}\0${topic}\0${payloadHash}`));

  return {
    id,
    shopDomain,
    topic,
    payloadHash,
    payload: sanitizePayload(topic, payload),
    apiVersion: String(headers["x-shopify-api-version"] || "") || null
  };
}

module.exports = { verifyAndNormalizeWebhook, sanitizePayload, safeEqual, sha256, uuidFromHash };
