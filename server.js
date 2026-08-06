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
const { listarProductos, crearPagina, editarTexto, escribirPreview } = require("./adaptador");
const { publicarPagina, despublicarPagina } = require("./publicar");
const { env, sesionDeEnv } = require("./shopify");
const { sesionDe, borrarTienda, listarTiendas } = require("./tiendas");
const { guardarPaginaDB, leerPaginaDB, listarPaginasDB } = require("./db");
const { iniciarInstalacion, terminarInstalacion, tiendaDelPase } = require("./auth");
const { nubeServible, urlVideo, urlPoster } = require("./inspiracion-nube");
const { estadoPlan, consumirCupo, revertirCupo, crearSuscripcion } = require("./facturacion");
const { reportarError, metrica } = require("./monitoreo");
const {
  leerConfigBundles,
  guardarConfigBundles,
  sincronizarDescuentos,
  borrarDescuentos
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
      path.join(dirWidgets, "tiendaiq.js"), path.join(dirWidgets, "tiendaiq.css")
    ];
    return Math.floor(Math.max(...archivos.map((a) => fs.statSync(a).mtimeMs))).toString(36);
  } catch {
    return Date.now().toString(36);
  }
})();
// Único hogar del código que corre en el storefront (widget de bundles). El
// theme app extension lo publica en el CDN de Shopify, y
// el server sirve LOS MISMOS archivos para el preview del admin y para la
// inyección directa. Una sola copia: no hay nada que sincronizar.
const DIR_WIDGETS = path.join(__dirname, "extensions", "tiendaiq-widgets", "assets");

// La URL pública por la que Shopify nos alcanza. En producción es la de Render;
// en local, el túnel. Sin esto el OAuth no puede volver.
const URL_APP = (env.APP_URL || `http://localhost:${PUERTO}`).replace(/\/$/, "");

// ---------- almacén de páginas, por tienda, vía db.js ----------

const idDePagina = (gid) => gid.split("/").pop(); // gid://shopify/Product/123 → 123

async function guardarPagina(tienda, registro) {
  registro.actualizado = new Date().toISOString();
  await guardarPaginaDB(tienda, registro.id, registro);
  return registro;
}
const leerPagina = (tienda, id) => leerPaginaDB(tienda, id);
const listarPaginas = (tienda) => listarPaginasDB(tienda);

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

const json = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(cuerpo));
};

// Cuerpo CRUDO (Buffer): los webhooks de Shopify se verifican con HMAC sobre
// los bytes exactos — parsear antes de verificar rompe la firma.
function leerCrudo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

// Dedup de webhooks: Shopify reintenta (hasta 8 veces) y puede entregar el
// mismo evento más de una vez. Hoy los handlers son idempotentes, pero registrar
// el `x-shopify-webhook-id` evita doble ejecución si se agrega uno con efectos.
// Map acotado con TTL en memoria: alcanza para una instancia (el deploy actual
// corre una sola); tras reinicio se pierde, sin consecuencia por ser idempotente.
const WEBHOOKS_VISTOS = new Map(); // id -> vence (ms)
const WEBHOOK_TTL = 10 * 60 * 1000;
const WEBHOOKS_MAX = 2000;
function webhookRepetido(id) {
  if (!id) return false;
  const ahora = Date.now();
  // Limpieza perezosa de vencidos + tope duro (evita fuga de memoria).
  if (WEBHOOKS_VISTOS.size > WEBHOOKS_MAX) {
    for (const [k, v] of WEBHOOKS_VISTOS) if (v < ahora) WEBHOOKS_VISTOS.delete(k);
    if (WEBHOOKS_VISTOS.size > WEBHOOKS_MAX) WEBHOOKS_VISTOS.clear();
  }
  const visto = WEBHOOKS_VISTOS.get(id);
  if (visto && visto > ahora) return true;
  WEBHOOKS_VISTOS.set(id, ahora + WEBHOOK_TTL);
  return false;
}

