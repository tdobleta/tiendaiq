"use strict";

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SOURCES = new Set(["session-token", "webhook", "internal-job", "development"]);

function normalizeShopDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

class TenantContext {
  constructor({ tenantId, shopDomain, source, actorId = null, requestId = null }) {
    const normalizedShop = normalizeShopDomain(shopDomain);
    const normalizedId = String(tenantId || "").trim();
    if (!normalizedId) throw new TypeError("TenantContext requiere tenantId");
    if (!SHOP_DOMAIN.test(normalizedShop)) throw new TypeError("TenantContext requiere un shopDomain valido");
    if (!SOURCES.has(source)) throw new TypeError("TenantContext requiere una fuente confiable");

    this.tenantId = normalizedId;
    this.shopDomain = normalizedShop;
    this.source = source;
    this.actorId = actorId == null ? null : String(actorId);
    this.requestId = requestId == null ? null : String(requestId);
    Object.freeze(this);
  }

  static fromShopDomain(shopDomain, options = {}) {
    const normalized = normalizeShopDomain(shopDomain);
    return new TenantContext({
      tenantId: options.tenantId || normalized,
      shopDomain: normalized,
      source: options.source || "session-token",
      actorId: options.actorId,
      requestId: options.requestId
    });
  }
}

function requireTenantContext(value) {
  if (!(value instanceof TenantContext)) {
    throw new TypeError("La operacion requiere un TenantContext validado");
  }
  return value;
}

function assertTenant(context, tenantId) {
  const ctx = requireTenantContext(context);
  if (ctx.tenantId !== String(tenantId || "")) {
    throw new Error("Intento de acceso cruzado entre tenants");
  }
  return ctx;
}

module.exports = { TenantContext, normalizeShopDomain, requireTenantContext, assertTenant };
