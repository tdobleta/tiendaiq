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
const { listarProductos, crearPagina, escribirPreview } = require("./adaptador");
const { publicarPagina } = require("./publicar");
const { env, sesionDeEnv } = require("./shopify");
const { sesionDe, borrarTienda, listarTiendas } = require("./tiendas");
const { guardarPaginaDB, leerPaginaDB, listarPaginasDB } = require("./db");
const { iniciarInstalacion, terminarInstalacion, tiendaDelPase } = require("./auth");
const { estadoPlan, exigirCupo, contarUso, crearSuscripcion } = require("./facturacion");
const { leerConfigCod, guardarConfigCod, instalarCod, actualizarSnippet, crearPedidoCod } = require("./cod");
const {
  leerConfigBundles,
  guardarConfigBundles,
  sincronizarDescuentos,
  borrarDescuentos,
  instalarBundles,
  actualizarSnippet: actualizarSnippetBundle
} = require("./bundles");

// Render (y cualquier host) fija el puerto por env; local usa 4321.
const PUERTO = Number(env.PORT || process.env.PORT || 4321);
const DIR_APP = path.join(__dirname, "app");
const DIR_PLANTILLA = path.join(__dirname, "plantilla-producto");
const DIR_COD = path.join(__dirname, "cod-form");
const DIR_BUNDLE = path.join(__dirname, "bundle-form");

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

  const topico = req.headers["x-shopify-topic"] || "";
  const tienda = req.headers["x-shopify-shop-domain"] || "";

  if (topico === "app/uninstalled" && tienda) {
    await borrarTienda(tienda);
    console.log(`  ✖ desinstalada · ${tienda}`);
  }
  // customers/data_request, customers/redact, shop/redact:
  // no almacenamos datos de clientes finales — 200 alcanza.
  res.writeHead(200).end();
}

