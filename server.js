// ============================================================
// SERVIDOR — multi-tienda.
//
//   node server.js   →  http://localhost:4321
//
// Rutas de instalación (una vez por tienda):
//   GET  /auth?shop=xxx            arranca el OAuth
//   GET  /auth/callback            guarda el token de esa tienda
//
// Rutas de la app (cada request trae el pase de sesión de App Bridge):
//   GET  /api/productos            productos de LA tienda que pregunta
//   POST /api/paginas              crea una página
//   PUT  /api/paginas/:id          guarda cambios del editor
//   POST /api/paginas/:id/publicar la sube a ESA tienda
//
// Regla dura: ninguna ruta /api/ toca Shopify sin haber resuelto antes qué
// tienda pregunta, verificando la firma del pase. Sin eso, cualquiera con la
// URL podría pedir datos de cualquier tienda instalada.
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { listarProductos } = require("./adaptador");
const { env, gql, sesionDeEnv } = require("./shopify");
const { sesionDe, borrarTienda, esDominioValido, normalizar } = require("./tiendas");
const { createSyntheticLoadHandler, safeEqual } = require("./src/capacity/synthetic-load-endpoints");
const { verifyRefreshRequest, parseRefreshRequest } = require("./src/shopify/token-refresh-broker");
const {
  guardarPaginaDB,
  leerPaginaDB,
  listarPaginasDB,
  encolarJobDB,
  encolarJobExclusivoDB,
  encolarPublicacionDB,
  encolarDespublicacionDB,
  encolarGeneracionDB,
  recibirWebhookDB,
  leerJobDB,
  estadoColaDB,
  estadoWorkerDB,
  estadoBillingWorkerDB,
  estadoInboxDB,
  leerEvidenciaCertificacionShopifyDB,
  verificarAlmacenamientoDB,
  cerrarAlmacenamientoDB
} = require("./db");
const { subscriptionRecoveryDiagnosticFromJob } = require("./src/jobs/subscription-recovery");
const { certificationConfigurationDiagnostic } = require("./src/shopify/certification-diagnostic");
const {
  iniciarInstalacion,
  terminarInstalacion,
  tiendaDelPase,
  recuperarInstalacionDesdePase,
  asegurarOrigenStorefront,
  ALCANCES,
  TOPICOS_OPERATIVOS
} = require("./auth");
const { nubeServible, urlVideo, urlPoster } = require("./inspiracion-nube");
const { estadoPlan, mesActual, PLAN_NOMBRE, configuracionPaginasGratis } = require("./facturacion");
const { billingRuntimeContract, billingRuntimeCompatible } = require("./src/runtime/billing-runtime-contract");
const { appRegistrationBindingContract, appRegistrationDiagnostic } = require("./src/runtime/app-registration-contract");
const { reportarError, metrica } = require("./monitoreo");
const { TenantContext } = require("./src/tenancy/tenant-context");
const { verifyAndNormalizeWebhook } = require("./src/webhooks/verify-and-normalize");
const { generationAdmissionPause } = require("./src/generation/admission-control");
const { resolveTemplateForCreation } = require("./src/domain/template-registry");
const { applyTemplateBoundEdit } = require("./src/domain/fixed-template-edit-policy");
const {
  queryShopifyCertification,
  queryStorefrontCertification,
  evaluateShopifyCertification
} = require("./src/shopify/staging-certification");
const {
  leerConfigBundles,
  guardarConfigBundles,
  validarConfigBundles,
  bundleEsPublicable,
  configAplicadaBundles
} = require("./bundles");

// Render (y cualquier host) fija el puerto por env; local usa 4321.
const PUERTO = Number(env.PORT || process.env.PORT || 4321);
const DIR_APP = path.join(__dirname, "app");
const DIR_PLANTILLA = path.join(__dirname, "plantilla-producto");
// Carpeta de videos de "Inspírate de los mejores" (TikToks de venta orgánica).
// Por defecto vive en el repo; se puede apuntar a otra ruta con INSPIRACION_DIR
// (ej. una carpeta local con GB de videos que no querés versionar).
const DIR_INSPIRACION = env.INSPIRACION_DIR || path.join(__dirname, "inspiracion-organica");

// Cache-busting: un token que cambia cuando cambia cualquier asset del front.
// Se inyecta en las URLs de app.js/app.css y render.js/styles.css, así después
// de cada deploy el navegador SIEMPRE baja la versión nueva (no más "no veo los
// cambios"). Se calcula del mtime más reciente; si algo falla, cae al arranque.
const VERSION_ASSETS = (() => {
  try {
    const dirWidgets = path.join(__dirname, "extensions", "tiendaiq-widgets", "assets");
    const archivos = [
      path.join(DIR_APP, "app.js"), path.join(DIR_APP, "app.css"),
      path.join(DIR_APP, "home-v2.js"), path.join(DIR_APP, "home-v2.css"),
      path.join(dirWidgets, "tiendaiq.js"), path.join(dirWidgets, "tiendaiq.css")
    ];
    return Math.floor(Math.max(...archivos.map((a) => fs.statSync(a).mtimeMs))).toString(36);
  } catch {
    return Date.now().toString(36);
  }
})();

let solicitudesCertificacionShopify = [];

function permitirCertificacionShopify(now = Date.now()) {
  solicitudesCertificacionShopify = solicitudesCertificacionShopify.filter((timestamp) => now - timestamp < 60_000);
  if (solicitudesCertificacionShopify.length >= 5) return false;
  solicitudesCertificacionShopify.push(now);
  return true;
}
// Único hogar del código que corre en el storefront (widget de bundles y
// widget de bundles). El theme app extension lo publica en el CDN de Shopify, y
// el server sirve LOS MISMOS archivos para el preview del admin y para la
// inyección directa. Una sola copia: no hay nada que sincronizar.
const DIR_WIDGETS = path.join(__dirname, "extensions", "tiendaiq-widgets", "assets");

// La URL pública por la que Shopify nos alcanza. En producción es la de Render;
// en local, el túnel. Sin esto el OAuth no puede volver.
const URL_APP = (env.APP_URL || `http://localhost:${PUERTO}`).replace(/\/$/, "");
const GENERATION_QUEUE_MAX_PER_TENANT = Math.max(1, Number(env.GENERATION_QUEUE_MAX_PER_TENANT) || 2);
const GENERATION_QUEUE_MAX_GLOBAL = Math.max(1, Number(env.GENERATION_QUEUE_MAX_GLOBAL) || 120);

// ---------- almacén de páginas, por tienda, vía db.js ----------

const idDePagina = (gid) => gid.split("/").pop(); // gid://shopify/Product/123 → 123

async function guardarPagina(tenant, registro) {
  registro.actualizado = new Date().toISOString();
  await guardarPaginaDB(tenant, registro.id, registro);
  return registro;
}
const leerPagina = (tenant, id) => leerPaginaDB(tenant, id);
const listarPaginas = (tenant) => listarPaginasDB(tenant);

// ---------- activación en el tema (deep links; la app NO escribe el tema) ----------

const CLIENT_ID = env.SHOPIFY_CLIENT_ID || "";

// Abre el editor de temas en el template de producto para que el merchant cree
// una vez la plantilla "tiendaiq" y le agregue el app block.
const linkEditorPagina = (tienda) =>
  `https://${tienda}/admin/themes/current/editor?template=product`;

// Preactiva un app embed en el editor: además de abrir el panel
// de "Incrustaciones de apps", deja el toggle del bloque listo para prender.
const linkActivarEmbed = (tienda, handle) =>
  `https://${tienda}/admin/themes/current/editor?context=apps&activateAppId=${CLIENT_ID}/${handle}`;

