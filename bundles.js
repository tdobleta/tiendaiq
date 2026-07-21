// ============================================================
// BUNDLES — paquetes / descuentos por volumen (estilo PagePilot).
//
// Dos piezas que hay que tener separadas en la cabeza:
//
//   EL WIDGET  → lo visual en la página de producto: las tarjetas de
//                oferta ("Comprá 1 / 2 / 3"), badges, precios tachados.
//                Solo pre-selecciona la cantidad. NO define el precio.
//
//   EL DESCUENTO → la plata de verdad. Vive como DESCUENTO AUTOMÁTICO
//                nativo de Shopify (uno por peldaño con descuento > 0).
//                Shopify lo hace cumplir en el checkout: imposible de
//                falsear desde el navegador. Igual que el recálculo
//                server-side de COD, la fuente de verdad es Shopify.
//
// Responsabilidades del módulo (espeja cod.js):
//   1. CONFIG    por tienda (lista de bundles). Clave `bundles` en la DB.
//   2. DESCUENTOS crea/borra los descuentos automáticos que respaldan cada
//                bundle. Se re-sincronizan al guardar.
//   3. INSTALAR  inyecta el widget en el tema: assets/tiendaiq-bundle.css
//                + .js + snippets/tiendaiq-bundle.liquid + {% render %}.
//
// v1: solo tipo "volumen" (buy-more-save-more). El modelo deja lugar para
// "bxgy" (compra X y obtené Y) y el peldaño de regalos, que van en v2.
// ============================================================

const fs = require("fs");
const path = require("path");
const { gql } = require("./shopify");
const { leerTienda, guardarTienda } = require("./tiendas");

const DIR_BUNDLE = path.join(__dirname, "bundle-form");

// ---------- config ----------

// Un bundle nuevo nace con 3 peldaños razonables para dropshipping: 1 sin
// descuento (ancla), 2 con 10%, 3 con 15%. El merchant los ajusta.
function bundleDefault() {
  return {
    id: "b_" + Math.random().toString(36).slice(2, 9),
    nombre: "Descuento por volumen",
    tipo: "volumen", // volumen | bxgy (v2)
    activo: true,
    activador: {
      tipo: "todos", // todos | productos | coleccion
      ids: []        // gids de productos o colecciones según el tipo
    },
    ofertas: [
      { cantidad: 1, descuento: 0,  titulo: "Comprá 1",  subtitulo: "Precio normal",   etiqueta: "",        badge: "",           popular: false, predeterminada: false },
      { cantidad: 2, descuento: 10, titulo: "Comprá 2",  subtitulo: "Ahorás un 10%",   etiqueta: "10% OFF", badge: "Más elegido", popular: true,  predeterminada: true  },
      { cantidad: 3, descuento: 15, titulo: "Comprá 3",  subtitulo: "Mejor precio",    etiqueta: "15% OFF", badge: "Mejor valor", popular: false, predeterminada: false }
    ],
    diseno: {
      preset: "negro",
      titulo: "Elegí tu paquete y ahorrá",
      subtitulo: "Cuantas más unidades, mejor el precio",
      mostrar_encabezado: true,
      color_borde: "#111111",           // borde de la tarjeta seleccionada
      color_badge: "#111111",           // fondo del badge "Más elegido"
      color_badge_texto: "#ffffff",
      color_etiqueta: "#e11d48",        // el "10% OFF"
      color_texto: "#111111",
      radio: 12,
      mostrar_ahorro: true,             // "Ahorrás $X"
      boton: {
        texto: "Agregar al carrito — {total}",
        color_fondo: "#111111",
        color_texto: "#ffffff",
        radio: 8,
        tamano: 16
      }
    },
    // gids de los descuentos automáticos que respaldan este bundle (uno por
    // peldaño con descuento > 0). Los gestiona el server, no el browser.
    discount_ids: []
  };
}

function configDefault() {
  return {
    activo: false,
    instalado: null, // { tema, fecha } cuando se inyectó en el tema
    lista: []        // bundle[]
  };
}

// Mezcla lo guardado sobre el default: claves nuevas se heredan sin migración.
// (Los arrays se reemplazan enteros — la lista de bundles la manda el merchant.)
function mezclar(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra) || typeof extra !== "object" || extra === null) {
    return extra === undefined ? base : extra;
  }
  const salida = { ...base };
  for (const k of Object.keys(extra)) salida[k] = mezclar(base?.[k], extra[k]);
  return salida;
}

async function leerConfigBundles(tienda) {
  const t = (await leerTienda(tienda)) || {};
  const cfg = mezclar(configDefault(), t.bundles || {});
  // Cada bundle también se completa contra su default (por si sumamos campos).
  cfg.lista = (cfg.lista || []).map((b) => mezclar(bundleDefault(), b));
  return cfg;
}