// POST /webhooks — desinstalación y pedidos de privacidad (GDPR).
// Shopify exige responder 200 a los de privacidad aunque no guardemos datos
// de clientes (no guardamos ninguno: solo tokens de tienda y páginas).
async function webhooks(req, res) {
  const crudo = await leerCrudo(req);
  const firma = req.headers["x-shopify-hmac-sha256"] || "";
  const esperada = require("crypto")
    .createHmac("sha256", env.SHOPIFY_CLIENT_SECRET)
    .update(crudo)
    .digest("base64");
  const a = Buffer.from(esperada), b = Buffer.from(firma);
  if (a.length !== b.length || !require("crypto").timingSafeEqual(a, b)) {
    return void res.writeHead(401).end();
  }

  // Repetido (reintento de Shopify): ya lo procesamos → 200 y cortar, así deja
  // de reintentar. Va DESPUÉS del HMAC para no dejar registrar ids sin firmar.
  if (webhookRepetido(req.headers["x-shopify-webhook-id"] || "")) {
    return void res.writeHead(200).end();
  }

  const topico = req.headers["x-shopify-topic"] || "";
  const tienda = req.headers["x-shopify-shop-domain"] || "";

  if (topico === "app/uninstalled" && tienda) {
    await borrarTienda(tienda);
    console.log(`  ✖ desinstalada · ${tienda}`);
  }

  // Cambió el estado de la suscripción (cancelada, vencida, congelada,
  // reactivada): se refleja en el plan al instante.
  if (topico === "app_subscriptions/update" && tienda) {
    try {
      const { actualizarPlanDesdeWebhook } = require("./facturacion");
      const plan = await actualizarPlanDesdeWebhook(tienda, JSON.parse(crudo.toString("utf8")));
      if (plan) console.log(`  ⟳ plan ${plan} · ${tienda}`);
    } catch (e) {
      console.error("✖ webhook suscripción:", e.message);
    }
  }
  // customers/data_request, customers/redact, shop/redact:
  // no almacenamos datos de clientes finales — 200 alcanza.
  res.writeHead(200).end();
}

function leerCuerpo(req, limite = 1_000_000) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let bytes = 0;
    // Tope de 1 MB por defecto: sin esto cualquiera
    // nos infla la memoria. La subida de imágenes pasa un límite mayor.
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
    return sesionDeEnv();
  }

  if (!pase) {
    const e = new Error("Falta el pase de sesión");
    e.status = 401;
    throw e;
  }
  try {
    return await sesionDe(tiendaDelPase(pase)); // firma → dominio → token guardado
  } catch (err) {
    err.status = 401;
    throw err;
  }
}

// ---------- api ----------

