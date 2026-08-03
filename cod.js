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

const { gql } = require("./shopify");
const { leerTienda, guardarTienda } = require("./tiendas");

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
        { cantidad: 1, descuento: 0, etiqueta: "1 unidad", popular: false },
        { cantidad: 2, descuento: 10, etiqueta: "2 unidades", popular: true },
        { cantidad: 3, descuento: 15, etiqueta: "3 unidades", popular: false }
      ]
    },
    // Elementos agregados por el merchant (título, texto, campo, imagen,
    // botón de WhatsApp, botón con enlace). Se renderizan en la columna de
    // campos según `orden`.
    elementos: [],
    // Orden de la columna de campos: claves "c:<campo>" y "e:<elemento>".
    // null = orden natural (campos y después elementos).
    orden: null,
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

// Busca un código de descuento de la tienda (read-only) y devuelve su tipo y
// valor. NO lo aplica: eso lo decide crearPedidoCod. Fail-safe: cualquier error
// o código desconocido/inactivo → { valido:false } (nunca rompe el flujo).
// `percentage` de Shopify viene como fracción 0–1 (0.15 = 15%).
const Q_DESCUENTO = `query($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    codeDiscount {
      __typename
      ... on DiscountCodeBasic {
        status
        customerGets { value {
          __typename
          ... on DiscountPercentage { percentage }
          ... on DiscountAmount { amount { amount currencyCode } }
        } }
      }
      ... on DiscountCodeFreeShipping { status }
    }
  }
}`;

async function validarDescuentoCod(sesion, code) {
  const codigo = String(code || "").trim();
  if (!codigo) return { valido: false };
  try {
    const d = await gql(Q_DESCUENTO, { code: codigo }, sesion);
    const cd = d.codeDiscountNodeByCode?.codeDiscount;
    if (!cd || cd.status !== "ACTIVE") return { valido: false };
    if (cd.__typename === "DiscountCodeFreeShipping") {
      return { valido: true, code: codigo, tipo: "envio" };
    }
    const v = cd.customerGets?.value;
    if (v?.__typename === "DiscountPercentage") {
      const pct = Number(v.percentage) || 0; // 0–1
      if (pct <= 0) return { valido: false };
      return { valido: true, code: codigo, tipo: "porcentaje", porcentaje: pct };
    }
    if (v?.__typename === "DiscountAmount") {
      const monto = Number(v.amount?.amount) || 0; // en unidad principal
      if (monto <= 0) return { valido: false };
      return { valido: true, code: codigo, tipo: "monto", monto, moneda: v.amount?.currencyCode || null };
    }
    return { valido: false };
  } catch (e) {
    console.error("✖ validar descuento COD:", e.message);
    return { valido: false };
  }
}

// pedido = { variante_id, cantidad, oferta, tarifa_id, campos, boletin, hp, codigo_descuento }
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

  // Campos personalizados (campo, desplegable, selección, casilla, fecha):
  // mismo criterio, el obligatorio se valida acá con la config, no con lo
  // que diga el browser.
  const TIPOS_CAMPO = ["campo", "desplegable", "seleccion", "casilla", "fecha"];
  const extras = [];
  const valoresExtra = pedido.extras || {}; // { <id elemento>: valor }
  for (const el of config.elementos || []) {
    if (!TIPOS_CAMPO.includes(el.tipo)) continue;
    const valor = String(valoresExtra[el.id] || "").trim();
    if (el.obligatorio && !valor) throw new Error(`Falta el campo obligatorio: ${el.etiqueta}`);
    if (valor) extras.push({ etiqueta: String(el.etiqueta || "Campo").slice(0, 250), valor: valor.slice(0, 250) });
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
  for (const x of extras) notas.push(`${x.etiqueta}: ${x.valor}`);
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
      ...(provincia ? [{ key: "Provincia", value: provincia }] : []),
      ...extras.map((x) => ({ key: x.etiqueta, value: x.valor }))
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

  // Descuento por código (opcional): SIEMPRE se re-valida server-side (jamás se
  // confía en lo que mande el browser) y recién ahí se aplica. Código inexistente
  // o inactivo → se ignora y la venta sigue igual. `percentage` de Shopify es
  // 0–1; el input de orderCreate lo espera en 0–100.
  if (pedido.codigo_descuento) {
    const dc = await validarDescuentoCod(sesion, pedido.codigo_descuento);
    if (dc.valido && dc.tipo === "porcentaje") {
      order.discountCode = { itemPercentageDiscountCode: { code: dc.code, percentage: round2(dc.porcentaje * 100) } };
    } else if (dc.valido && dc.tipo === "monto") {
      order.discountCode = { itemFixedDiscountCode: { code: dc.code, amountSet: { shopMoney: { amount: round2(dc.monto).toFixed(2), currencyCode: moneda } } } };
    } else if (dc.valido && dc.tipo === "envio") {
      order.discountCode = { freeShippingDiscountCode: { code: dc.code } };
    }
  }

  const crear = (orderInput) =>
    gql(M_PEDIDO, { order: orderInput, options: { inventoryBehaviour: "DECREMENT_OBEYING_POLICY", sendReceipt: false } }, sesion);

  let r = await crear(order);
  // Fail-safe: si el pedido falló y llevaba descuento, reintentar SIN él. Mejor
  // una venta sin descuento que una venta perdida por un código conflictivo.
  if (r.orderCreate.userErrors?.length && order.discountCode) {
    console.error("⚠ orderCreate con descuento falló, reintento sin descuento:", r.orderCreate.userErrors.map((e) => e.message).join(" · "));
    const sinDescuento = { ...order };
    delete sinDescuento.discountCode;
    r = await crear(sinDescuento);
  }
  if (r.orderCreate.userErrors?.length) {
    throw new Error("No se pudo crear el pedido: " + r.orderCreate.userErrors.map((e) => e.message).join(" · "));
  }

  return { orden: r.orderCreate.order.name, id: r.orderCreate.order.id };
}

module.exports = { configDefault, leerConfigCod, guardarConfigCod, crearPedidoCod, validarDescuentoCod };