// ¿La landing de producto se ve, y CÓMO? En vez de leer el tema (scope que
// Shopify no otorga), fetcheamos el HTML público del producto y distinguimos
// quién la está pintando mirando de dónde salen los assets. Devuelve:
//   "app_block" → la pinta el app block de la extensión (CDN de extensiones) ✓
//   "legacy"    → la pinta una plantilla/asset VIEJO que quedó ESCRITO en el
//                 tema (época de themeFilesUpsert): tiendaiq.js sale de
//                 /cdn/shop/t/…/assets/. Hay que limpiarlo — le gana al bloque.
//   "inactiva"  → sin marcador: cae al producto nativo (falta crear/activar la
//                 plantilla con el bloque).
//   null        → no verificable (timeout, tienda con contraseña, sin URL).
// El estado "legacy" es clave: el marcador TIENDAIQ_DATA está en AMBOS (bloque y
// plantilla vieja), así que mirarlo solo daba falso positivo — por eso miramos
// el origen de los assets.
const cacheViva = new Map(); // url -> { t, v }
async function verificarUrlViva(url, fresh = false) {
  if (!url) return null;
  if (!fresh) {
    const c = cacheViva.get(url);
    if (c && Date.now() - c.t < 60 * 1000) return c.v;
  }
  let v = null;
  try {
    const señal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined;
    const r = await fetch(url, { redirect: "follow", signal: señal });
    // Tienda con contraseña: la storefront redirige a /password (200) sin el
    // marcador. Eso NO es "no se ve" — es "no verificable" (null).
    const esPassword = /\/password(\/|\?|$)/.test(r.url || "");
    if (r.ok && !esPassword) {
      const html = await r.text();
      if (!html.includes("TIENDAIQ_DATA")) v = "inactiva";
      // Asset de render servido desde el TEMA (/cdn/shop/t/<id>/assets/) =
      // plantilla vieja inyectada. El app block lo sirve desde cdn.shopify.com/extensions/.
      else if (/\/cdn\/shop\/t\/\d+\/assets\/tiendaiq\.(?:js|css)/.test(html)) v = "legacy";
      else v = "app_block";
    }
  } catch {
    v = null;
  }
  cacheViva.set(url, { t: Date.now(), v });
  return v;
}

// ---------- helpers HTTP ----------

const json = (res, codigo, cuerpo, headers = {}) => {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(cuerpo));
};

const jobPublico = (job) => job && ({
  id: job.id,
  type: job.type,
  status: job.status,
  attempts: job.attempts,
  maxAttempts: job.maxAttempts,
  lastError: job.status === "failed" ? "No se pudo completar la operación después de varios intentos." : null,
  result: job.status === "succeeded" ? job.result : null,
  diagnostic: job.status === "failed" ? subscriptionRecoveryDiagnosticFromJob(job) : null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  completedAt: job.completedAt
});

// Cuerpo CRUDO (Buffer): los webhooks de Shopify se verifican con HMAC sobre
// los bytes exactos — parsear antes de verificar rompe la firma.
function leerCrudo(req, limite = 1_000_000) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > limite) {
        reject(Object.assign(new Error("Webhook demasiado grande"), { status: 413 }));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

// POST /webhooks: verifica, minimiza y persiste. Los efectos ocurren en el
// worker; responder 200 significa "el evento quedó durable", no "ya terminó".
async function webhooks(req, res) {
  const crudo = await leerCrudo(req);
  const input = verifyAndNormalizeWebhook(crudo, req.headers, env.SHOPIFY_CLIENT_SECRET);
  const { inserted } = await recibirWebhookDB(input);
  if (inserted) metrica("webhook_recibido", { topic: input.topic });
  res.writeHead(200).end();
}

function leerCuerpo(req, limite = 1_000_000) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let bytes = 0;
    // Tope de 1 MB por defecto: sin esto una ruta pública podría inflar la
    // memoria. La subida de imágenes pasa un límite mayor.
    // Se mide por BYTES reales (Buffer.length), no por largo de string: con
    // multibyte el corte en .length no coincide con los bytes recibidos, y
    // acumular en string materializa el base64 de 15 MB en memoria UTF-16.
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > limite) {
        reject(Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 }));
        req.destroy();
        return;
      }
      trozos.push(c);
    });
    req.on("end", () => {
      if (!bytes) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(trozos).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Cuerpo JSON inválido"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const syntheticLoadHandler = createSyntheticLoadHandler({
  enabled: env.ENABLE_SYNTHETIC_LOAD_ENDPOINTS,
  environment: env.SYNTHETIC_LOAD_ENVIRONMENT,
  token: env.SYNTHETIC_LOAD_TOKEN,
  expiresAt: env.SYNTHETIC_LOAD_EXPIRES_AT,
  readJson: leerCuerpo
});