function leerCuerpo(req, limite = 1_000_000) {
  return new Promise((resolve, reject) => {
    let d = "";
    // Tope de 1 MB por defecto: /cod/pedido es público y sin esto cualquiera
    // nos infla la memoria. La subida de imágenes pasa un límite mayor.
    req.on("data", (c) => {
      d += c;
      if (d.length > limite) {
        reject(Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        reject(new Error("Cuerpo JSON inválido"));
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
  ".svg": "image/svg+xml"
};

function servirIndex(res) {
  const html = fs
    .readFileSync(path.join(DIR_APP, "index.html"), "utf8")
    .replace("{{SHOPIFY_CLIENT_ID}}", env.SHOPIFY_CLIENT_ID || "");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    // Sin esto el admin de Shopify no puede meter la app en su iframe.
    "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com"
  });
  res.end(html);
}

function servirEstatico(res, base, rel) {
  // decodeURIComponent: los avatares traen espacios en el nombre.
  const limpio = path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, "");
  const archivo = path.join(base, limpio);
  if (!archivo.startsWith(base) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404).end("no encontrado");
    return;
  }
  res.writeHead(200, {
    "Content-Type": TIPOS[path.extname(archivo).toLowerCase()] || "application/octet-stream",
    // Sin esto el navegador se queda con app.js/css viejos después de un
    // deploy y "los cambios no aparecen". no-cache = revalidar siempre.
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
        estado: paginas[idDePagina(p.id)] ?? null
      }))
    );
  }

  // GET /api/paginas — resumen para el inicio y la tabla de páginas
  // (no toca Shopify, solo DB)
  if (req.method === "GET" && ruta === "/api/paginas") {
    const ps = await listarPaginas(sesion.tienda);
    return json(
      res,
      200,
      ps.map((p) => {
        const galeria = p.data?.facetas?.hero?.galeria || [];
        return {
          id: p.id,
          shopify_product_id: p.shopify_product_id || null,
          estado: p.estado,
          url_publica: p.url_publica || null,
          titulo: p.data?.facetas?.hero?.titulo || null,
          imagen: (galeria.length && p.urls?.[galeria[0]]) || null,
          actualizado: p.actualizado || null
        };
      })
    );
  }

  // GET /api/paginas/:id
  const mGet = ruta.match(/^\/api\/paginas\/([^/]+)$/);
  if (req.method === "GET" && mGet) {
    const p = await leerPagina(sesion.tienda, mGet[1]);
    return p ? json(res, 200, p) : json(res, 404, { error: "No existe esa página" });
  }

  // GET /api/cod — la config del formulario contra reembolso
  if (req.method === "GET" && ruta === "/api/cod") {
    return json(res, 200, await leerConfigCod(sesion.tienda));
  }

  // PUT /api/cod — guardar la config. Si ya está inyectado en el tema,
  // re-sube el snippet (la config viaja adentro) para que la tienda la vea.
  if (req.method === "PUT" && ruta === "/api/cod") {
    const { config } = await leerCuerpo(req);
    if (!config) return json(res, 400, { error: "Falta config" });
    config.instalado = (await leerConfigCod(sesion.tienda)).instalado; // no se pisa desde el browser
    await guardarConfigCod(sesion.tienda, config);
    if (config.instalado) {
      await actualizarSnippet(sesion, config, URL_APP);
      // Footgun conocido: guardar desde un server local re-sube el snippet
      // apuntando al APP_URL local. En la tienda REAL tiene que ser el de
      // producción — este log lo hace visible al instante.
      if (env.DEV_MODE === "1") console.log(`  ⚠ snippet COD re-subido apuntando a ${URL_APP} (server local)`);
    }
    return json(res, 200, config);
  }

  // POST /api/cod/imagen — imagen para un elemento del formulario COD
  // (va a Files de la tienda; devuelve la URL del CDN de Shopify)
  if (req.method === "POST" && ruta === "/api/cod/imagen") {
    const { nombre, mime, base64 } = await leerCuerpo(req, 15_000_000);
    if (!base64) return json(res, 400, { error: "Falta la imagen" });
    const { subirImagenTienda } = require("./imagenes");
    return json(res, 200, await subirImagenTienda(sesion, nombre, mime || "image/jpeg", base64));
  }

  // POST /api/cod/instalar — inyecta (o re-inyecta) el formulario en el tema
  if (req.method === "POST" && ruta === "/api/cod/instalar") {
    const config = await leerConfigCod(sesion.tienda);
    const { tema } = await instalarCod(sesion, config, URL_APP);
    config.instalado = { tema, fecha: new Date().toISOString() };
    await guardarConfigCod(sesion.tienda, config);
    return json(res, 200, config);
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

    await sincronizarDescuentos(sesion, config); // muta discount_ids
    await guardarConfigBundles(sesion.tienda, config);

    if (config.instalado) {
      await actualizarSnippetBundle(sesion, config, URL_APP);
      if (env.DEV_MODE === "1") console.log(`  ⚠ snippet Bundle re-subido apuntando a ${URL_APP} (server local)`);
    }
    return json(res, 200, config);
  }

  // POST /api/bundles/instalar — inyecta (o re-inyecta) el widget en el tema
  if (req.method === "POST" && ruta === "/api/bundles/instalar") {
    const config = await leerConfigBundles(sesion.tienda);
    const { tema } = await instalarBundles(sesion, config, URL_APP);
    config.instalado = { tema, fecha: new Date().toISOString() };
    await guardarConfigBundles(sesion.tienda, config);
    return json(res, 200, config);
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
    const { producto_id, idioma = "es", angulo = "" } = await leerCuerpo(req);
    if (!producto_id) return json(res, 400, { error: "Falta producto_id" });

    await exigirCupo(sesion); // 402 si agotó las gratis y no es pro

    const t0 = Date.now();
    const { data, urls, avisos, uso } = await crearPagina(producto_id, sesion, { idioma, angulo });

    const registro = await guardarPagina(sesion.tienda, {
      id: idDePagina(producto_id),
      shopify_product_id: producto_id,
      estado: "borrador", // nace inactiva, como PagePilot
      data,
      urls,
      avisos,
      url_publica: null
    });

    await contarUso(sesion);
    return json(res, 200, { ...registro, segundos: (Date.now() - t0) / 1000, uso });
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
    if (!/^video\//.test(mime)) return json(res, 400, { error: "Solo se pueden subir videos." });
    if (Number(size) > 200 * 1024 * 1024) return json(res, 400, { error: "El video supera los 200 MB." });
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
    registro.estado = "publicada";
    registro.url_publica = url;
    await guardarPagina(sesion.tienda, registro);
    return json(res, 200, registro);
  }

  return json(res, 404, { error: "Ruta desconocida" });
}

// ---------- pedido COD (público, viene de la tienda del merchant) ----------

// Rate limit mínimo: por IP+tienda, 10 pedidos cada 10 minutos. Suficiente
// para frenar un script tonto sin molestar a una tienda real.
const ventanaCod = new Map();
function pasaRateLimit(clave) {
  const ahora = Date.now();
  const marcas = (ventanaCod.get(clave) || []).filter((t) => ahora - t < 10 * 60 * 1000);
  if (marcas.length >= 10) return false;
  marcas.push(ahora);
  ventanaCod.set(clave, marcas);
  if (ventanaCod.size > 5000) ventanaCod.clear(); // que no crezca infinito
  return true;
}

const CORS_COD = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

