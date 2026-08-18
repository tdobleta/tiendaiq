// ============================================================
// AUTENTICACIÓN — dos cosas distintas que se confunden fácil:
//
//   1. INSTALACIÓN (OAuth). Ocurre una vez por tienda. La tienda autoriza,
//      volvemos con su token y lo guardamos. Reemplaza al oauth.js de una vez.
//
//   2. IDENTIFICACIÓN (pase de sesión). Ocurre en CADA request de la app.
//      App Bridge le da al frontend un pase firmado que dice "soy la tienda
//      tal". Acá se verifica la firma y se saca de ahí quién pregunta.
//
// Sin la 2, cualquiera con la URL podría pedirnos datos de cualquier tienda
// instalada: bastaría con mandar ?shop=lo-que-sea.
// ============================================================

const crypto = require("crypto");
const { env } = require("./shopify");
const { guardarTienda, normalizar, esDominioValido } = require("./tiendas");
const { metrica } = require("./monitoreo");
const { guardarEstadoDB, consumirEstadoDB } = require("./db");
const { urlInicioAppShopify } = require("./shopify-admin-url");

// OJO: al agregar un alcance, las tiendas ya instaladas tienen que volver a
// pasar por /auth?shop=... para autorizarlo.
// read_discounts: métricas de uso de las reglas creadas por TiendaIQ, sin leer
// pedidos ni datos protegidos de compradores.
// write_files: imágenes que el merchant sube al editor (Files API).
// write_discounts: los bundles crean descuentos automáticos (por volumen)
// que Shopify hace cumplir en el checkout.
// write_online_store_navigation: el menú principal (Inicio/Comprar/Nosotros/
// Contacto) es contenido de tienda, compartido por todos los themes.
// Sin read_themes/write_themes: la app NO toca el tema (compliance App Store —
// escribir archivos al tema no se exenta para este caso de uso). El video
// slider y demás secciones viven en la landing (metafield + app block), no en
// el tema. La verificación de "landing viva" se hace fetcheando el storefront.
const ALCANCES = "read_products,write_products,read_files,write_files,read_content,write_content,read_discounts,write_discounts,write_online_store_navigation";

const TOPICOS_OPERATIVOS = Object.freeze(["APP_UNINSTALLED", "APP_SUBSCRIPTIONS_UPDATE"]);

function alcancesFaltantes(scope) {
  const concedidos = new Set(String(scope || "").split(",").map((value) => value.trim()).filter(Boolean));
  return ALCANCES.split(",").filter((alcance) => !concedidos.has(alcance));
}