async function guardarConfigBundles(tienda, config) {
  const t = (await leerTienda(tienda)) || {};
  if (!t.token) throw new Error(`La tienda ${tienda} no está instalada`);
  await guardarTienda(tienda, t.token, { ...t, bundles: config });
  return config;
}

// ---------- descuentos automáticos ----------

const M_CREAR = `mutation($d: DiscountAutomaticBasicInput!) {
  discountAutomaticBasicCreate(automaticBasicDiscount: $d) {
    automaticDiscountNode { id }
    userErrors { field message }
  }
}`;

const M_BORRAR = `mutation($id: ID!) {
  discountAutomaticDelete(id: $id) {
    deletedAutomaticDiscountId
    userErrors { field message }
  }
}`;

// Traduce el activador del bundle al DiscountItemsInput de Shopify: define a
// QUÉ productos se les aplica el % (y, con la cantidad mínima, cuándo).
function itemsDelActivador(activador) {
  if (activador.tipo === "productos" && activador.ids?.length) {
    return { products: { productsToAdd: activador.ids } };
  }
  if (activador.tipo === "coleccion" && activador.ids?.length) {
    return { collections: { add: activador.ids } };
  }
  return { all: true }; // "todos": aplica a cualquier producto del carrito
}

// Borra los descuentos que respaldaban un bundle. Tolera ids muertos (si el
// merchant borró el descuento a mano, el userErrors no nos frena).
async function borrarDescuentos(sesion, ids = [], log = () => {}) {
  for (const id of ids) {
    try {
      await gql(M_BORRAR, { id }, sesion);
    } catch (e) {
      log(`  aviso · no se pudo borrar ${id}: ${e.message}`);
    }
  }
}

// Crea un descuento automático por peldaño con descuento > 0. Devuelve los
// gids creados. El peldaño de cantidad 1 (o descuento 0) no genera descuento:
// es el precio ancla, Shopify no toca nada.
//
// Por qué un descuento POR peldaño: Shopify no tiene "precio escalonado" en un
// solo descuento. Se crea "≥2 → 10%" y "≥3 → 15%" por separado; cuando el
// carrito tiene 3, ambos califican y —al no combinar entre sí— Shopify aplica
// el más valioso (el 15%). Es el patrón estándar sin Shopify Functions.
async function crearDescuentos(sesion, bundle, log = () => {}) {
  if (bundle.tipo !== "volumen") return []; // bxgy: v2
  if (bundle.activo === false) return [];

  const items = itemsDelActivador(bundle.activador || { tipo: "todos" });
  const creados = [];

  for (const oferta of bundle.ofertas || []) {
    const desc = Number(oferta.descuento) || 0;
    const cant = Math.max(1, Number(oferta.cantidad) || 1);
    if (desc <= 0) continue;

    const d = {
      title: `TiendaIQ Bundle · ${bundle.nombre} · ${cant}+`.slice(0, 250),
      startsAt: new Date().toISOString(),
      customerGets: {
        value: { percentage: Math.min(1, desc / 100) },
        items
      },
      minimumRequirement: {
        quantity: { greaterThanOrEqualToQuantity: String(cant) }
      },
      // El bundle no combina con otros descuentos de producto/pedido (evita
      // apilar el 10% y el 15%); el envío sí puede combinar.
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true }
    };

    const r = await gql(M_CREAR, { d }, sesion);
    const errores = r.discountAutomaticBasicCreate.userErrors;
    if (errores?.length) {
      throw new Error(`Descuento ${cant}+: ${errores.map((e) => e.message).join(" · ")}`);
    }
    const id = r.discountAutomaticBasicCreate.automaticDiscountNode.id;
    creados.push(id);
    log(`  descuento · ${cant}+ → ${desc}%  (${id.split("/").pop()})`);
  }
  return creados;
}

// Re-sincroniza los descuentos de TODA la lista: borra los viejos y crea los
// nuevos según la config actual. Devuelve la lista con los discount_ids
// actualizados. Idempotente: correrlo dos veces deja el mismo estado.
async function sincronizarDescuentos(sesion, config, log = () => {}) {
  for (const bundle of config.lista) {
    await borrarDescuentos(sesion, bundle.discount_ids, log);
    bundle.discount_ids = await crearDescuentos(sesion, bundle, log);
  }
  return config;
}

// ---------- instalación en el tema ----------

const Q_TEMA = `{ themes(first: 1, roles: [MAIN]) { nodes { id name } } }`;

const Q_ARCHIVO = `query($id: ID!, $nombres: [String!]!) {
  theme(id: $id) {
    files(filenames: $nombres, first: 1) {
      nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
    }
  }
}`;

const M_ARCHIVOS = `mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { field message }
  }
}`;

