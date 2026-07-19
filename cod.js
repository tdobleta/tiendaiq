// ============================================================
// COD — formulario de pago contra reembolso (estilo Releasit).
//
// Tres responsabilidades:
//   1. CONFIG    por tienda (botón, campos, tarifas, ofertas, textos).
//                Vive en el registro de la tienda (tiendas/db), clave `cod`.
//   2. INSTALAR  inyecta el formulario en el tema del merchant:
//                assets/tiendaiq-cod.css + .js, snippets/tiendaiq-cod.liquid
//                (con la config adentro) y el {% render %} en theme.liquid.
//                Sin dependencia del server para RENDERIZAR: la tienda solo
//                nos llama al enviar un pedido.
//   3. PEDIDO    crea la orden real en Shopify (orderCreate, pago PENDING,
//                tag "TiendaIQ COD"). El precio NO se toma del navegador:
//                se recalcula acá con la Admin API.
// ============================================================

const fs = require("fs");
const path = require("path");
const { gql } = require("./shopify");
const { leerTienda, guardarTienda } = require("./tiendas");

const DIR_COD = path.join(__dirname, "cod-form");

// ---------- config ----------

function configDefault() {
  return {
    activo: false,
    instalado: null, // { tema, fecha } cuando se inyectó en el tema
    boton: {
      texto: "Comprar contra reembolso",
      subtitulo: "Pagás al recibir tu pedido",
      icono: "billete", // billete | carrito | camion | casa | ninguno
      animacion: "ninguna", // ninguna | latido | sacudida
      color_fondo: "#000000",
      color_texto: "#ffffff",
      radio: 6,
      tamano: 16,
      borde_ancho: 0,
      borde_color: "#000000",
      sombra: 0,
      sticky: true // barra adhesiva en móvil
    },
    formulario: {
      fondo: "#ffffff",
      texto: "#111111",
      radio: 14,
      borde_ancho: 0,
      borde_color: "#000000",
      campo_fondo: "#ffffff",
      campo_texto: "#111111",
      campo_borde: "#cbcbcb",
      campo_radio: 8
    },
    campos: [
      { id: "nombre", etiqueta: "Nombre", visible: true, obligatorio: true },
      { id: "apellido", etiqueta: "Apellido", visible: true, obligatorio: true },
      { id: "telefono", etiqueta: "Teléfono", visible: true, obligatorio: true },
      { id: "direccion", etiqueta: "Dirección", visible: true, obligatorio: true },
      { id: "direccion2", etiqueta: "Depto / piso / referencia", visible: true, obligatorio: false },
      { id: "provincia", etiqueta: "Provincia", visible: true, obligatorio: true },
      { id: "ciudad", etiqueta: "Ciudad", visible: true, obligatorio: true },
      { id: "codigo_postal", etiqueta: "Código postal", visible: true, obligatorio: false },
      { id: "email", etiqueta: "Correo electrónico", visible: true, obligatorio: false },
      { id: "nota", etiqueta: "Nota del pedido", visible: true, obligatorio: false }
    ],
    tarifas: [{ id: "estandar", nombre: "Envío estándar", precio: 0 }],
    ofertas: {
      activo: false,
      tiers: [
        { cantidad: 1, descuento: 0, etiqueta: "1 unidad" },
        { cantidad: 2, descuento: 10, etiqueta: "2 unidades" },
        { cantidad: 3, descuento: 15, etiqueta: "3 unidades" }
      ]
    },
    extras: { boletin: true, terminos: false, terminos_url: "" },
    textos: {
      titulo: "Pago contra reembolso",
      subtitulo: "Ingresá tus datos de envío",
      cta: "Completá tu compra — {total}",
      subtotal: "Subtotal",
      total: "Total",
      gratis: "Gratis",
      boletin: "Quiero recibir ofertas y novedades",
      terminos: "Acepto los",
      terminos_link: "términos y condiciones",
      enviando: "Enviando tu pedido…",
      error_terminos: "Tenés que aceptar los términos y condiciones.",
      exito_titulo: "¡Pedido confirmado!",
      exito_texto: "Te vamos a contactar para coordinar la entrega. Pagás al recibirlo.",
      exito_boton: "Seguir comprando"
    }
  };
}

// Mezcla lo guardado sobre el default: si mañana agregamos claves nuevas,
// las tiendas viejas las heredan sin migración.
function mezclar(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra) || typeof extra !== "object" || extra === null) {
    return extra === undefined ? base : extra;
  }
  const salida = { ...base };
  for (const k of Object.keys(extra)) salida[k] = mezclar(base?.[k], extra[k]);
  return salida;
}

async function leerConfigCod(tienda) {
  const t = (await leerTienda(tienda)) || {};
  return mezclar(configDefault(), t.cod || {});
}

