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

// Render (y cualquier host) fija el puerto por env; local usa 4321.
const PUERTO = Number(env.PORT || process.env.PORT || 4321);
const DIR_APP = path.join(__dirname, "app");
const DIR_PLANTILLA = path.join(__dirname, "plantilla-producto");

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

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
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
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo).toLowerCase()] || "application/octet-stream" });
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
        estado: paginas[idDePagina(p.id)] ?? null
      }))
    );
  }

  // GET /api/paginas/:id
  const mGet = ruta.match(/^\/api\/paginas\/([^/]+)$/);
  if (req.method === "GET" && mGet) {
    const p = await leerPagina(sesion.tienda, mGet[1]);
    return p ? json(res, 200, p) : json(res, 404, { error: "No existe esa página" });
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

// ---------- servidor ----------

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, URL_APP);

  try {
    // --- instalación ---
    if (url.pathname === "/auth") return iniciarInstalacion(res, url, URL_APP);
    if (url.pathname === "/auth/callback") return await terminarInstalacion(res, url);

    // --- webhooks de Shopify (desinstalación + privacidad) ---
    if (req.method === "POST" && url.pathname === "/webhooks") return await webhooks(req, res);

    // --- app ---
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);

    if (url.pathname.startsWith("/preview")) {
      const rel = url.pathname.replace(/^\/preview\/?/, "") || "index.html";
      return servirEstatico(res, DIR_PLANTILLA, rel);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") return servirIndex(res);

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