// El snippet deja la config del widget en window y —clave— pasa el id y las
// colecciones del producto actual desde Liquid, para que el JS decida si este
// producto tiene un bundle sin llamar al server. Solo corre en producto.
function armarSnippet(config, sesion, urlApp) {
  const publica = { activo: config.activo, lista: (config.lista || []).map((b) => {
    const { discount_ids, ...resto } = b; // los ids de descuento no van al browser
    return resto;
  }) };
  const json = JSON.stringify({ ...publica, tienda: sesion.tienda, app_url: urlApp })
    .replace(/</g, "\\u003c");

  return `{%- comment -%} TiendaIQ Bundles — generado por la app, no editar a mano {%- endcomment -%}
{%- if request.page_type == 'product' -%}
<script>
  window.TIENDAIQ_BUNDLES = ${json};
  window.TIENDAIQ_PRODUCTO = {
    id: {{ product.id | json }},
    colecciones: {{ product.collections | map: 'id' | json }},
    precio: {{ product.selected_or_first_available_variant.price | json }},
    moneda: {{ shop.money_format | json }}
  };
</script>
{{ 'tiendaiq-bundle.css' | asset_url | stylesheet_tag }}
<script src="{{ 'tiendaiq-bundle.js' | asset_url }}" defer></script>
{%- endif -%}`;
}

const RENDER_TAG = "{% render 'tiendaiq-bundle' %}";

// Sube assets + snippet y engancha el render en layout/theme.liquid.
// Idempotente: correrlo de nuevo pisa los archivos y no duplica el render.
async function instalarBundles(sesion, config, urlApp, log = () => {}) {
  const tema = (await gql(Q_TEMA, {}, sesion)).themes.nodes[0];
  if (!tema) throw new Error("La tienda no tiene tema principal.");
  log(`  tema     · ${tema.name}`);

  const archivos = [
    {
      filename: "assets/tiendaiq-bundle.css",
      body: { type: "TEXT", value: fs.readFileSync(path.join(DIR_BUNDLE, "tiendaiq-bundle.css"), "utf8") }
    },
    {
      filename: "assets/tiendaiq-bundle.js",
      body: { type: "TEXT", value: fs.readFileSync(path.join(DIR_BUNDLE, "tiendaiq-bundle.js"), "utf8") }
    },
    {
      filename: "snippets/tiendaiq-bundle.liquid",
      body: { type: "TEXT", value: armarSnippet(config, sesion, urlApp) }
    }
  ];
  const r1 = await gql(M_ARCHIVOS, { themeId: tema.id, files: archivos }, sesion);
  if (r1.themeFilesUpsert.userErrors.length) {
    throw new Error("Archivos Bundle: " + JSON.stringify(r1.themeFilesUpsert.userErrors));
  }
  log(`  archivos · ${r1.themeFilesUpsert.upsertedThemeFiles.length} instalados`);

  // --- enganchar el snippet en el layout ---
  const rTema = await gql(Q_ARCHIVO, { id: tema.id, nombres: ["layout/theme.liquid"] }, sesion);
  const layout = rTema.theme?.files?.nodes?.[0]?.body?.content;
  if (!layout) throw new Error("No se pudo leer layout/theme.liquid del tema.");

  if (!layout.includes("tiendaiq-bundle")) {
    if (!/<\/body>/i.test(layout)) throw new Error("El theme.liquid no tiene </body>: no sé dónde inyectar.");
    const parchado = layout.replace(/<\/body>/i, `  ${RENDER_TAG}\n</body>`);
    const r2 = await gql(
      M_ARCHIVOS,
      { themeId: tema.id, files: [{ filename: "layout/theme.liquid", body: { type: "TEXT", value: parchado } }] },
      sesion
    );
    if (r2.themeFilesUpsert.userErrors.length) {
      throw new Error("theme.liquid: " + JSON.stringify(r2.themeFilesUpsert.userErrors));
    }
    log(`  layout   · render agregado antes de </body>`);
  } else {
    log(`  layout   · ya estaba enganchado`);
  }

  return { tema: tema.name };
}

// Al guardar la config con los bundles ya instalados, alcanza con re-subir el
// snippet (la config viaja adentro). No hace falta tocar el layout.
async function actualizarSnippet(sesion, config, urlApp) {
  const tema = (await gql(Q_TEMA, {}, sesion)).themes.nodes[0];
  if (!tema) throw new Error("La tienda no tiene tema principal.");
  const r = await gql(
    M_ARCHIVOS,
    {
      themeId: tema.id,
      files: [{ filename: "snippets/tiendaiq-bundle.liquid", body: { type: "TEXT", value: armarSnippet(config, sesion, urlApp) } }]
    },
    sesion
  );
  if (r.themeFilesUpsert.userErrors.length) {
    throw new Error("Snippet Bundle: " + JSON.stringify(r.themeFilesUpsert.userErrors));
  }
}

module.exports = {
  bundleDefault,
  configDefault,
  leerConfigBundles,
  guardarConfigBundles,
  sincronizarDescuentos,
  borrarDescuentos,
  instalarBundles,
  actualizarSnippet
};