async function api(req, res, url) {
  const ruta = url.pathname;
  const sesion = await resolverSesion(req);

  // GET /api/productos
  if (req.method === "GET" && ruta === "/api/productos") {
    const productos = await listarProductos(sesion);
    const paginas = Object.fromEntries((await listarPaginas(sesion.tienda)).map((p) => [p.id, p.estado]));
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

  // GET /api/paginas — resumen para el inicio y la tabla de páginas
  // (no toca Shopify, solo DB)
  if (req.method === "GET" && ruta === "/api/paginas") {
    // listarPaginas ya devuelve el resumen proyectado (id/estado/título/imagen/…),
    // no el JSONB entero de cada página.
    return json(res, 200, await listarPaginas(sesion.tienda));
  }

  // GET /api/pagina-estado — ¿las páginas publicadas se ven en la tienda?
  // Verifica la última publicada fetcheando su HTML público (sin tocar el tema).
  // Alimenta el banner persistente que avisa si falta activar la plantilla.
  if (req.method === "GET" && ruta === "/api/pagina-estado") {
    const ps = await listarPaginas(sesion.tienda);
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
    const p = await leerPagina(sesion.tienda, mGet[1]);
    return p ? json(res, 200, p) : json(res, 404, { error: "No existe esa página" });
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

  // PUT /api/bundles — guardar la config. Re-sincroniza los descuentos
  // automáticos (borra los viejos, crea los nuevos) y, si ya está inyectado,
  // re-sube el snippet con la config nueva.
  if (req.method === "PUT" && ruta === "/api/bundles") {
    const { config } = await leerCuerpo(req);
    if (!config) return json(res, 400, { error: "Falta config" });

    const actual = await leerConfigBundles(sesion.tienda);
    config.instalado = actual.instalado; // no se pisa desde el browser
    // Los discount_ids los manda el server: arrancamos de lo guardado para
    // poder borrar los descuentos viejos aunque el browser no los tenga.
    config.lista = (config.lista || []).map((b) => {
      const previo = actual.lista.find((x) => x.id === b.id);
      return { ...b, discount_ids: previo ? previo.discount_ids : [] };
    });

    // Bundles que el merchant eliminó: hay que borrar SUS descuentos en Shopify
    // (el sync solo recorre los que quedan, así que quedarían huérfanos).
    const idsQueQuedan = new Set(config.lista.map((b) => b.id));
    for (const viejo of actual.lista) {
      if (!idsQueQuedan.has(viejo.id) && viejo.discount_ids?.length) {
        await borrarDescuentos(sesion, viejo.discount_ids);
      }
    }

    config.activo = (config.lista || []).some((b) => b.activo !== false); // master derivado
    await sincronizarDescuentos(sesion, config); // muta discount_ids
    await guardarConfigBundles(sesion.tienda, config);
    // Ya NO re-escribimos el snippet en el tema: la config viaja EN VIVO por
    // /publico/bundles (app embed). Compliance App Store: cero escritura al tema.
    return json(res, 200, config);
  }

  // GET /api/bundles/metricas — números reales calculados sobre los pedidos
  // que traen aplicado alguno de nuestros descuentos.
  if (req.method === "GET" && ruta === "/api/bundles/metricas") {
    const { metricasBundles } = require("./bundles");
    let dias = 30;
    try { const d = Number(new URL(req.url, "http://x").searchParams.get("dias")); if ([7, 30, 90].includes(d)) dias = d; } catch {}
    return json(res, 200, await metricasBundles(sesion, dias));
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
    const { montarContenidoNicho } = require("./contenido");
    return json(res, 200, { ok: true, resultado: await montarContenidoNicho(sesion) });
  }

  // GET /api/plan — estado del plan para la UI
  if (req.method === "GET" && ruta === "/api/plan") {
    return json(res, 200, await estadoPlan(sesion));
  }

  // POST /api/plan/suscribir — devuelve la URL de confirmación de Shopify
  if (req.method === "POST" && ruta === "/api/plan/suscribir") {
    const urlConfirmacion = await crearSuscripcion(sesion, URL_APP);
    return json(res, 200, { url: urlConfirmacion });
  }

  // POST /api/paginas — el botón "Crear página con IA"
  if (req.method === "POST" && ruta === "/api/paginas") {
    const { producto_id, idioma = "es", angulo = "", estilo = "clasico" } = await leerCuerpo(req);
    if (!producto_id) return json(res, 400, { error: "Falta producto_id" });

    // Reserva ATÓMICA del cupo ANTES de generar (402 si no queda). Si la
    // generación falla después, se devuelve la página reservada.
    await consumirCupo(sesion);

    const t0 = Date.now();
    let generado;
    try {
      generado = await crearPagina(producto_id, sesion, { idioma, angulo, estilo });
    } catch (e) {
      await revertirCupo(sesion); // la generación falló → no cobrar la página
      throw e;
    }
    const { data, urls, avisos, uso } = generado;

    const registro = await guardarPagina(sesion.tienda, {
      id: idDePagina(producto_id),
      shopify_product_id: producto_id,
      estado: "borrador", // nace inactiva, como PagePilot
      data,
      urls,
      avisos,
      url_publica: null
    });

    return json(res, 200, { ...registro, segundos: (Date.now() - t0) / 1000, uso });
  }

  // POST /api/texto/editar — asistente puntual del editor de páginas.
  if (req.method === "POST" && ruta === "/api/texto/editar") {
    const { texto = "", instrucciones = "", modo = "rewrite", idioma = "es", contexto = "" } = await leerCuerpo(req);
    if (String(texto).length > 12000) return json(res, 400, { error: "El texto es demasiado largo para editarlo en una sola vez." });
    const salida = await editarTexto({ texto, instrucciones, modo, idioma, contexto });
    return json(res, 200, { texto: salida });
  }

  // PUT /api/paginas/:id — el editor
  if (req.method === "PUT" && mGet) {
    const existente = await leerPagina(sesion.tienda, mGet[1]);
    if (!existente) return json(res, 404, { error: "No existe esa página" });
    const { data } = await leerCuerpo(req);
    if (!data) return json(res, 400, { error: "Falta data" });
    existente.data = data;
    await guardarPagina(sesion.tienda, existente);
    return json(res, 200, existente);
  }

  // POST /api/paginas/:id/imagenes — subir una foto de la compu al producto.
  // Entra al pool de la página y a Shopify como media del producto, así el
  // Liquid publicado la resuelve igual que a cualquier otra foto.
  const mImg = ruta.match(/^\/api\/paginas\/([^/]+)\/imagenes$/);
  if (req.method === "POST" && mImg) {
    const registro = await leerPagina(sesion.tienda, mImg[1]);
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
    await guardarPagina(sesion.tienda, registro);
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
    const registro = await leerPagina(sesion.tienda, mPub[1]);
    if (!registro) return json(res, 404, { error: "No existe esa página" });
    const { url } = await publicarPagina(registro.data, sesion);
    const yaEstaba = registro.estado === "publicada";
    registro.estado = "publicada";
    registro.url_publica = url;
    await guardarPagina(sesion.tienda, registro);
    metrica("pagina_publicada", { tienda: sesion.tienda, republicacion: yaEstaba });
    // Verificamos si la landing se ve DE VERDAD (o si cae al producto nativo
    // porque falta la plantilla) + deep link al editor. No se persiste: es para
    // la pantalla de éxito. La app NO escribe el tema, solo lo mira desde afuera.
    registro.paginaEstado = await verificarUrlViva(url);
    registro.setupPaginaUrl = linkEditorPagina(sesion.tienda);
    return json(res, 200, registro);
  }

  // POST /api/paginas/:id/despublicar — vuelve el producto a su página nativa
  // (saca el templateSuffix). El metafield queda para re-publicar sin regenerar.
  const mDespub = ruta.match(/^\/api\/paginas\/([^/]+)\/despublicar$/);
  if (req.method === "POST" && mDespub) {
    const registro = await leerPagina(sesion.tienda, mDespub[1]);
    if (!registro) return json(res, 404, { error: "No existe esa página" });
    await despublicarPagina(registro.data, sesion);
    registro.estado = "borrador";
    registro.url_publica = null;
    await guardarPagina(sesion.tienda, registro);
    metrica("pagina_despublicada", { tienda: sesion.tienda });
    return json(res, 200, registro);
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
      "Cache-Control": "public, max-age=60",
      ...CORS_PUB
    });
    res.end(JSON.stringify(cuerpo));
  };
  try {
    const tienda = String(url.searchParams.get("shop") || "").toLowerCase().replace(/[^a-z0-9.\-]/g, "");
    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(tienda)) return responder(400, { activo: false, lista: [] });
    const cfg = await leerConfigBundles(tienda);
    return responder(200, {
      // El master activo se deriva de que haya al menos un bundle activo.
      activo: (cfg.lista || []).some((b) => b.activo !== false),
      lista: (cfg.lista || []).map((b) => {
        const { discount_ids, ...resto } = b;
        return resto;
      })
    });
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

    // Prototipos independientes de plantillas: se diseñan y validan antes de
    // conectarlos al renderer, editor y publicación de TiendaIQ.
    if (url.pathname.startsWith("/prototipos/")) {
      const solicitado = url.pathname.replace(/^\/prototipos\/?/, "");
      const rel = solicitado ? (solicitado.endsWith("/") ? `${solicitado}index.html` : solicitado) : "plantilla-01/index.html";
      return servirEstatico(req, res, path.join(__dirname, "prototipos"), rel);
    }

    // Videos de "Inspírate de los mejores" (con Range, sin pase: los <video>
    // no pueden mandar Authorization). Van desde DIR_INSPIRACION.
    if (url.pathname.startsWith("/inspiracion-media/")) {
      return servirVideo(req, res, url.pathname.replace(/^\/inspiracion-media\/?/, ""));
    }

    // /paginas y /crear son rutas del frontend (el menú lateral del admin
    // navega por URL): sirven la misma app, que rutea por pathname.
    if (["/", "/index.html", "/paginas", "/crear", "/bundles", "/inspiracion"].includes(url.pathname))
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
    // 401 = churn de auth esperado (token rotado/desinstalado): no es un bug.
    // El resto sí se reporta (console + Sentry si hay DSN), con e.detalle si lo
    // trae (respuesta cruda de Shopify/GraphQL, que NO va al cliente).
    if (e.status !== 401) reportarError(e, { donde: url.pathname, metodo: req.method, detalle: e.detalle });
    // Nunca filtrar internals: los errores con e.status son mensajes nuestros
    // (400/402/413…) y son seguros de mostrar; cualquier 5xx inesperado (incluye
    // mensajes crudos de Shopify/GraphQL o bugs) se responde genérico — el
    // detalle real ya quedó logueado arriba.
    const codigo = e.status || 500;
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

// Una promesa rechazada fuera de un try/catch tumba el proceso Node entero.
// En Render eso es caída silenciosa: se loguea y se sigue viviendo.
process.on("unhandledRejection", (e) => {
  reportarError(e, { tipo: "unhandledRejection" });
});
process.on("uncaughtException", (e) => {
  reportarError(e, { tipo: "uncaughtException" });
});

servidor.listen(PUERTO, async () => {
  const { USA_PG } = require("./db");
  let tiendas = [];
  try { tiendas = await listarTiendas(); } catch (e) { console.error("  ⚠ base:", e.message); }
  console.log(`\n  TiendaIQ  →  ${URL_APP}`);
  console.log(`  almacén: ${USA_PG ? "Postgres" : "archivos (local)"}`);
  console.log(`  tiendas instaladas: ${tiendas.length}${tiendas.length ? " · " + tiendas.map((t) => t.dominio).join(", ") : ""}`);
  // Las legales son URLs públicas de la ficha del App Store: si les falta un
  // dato, el review lo devuelve. Se avisa en cada arranque hasta completarlas.
  const faltan = legalesIncompletos();
  if (faltan.length) {
    console.log(`  ⚠ legales incompletas (${faltan.join(", ")}) — se ven como "(pendiente)" en /privacidad y /terminos`);
    console.log(`    completar con EMAIL_SOPORTE / RAZON_SOCIAL / DOMICILIO en el entorno`);
  }

  if (!env.APP_URL) console.log(`  ⚠ falta APP_URL en .env — el OAuth no va a poder volver\n`);
  else console.log(`  instalar: ${URL_APP}/auth?shop=TIENDA.myshopify.com\n`);
});