async function registrarWebhooksOperativos(sesion, urlApp, gqlClient) {
  const callbackUrl = `${String(urlApp || "").replace(/\/$/, "")}/webhooks`;
  if (!/^https:\/\//.test(callbackUrl)) throw new Error("APP_URL debe ser HTTPS para registrar webhooks");
  const gql = gqlClient || require("./shopify").gql;
  const consulta = `query($topics: [WebhookSubscriptionTopic!]) {
    webhookSubscriptions(first: 50, topics: $topics) {
      edges { node { topic uri } }
    }
  }`;
  const existentes = await gql(consulta, { topics: TOPICOS_OPERATIVOS }, sesion);
  const registrados = new Set(
    (existentes?.webhookSubscriptions?.edges || [])
      .map((edge) => edge?.node)
      .filter((node) => node?.uri === callbackUrl)
      .map((node) => node.topic)
  );
  const mutacion = `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }`;

  for (const topic of TOPICOS_OPERATIVOS) {
    if (registrados.has(topic)) continue;
    const result = await gql(
      mutacion,
      { topic, sub: { callbackUrl, format: "JSON" } },
      sesion
    );
    const payload = result?.webhookSubscriptionCreate;
    const errors = payload?.userErrors || [];
    if (errors.length || !payload?.webhookSubscription?.id) {
      const error = new Error(`No se pudo registrar el webhook ${topic}`);
      error.detalle = JSON.stringify(errors).slice(0, 500);
      throw error;
    }
  }
}

// Comparación en tiempo constante: comparar firmas con === filtra el secreto
// de a un carácter por vez.
function igualSeguro(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

const MINUTOS_ESTADO = 10;
const SEGUNDOS_MAX_SOLICITUD_OAUTH = 5 * 60;
const SEGUNDOS_FUTURO_SOLICITUD_OAUTH = 60;
const COOKIE_ESTADO_OAUTH = "tiendaiq_oauth_state";
const RUTA_COOKIE_ESTADO_OAUTH = "/auth/callback";

function parametrosOAuth(params) {
  if (params instanceof URLSearchParams) return Object.fromEntries(params);
  return params && typeof params === "object" ? params : {};
}

// ============================================================
// 1. INSTALACIÓN
// ============================================================

// Shopify firma sus redirects con HMAC sobre los parámetros ordenados.
// Sin verificar esto, cualquiera puede hacernos guardar un token falso.
function hmacValido(params) {
  const { hmac, signature, ...resto } = parametrosOAuth(params);
  if (!env.SHOPIFY_CLIENT_SECRET || typeof hmac !== "string" || !hmac) return false;
  const mensaje = Object.keys(resto)
    .sort()
    .map((k) => `${k}=${resto[k]}`)
    .join("&");
  const esperado = crypto
    .createHmac("sha256", env.SHOPIFY_CLIENT_SECRET)
    .update(mensaje)
    .digest("hex");
  return igualSeguro(esperado, hmac || "");
}

function timestampOAuthValido(params, {
  ahoraMs = Date.now(),
  maxEdadSegundos = SEGUNDOS_MAX_SOLICITUD_OAUTH,
  maxFuturoSegundos = SEGUNDOS_FUTURO_SOLICITUD_OAUTH
} = {}) {
  const valor = String(parametrosOAuth(params).timestamp || "");
  if (!/^\d+$/.test(valor)) return false;
  const timestamp = Number(valor);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return false;
  const edad = Math.floor(Number(ahoraMs) / 1000) - timestamp;
  return edad >= -Math.max(0, Number(maxFuturoSegundos) || 0) &&
    edad <= Math.max(0, Number(maxEdadSegundos) || 0);
}

function validarSolicitudOAuthInicial(params, opciones) {
  return hmacValido(params) && timestampOAuthValido(params, opciones);
}

function esProduccionOAuth() {
  return env.DEV_MODE !== "1" && (!!env.DATABASE_URL || process.env.NODE_ENV === "production");
}

// El acceso directo /auth?shop=... se conserva solo para desarrollo local.
// En produccion, o si la URL afirma venir firmada, HMAC y timestamp son
// obligatorios. Asi una firma incompleta tampoco cae silenciosamente al modo dev.
function solicitudInicialOAuthPermitida(params, {
  produccion = esProduccionOAuth(),
  ahoraMs = Date.now()
} = {}) {
  const valores = parametrosOAuth(params);
  const traeFirma = Object.hasOwn(valores, "hmac") || Object.hasOwn(valores, "timestamp");
  if (!produccion && !traeFirma) return true;
  return validarSolicitudOAuthInicial(valores, { ahoraMs });
}

function firmaCookieEstadoOAuth(estado) {
  if (!env.SHOPIFY_CLIENT_SECRET || typeof estado !== "string" || !estado) return null;
  return crypto
    .createHmac("sha256", env.SHOPIFY_CLIENT_SECRET)
    .update(`oauth-state-cookie:${estado}`)
    .digest("base64url");
}

function crearCookieEstadoOAuth(estado, { maxAge = MINUTOS_ESTADO * 60 } = {}) {
  const firma = firmaCookieEstadoOAuth(estado);
  if (!firma) throw new Error("SHOPIFY_CLIENT_SECRET es obligatorio para emitir el estado OAuth");
  return `${COOKIE_ESTADO_OAUTH}=${estado}.${firma}; Max-Age=${Math.max(0, Number(maxAge) || 0)}; Path=${RUTA_COOKIE_ESTADO_OAUTH}; HttpOnly; Secure; SameSite=Lax`;
}

function cookiePorNombre(cookieHeader, nombre) {
  for (const parte of String(cookieHeader || "").split(";")) {
    const indice = parte.indexOf("=");
    if (indice < 0 || parte.slice(0, indice).trim() !== nombre) continue;
    try {
      return decodeURIComponent(parte.slice(indice + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function verificarCookieEstadoOAuth(cookieHeader, estadoEsperado) {
  if (typeof estadoEsperado !== "string" || !estadoEsperado) return false;
  const valor = cookiePorNombre(cookieHeader, COOKIE_ESTADO_OAUTH);
  if (!valor) return false;
  const separador = valor.lastIndexOf(".");
  if (separador <= 0) return false;
  const estado = valor.slice(0, separador);
  const firma = valor.slice(separador + 1);
  const esperada = firmaCookieEstadoOAuth(estado);
  return !!esperada && igualSeguro(firma, esperada) && igualSeguro(estado, estadoEsperado);
}

function agregarSetCookie(res, cookie) {
  const existentes = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : null;
  const valores = existentes == null ? [] : Array.isArray(existentes) ? existentes : [String(existentes)];
  res.setHeader("Set-Cookie", [...valores, cookie]);
}

function consumirCookieEstadoOAuth(res, estadoEsperado, cookieHeader = res?.req?.headers?.cookie) {
  const valida = verificarCookieEstadoOAuth(cookieHeader, estadoEsperado);
  agregarSetCookie(
    res,
    `${COOKIE_ESTADO_OAUTH}=; Max-Age=0; Path=${RUTA_COOKIE_ESTADO_OAUTH}; HttpOnly; Secure; SameSite=Lax`
  );
  return valida;
}

// Un `state` de un solo uso ata el callback a un inicio nuestro. Vive en la
// base (no en memoria): el proceso se reinicia y puede haber más de una
// instancia, y el callback tiene que poder caer en cualquiera de ellas.
async function nuevoEstado(tienda) {
  const s = crypto.randomBytes(16).toString("hex");
  await guardarEstadoDB(s, tienda, Date.now() + MINUTOS_ESTADO * 60 * 1000);
  return s;
}

// GET /auth?shop=xxx.myshopify.com — arranca la instalación.
async function iniciarInstalacion(res, url, urlApp) {
  const tienda = normalizar(url.searchParams.get("shop"));
  if (!esDominioValido(tienda)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Falta o es inválido el parámetro ?shop=xxx.myshopify.com");
    return;
  }

  const params = Object.fromEntries(url.searchParams);
  if (!solicitudInicialOAuthPermitida(params)) {
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }).end("Solicitud de instalacion invalida o vencida");
    return;
  }

  const estado = await nuevoEstado(tienda);
  agregarSetCookie(res, crearCookieEstadoOAuth(estado));

  const destino =
    `https://${tienda}/admin/oauth/authorize` +
    `?client_id=${env.SHOPIFY_CLIENT_ID}` +
    `&scope=${encodeURIComponent(ALCANCES)}` +
    `&redirect_uri=${encodeURIComponent(`${urlApp}/auth/callback`)}` +
    `&state=${estado}`;

  res.writeHead(302, { Location: destino }).end();
}

// GET /auth/callback — la tienda autorizó: canjeamos el código por su token.
async function terminarInstalacion(res, url) {
  const params = Object.fromEntries(url.searchParams);
  const tienda = normalizar(params.shop);

  if (!esDominioValido(tienda)) return void res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("shop inválido");
  if (!hmacValido(params)) return void res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }).end("Firma inválida — el pedido no vino de Shopify");

  // La cookie liga el state al navegador que inicio el flujo. Se elimina aun
  // si esta alterada para que nunca sobreviva a un callback firmado.
  if (!consumirCookieEstadoOAuth(res, params.state)) {
    return void res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" })
      .end("state inválido o vencido — volvé a empezar la instalación");
  }

  // El state tiene que existir, no haber vencido, y ser el que emitimos para
  // ESTA tienda: si no se compara, un state válido de una tienda sirve para
  // cerrar la instalación de otra.
  const emitido = await consumirEstadoDB(params.state);
  if (!emitido || emitido.tienda !== tienda) {
    return void res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }).end("state inválido o vencido — volvé a empezar la instalación");
  }

  const r = await fetch(`https://${tienda}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      code: params.code
    }),
    signal: AbortSignal.timeout(Math.max(3000, Number(env.SHOPIFY_OAUTH_TIMEOUT_MS) || 15000))
  });

  const datos = await r.json();
  if (!datos.access_token) {
    // No filtrar la respuesta cruda de Shopify al navegador: se loguea del lado
    // nuestro y el merchant ve un mensaje genérico.
    console.error(`  ✖ OAuth ${tienda}: sin access_token en la respuesta ·`, JSON.stringify(datos).slice(0, 300));
    return void res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }).end("No se pudo completar la instalación. Volvé a intentarlo.");
  }

  // Aviso si Shopify concedió MENOS alcances que los pedidos (p. ej. el merchant
  // instaló con un token viejo): la app funcionará pero puede fallar en runtime
  // (ACCESS_DENIED) en las features del alcance faltante. Se registra para que
  // el problema sea visible desde la instalación, no recién al usar la feature.
  const faltantes = alcancesFaltantes(datos.scope);
  if (faltantes.length) {
    console.log(`  ⚠ ${tienda}: alcances no concedidos → ${faltantes.join(", ")} (puede requerir re-autorización)`);
  }

  if (faltantes.length) {
    return void res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Shopify no concedió todos los permisos necesarios. Volvé a iniciar la instalación.");
  }
  try {
    await registrarWebhooksOperativos({ tienda, token: datos.access_token }, env.APP_URL);
  } catch (error) {
    console.error(`  instalacion ${tienda}: webhooks incompletos`, error.message, error.detalle || "");
    return void res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" })
      .end("No se pudo completar la configuración de la app. Volvé a iniciar la instalación.");
  }

  await guardarTienda(tienda, datos.access_token, { alcances: datos.scope, alcances_faltantes: faltantes });
  console.log(`  ✚ instalada · ${tienda}`);
  metrica("instalacion", { tienda });

  // Adentro del admin, no a la app suelta.
  res
    .writeHead(302, {
      Location: urlInicioAppShopify(tienda, { appHandle: env.SHOPIFY_APP_HANDLE })
    })
    .end();
}

// ============================================================
// 2. IDENTIFICACIÓN — el pase de sesión de App Bridge
// ============================================================

const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();

// El pase es un JWT firmado con nuestro client secret. Verificamos la firma
// y las fechas, y el claim `dest` nos dice qué tienda es.
function tiendaDelPase(pase) {
  const partes = String(pase || "").split(".");
  if (partes.length !== 3) throw new Error("Pase de sesión mal formado");

  const [cabecera, cuerpo, firma] = partes;
  const header = JSON.parse(b64url(cabecera));
  if (header.alg !== "HS256") throw new Error("Pase de sesión con algoritmo no permitido");
  const esperada = crypto
    .createHmac("sha256", env.SHOPIFY_CLIENT_SECRET)
    .update(`${cabecera}.${cuerpo}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (!igualSeguro(esperada, firma)) throw new Error("Pase de sesión con firma inválida");

  const c = JSON.parse(b64url(cuerpo));
  const ahora = Math.floor(Date.now() / 1000);
  for (const claim of ["exp", "nbf", "iat"]) {
    if (!Number.isFinite(c[claim])) throw new Error(`Pase de sesión sin claim ${claim} válido`);
  }
  if (typeof c.sub !== "string" || !c.sub) throw new Error("Pase de sesión sin subject válido");
  if (ahora >= c.exp) throw new Error("Pase de sesión vencido");
  if (ahora < c.nbf - 5 || c.iat > ahora + 5) throw new Error("Pase de sesión todavía no válido");
  if (c.aud !== env.SHOPIFY_CLIENT_ID) throw new Error("Pase de sesión emitido para otra app");

  // La doc de Shopify (set-up-session-tokens) exige que `iss` (quién emitió el
  // pase) y `dest` (a qué tienda va dirigido) apunten a la MISMA tienda. Sin
  // este chequeo, un pase legítimo de una tienda podría reusarse apuntando a
  // otra. Comparamos por host.
  const hostDe = (u) => { try { return new URL(String(u)).host; } catch { return null; } };
  const hIss = hostDe(c.iss);
  const hDest = hostDe(c.dest);
  if (!hIss || !hDest || hIss !== hDest) throw new Error("Pase de sesión inconsistente (iss ≠ dest)");

  const tienda = normalizar(c.dest);
  if (!esDominioValido(tienda)) throw new Error("El pase no trae una tienda válida");
  return tienda;
}

module.exports = {
  iniciarInstalacion,
  terminarInstalacion,
  tiendaDelPase,
  hmacValido,
  timestampOAuthValido,
  validarSolicitudOAuthInicial,
  solicitudInicialOAuthPermitida,
  crearCookieEstadoOAuth,
  verificarCookieEstadoOAuth,
  consumirCookieEstadoOAuth,
  alcancesFaltantes,
  registrarWebhooksOperativos,
  ALCANCES,
  TOPICOS_OPERATIVOS,
  COOKIE_ESTADO_OAUTH
};