async function pedidoCod(req, res) {
  if (req.method === "OPTIONS") {
    return void res.writeHead(204, CORS_COD).end();
  }
  const responder = (codigo, cuerpo) => {
    res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8", ...CORS_COD });
    res.end(JSON.stringify(cuerpo));
  };
  try {
    const pedido = await leerCuerpo(req);
    const tienda = String(pedido.tienda || "");
    const sesion = await sesionDe(tienda); // tira si la tienda no está instalada

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "?";
    if (!pasaRateLimit(`${sesion.tienda}|${ip}`)) {
      return responder(429, { ok: false, error: "Demasiados intentos. Probá de nuevo en unos minutos." });
    }

    const { orden } = await crearPedidoCod(sesion, pedido);
    console.log(`  🛵 pedido COD ${orden} · ${sesion.tienda}`);
    return responder(200, { ok: true, orden });
  } catch (e) {
    console.error("✖ pedido COD:", e.message);
    return responder(400, { ok: false, error: e.message });
  }
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
      activo: cfg.activo,
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
    if (url.pathname === "/auth") return iniciarInstalacion(res, url, URL_APP);
    if (url.pathname === "/auth/callback") return await terminarInstalacion(res, url);

    // --- webhooks de Shopify (desinstalación + privacidad) ---
    if (req.method === "POST" && url.pathname === "/webhooks") return await webhooks(req, res);

    // --- pedido COD desde la tienda del merchant (público, con CORS) ---
    if (url.pathname === "/cod/pedido") return await pedidoCod(req, res);

    // --- config pública de bundles (la trae el app embed del storefront) ---
    if (url.pathname === "/publico/bundles") return await bundlesPublico(req, res, url);

    // TEMPORAL: monta el contenido del nicho (páginas) en una tienda, usando su
    // sesión de la DB. Gated por el secreto de la app. Se borra cuando la
    // inyección llame a montarContenidoNicho() directo en su flujo.
    if (url.pathname === "/_nicho/contenido") {
      if (url.searchParams.get("key") !== env.SHOPIFY_CLIENT_SECRET) return json(res, 403, { error: "no autorizado" });
      const sesion = await sesionDe(url.searchParams.get("shop") || "");
      const { montarContenidoNicho } = require("./contenido");
      return json(res, 200, { ok: true, resultado: await montarContenidoNicho(sesion) });
    }

    // --- app ---
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);

    // Assets del formulario COD (la app del admin los usa para el preview).
    if (url.pathname.startsWith("/cod-form/")) {
      return servirEstatico(res, DIR_COD, url.pathname.replace(/^\/cod-form\/?/, ""));
    }

    // Assets del widget de bundles (para el preview en el admin).
    if (url.pathname.startsWith("/bundle-form/")) {
      return servirEstatico(res, DIR_BUNDLE, url.pathname.replace(/^\/bundle-form\/?/, ""));
    }

    if (url.pathname.startsWith("/preview")) {
      const rel = url.pathname.replace(/^\/preview\/?/, "") || "index.html";
      return servirEstatico(res, DIR_PLANTILLA, rel);
    }

    // /paginas y /crear son rutas del frontend (el menú lateral del admin
    // navega por URL): sirven la misma app, que rutea por pathname.
    if (["/", "/index.html", "/paginas", "/crear", "/cod", "/bundles"].includes(url.pathname))
      return servirIndex(res);

    return servirEstatico(res, DIR_APP, url.pathname);
  } catch (e) {
    // Token muerto = desinstalaron o rotaron. Se borra la tienda para que el
    // próximo ingreso la mande a reinstalar en vez de fallar para siempre.
    if (e.code === "TOKEN_INVALIDO") {
      const t = /(?:^|\s)([a-z0-9-]+\.myshopify\.com)/.exec(e.message)?.[1];
      if (t) await borrarTienda(t);
      return json(res, 401, { error: e.message, reinstalar: true });
    }
    if (e.status !== 401) console.error("✖", e.message);
    json(res, e.status || 500, { error: e.message });
  }
});

servidor.listen(PUERTO, async () => {
  const { USA_PG } = require("./db");
  let tiendas = [];
  try { tiendas = await listarTiendas(); } catch (e) { console.error("  ⚠ base:", e.message); }
  console.log(`\n  TiendaIQ  →  ${URL_APP}`);
  console.log(`  almacén: ${USA_PG ? "Postgres" : "archivos (local)"}`);
  console.log(`  tiendas instaladas: ${tiendas.length}${tiendas.length ? " · " + tiendas.map((t) => t.dominio).join(", ") : ""}`);
  if (!env.APP_URL) console.log(`  ⚠ falta APP_URL en .env — el OAuth no va a poder volver\n`);
  else console.log(`  instalar: ${URL_APP}/auth?shop=TIENDA.myshopify.com\n`);
});