async function estadoOperativo(req, res) {
  const token = String(env.OPS_STATUS_TOKEN || "");
  if (token.length < 32) return json(res, 404, { error: "not_found" });

  if (!safeEqual(req.headers.authorization, `Bearer ${token}`)) {
    return json(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
  }

  if (req.method !== "GET") {
    return json(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
  }

  const [cola, worker, inbox] = await Promise.all([
    estadoColaDB("ops-status"),
    estadoWorkerDB(),
    estadoInboxDB()
  ]);
  const totales = cola.reduce(
    (acc, item) => {
      acc.queued += Number(item.queued) || 0;
      acc.running += Number(item.running) || 0;
      acc.failed += Number(item.failed) || 0;
      acc.failedRecent += Number(item.failedRecent) || 0;
      acc.staleRunning += Number(item.staleRunning) || 0;
      acc.compensationPending += Number(item.compensationPending) || 0;
      acc.compensationDeadLetter += Number(item.compensationDeadLetter) || 0;
      acc.staleCompensation += Number(item.staleCompensation) || 0;
      acc.oldestQueuedSeconds = Math.max(acc.oldestQueuedSeconds, Number(item.oldestQueuedSeconds) || 0);
      acc.oldestCompensationSeconds = Math.max(acc.oldestCompensationSeconds, Number(item.oldestCompensationSeconds) || 0);
      return acc;
    },
    {
      queued: 0,
      running: 0,
      failed: 0,
      failedRecent: 0,
      staleRunning: 0,
      compensationPending: 0,
      compensationDeadLetter: 0,
      staleCompensation: 0,
      oldestQueuedSeconds: 0,
      oldestCompensationSeconds: 0
    }
  );
  const admision = generationAdmissionPause(env);
  const faltanLegales = legalesIncompletos();

  return json(res, 200, {
    ok: true,
    release: process.env.RENDER_GIT_COMMIT || null,
    // Este endpoint muestra configuración no secreta. La coincidencia con la
    // base se demuestra en el preflight y en /ready; así ops local sigue siendo
    // consultable sin convertirlo en una conexión Postgres implícita.
    appRegistration: appRegistrationDiagnostic(appRegistrationBindingContract(env)),
    billing: {
      planTest: String(env.PLAN_TEST || "") === "1"
    },
    legal: {
      complete: faltanLegales.length === 0,
      missing: faltanLegales
    },
    generationAdmission: {
      paused: admision.paused,
      retryAfter: admision.retryAfter
    },
    worker,
    inbox: {
      received: Number(inbox.received) || 0,
      processing: Number(inbox.processing) || 0,
      failed: Number(inbox.failed) || 0,
      failedRecent: Number(inbox.failedRecent) || 0,
      staleProcessing: Number(inbox.staleProcessing) || 0,
      oldestReceivedSeconds: Number(inbox.oldestReceivedSeconds) || 0
    },
    queue: cola.map((item) => ({
      type: item.type,
      queued: Number(item.queued) || 0,
      running: Number(item.running) || 0,
      failed: Number(item.failed) || 0,
      failedRecent: Number(item.failedRecent) || 0,
      staleRunning: Number(item.staleRunning) || 0,
      compensationPending: Number(item.compensationPending) || 0,
      compensationDeadLetter: Number(item.compensationDeadLetter) || 0,
      staleCompensation: Number(item.staleCompensation) || 0,
      oldestQueuedSeconds: Number(item.oldestQueuedSeconds) || 0,
      oldestCompensationSeconds: Number(item.oldestCompensationSeconds) || 0
    })),
    totals: totales,
    ts: new Date().toISOString()
  }, { "Cache-Control": "no-store" });
}

async function configuracionBillingOperativa(req, res) {
  const token = String(env.OPS_STATUS_TOKEN || "");
  if (token.length < 32) return json(res, 404, { error: "not_found" });
  if (!safeEqual(req.headers.authorization, `Bearer ${token}`)) {
    return json(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
  }
  if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });

  const expected = billingRuntimeContract(env);
  const worker = await estadoBillingWorkerDB();
  return json(res, 200, {
    ok: true,
    release: process.env.RENDER_GIT_COMMIT || null,
    billing: {
      paginasGratis: configuracionPaginasGratis,
      planTest: expected.planTest,
      appHandle: expected.appHandle,
      worker,
      workerCompatible: billingRuntimeCompatible(expected, worker)
    }
  }, { "Cache-Control": "no-store" });
}

async function certificarShopifyStaging(req, res) {
  if (String(env.SHOPIFY_CERTIFICATION_ENABLED || "") !== "1") {
    return json(res, 404, { error: "not_found" });
  }

  const token = String(env.OPS_STATUS_TOKEN || "");
  if (token.length < 32 || !safeEqual(req.headers.authorization, `Bearer ${token}`)) {
    return json(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
  }
  if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
  if (!permitirCertificacionShopify()) {
    return json(res, 429, { error: "rate_limited" }, { "Retry-After": "60", "Cache-Control": "no-store" });
  }

  const shop = normalizar(env.SHOPIFY_CERTIFICATION_SHOP);
  const pageId = String(env.SHOPIFY_CERTIFICATION_PAGE_ID || "").trim();
  const releaseSha = String(process.env.RENDER_GIT_COMMIT || "").trim().toLowerCase();
  const configuration = certificationConfigurationDiagnostic({
    shop: esDominioValido(shop) ? shop : null,
    pageId,
    planTest: String(env.PLAN_TEST || "") === "1",
    releaseSha
  });
  if (!configuration.configured) {
    return json(res, 503, {
      activeStoreOk: false,
      error: "certification_not_configured",
      diagnostic: configuration
    });
  }

  const maxAgeHours = Math.min(168, Math.max(1, Number(env.SHOPIFY_CERTIFICATION_MAX_AGE_HOURS) || 24));
  const since = new Date(Date.now() - maxAgeHours * 3600 * 1000);
  const tenant = TenantContext.fromShopDomain(shop, { source: "internal-job" });
  const session = await sesionDe(tenant);
  const evidence = await leerEvidenciaCertificacionShopifyDB(tenant, since, pageId, releaseSha);
  const timeoutSignal = () => typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(20_000)
    : undefined;
  const remote = await queryShopifyCertification(gql, session, evidence.publication?.productId || null, {
    signal: timeoutSignal()
  });
  remote.storefront = null;
  if (remote.product?.onlineStoreUrl && evidence.publication?.publicUrl) {
    try {
      remote.storefront = await queryStorefrontCertification(
        fetch,
        remote.product.onlineStoreUrl,
        evidence.publication.publicUrl,
        { signal: timeoutSignal() }
      );
    } catch {
      remote.storefront = {
        ok: false,
        status: 0,
        html: false,
        urlMatch: false,
        markers: { data: false, app: false, asset: false },
        bytes: 0
      };
    }
  }
  const result = evaluateShopifyCertification({
    requiredScopes: ALCANCES.split(","),
    requiredTopics: TOPICOS_OPERATIVOS,
    expectedWebhookUrl: `${URL_APP}/webhooks`,
    shopDomain: shop,
    planName: PLAN_NOMBRE,
    planTest: String(env.PLAN_TEST || "") === "1",
    releaseSha,
    evidence,
    remote
  });

  return json(res, result.activeStoreOk ? 200 : 503, {
    ...result,
    release: releaseSha,
    maxAgeHours,
    checkedAt: new Date().toISOString()
  }, { "Cache-Control": "no-store" });
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
};

function servirIndex(res) {
  const html = fs
    .readFileSync(path.join(DIR_APP, "index.html"), "utf8")
    .replace("{{SHOPIFY_CLIENT_ID}}", env.SHOPIFY_CLIENT_ID || "")
    .replace('href="app.css"', `href="app.css?v=${VERSION_ASSETS}"`)
    .replace('href="home-v2.css"', `href="home-v2.css?v=${VERSION_ASSETS}"`)
    .replace('src="home-v2.js"', `src="home-v2.js?v=${VERSION_ASSETS}"`)
    .replace('src="app.js"', `src="app.js?v=${VERSION_ASSETS}"`);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    // Sin esto el admin de Shopify no puede meter la app en su iframe.
    "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com"
  });
  res.end(html);
}

// ---------- legales ----------
//
// Los datos del titular no van escritos en el HTML: se completan desde el
// entorno al servir. Así, el día que cambie el dominio, el email de soporte o
// el domicilio, se toca el panel del host y listo — sin editar archivos, sin
// commit y sin deploy. Es el mismo mecanismo que ya usa index.html con el
// client_id.
//
// Estas dos páginas son las URLs que van en la ficha del App Store, así que
// tienen que estar completas ANTES del review.
const CAMPOS_LEGALES = {
  EMAIL_SOPORTE: {
    valor: env.EMAIL_SOPORTE,
    // Un mailto es lo que espera cualquiera que quiera escribirte, y es lo que
    // mira el reviewer de Shopify para confirmar que hay soporte de verdad.
    formato: (v) => `<a href="mailto:${v}">${v}</a>`,
    falta: "email de soporte"
  },
  RAZON_SOCIAL: { valor: env.RAZON_SOCIAL, falta: "nombre o razón social del titular" },
  DOMICILIO: { valor: env.DOMICILIO, falta: "domicilio del titular" }
};

const legalesIncompletos = () =>
  Object.values(CAMPOS_LEGALES).filter((c) => !c.valor).map((c) => c.falta);