async function guardarConfigCod(tienda, config) {
  const t = (await leerTienda(tienda)) || {};
  if (!t.token) throw new Error(`La tienda ${tienda} no está instalada`);
  await guardarTienda(tienda, t.token, { ...t, cod: config });
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

// El snippet deja la config en window y carga los assets. Solo corre en
// páginas de producto: el propio JS chequea la URL, pero evitar cargarlo en
// todo el sitio es gratis desde Liquid.
function armarSnippet(config, sesion, urlApp) {
  const publica = { ...config };
  delete publica.instalado;
  const json = JSON.stringify({
    ...publica,
    tienda: sesion.tienda,
    app_url: urlApp
  }).replace(/</g, "\\u003c");

  return `{%- comment -%} TiendaIQ COD — generado por la app, no editar a mano {%- endcomment -%}
{%- if request.page_type == 'product' -%}
<script>window.TIENDAIQ_COD = ${json};</script>
{{ 'tiendaiq-cod.css' | asset_url | stylesheet_tag }}
<script src="{{ 'tiendaiq-cod.js' | asset_url }}" defer></script>
{%- endif -%}`;
}

const RENDER_TAG = "{% render 'tiendaiq-cod' %}";

// Sube assets + snippet y engancha el render en layout/theme.liquid.
// Idempotente: correrlo de nuevo pisa los archivos y no duplica el render.
async function instalarCod(sesion, config, urlApp, log = () => {}) {
  const tema = (await gql(Q_TEMA, {}, sesion)).themes.nodes[0];
  if (!tema) throw new Error("La tienda no tiene tema principal.");
  log(`  tema     · ${tema.name}`);

  const archivos = [
    {
      filename: "assets/tiendaiq-cod.css",
      body: { type: "TEXT", value: fs.readFileSync(path.join(DIR_COD, "tiendaiq-cod.css"), "utf8") }
    },
    {
      filename: "assets/tiendaiq-cod.js",
      body: { type: "TEXT", value: fs.readFileSync(path.join(DIR_COD, "tiendaiq-cod.js"), "utf8") }
    },
    {
      filename: "snippets/tiendaiq-cod.liquid",
      body: { type: "TEXT", value: armarSnippet(config, sesion, urlApp) }
    }
  ];
  const r1 = await gql(M_ARCHIVOS, { themeId: tema.id, files: archivos }, sesion);
  if (r1.themeFilesUpsert.userErrors.length) {
    throw new Error("Archivos COD: " + JSON.stringify(r1.themeFilesUpsert.userErrors));
  }
  log(`  archivos · ${r1.themeFilesUpsert.upsertedThemeFiles.length} instalados`);

  // --- enganchar el snippet en el layout ---
  const rTema = await gql(Q_ARCHIVO, { id: tema.id, nombres: ["layout/theme.liquid"] }, sesion);
  const layout = rTema.theme?.files?.nodes?.[0]?.body?.content;
  if (!layout) throw new Error("No se pudo leer layout/theme.liquid del tema.");

  if (!layout.includes("tiendaiq-cod")) {
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

// Al guardar la config con el COD ya instalado, alcanza con re-subir el
// snippet (la config viaja adentro). No hace falta tocar el layout.
async function actualizarSnippet(sesion, config, urlApp) {
  const tema = (await gql(Q_TEMA, {}, sesion)).themes.nodes[0];
  if (!tema) throw new Error("La tienda no tiene tema principal.");
  const r = await gql(
    M_ARCHIVOS,
    {
      themeId: tema.id,
      files: [{ filename: "snippets/tiendaiq-cod.liquid", body: { type: "TEXT", value: armarSnippet(config, sesion, urlApp) } }]
    },
    sesion
  );
  if (r.themeFilesUpsert.userErrors.length) {
    throw new Error("Snippet COD: " + JSON.stringify(r.themeFilesUpsert.userErrors));
  }
}

// ---------- creación del pedido ----------

const Q_DATOS_PEDIDO = `query($id: ID!) {
  shop { currencyCode billingAddress { countryCodeV2 } }
  node(id: $id) {
    ... on ProductVariant {
      id
      title
      price
      availableForSale
      product { title }
    }
  }
}`;

const M_PEDIDO = `mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    userErrors { field message }
    order { id name }
  }
}`;

const round2 = (n) => Math.round(n * 100) / 100;

// pedido = { variante_id, cantidad, oferta, tarifa_id, campos, boletin, hp }
async function crearPedidoCod(sesion, pedido) {
  const config = await leerConfigCod(sesion.tienda);
  if (!config.activo) throw new Error("El formulario COD está desactivado en esta tienda.");
  if (pedido.hp) throw new Error("Pedido rechazado."); // honeypot: lo llenó un bot

  const campos = pedido.campos || {};

  // Obligatorios según lo que configuró el merchant (no confiar en el browser).
  for (const c of config.campos) {
    if (c.visible !== false && c.obligatorio && !String(campos[c.id] || "").trim()) {
      throw new Error(`Falta el campo obligatorio: ${c.etiqueta}`);
    }
  }

  // Cantidad y oferta: la oferta manda si está activa.
  let cantidad = Math.max(1, Math.min(10, Number(pedido.cantidad) || 1));
  let descuento = 0;
  let etiquetaOferta = null;
  if (config.ofertas?.activo && pedido.oferta !== null && pedido.oferta !== undefined) {
    const tier = config.ofertas.tiers?.[Number(pedido.oferta)];
    if (!tier) throw new Error("Oferta inválida.");
    cantidad = Math.max(1, Number(tier.cantidad) || 1);
    descuento = Number(tier.descuento) || 0;
    etiquetaOferta = tier.etiqueta || `${tier.cantidad} unidades`;
  }

  // Tarifa de envío: siempre la del server, jamás el precio que mande el browser.
  let tarifa = null;
  if (config.tarifas?.length) {
    tarifa = config.tarifas.find((t) => t.id === pedido.tarifa_id) || config.tarifas[0];
  }

  // --- datos reales desde Shopify ---
  if (!pedido.variante_id) throw new Error("Falta la variante.");
  const gid = `gid://shopify/ProductVariant/${String(pedido.variante_id).replace(/\D/g, "")}`;
  const d = await gql(Q_DATOS_PEDIDO, { id: gid }, sesion);
  const variante = d.node;
  if (!variante?.id) throw new Error("Esa variante no existe en la tienda.");
  if (variante.availableForSale === false) throw new Error("El producto no está disponible.");

  const moneda = d.shop.currencyCode;
  const precioUnitario = round2(Number(variante.price) * (1 - descuento / 100));

  const nombre = String(campos.nombre || "").trim();
  const apellido = String(campos.apellido || "").trim();
  const email = String(campos.email || "").trim();
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;

  // MailingAddressInput no acepta provincia como texto libre (solo
  // provinceCode, que exige el código exacto). La provincia que escribió el
  // cliente va como atributo del pedido y en la nota: el merchant la ve igual.
  const provincia = String(campos.provincia || "").trim();
  const direccion = {
    firstName: nombre || "Cliente",
    lastName: apellido || "COD",
    address1: String(campos.direccion || "").trim() || null,
    address2: String(campos.direccion2 || "").trim() || null,
    city: String(campos.ciudad || "").trim() || null,
    zip: String(campos.codigo_postal || "").trim() || null,
    phone: String(campos.telefono || "").trim() || null,
    countryCode: d.shop.billingAddress?.countryCodeV2 || null
  };
  for (const k of Object.keys(direccion)) if (direccion[k] === null) delete direccion[k];

  const notas = [];
  if (provincia) notas.push(`Provincia: ${provincia}`);
  if (String(campos.nota || "").trim()) notas.push(`Nota del cliente: ${String(campos.nota).trim()}`);
  if (etiquetaOferta) notas.push(`Oferta aplicada: ${etiquetaOferta} (-${descuento}%)`);
  notas.push("Pedido contra reembolso creado por TiendaIQ COD.");

  const linea = { variantId: variante.id, quantity: cantidad };
  // Solo pisamos el precio si hay descuento; sin oferta, manda el de Shopify.
  if (descuento > 0) {
    linea.priceSet = { shopMoney: { amount: precioUnitario.toFixed(2), currencyCode: moneda } };
  }

  const order = {
    currency: moneda,
    financialStatus: "PENDING",
    lineItems: [linea],
    shippingAddress: direccion,
    billingAddress: direccion,
    note: notas.join("\n"),
    tags: ["TiendaIQ COD", "Contra reembolso"],
    customAttributes: [
      { key: "Método de pago", value: "Contra reembolso (COD)" },
      ...(provincia ? [{ key: "Provincia", value: provincia }] : [])
    ]
  };
  if (emailValido) order.email = emailValido;
  if (pedido.boletin) order.buyerAcceptsMarketing = true;
  if (tarifa) {
    order.shippingLines = [
      {
        title: tarifa.nombre || "Envío",
        priceSet: { shopMoney: { amount: round2(Number(tarifa.precio) || 0).toFixed(2), currencyCode: moneda } }
      }
    ];
  }

  const r = await gql(
    M_PEDIDO,
    { order, options: { inventoryBehaviour: "DECREMENT_OBEYING_POLICY", sendReceipt: false } },
    sesion
  );
  if (r.orderCreate.userErrors?.length) {
    throw new Error("No se pudo crear el pedido: " + r.orderCreate.userErrors.map((e) => e.message).join(" · "));
  }

  return { orden: r.orderCreate.order.name, id: r.orderCreate.order.id };
}

module.exports = { configDefault, leerConfigCod, guardarConfigCod, instalarCod, actualizarSnippet, crearPedidoCod };
