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
const { leerConfigCod, guardarConfigCod, crearPedidoCod } = require("./cod");
const {
  leerConfigBundles,
  guardarConfigBundles,
  sincronizarDescuentos,
  borrarDescuentos
} = require("./bundles");
const { catalogoPublico, instalarSeccion, seccionInstalada } = require("./secciones");

// Render (y cualquier host) fija el puerto por env; local usa 4321.
const PUERTO = Number(env.PORT || process.env.PORT || 4321);
const DIR_APP = path.join(__dirname, "app");
const DIR_PLANTILLA = path.join(__dirname, "plantilla-producto");

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
// Único hogar del código que corre en el storefront (widget de bundles y
// formulario COD). El theme app extension lo publica en el CDN de Shopify, y
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

// Preactiva un app embed (COD/Bundles) en el editor: además de abrir el panel
// de "Incrustaciones de apps", deja el toggle del bloque listo para prender.
const linkActivarEmbed = (tienda, handle) =>
  `https://${tienda}/admin/themes/current/editor?context=apps&activateAppId=${CLIENT_ID}/${handle}`;

// ¿La landing de producto se ve DE VERDAD en la tienda? En vez de leer el tema
// (scope que Shopify no otorga), fetcheamos el HTML público del producto y
// buscamos el marcador del app block. Devuelve:
//   true  → la landing se está pintando (plantilla activa)
//   false → cae al producto nativo (el merchant no creó/activó la plantilla)
//   null  → no se pudo verificar (timeout, tienda con contraseña, sin URL)
const cacheViva = new Map(); // url -> { t, v }
async function verificarUrlViva(url) {
  if (!url) return null;
  const c = cacheViva.get(url);
  if (c && Date.now() - c.t < 60 * 1000) return c.v;
  let v = null;
  try {
    const señal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined;
    const r = await fetch(url, { redirect: "follow", signal: señal });
    // Tienda con contraseña: la storefront redirige a /password (200) sin el
    // marcador. Eso NO es "no se ve" — es "no verificable" (null), no false.
    const esPassword = /\/password(\/|\?|$)/.test(r.url || "");
    if (r.ok && !esPassword) {
      const html = await r.text();
      v = html.includes("TIENDAIQ_DATA");
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
      configurado: pub ? await verificarUrlViva(pub.url_publica) : null,
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
    // Ya NO re-escribimos el snippet en el tema: la config viaja EN VIVO por
    // /publico/cod (app embed). Compliance App Store: cero escritura directa al tema.
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

  // POST /api/cod/instalar — YA NO inyecta código en el tema (compliance: Shopify
  // exige app embed). Marca "publicado" y devuelve el link para activar el app
  // embed en el editor de temas. La config ya viaja en vivo por /publico/cod.
  if (req.method === "POST" && ruta === "/api/cod/instalar") {
    const config = await leerConfigCod(sesion.tienda);
    config.instalado = { fecha: new Date().toISOString() };
    await guardarConfigCod(sesion.tienda, config);
    config.activarUrl = linkActivarEmbed(sesion.tienda, "cod");
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

  // GET /api/secciones — catálogo de secciones (para la galería estilo Section
  // Store) + si la pidas con ?tipo=, si esa sección ya está escrita en el tema.
  if (req.method === "GET" && ruta === "/api/secciones") {
    const tipo = url.searchParams.get("tipo");
    if (tipo) {
      let instalada = null;
      try { instalada = await seccionInstalada(sesion, tipo); } catch { instalada = null; }
      return json(res, 200, { instalada });
    }
    return json(res, 200, { catalogo: catalogoPublico() });
  }

  // POST /api/secciones/instalar — escribe la section Liquid + assets en el tema
  // principal (write_themes). Después el merchant la agrega desde el editor de
  // temas ("Agregar sección"), que es donde Shopify dibuja el panel nativo.
  if (req.method === "POST" && ruta === "/api/secciones/instalar") {
    const { tipo } = await leerCuerpo(req);
    if (!tipo) return json(res, 400, { error: "Falta tipo" });
    const r = await instalarSeccion(sesion, tipo);
    // Deep link al editor de temas con la sección preseleccionada para agregar.
    const editorUrl = `https://${sesion.tienda}/admin/themes/current/editor?template=product&addSectionId=${encodeURIComponent(tipo)}`;
    return json(res, 200, { ok: true, tema: r.tema, tipo, editorUrl });
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
    registro.estado = "publicada";
    registro.url_publica = url;
    await guardarPagina(sesion.tienda, registro);
    // Verificamos si la landing se ve DE VERDAD (o si cae al producto nativo
    // porque falta la plantilla) + deep link al editor. No se persiste: es para
    // la pantalla de éxito. La app NO escribe el tema, solo lo mira desde afuera.
    registro.paginaViva = await verificarUrlViva(url);
    registro.setupPaginaUrl = linkEditorPagina(sesion.tienda);
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
  // No crecer infinito: poda SOLO los vencidos (clear() total lo podría disparar
  // un atacante rotando IPs para resetear el contador de todos).
  if (ventanaCod.size > 5000) {
    for (const [k, ts] of ventanaCod) {
      const vivas = ts.filter((t) => ahora - t < 10 * 60 * 1000);
      if (vivas.length) ventanaCod.set(k, vivas); else ventanaCod.delete(k);
    }
  }
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
    // El detalle va al log; al cliente (endpoint público) solo un mensaje genérico
    // — no filtramos internals (App Store 2.1: sin errores crudos visibles).
    console.error("✖ pedido COD:", e.message);
    return responder(400, { ok: false, error: "No pudimos registrar tu pedido. Probá de nuevo en un momento." });
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

// GET /publico/cod?shop=xxx.myshopify.com — config pública del formulario COD
// para el app embed. Es lo mismo que hoy va embebido en el snippet: la config
// sin `instalado`, más tienda y app_url (para que el form sepa a dónde postear
// el pedido). Sin secretos (el token no viaja acá).
async function codPublico(req, res, url) {
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
    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(tienda)) return responder(400, { activo: false });
    const cfg = await leerConfigCod(tienda);
    const { instalado, ...publica } = cfg;
    return responder(200, { ...publica, tienda, app_url: URL_APP });
  } catch (e) {
    return responder(200, { activo: false });
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

    // --- pedido COD desde la tienda del merchant (público, con CORS) ---
    if (url.pathname === "/cod/pedido") return await pedidoCod(req, res);

    // --- config pública de bundles/COD (la trae el app embed del storefront) ---
    if (url.pathname === "/publico/bundles") return await bundlesPublico(req, res, url);
    if (url.pathname === "/publico/cod") return await codPublico(req, res, url);

    // --- legales (públicas: van en la ficha del App Store) ---
    if (url.pathname === "/privacidad") return servirLegal(res, "privacidad.html");
    if (url.pathname === "/terminos") return servirLegal(res, "terminos.html");

    // --- app ---
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);

    // Código del storefront (widget de bundles + formulario COD). Lo usa el
    // preview del admin, y es EL MISMO archivo que publica el extension.
    if (url.pathname.startsWith("/widgets/")) {
      return servirEstatico(res, DIR_WIDGETS, url.pathname.replace(/^\/widgets\/?/, ""));
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
  console.error("✖ promesa sin catch:", e?.stack || e);
});
process.on("uncaughtException", (e) => {
  console.error("✖ excepción sin catch:", e?.stack || e);
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