function servirLegal(res, archivo) {
  let html = fs.readFileSync(path.join(DIR_APP, archivo), "utf8");
  for (const [clave, campo] of Object.entries(CAMPOS_LEGALES)) {
    // Sin valor se ve "(pendiente)" en vez del marcador crudo: queda claro que
    // falta completarlo y no se filtra un {{...}} a una página pública.
    const texto = campo.valor ? (campo.formato ? campo.formato(campo.valor) : campo.valor) : "(pendiente)";
    html = html.split(`{{${clave}}}`).join(texto);
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(html);
}

const zlib = require("zlib");
const cacheAsset = new Map(); // archivo -> { mtimeMs, min: Buffer, gz: Buffer }

// Minifica JS/CSS con esbuild y cachea el resultado (+ su gzip) por mtime del
// archivo. Es para lo que sirve NUESTRO server sin comprimir (los assets del
// admin: app.js pesa cientos de KB); los del extension los comprime el CDN de
// Shopify. Fallback al original si esbuild falla; en DEV_MODE ni se minifica.
function assetOptimizado(archivo, ext) {
  const st = fs.statSync(archivo);
  const hit = cacheAsset.get(archivo);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit;
  let cuerpo = fs.readFileSync(archivo);
  try {
    const esbuild = require("esbuild");
    cuerpo = Buffer.from(
      esbuild.transformSync(cuerpo.toString("utf8"), {
        loader: ext === ".css" ? "css" : "js",
        minify: true,
        legalComments: "none"
      }).code
    );
  } catch (e) {
    console.error("⚠ minify", path.basename(archivo) + ":", e.message);
    cuerpo = fs.readFileSync(archivo); // el original, sin tocar
  }
  const entry = { mtimeMs: st.mtimeMs, min: cuerpo, gz: zlib.gzipSync(cuerpo, { level: 6 }) };
  cacheAsset.set(archivo, entry);
  return entry;
}

function servirEstatico(req, res, base, rel) {
  // decodeURIComponent: los avatares traen espacios en el nombre.
  const limpio = path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, "");
  const archivo = path.join(base, limpio);
  if (!archivo.startsWith(base) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404).end("no encontrado");
    return;
  }
  const ext = path.extname(archivo).toLowerCase();
  const tipo = TIPOS[ext] || "application/octet-stream";

  // JS/CSS: se sirve minificado (+ gzip si el cliente lo acepta), salvo DEV_MODE.
  if ((ext === ".js" || ext === ".css") && env.DEV_MODE !== "1") {
    const { min, gz } = assetOptimizado(archivo, ext);
    const aceptaGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    const salida = aceptaGzip ? gz : min;
    res.writeHead(200, {
      "Content-Type": tipo,
      "Cache-Control": "no-cache", // revalidar tras deploy (con ?v= igual baja lo nuevo)
      "Content-Length": salida.length,
      Vary: "Accept-Encoding",
      ...(aceptaGzip ? { "Content-Encoding": "gzip" } : {})
    });
    return void res.end(salida);
  }

  res.writeHead(200, {
    "Content-Type": tipo,
    // Sin esto el navegador se queda con app.js/css viejos después de un
    // deploy y "los cambios no aparecen". no-cache = revalidar siempre.
    "Cache-Control": "no-cache"
  });
  fs.createReadStream(archivo).pipe(res);
}

// ---------- inspiración (videos de venta orgánica) ----------

const RE_VIDEO = /\.(mp4|m4v|webm|mov)$/i;
// Manifiesto que escribe el script de subida (scripts/subir-inspiracion.js):
// [{ public_id, vistas, likes, comentarios }]. Es chico y SÍ se versiona.
const MANIFIESTO_INSP = path.join(__dirname, "inspiracion.json");

// Números de las métricas a partir del nombre: vistas . likes . comentarios
// (ej "46100 . 1233 . 26.mp4"). \d+ aguanta espacios y prefijos tipo "(AI)".
const metricasDeNombre = (nombre) => {
  const nums = (nombre.replace(RE_VIDEO, "").match(/\d+/g) || []).map((n) => parseInt(n, 10));
  return { vistas: nums[0] ?? 0, likes: nums[1] ?? 0, comentarios: nums[2] ?? 0 };
};

// Lista los videos con sus métricas. Prioriza la NUBE (Cloudinary: CDN + poster
// instantáneo, lo que ven los merchants en prod); si no está configurada o no
// hay manifiesto, cae al modo LOCAL (lee la carpeta) para desarrollo.
function listarInspiracion() {
  if (nubeServible() && fs.existsSync(MANIFIESTO_INSP)) {
    try {
      const items = JSON.parse(fs.readFileSync(MANIFIESTO_INSP, "utf8"));
      if (Array.isArray(items) && items.length) {
        return items.map((it) => ({
          archivo: it.public_id,
          url: urlVideo(it.public_id),
          poster: urlPoster(it.public_id), // thumbnail del CDN (nunca negro)
          vistas: it.vistas ?? 0,
          likes: it.likes ?? 0,
          comentarios: it.comentarios ?? 0
        }));
      }
    } catch (e) {
      console.error("⚠ inspiracion.json inválido, uso carpeta local:", e.message);
    }
  }
  // Fallback local.
  let archivos = [];
  try { archivos = fs.readdirSync(DIR_INSPIRACION); } catch { return []; }
  return archivos
    .filter((f) => RE_VIDEO.test(f))
    .map((f) => ({
      archivo: f,
      url: "/inspiracion-media/" + encodeURIComponent(f),
      ...metricasDeNombre(f)
    }));
}

