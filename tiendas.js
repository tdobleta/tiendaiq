// ============================================================
// TIENDAS — el registro de merchants instalados.
//
// La persistencia vive en db.js (Postgres en producción, archivos en local).
// Acá queda solo la lógica: normalizar dominios, validar, armar la sesión.
// Todo lo que toca la base es async.
// ============================================================

const { guardarTiendaDB, leerTiendaDB, borrarTiendaDB, listarTiendasDB,
        incrementarUsoDB, decrementarUsoDB, actualizarCamposTiendaDB,
        guardarCredencialShopifyDB, leerCredencialShopifyDB,
        adquirirLeaseRefreshShopifyDB, completarRefreshShopifyDB, fallarRefreshShopifyDB } = require("./db");
const { TenantContext } = require("./src/tenancy/tenant-context");
const { env } = require("./shopify");
const { needsRefresh, refreshCredentialWithShopify } = require("./src/shopify/offline-token-lifecycle");
const { requestRefreshFromBroker } = require("./src/shopify/token-refresh-broker");

// Shopify manda el dominio de mil formas: con https://, con barra, en el claim
// `dest` del pase. Se normaliza siempre a "xxx.myshopify.com".
function normalizar(dominio) {
  return String(dominio || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function esDominioValido(dominio) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalizar(dominio));
}

async function guardarTienda(dominio, token, extra = {}) {
  const d = normalizar(dominio);
  if (!esDominioValido(d)) throw new Error(`Dominio inválido: ${dominio}`);

  const previo = (await leerTiendaDB(d)) || {};
  const registro = {
    dominio: d,
    token,
    instalada: previo.instalada || new Date().toISOString(),
    actualizada: new Date().toISOString(),
    ...extra
  };
  await guardarTiendaDB(d, registro);
  return registro;
}

async function guardarInstalacionExpiring(dominio, credential, extra = {}) {
  const d = normalizar(dominio);
  if (!esDominioValido(d)) throw new Error(`Dominio inválido: ${dominio}`);
  // El registro de instalación conserva sólo metadata no secreta. Nunca se
  // duplica un refresh token en JSONB de public.tiendas.
  await guardarTienda(d, null, extra);
  await guardarCredencialShopifyDB(d, credential);
}

async function leerTienda(dominio) {
  return leerTiendaDB(normalizar(dominio));
}

async function borrarTienda(dominio) {
  return borrarTiendaDB(normalizar(dominio));
}

async function listarTiendas() {
  return listarTiendasDB();
}

// Reserva ATÓMICA de una página del cupo del mes. Devuelve el nuevo total, o
// null si no queda cupo (sin pisarse entre requests concurrentes). limite null
// = sin tope (pro).
async function consumirCupoTienda(dominio, mes, limite) {
  return incrementarUsoDB(normalizar(dominio), mes, limite);
}
// Devuelve una página al cupo (si la generación falló tras reservar).
async function revertirCupoTienda(dominio, mes) {
  return decrementarUsoDB(normalizar(dominio), mes);
}
// Actualiza SOLO ciertos campos (plan, plan_verificado…) sin reescribir todo el
// registro → no pisa uso ni token (fin de los lost updates).
async function actualizarCamposTienda(dominio, campos) {
  return actualizarCamposTiendaDB(normalizar(dominio), campos);
}

function errorReautorizacion(tienda) {
  const e = new Error(`La autorización de ${tienda} necesita renovarse`);
  e.code = "SHOPIFY_REAUTH_REQUIRED";
  e.status = 401;
  e.tienda = tienda;
  return e;
}

async function refrescarEnWeb(context, credential) {
  const lease = await adquirirLeaseRefreshShopifyDB(context, credential.credentialVersion);
  if (!lease) {
    const current = await leerCredencialShopifyDB(context);
    if (current && !needsRefresh(current)) return current;
    const e = new Error("La renovación Shopify ya está en curso");
    e.code = "SHOPIFY_REFRESH_IN_PROGRESS";
    e.status = 503;
    e.retryAfter = 2;
    throw e;
  }
  try {
    const renewed = await refreshCredentialWithShopify({
      shop: context.tenantId,
      refreshToken: lease.refreshToken,
      clientId: env.SHOPIFY_CLIENT_ID,
      clientSecret: env.SHOPIFY_CLIENT_SECRET,
      timeoutMs: env.SHOPIFY_OAUTH_TIMEOUT_MS
    });
    const completed = await completarRefreshShopifyDB(context, lease, renewed);
    if (!completed) {
      const e = new Error("La renovación Shopify perdió su lease");
      e.code = "SHOPIFY_REFRESH_CONFLICT";
      e.status = 503;
      throw e;
    }
    return leerCredencialShopifyDB(context);
  } catch (error) {
    await fallarRefreshShopifyDB(context, lease, {
      code: error.code || "shopify_refresh_failed",
      reauthRequired: error.code === "SHOPIFY_REAUTH_REQUIRED"
    });
    if (error.code === "SHOPIFY_REAUTH_REQUIRED") throw errorReautorizacion(context.tenantId);
    throw error;
  }
}

// La sesión es lo que viaja por toda la app: quién es y con qué token.
// Nada llama a Shopify sin una de estas.
async function sesionDe(dominio, { forceRefresh = false } = {}) {
  const context = dominio instanceof TenantContext ? dominio : null;
  const tienda = context ? context.tenantId : normalizar(dominio);
  const t = await leerTiendaDB(context || tienda);
  if (!t) {
    const e = new Error(`La tienda ${tienda} no tiene la app instalada`);
    e.code = "TIENDA_NO_INSTALADA";
    e.status = 401;
    e.tienda = tienda;
    throw e;
  }
  const credential = await leerCredencialShopifyDB(context || tienda);
  if (credential) {
    if (credential.refreshState === "reauth_required") {
      throw errorReautorizacion(tienda);
    }
    let active = credential;
    if (forceRefresh || needsRefresh(active)) {
      if (env.PG_RUNTIME_ROLE === "tiendaiq_worker_runtime") {
        await requestRefreshFromBroker({
          url: env.TOKEN_REFRESH_BROKER_URL,
          secret: env.TOKEN_REFRESH_BROKER_KEY,
          shop: tienda,
          credentialVersion: active.credentialVersion
        });
        active = await leerCredencialShopifyDB(context || tienda);
        if (!active || needsRefresh(active)) {
          const e = new Error("El broker no dejó una autorización Shopify utilizable");
          e.code = "SHOPIFY_REFRESH_BROKER_STALE";
          e.status = 503;
          throw e;
        }
      } else {
        active = await refrescarEnWeb(context || TenantContext.fromShopDomain(tienda, { source: "internal-job" }), active);
      }
    }
    return {
      tienda: t.dominio,
      token: active.accessToken,
      credentialVersion: active.credentialVersion,
      refresh: async () => sesionDe(context || tienda, { forceRefresh: true })
    };
  }
  // Instalaciones anteriores a los tokens expiring siguen operativas mientras
  // migran; toda instalación nueva usa el almacén separado de arriba.
  return { tienda: t.dominio, token: t.token };
}

module.exports = {
  normalizar,
  esDominioValido,
  guardarTienda,
  guardarInstalacionExpiring,
  leerTienda,
  borrarTienda,
  listarTiendas,
  consumirCupoTienda,
  revertirCupoTienda,
  actualizarCamposTienda,
  sesionDe
};