// Sirve un video con soporte de Range (206). Es lo que permite que el navegador
// haga seek a un frame para la vista previa (así NO se ve negra) y que el video
// se pueda scrubbear/reproducir sin bajarlo entero.
function servirVideo(req, res, rel) {
  const limpio = path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, "");
  const archivo = path.join(DIR_INSPIRACION, limpio);
  if (!archivo.startsWith(DIR_INSPIRACION) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    return void res.writeHead(404).end("no encontrado");
  }
  const tipo = TIPOS[path.extname(archivo).toLowerCase()] || "application/octet-stream";
  const st = fs.statSync(archivo);
  const rango = req.headers.range;
  if (rango) {
    const m = /bytes=(\d*)-(\d*)/.exec(rango);
    let ini = m && m[1] ? parseInt(m[1], 10) : 0;
    let fin = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (!(ini >= 0)) ini = 0;
    if (!(fin < st.size)) fin = st.size - 1;
    if (ini > fin) return void res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
    res.writeHead(206, {
      "Content-Type": tipo,
      "Content-Range": `bytes ${ini}-${fin}/${st.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": fin - ini + 1,
      "Cache-Control": "no-cache"
    });
    return void fs.createReadStream(archivo, { start: ini, end: fin }).pipe(res);
  }
  res.writeHead(200, {
    "Content-Type": tipo,
    "Accept-Ranges": "bytes",
    "Content-Length": st.size,
    "Cache-Control": "no-cache"
  });
  fs.createReadStream(archivo).pipe(res);
}

// ---------- quién pregunta ----------

// Devuelve { tienda, token } o tira. El pase viene del frontend, que se lo
// pide a App Bridge en cada llamada.
async function resolverSesion(req) {
  const cabecera = req.headers.authorization || "";
  const pase = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : null;

  // MODO DEV: sin pase, se usa la tienda del .env. Sirve para abrir la app
  // directo por la URL del túnel, sin el iframe del admin ni App Bridge.
  // Solo para tu tienda de prueba. En producción DEV_MODE va apagado y todo
  // pasa por el pase firmado (multi-tienda).
  if (!pase && env.DEV_MODE === "1") {
    const sesion = sesionDeEnv();
    return { ...sesion, tenant: TenantContext.fromShopDomain(sesion.tienda, { source: "development" }) };
  }

  if (!pase) {
    const e = new Error("Falta el pase de sesión");
    e.status = 401;
    throw e;
  }
  let tienda;
  try {
    tienda = tiendaDelPase(pase);
  } catch (err) {
    err.status = 401;
    throw err;
  }
  // La identidad inválida es 401; una caída de almacenamiento debe conservar
  // su 5xx para no iniciar un loop de reinstalación engañoso.
  let sesion;
  try {
    sesion = await sesionDe(tienda);
  } catch (error) {
    if (error.code !== "TIENDA_NO_INSTALADA" && error.code !== "SHOPIFY_REAUTH_REQUIRED") throw error;
    sesion = await recuperarInstalacionDesdePase(pase, { tiendaEsperada: tienda });
  }
  await asegurarOrigenStorefront(sesion, env.APP_URL);
  return { ...sesion, tenant: TenantContext.fromShopDomain(sesion.tienda, { source: "session-token" }) };
}

async function brokerRefreshShopify(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  const rawBody = (await leerCrudo(req, 4096)).toString("utf8");
  const timestamp = req.headers["x-tiendaiq-refresh-timestamp"];
  const nonce = req.headers["x-tiendaiq-refresh-nonce"];
  const signature = req.headers["x-tiendaiq-refresh-signature"];
  if (!verifyRefreshRequest({
    secret: env.TOKEN_REFRESH_BROKER_KEY,
    rawBody,
    timestamp,
    nonce,
    signature
  })) return json(res, 403, { error: "broker_auth_failed" });
  const input = parseRefreshRequest(rawBody);
  if (!input) return json(res, 400, { error: "invalid_request" });
  const current = await sesionDe(input.shop);
  if (current.credentialVersion > input.credentialVersion) {
    return json(res, 200, { ok: true, credentialVersion: current.credentialVersion });
  }
  if (current.credentialVersion !== input.credentialVersion) {
    return json(res, 409, { error: "credential_version_conflict" });
  }
  const session = await sesionDe(input.shop, { forceRefresh: true });
  if (session.credentialVersion <= input.credentialVersion) {
    const error = new Error("La renovación no avanzó la versión de credencial");
    error.code = "SHOPIFY_REFRESH_BROKER_STALE";
    error.status = 503;
    throw error;
  }
  // Nunca retornamos access ni refresh token: el worker vuelve a leer sólo la
  // columna access permitida por RLS/GRANT.
  return json(res, 200, { ok: true, credentialVersion: session.credentialVersion });
}

// ---------- api ----------

async function api(req, res, url) {
  const ruta = url.pathname;
  const sesion = await resolverSesion(req);

  // GET /api/productos
  if (req.method === "GET" && ruta === "/api/productos") {
    const productos = await listarProductos(sesion);
    const paginas = Object.fromEntries((await listarPaginas(sesion.tenant)).map((p) => [p.id, p.estado]));
    return json(
      res,
      200,
      productos.map((p) => ({
        id: p.id,
        titulo: p.title,
        imagen: p.featuredMedia?.preview?.image?.url ?? null,
        precio: p.priceRangeV2?.minVariantPrice?.amount ?? null,
        moneda: p.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
        estado: paginas[idDePagina(p.id)] ?? null,
        opciones: (p.options || []).map((o) => ({ nombre: o.name, valores: o.values || [] })),
        variantes: (p.variants?.edges || []).map((e) => ({
          id: e.node.id,
          titulo: e.node.title,
          disponible: e.node.availableForSale !== false
        }))
      }))
    );
  }

  // GET /api/inspiracion — lista los videos de la carpeta con sus métricas
  // parseadas del nombre. El orden/filtro lo hace el front (es data local).
  if (req.method === "GET" && ruta === "/api/inspiracion") {
    return json(res, 200, listarInspiracion());
  }

  // GET /api/jobs/:id — estado tenant-scoped de una operación asíncrona.
  const mJob = ruta.match(/^\/api\/jobs\/([0-9a-f-]{36})$/i);
  if (req.method === "GET" && mJob) {
    const job = await leerJobDB(sesion.tenant, mJob[1]);
    return job ? json(res, 200, { job: jobPublico(job) }) : json(res, 404, { error: "No existe ese trabajo" });
  }

  // GET /api/paginas — resumen para el inicio y la tabla de páginas
  // (no toca Shopify, solo DB)
  if (req.method === "GET" && ruta === "/api/paginas") {
    // listarPaginas ya devuelve el resumen proyectado (id/estado/título/imagen/…),
    // no el JSONB entero de cada página.
    return json(res, 200, await listarPaginas(sesion.tenant));
  }

  // GET /api/pagina-estado — ¿las páginas publicadas se ven en la tienda?
  // Verifica la última publicada fetcheando su HTML público (sin tocar el tema).
  // Alimenta el banner persistente que avisa si falta activar la plantilla.
  if (req.method === "GET" && ruta === "/api/pagina-estado") {
    const ps = await listarPaginas(sesion.tenant);
    const pub = ps
      .filter((p) => p.estado === "publicada" && p.url_publica)
      .sort((a, b) => (b.actualizado || "").localeCompare(a.actualizado || ""))[0];
    return json(res, 200, {
      hayPublicadas: !!pub,
      estado: pub ? await verificarUrlViva(pub.url_publica, url.searchParams.get("fresh") === "1") : null,
      ejemploUrl: pub?.url_publica || null,
      setupUrl: linkEditorPagina(sesion.tienda)
    });
  }

  // GET /api/paginas/:id
  const mGet = ruta.match(/^\/api\/paginas\/([^/]+)$/);
  if (req.method === "GET" && mGet) {
    const p = await leerPagina(sesion.tenant, mGet[1]);
    return p ? json(res, 200, p) : json(res, 404, { error: "No existe esa página" });
  }

  // POST /api/texto/editar — registra una intención durable. Anthropic se llama
  // exclusivamente desde el worker y una intención ambigua nunca se repite.
  if (req.method === "POST" && ruta === "/api/texto/editar") {
    const {
      texto = "",
      instrucciones = "",
      modo = "rewrite",
      idioma = "es",
      contexto = "",
      request_id
    } = await leerCuerpo(req, 40_000);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id || "")) {
      return json(res, 400, { error: "Falta un request_id válido para editar de forma segura" });
    }
    if (String(texto).length > 10_000 || String(instrucciones).length > 2_000 || String(contexto).length > 15_000) {
      return json(res, 413, { error: "El contenido de edición supera el límite permitido" });
    }
    if (!["rewrite", "shorter", "longer"].includes(String(modo))) {
      return json(res, 400, { error: "El modo de edición no es válido" });
    }
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(String(idioma))) {
      return json(res, 400, { error: "El idioma de edición no es válido" });
    }
    const admissionPause = generationAdmissionPause(env);
    if (admissionPause.paused) {
      res.setHeader("Retry-After", String(admissionPause.retryAfter));
      return json(res, 503, { error: admissionPause.message, code: admissionPause.code });
    }

    const idempotencyKey = `edit-text:${request_id}`;
    const job = await encolarJobExclusivoDB(sesion.tenant, {
      type: "edit-text",
      payload: { texto, instrucciones, modo, idioma, contexto },
      idempotencyKey,
      maxAttempts: 1
    });
    if (job?.idempotencyKey !== idempotencyKey) {
      return json(res, 409, { error: "Ya hay otra edición asistida en curso. Esperá a que termine." });
    }
    return json(res, 202, { job: jobPublico(job) });
  }

  // POST /api/imagen — sube una imagen a Files de la tienda (genérico). Lo usa
  // el editor de bundles para las imágenes de add-on/regalo. Devuelve la URL del CDN.
  if (req.method === "POST" && ruta === "/api/imagen") {
    const { nombre, mime, base64 } = await leerCuerpo(req, 15_000_000);
    if (!base64) return json(res, 400, { error: "Falta la imagen" });
    const { subirImagenTienda } = require("./imagenes");
    return json(res, 200, await subirImagenTienda(sesion, nombre, mime || "image/jpeg", base64));
  }

  // ---------- bundles ----------

  // GET /api/bundles — la config de paquetes de la tienda
  if (req.method === "GET" && ruta === "/api/bundles") {
    return json(res, 200, await leerConfigBundles(sesion.tienda));
  }

  // PUT /api/bundles — registra una intención durable. El request web no toca
  // Shopify: el worker serializa la mutación externa y solo entonces avanza la
  // versión que consume el storefront.
  if (req.method === "PUT" && ruta === "/api/bundles") {
    const { config, request_id, expected_version } = await leerCuerpo(req);
    if (!config) return json(res, 400, { error: "Falta config" });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id || "")) {
      return json(res, 400, { error: "Falta un request_id valido para sincronizar bundles de forma segura" });
    }
    validarConfigBundles(config);

    const actual = await leerConfigBundles(sesion.tienda);
    // Si la respuesta HTTP anterior se perdió, el navegador repite la misma
    // intención. El estado durable permite recuperar el job sin crear otro.
    if (actual.sync?.request_id === request_id && actual.sync?.job_id) {
      const existente = await leerJobDB(sesion.tenant, actual.sync.job_id);
      if (existente) return json(res, 202, { job: jobPublico(existente) });
    }
    if (actual.sync?.status === "manual_review") {
      return json(res, 423, {
        error: "Los descuentos requieren reconciliación manual antes de aceptar otro cambio"
      });
    }

    const version = Number(expected_version);
    if (!Number.isInteger(version) || version < 0) {
      return json(res, 400, { error: "Falta expected_version para evitar sobrescribir cambios recientes" });
    }
    if (version !== Math.max(0, Number(actual.version) || 0)) {
      return json(res, 409, { error: "La configuración cambió en otra sesión. Recargá antes de guardar." });
    }

    const idempotencyKey = `sync-bundles:${request_id}`;
    const job = await encolarJobExclusivoDB(sesion.tenant, {
      type: "sync-bundles",
      payload: { config, requestId: request_id, expectedVersion: version },
      idempotencyKey,
      maxAttempts: 1
    });
    // enqueueExclusive devuelve el trabajo activo del tenant. Si pertenece a
    // otra pestaña, no fingimos que esa operación representa este guardado.
    if (job?.idempotencyKey !== idempotencyKey) {
      return json(res, 409, { error: "Ya hay otra sincronización de bundles en curso. Esperá a que termine y recargá." });
    }
    return json(res, 202, { job: jobPublico(job) });
  }

  // GET /api/bundles/metricas — uso de los descuentos que respaldan los
  // bundles. No consulta pedidos ni datos de compradores.
  if (req.method === "GET" && ruta === "/api/bundles/metricas") {
    const { metricasBundles } = require("./bundles");
    const config = await leerConfigBundles(sesion.tienda);
    return json(res, 200, await metricasBundles(sesion, config));
  }

  // POST /api/bundles/instalar — YA NO inyecta código en el tema (compliance: app
  // embed). Marca "publicado" y devuelve el link para activar el app embed en el
  // editor de temas. La config ya viaja en vivo por /publico/bundles.
  if (req.method === "POST" && ruta === "/api/bundles/instalar") {
    const config = await leerConfigBundles(sesion.tienda);
    config.instalado = { fecha: new Date().toISOString() };
    await guardarConfigBundles(sesion.tienda, config);
    config.activarUrl = linkActivarEmbed(sesion.tienda, "bundle");
    return json(res, 200, config);
  }

  // POST /api/nicho/contenido — monta el contenido del nicho (About/Contact)
  // en la tienda que pregunta. Va acá adentro (no como ruta pública) para que
  // use el pase de sesión de App Bridge: la tienda sale del pase firmado, no
  // de un ?shop= con el secreto de la app en la URL.
  if (req.method === "POST" && ruta === "/api/nicho/contenido") {
    const { request_id } = await leerCuerpo(req);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id || "")) {
      return json(res, 400, { error: "Falta un request_id valido para instalar contenido de forma segura" });
    }
    const job = await encolarJobExclusivoDB(sesion.tenant, {
      type: "install-niche-content",
      payload: {},
      idempotencyKey: `install-niche-content:${request_id}`,
      maxAttempts: 5
    });
    return json(res, 202, { job: jobPublico(job) });
  }

  // GET /api/plan — estado del plan para la UI
  if (req.method === "GET" && ruta === "/api/plan") {
    return json(res, 200, await estadoPlan(sesion, { confirmar: url.searchParams.get("confirmar") === "1" }));
  }

  // POST /api/plan/suscribir — devuelve la URL de confirmación de Shopify
  if (req.method === "POST" && ruta === "/api/plan/suscribir") {
    const { request_id } = await leerCuerpo(req);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id || "")) {
      return json(res, 400, { error: "Falta un request_id valido para iniciar la suscripcion de forma segura" });
    }
    // The web admits the intent but the worker performs the Shopify mutation.
    // Refuse before enqueueing unless its latest non-secret heartbeat proves it
    // has the same billing mode and App Home handle as this web process.
    const billingWorker = await estadoBillingWorkerDB();
    if (!billingRuntimeCompatible(billingRuntimeContract(env), billingWorker)) {
      return json(res, 503, { error: "billing_worker_runtime_not_ready" }, { "Retry-After": "30" });
    }
    // Shopify no ofrece idempotency key para appSubscriptionCreate. Una llave
    // por request evita replays del mismo cliente, pero dos pestañas generan
    // llaves distintas; el bloqueo por tenant deja una única intención activa.
    const job = await encolarJobExclusivoDB(sesion.tenant, {
      type: "create-subscription",
      payload: { urlApp: URL_APP },
      idempotencyKey: `create-subscription:${request_id}`,
      maxAttempts: 2,
      allowSubscriptionRecovery: true
    });
    if (job?.status === "failed") {
      return json(res, 409, {
        error: "subscription_recovery_required",
        diagnostic: subscriptionRecoveryDiagnosticFromJob(job)
      });
    }
    return json(res, 202, { job: jobPublico(job) });
  }

  // POST /api/paginas — el botón "Crear página con IA"
  if (req.method === "POST" && ruta === "/api/paginas") {
    const { producto_id, idioma = "es", angulo = "", estilo = "clasico", request_id } = await leerCuerpo(req);
    if (!producto_id) return json(res, 400, { error: "Falta producto_id" });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id || "")) {
      return json(res, 400, { error: "Falta un request_id válido para generar de forma segura" });
    }

    // Validar antes de cupo/encolado. El worker vuelve a resolverlo como
    // defensa de profundidad para jobs ya persistidos o reenviados.
    resolveTemplateForCreation(estilo);

    const admissionPause = generationAdmissionPause(env);
    if (admissionPause.paused) {
      res.setHeader("Retry-After", String(admissionPause.retryAfter));
      return json(res, 503, { error: admissionPause.message, code: admissionPause.code });
    }

    const plan = await estadoPlan(sesion);
    const { job } = await encolarGeneracionDB(sesion.tenant, {
      payload: { productId: producto_id, idioma, angulo, estilo },
      idempotencyKey: `generate:${request_id}`,
      period: mesActual(),
      limit: plan.limite,
      maxAttempts: 3,
      maxPending: GENERATION_QUEUE_MAX_PER_TENANT,
      maxGlobalPending: GENERATION_QUEUE_MAX_GLOBAL
    });
    return json(res, 202, { job: jobPublico(job) });
  }

  // PUT /api/paginas/:id — el editor
  if (req.method === "PUT" && mGet) {
    const existente = await leerPagina(sesion.tenant, mGet[1]);
    if (!existente) return json(res, 404, { error: "No existe esa página" });
    if (existente.active_job_id) {
      const active = await leerJobDB(sesion.tenant, existente.active_job_id);
      if (active && ["queued", "running"].includes(active.status)) {
        return json(res, 409, { error: "La página se está publicando. Esperá a que termine antes de guardar nuevos cambios." });
      }
    }
    const { data } = await leerCuerpo(req);
    if (!data) return json(res, 400, { error: "Falta data" });
    existente.data = applyTemplateBoundEdit({
      persistedData: existente.data,
      submittedData: data
    });
    if (existente.estado === "publicada") existente.cambios_sin_publicar = true;
    await guardarPagina(sesion.tenant, existente);
    return json(res, 200, existente);
  }

  // POST /api/paginas/:id/imagenes — subir una foto de la compu al producto.
  // Entra al pool de la página y a Shopify como media del producto, así el
  // Liquid publicado la resuelve igual que a cualquier otra foto.
  const mImg = ruta.match(/^\/api\/paginas\/([^/]+)\/imagenes$/);
  if (req.method === "POST" && mImg) {
    const registro = await leerPagina(sesion.tenant, mImg[1]);
    if (!registro) return json(res, 404, { error: "No existe esa página" });
    const { nombre, mime, base64 } = await leerCuerpo(req, 15_000_000);
    if (!base64) return json(res, 400, { error: "Falta la imagen" });

    const { subirImagenProducto } = require("./imagenes");
    const { media_id, url } = await subirImagenProducto(
      sesion, registro.shopify_product_id, nombre, mime || "image/jpeg", base64
    );

    registro.data.pool_imagenes = registro.data.pool_imagenes || [];
    registro.data.pool_imagenes.push({ media_id, tipo: "producto_limpio" });
    registro.urls = { ...(registro.urls || {}), [media_id]: url };
    await guardarPagina(sesion.tenant, registro);
    return json(res, 200, { media_id, url });
  }

  // Subida directa de video (2 pasos, el binario no pasa por acá):
  // POST /api/paginas/:id/archivo-inicio → destino temporal en Shopify
  const mArchIni = ruta.match(/^\/api\/paginas\/([^/]+)\/archivo-inicio$/);
  if (req.method === "POST" && mArchIni) {
    const { nombre, mime, size } = await leerCuerpo(req);
    if (!mime || !size) return json(res, 400, { error: "Faltan datos del archivo" });
    // Videos, imágenes o GIFs: el muro de clientes acepta todo (los GIF/imagen
    // se renderizan como <img>, los videos como <video>).
    if (!/^(video|image)\//.test(mime)) return json(res, 400, { error: "Solo se pueden subir videos, imágenes o GIFs." });
    if (Number(size) > 200 * 1024 * 1024) return json(res, 400, { error: "El archivo supera los 200 MB." });
    const { crearDestinoArchivo } = require("./imagenes");
    const destino = await crearDestinoArchivo(sesion, nombre, mime, size);
    return json(res, 200, destino);
  }

  // POST /api/paginas/:id/archivo-fin → finaliza y devuelve la URL del CDN
  const mArchFin = ruta.match(/^\/api\/paginas\/([^/]+)\/archivo-fin$/);
  if (req.method === "POST" && mArchFin) {
    const { resourceUrl, mime } = await leerCuerpo(req);
    if (!resourceUrl) return json(res, 400, { error: "Falta resourceUrl" });
    const { finalizarArchivo } = require("./imagenes");
    return json(res, 200, await finalizarArchivo(sesion, resourceUrl, mime));
  }

  // POST /api/paginas/:id/publicar
  const mPub = ruta.match(/^\/api\/paginas\/([^/]+)\/publicar$/);
  if (req.method === "POST" && mPub) {
    const registro = await leerPagina(sesion.tenant, mPub[1]);
    if (!registro) return json(res, 404, { error: "No existe esa página" });
    const publication = await encolarPublicacionDB(sesion.tenant, registro.id, { maxAttempts: 3 });
    if (!publication) return json(res, 404, { error: "No existe esa página" });
    if (publication.conflict) return json(res, 409, { error: "La pagina tiene otra operacion en curso." });
    return json(res, 202, { job: jobPublico(publication.job) });
  }

  // POST /api/paginas/:id/despublicar — vuelve el producto a su página nativa
  // (saca el templateSuffix). El metafield queda para re-publicar sin regenerar.
  const mDespub = ruta.match(/^\/api\/paginas\/([^/]+)\/despublicar$/);
  if (req.method === "POST" && mDespub) {
    const registro = await leerPagina(sesion.tenant, mDespub[1]);
    if (!registro) return json(res, 404, { error: "No existe esa página" });
    const publication = await encolarDespublicacionDB(sesion.tenant, registro.id, { maxAttempts: 3 });
    if (publication.conflict) return json(res, 409, { error: "La pagina tiene otra operacion en curso." });
    return json(res, 202, { job: jobPublico(publication.job) });
  }

  return json(res, 404, { error: "Ruta desconocida" });
}

const CORS_PUB = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

// GET /publico/bundles?shop=xxx.myshopify.com — config pública de bundles para
// el widget del storefront (app embed). Sin secretos: solo activo + lista sin
// los discount_ids (esos los gestiona el server). Es lo mismo que hoy viaja
// embebido en el snippet de la inyección directa.
async function bundlesPublico(req, res, url) {
  if (req.method === "OPTIONS") return void res.writeHead(204, CORS_PUB).end();
  const responder = (codigo, cuerpo) => {
    res.writeHead(codigo, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=5, stale-while-revalidate=10",
      ...CORS_PUB
    });
    res.end(JSON.stringify(cuerpo));
  };
  try {
    const tienda = String(url.searchParams.get("shop") || "").toLowerCase().replace(/[^a-z0-9.\-]/g, "");
    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(tienda)) return responder(400, { activo: false, lista: [] });
    const cfg = configAplicadaBundles(await leerConfigBundles(tienda));
    const publicables = (cfg.lista || []).filter(bundleEsPublicable);
    const publico = {
      // El master activo se deriva de que haya al menos un bundle activo.
      activo: publicables.length > 0,
      lista: publicables.map((b) => {
        const { discount_ids, sync_status, sync_error, ...resto } = b;
        return resto;
      })
    };
    return responder(200, publico);
  } catch (e) {
    return responder(200, { activo: false, lista: [] });
  }
}

// ---------- servidor ----------

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, URL_APP);

  try {
    // --- instalación ---
    // Chequeo de vida. Sirve para el monitor externo que mantiene despierto
    // el proceso: si Render lo duerme, los webhooks de Shopify (5 s de
    // timeout) fallan y Shopify termina dando de baja las suscripciones.
    if (url.pathname === "/health") {
      return json(res, 200, { ok: true, ts: new Date().toISOString() });
    }
    if (url.pathname === "/ready") {
      const almacenamiento = await verificarAlmacenamientoDB();
      return json(res, 200, {
        ok: true,
        release: process.env.RENDER_GIT_COMMIT || null,
        almacenamiento: almacenamiento.tipo,
        aislamiento: almacenamiento.aislamiento || null,
        appRegistration: almacenamiento.appRegistration || null,
        ts: new Date().toISOString()
      });
    }
    if (url.pathname === "/ops/status") return await estadoOperativo(req, res);
    if (url.pathname === "/ops/billing-config") return await configuracionBillingOperativa(req, res);
    if (url.pathname === "/ops/shopify-certification") return await certificarShopifyStaging(req, res);
    if (await syntheticLoadHandler(req, res, url)) return;

    if (url.pathname === "/internal/shopify-token/refresh") return await brokerRefreshShopify(req, res);

    if (url.pathname === "/auth") return await iniciarInstalacion(res, url, URL_APP);
    if (url.pathname === "/auth/callback") return await terminarInstalacion(res, url);

    // --- webhooks de Shopify (desinstalación + privacidad) ---
    if (req.method === "POST" && url.pathname === "/webhooks") return await webhooks(req, res);

    // --- config pública de bundles (la trae el app embed del storefront) ---
    if (url.pathname === "/publico/bundles") return await bundlesPublico(req, res, url);

    // --- legales (públicas: van en la ficha del App Store) ---
    if (url.pathname === "/privacidad") return servirLegal(res, "privacidad.html");
    if (url.pathname === "/terminos") return servirLegal(res, "terminos.html");

    // --- app ---
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);

    // Código del storefront (widget de bundles). Lo usa el
    // preview del admin, y es EL MISMO archivo que publica el extension.
    if (url.pathname.startsWith("/widgets/")) {
      return servirEstatico(req, res, DIR_WIDGETS, url.pathname.replace(/^\/widgets\/?/, ""));
    }

    if (url.pathname.startsWith("/preview")) {
      const rel = url.pathname.replace(/^\/preview\/?/, "") || "index.html";
      // El index del preview referencia tiendaiq.css/js con ?v=…: le
      // inyectamos la versión viva para que tras un deploy baje lo nuevo.
      if (rel === "index.html") {
        const html = fs
          .readFileSync(path.join(DIR_PLANTILLA, "index.html"), "utf8")
          .replace(/(tiendaiq\.css|tiendaiq\.js)\?v=[\w.]+/g, `$1?v=${VERSION_ASSETS}`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        return res.end(html);
      }
      return servirEstatico(req, res, DIR_PLANTILLA, rel);
    }

    // Videos de "Inspírate de los mejores" (con Range, sin pase: los <video>
    // no pueden mandar Authorization). Van desde DIR_INSPIRACION.
    if (url.pathname.startsWith("/inspiracion-media/")) {
      return servirVideo(req, res, url.pathname.replace(/^\/inspiracion-media\/?/, ""));
    }

    // /paginas y /crear son rutas del frontend (el menú lateral del admin
    // navega por URL): sirven la misma app, que rutea por pathname.
    if (["/", "/app", "/index.html", "/paginas", "/crear", "/bundles", "/inspiracion"].includes(url.pathname))
      return servirIndex(res);

    return servirEstatico(req, res, DIR_APP, url.pathname);
  } catch (e) {
    // Token muerto = desinstalaron o rotaron. Se borra la tienda para que el
    // próximo ingreso la mande a reinstalar en vez de fallar para siempre.
    if (e.code === "TOKEN_INVALIDO") {
      const t = /(?:^|\s)([a-z0-9-]+\.myshopify\.com)/.exec(e.message)?.[1];
      if (t) await borrarTienda(t);
      return json(res, 401, { error: e.message, reinstalar: true });
    }
    if (e.code === "TIENDA_NO_INSTALADA") {
      return json(res, 401, { error: "La app necesita autorización para esta tienda.", reinstalar: true });
    }
    if (e.code === "SHOPIFY_REAUTH_REQUIRED") {
      res.setHeader("X-Shopify-Retry-Invalid-Session-Request", "1");
      return json(res, 401, { error: "La autorización de Shopify debe renovarse.", reinstalar: true });
    }
    // 401 = churn de auth esperado (token rotado/desinstalado): no es un bug.
    // El resto sí se reporta (console + Sentry si hay DSN), con e.detalle si lo
    // trae (respuesta cruda de Shopify/GraphQL, que NO va al cliente).
    if (e.status !== 401) reportarError(e, { donde: url.pathname, metodo: req.method, detalle: e.detalle });
    // Nunca filtrar internals: los errores con e.status son mensajes nuestros
    // (400/402/413…) y son seguros de mostrar; cualquier 5xx inesperado (incluye
    // mensajes crudos de Shopify/GraphQL o bugs) se responde genérico — el
    // detalle real ya quedó logueado arriba.
    const codigo = e.status || 500;
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    if (codigo >= 500 && e.expose) return json(res, codigo, { error: e.message });
    json(res, codigo, { error: codigo >= 500 ? "Ocurrió un error interno. Probá de nuevo en un momento." : e.message });
  }
});

// DEV_MODE saltea la verificación del pase y opera sobre la tienda del .env
// (ver resolverSesion). Es comodísimo en local y es un agujero abierto en
// producción: cualquiera con la URL manejaría esa tienda. Si hay DATABASE_URL
// estamos en el server de verdad, así que no arranca.
if (env.DEV_MODE === "1" && env.DATABASE_URL) {
  console.error("\n  ✖ DEV_MODE=1 con DATABASE_URL presente: eso saltea la autenticación en producción.");
  console.error("    Sacá DEV_MODE del panel del host y volvé a deployar.\n");
  process.exit(1);
}

// Un fallo no controlado deja el estado del proceso indeterminado. Se reporta,
// se drenan los recursos y se termina para que Render reemplace la instancia.
let cerrandoPorFallo = false;
async function cerrarPorFallo(error, tipo) {
  reportarError(error, { tipo });
  if (cerrandoPorFallo) return;
  cerrandoPorFallo = true;
  process.exitCode = 1;

  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref?.();
  try {
    await new Promise((resolve) => {
      if (!servidor.listening) return resolve();
      servidor.close(resolve);
    });
    if (servidor._tiendaiqWorker) await servidor._tiendaiqWorker.stop();
    await cerrarAlmacenamientoDB();
  } catch (closeError) {
    reportarError(closeError, { tipo: `${tipo}-shutdown` });
  } finally {
    process.exit(1);
  }
}

process.on("unhandledRejection", (error) => void cerrarPorFallo(error, "unhandledRejection"));
process.on("uncaughtException", (error) => void cerrarPorFallo(error, "uncaughtException"));

async function iniciarServidor({
  server = servidor,
  port = PUERTO,
  verificar = verificarAlmacenamientoDB,
  usaPostgres = Boolean(env.DATABASE_URL),
  iniciarWorkerLocal = null
} = {}) {
  // Antes de abrir un puerto HTTP, la instancia web con Postgres debe demostrar
  // que su registro Shopify coincide con la base. Así un client id de otra app
  // jamás puede consumir o escribir estado de tenants de esta base.
  if (usaPostgres) await verificar();

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off?.("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, () => {
      server.off?.("error", onError);
      resolve();
    });
  });

  const { USA_PG } = require("./db");
  console.log(`\n  TiendaIQ  →  ${URL_APP}`);
  console.log(`  almacén: ${USA_PG ? "Postgres" : "archivos (local)"}`);
  // Las legales son URLs públicas de la ficha del App Store: si les falta un
  // dato, el review lo devuelve. Se avisa en cada arranque hasta completarlas.
  const faltan = legalesIncompletos();
  if (faltan.length) {
    console.log(`  ⚠ legales incompletas (${faltan.join(", ")}) — se ven como "(pendiente)" en /privacidad y /terminos`);
    console.log(`    completar con EMAIL_SOPORTE / RAZON_SOCIAL / DOMICILIO en el entorno`);
  }

  if (!env.APP_URL) console.log(`  ⚠ falta APP_URL en .env — el OAuth no va a poder volver\n`);
  else if (env.DEV_MODE === "1") console.log(`  instalar local: ${URL_APP}/auth?shop=TIENDA.myshopify.com\n`);
  else console.log("  instalacion: iniciar desde Shopify Admin o el enlace oficial de Shopify\n");

  // En desarrollo por archivos no levantamos un segundo proceso: el mismo
  // server ejecuta el worker. Producción usa el servicio worker de Render.
  if (env.DEV_MODE === "1" && !USA_PG) {
    if (typeof iniciarWorkerLocal === "function") {
      await iniciarWorkerLocal(server);
      return server;
    }
    const localReleaseSha = "0".repeat(40);
    server._tiendaiqWorker = require("./src/jobs/runtime").createRuntime({
      workerId: `dev-web:${process.pid}`,
      releaseSha: localReleaseSha
    });
    server._tiendaiqWorker.start();
    console.log("  worker local: activo\n");
  }
  return server;
}

if (require.main === module) {
  iniciarServidor().catch(async (error) => {
    console.error(`Servidor detenido por preflight fallido: ${error.message}`);
    await cerrarAlmacenamientoDB().catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { servidor, iniciarServidor };
