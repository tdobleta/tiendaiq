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
//                falsear desde el navegador. La fuente de verdad es Shopify.
//
// Responsabilidades del módulo:
//   1. CONFIG    por tienda (lista de bundles). Clave `bundles` en la DB.
//   2. DESCUENTOS crea/borra los descuentos automáticos que respaldan cada
//                bundle. Se re-sincronizan al guardar.
//   3. INSTALAR  inyecta el widget en el tema: assets/tiendaiq-bundle.css
//                + .js + snippets/tiendaiq-bundle.liquid + {% render %}.
//
// v1: solo tipo "volumen" (buy-more-save-more). El modelo deja lugar para
// "bxgy" (compra X y obtené Y) y el peldaño de regalos, que van en v2.
// ============================================================

const { gql } = require("./shopify");
const { leerTienda, actualizarCamposTienda } = require("./tiendas");

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
    // Solo se usa cuando tipo === "bxgy" (comprá X y obtené Y). El activador
    // define el scope de ambos lados (lo que comprás y lo que te llevás).
    bxgy: {
      compra_cantidad: 2,     // customerBuys.value.quantity
      regalo_cantidad: 1,     // customerGets.value.discountOnQuantity.quantity
      regalo_descuento: 100   // 100 = gratis; 50 = mitad de precio, etc.
    },
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
    lista: [],       // bundle[]
    pending_cleanup_ids: [], // descuentos de bundles borrados que Shopify no dejó limpiar todavía
    sync: null, // estado durable del último reemplazo de descuentos
    version: 0,
    applied_version: 0,
    applied: null
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
  // Builds anteriores permitían guardar promesas visuales sin operación real.
  // Las apagamos al leer para que ni el admin ni el storefront las vuelvan a
  // publicar; el resto de la configuración permanece editable y reversible.
  for (const bundle of cfg.lista) {
    for (const oferta of bundle.ofertas || []) {
      if (oferta.addons?.regalo) oferta.addons.regalo.on = false;
      if (oferta.addons?.envio) oferta.addons.envio.on = false;
      oferta.redondeo = false;
    }
  }
  return cfg;
}

async function guardarConfigBundles(tienda, config) {
  const t = (await leerTienda(tienda)) || {};
  if (!t.token) throw new Error(`La tienda ${tienda} no está instalada`);
  // Escribe solo bundles: reemplazar el documento completo puede perder un
  // token, plan o contador actualizado por otro request.
  await actualizarCamposTienda(tienda, { bundles: config });
  return config;
}

function errorConfig(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

// Solo estas dos familias tienen hoy una regla nativa de Shopify que respalda
// lo prometido en el storefront. La validación vive en el servidor para que no
// dependa de que la interfaz oculte correctamente controles experimentales.
function validarConfigBundles(config) {
  if (!config || !Array.isArray(config.lista)) throw errorConfig("La configuración de bundles no es válida.");

  const ids = new Set();

  for (const bundle of config.lista) {
    if (!bundle) throw errorConfig("La configuración contiene un bundle vacío.");
    if (!bundle.id || ids.has(bundle.id)) {
      throw errorConfig("Cada bundle debe tener un identificador único.");
    }
    ids.add(bundle.id);
    if (bundle.activo === false) continue;
    if (!["volumen", "bxgy"].includes(bundle.tipo || "volumen")) {
      throw errorConfig("Ese tipo de bundle todavía no está disponible para publicar.");
    }
    if (bundle.tipo === "bxgy") continue;

    for (const oferta of bundle.ofertas || []) {
      if (!oferta || oferta.activo === false) continue;
      const tipo = oferta.tipo_desc || (Number(oferta.descuento) > 0 ? "porcentaje" : "ninguno");
      if (!["porcentaje", "ninguno"].includes(tipo)) {
        throw errorConfig("Ese tipo de descuento todavía no está disponible para publicar.");
      }
      if (oferta.addons?.regalo?.on || oferta.addons?.envio?.on) {
        throw errorConfig("Los regalos adicionales y las promesas de envío todavía no están disponibles para publicar.");
      }
      if (oferta.redondeo) {
        throw errorConfig("El redondeo de precios todavía no está disponible para publicar.");
      }
    }
  }
  return config;
}

// El navegador nunca decide qué descuentos existen en Shopify. Esta función
// arma la intención que ejecutará el worker conservando exclusivamente los IDs
// que ya conoce el servidor y registrando las limpiezas de bundles eliminados.
function prepararConfigBundles(actual = configDefault(), propuesta) {
  validarConfigBundles(propuesta);
  const config = JSON.parse(JSON.stringify(propuesta));
  const anterior = actual && typeof actual === "object" ? actual : configDefault();
  const anterioresPorId = new Map((anterior.lista || []).map((bundle) => [bundle.id, bundle]));

  // Campos de estado que el navegador no puede decidir.
  delete config.applied;
  delete config.applied_version;
  delete config.version;
  delete config.sync;
  config.instalado = anterior.instalado || null;
  config.lista = (config.lista || []).map((bundle) => ({
    ...bundle,
    discount_ids: [...new Set(anterioresPorId.get(bundle.id)?.discount_ids || [])],
    sync_status: anterioresPorId.get(bundle.id)?.sync_status || null,
    sync_error: null
  }));

  const pendientes = new Set(anterior.pending_cleanup_ids || []);
  const vigentes = new Set(config.lista.map((bundle) => bundle.id));
  for (const bundle of anterior.lista || []) {
    if (!vigentes.has(bundle.id)) {
      for (const id of bundle.discount_ids || []) pendientes.add(id);
    }
  }
  config.pending_cleanup_ids = [...pendientes];
  config.activo = config.lista.some((bundle) => bundle.activo !== false);
  config.version = Math.max(0, Number(anterior.version) || 0) + 1;
  config.applied_version = Math.max(0, Number(anterior.applied_version) || 0);
  config.applied = anterior.applied
    ? JSON.parse(JSON.stringify(anterior.applied))
    : snapshotConfigBundles(anterior);
  config.sync = null;
  return config;
}

function snapshotConfigBundles(config = configDefault()) {
  return {
    activo: config.activo === true,
    instalado: config.instalado || null,
    lista: JSON.parse(JSON.stringify(config.lista || [])),
    pending_cleanup_ids: [...new Set(config.pending_cleanup_ids || [])],
    version: Math.max(0, Number(config.version) || 0)
  };
}

// La tienda pública consume únicamente el último documento confirmado. La
// intención nueva puede verse en el admin mientras el worker sincroniza, pero
// no se ofrece al comprador hasta que Shopify confirmó sus descuentos.
function configAplicadaBundles(config = configDefault()) {
  return config.applied
    ? JSON.parse(JSON.stringify(config.applied))
    : snapshotConfigBundles(config);
}

function bundleEsPublicable(bundle) {
  try {
    validarConfigBundles({ lista: [bundle] });
    return bundle?.activo !== false;
  } catch {
    return false;
  }
}

// ---------- descuentos automáticos ----------

const M_CREAR = `mutation($d: DiscountAutomaticBasicInput!) {
  discountAutomaticBasicCreate(automaticBasicDiscount: $d) {
    automaticDiscountNode { id }
    userErrors { field message }
  }
}`;

const M_CREAR_BXGY = `mutation($d: DiscountAutomaticBxgyInput!) {
  discountAutomaticBxgyCreate(automaticBxgyDiscount: $d) {
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
//
// Un activador acotado SIN nada elegido revienta en vez de caer en `all`. El
// merchant que elige "solo estos productos" y guarda sin seleccionar ninguno
// esperaba un descuento acotado; darle uno para toda la tienda le descuenta
// el catálogo entero sin que se entere. Es preferible que no guarde.
function itemsDelActivador(activador) {
  const ids = activador.ids || [];

  if (activador.tipo === "productos") {
    if (!ids.length) throw new Error("El bundle está limitado a productos pero no tiene ningún producto elegido.");
    return { products: { productsToAdd: ids } };
  }
  if (activador.tipo === "coleccion") {
    if (!ids.length) throw new Error("El bundle está limitado a una colección pero no tiene ninguna colección elegida.");
    return { collections: { add: ids } };
  }
  return { all: true }; // "todos": aplica a cualquier producto del carrito
}

// El porcentaje que se le manda a Shopify va de 0 a 1. Un número mayor a 100
// no se recorta: se rechaza. Recortarlo a 1 convierte un "150" mal tipeado
// (por ejemplo, alguien que quiso poner $150 de descuento) en un producto
// regalado, y el descuento queda activo en la tienda hasta que alguien lo note.
function porcentajeValido(descuento, cantidad) {
  const d = Number(descuento) || 0;
  if (d > 100) {
    throw new Error(`El descuento del peldaño de ${cantidad}+ es ${d}%: el porcentaje no puede pasar de 100.`);
  }
  return d / 100;
}

// Borra los descuentos que respaldaban un bundle. Tolera ids muertos (si el
// merchant borró el descuento a mano, el userErrors no nos frena).
async function borrarDescuentos(sesion, ids = [], log = () => {}, { signal } = {}) {
  const borrados = [];
  const fallidos = [];
  for (const id of ids) {
    try {
      const r = await gql(M_BORRAR, { id }, sesion, { signal });
      const errores = r.discountAutomaticDelete?.userErrors || [];
      if (errores.length) throw new Error(errores.map((e) => e.message).join(" · "));
      borrados.push(id);
    } catch (e) {
      if (signal?.aborted) throw signal.reason || e;
      fallidos.push(id);
      log(`  aviso · no se pudo borrar ${id}: ${e.message}`);
    }
  }
  return { borrados, fallidos };
}

// Crea un descuento automático por peldaño con descuento > 0. Devuelve los
// gids creados. El peldaño de cantidad 1 (o descuento 0) no genera descuento:
// es el precio ancla, Shopify no toca nada.
//
// Por qué un descuento POR peldaño: Shopify no tiene "precio escalonado" en un
// solo descuento. Se crea "≥2 → 10%" y "≥3 → 15%" por separado; cuando el
// carrito tiene 3, ambos califican y —al no combinar entre sí— Shopify aplica
// el más valioso (el 15%). Es el patrón estándar sin Shopify Functions.
//
// Si algo falla en el medio, el error sale con los gids que YA se crearon
// (`err.creados`). Sin eso, un fallo en el segundo peldaño deja el primero
// vivo en la tienda del merchant y sin registro: la app no lo puede borrar
// nunca más, y cada intento siguiente suma otro huérfano encima.
async function crearDescuentos(sesion, bundle, log = () => {}, { signal } = {}) {
  if (bundle.activo === false) return [];
  if (bundle.tipo === "bxgy") return await crearDescuentoBxgy(sesion, bundle, log, { signal });

  const items = itemsDelActivador(bundle.activador || { tipo: "todos" });
  const creados = [];

  try {
    await crearPeldanos(sesion, bundle, items, creados, log, { signal });
  } catch (e) {
    e.creados = creados;
    throw e;
  }
  return creados;
}

// combinesWith del descuento: lo controla el merchant en "Configuración avanzada
// → Combinación de descuentos". Defaults estilo Pumper (Pedido/Envío ON, Producto
// OFF) vía `!== false`, así los bundles viejos sin `combina` toman ese default.
function combinaDe(bundle) {
  const c = (bundle && bundle.combina) || {};
  return {
    orderDiscounts: c.pedido !== false,
    productDiscounts: !!c.producto,
    shippingDiscounts: c.envio !== false
  };
}

function resultadoMutacionAmbiguo(error) {
  if (error?.nonRetryable === true || error?.code === "TOKEN_INVALIDO") return false;
  return ["SHOPIFY_TIMEOUT", "JOB_LEASE_LOST"].includes(error?.code)
    || error?.name === "TypeError"
    || !error?.status
    || Number(error.status) >= 500;
}

async function crearPeldanos(sesion, bundle, items, creados, log, { signal } = {}) {
  for (const oferta of bundle.ofertas || []) {
    if (oferta.activo === false) continue; // nivel apagado: no crea descuento
    const tipo = oferta.tipo_desc || (Number(oferta.descuento) > 0 ? "porcentaje" : "ninguno");
    const desc = tipo === "ninguno" ? 0 : Number(oferta.descuento) || 0;
    const cant = Math.max(1, Number(oferta.cantidad) || 1);
    if (desc <= 0) continue;

    const d = {
      title: `TiendaIQ Bundle · ${bundle.nombre} · ${cant}+`.slice(0, 250),
      startsAt: new Date().toISOString(),
      customerGets: {
        value: { percentage: porcentajeValido(desc, cant) },
        items
      },
      minimumRequirement: {
        quantity: { greaterThanOrEqualToQuantity: String(cant) }
      },
      // Combinación con otros descuentos: la elige el merchant (ver combinaDe).
      combinesWith: combinaDe(bundle)
    };

    let r;
    try {
      r = await gql(M_CREAR, { d }, sesion, { signal });
    } catch (error) {
      // Sin respuesta de una mutación no podemos afirmar si Shopify alcanzó a
      // crear el descuento. El worker debe detener reintentos ciegos.
      if (resultadoMutacionAmbiguo(error)) {
        error.ambiguous = true;
      }
      throw error;
    }
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

// BXGY: "comprá X y obtené Y" con un solo descuento automático nativo.
// El activador define el scope de los dos lados. regalo_descuento 100 = gratis.
async function crearDescuentoBxgy(sesion, bundle, log = () => {}, { signal } = {}) {
  const b = bundle.bxgy || {};
  const compra = Math.max(1, Number(b.compra_cantidad) || 1);
  const regalo = Math.max(1, Number(b.regalo_cantidad) || 1);
  const desc = Math.min(100, Math.max(1, Number(b.regalo_descuento) || 100));
  const items = itemsDelActivador(bundle.activador || { tipo: "todos" });

  const d = {
    title: `TiendaIQ Bundle · ${bundle.nombre} · ${compra}x${regalo}`.slice(0, 250),
    startsAt: new Date().toISOString(),
    customerBuys: { value: { quantity: String(compra) }, items },
    customerGets: {
      value: { discountOnQuantity: { quantity: String(regalo), effect: { percentage: desc / 100 } } },
      items
    },
    combinesWith: combinaDe(bundle)
  };

  let r;
  try {
    r = await gql(M_CREAR_BXGY, { d }, sesion, { signal });
  } catch (error) {
    if (resultadoMutacionAmbiguo(error)) {
      error.ambiguous = true;
    }
    throw error;
  }
  const errores = r.discountAutomaticBxgyCreate.userErrors;
  if (errores?.length) {
    throw new Error(`BXGY: ${errores.map((e) => e.message).join(" · ")}`);
  }
  const id = r.discountAutomaticBxgyCreate.automaticDiscountNode.id;
  log(`  descuento · comprá ${compra} → ${regalo} al ${desc}% off  (${id.split("/").pop()})`);
  return [id];
}

// Re-sincroniza con una saga compensable: primero crea el reemplazo y solo
// después retira la versión anterior. Si crear falla, los descuentos viejos
// siguen activos y cualquier creación parcial se compensa. `discount_ids`
// conserva también las limpiezas pendientes para no dejar ids huérfanos.
async function sincronizarDescuentos(sesion, config, log = () => {}, { signal } = {}) {
  validarConfigBundles(config);
  for (const bundle of config.lista) {
    const anteriores = [...new Set(bundle.discount_ids || [])];

    if (bundle.activo === false) {
      const limpieza = await borrarDescuentos(sesion, anteriores, log, { signal });
      bundle.discount_ids = limpieza.fallidos;
      bundle.sync_status = limpieza.fallidos.length ? "cleanup_pending" : "inactive";
      continue;
    }

    try {
      const nuevos = await crearDescuentos(sesion, bundle, log, { signal });
      bundle.discount_ids = [...new Set([...anteriores, ...nuevos])];
      const limpieza = await borrarDescuentos(sesion, anteriores, log, { signal });
      bundle.discount_ids = [...new Set([...nuevos, ...limpieza.fallidos])];
      bundle.sync_status = limpieza.fallidos.length ? "cleanup_pending" : "active";
    } catch (e) {
      const parciales = e.creados || [];
      const compensacion = await borrarDescuentos(sesion, parciales, log, { signal });
      bundle.discount_ids = [...new Set([...anteriores, ...compensacion.fallidos])];
      bundle.sync_status = "error";
      bundle.sync_error = e.message;
      e.requierePersistencia = true;
      throw e;
    }
  }
  return config;
}

// ---------- métricas ----------
//
// Shopify mantiene un contador asíncrono por descuento. Leerlo conserva una
// señal útil para el merchant sin consultar pedidos ni datos de compradores.
// Los IDs nacen y se guardan al sincronizar cada bundle, así que tampoco
// inferimos pertenencia por títulos editables.

const Q_USO_DESCUENTOS = `query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on DiscountAutomaticNode {
      id
      automaticDiscount {
        ... on DiscountAutomaticBasic { asyncUsageCount }
        ... on DiscountAutomaticBxgy { asyncUsageCount }
      }
    }
  }
}`;

async function metricasBundles(sesion, config = configDefault()) {
  const lista = config.lista || [];
  const ids = [...new Set(lista.flatMap((bundle) => bundle.discount_ids || []).filter(Boolean))];
  const usosPorId = new Map();

  for (let inicio = 0; inicio < ids.length; inicio += 250) {
    const lote = ids.slice(inicio, inicio + 250);
    const resultado = await gql(Q_USO_DESCUENTOS, { ids: lote }, sesion);
    for (const node of resultado.nodes || []) {
      if (!node?.id) continue;
      usosPorId.set(node.id, Number(node.automaticDiscount?.asyncUsageCount || 0));
    }
  }

  const porBundle = Object.fromEntries(lista.map((bundle) => [
    bundle.id,
    { usos: (bundle.discount_ids || []).reduce((total, id) => total + (usosPorId.get(id) || 0), 0) }
  ]));

  return {
    ofertasActivas: lista.filter((bundle) => bundle.activo !== false).length,
    reglas: usosPorId.size,
    usos: [...usosPorId.values()].reduce((total, value) => total + value, 0),
    faltantes: Math.max(0, ids.length - usosPorId.size),
    actualizadoAsincrono: true,
    porBundle
  };
}

module.exports = {
  bundleDefault,
  configDefault,
  leerConfigBundles,
  guardarConfigBundles,
  validarConfigBundles,
  prepararConfigBundles,
  snapshotConfigBundles,
  configAplicadaBundles,
  bundleEsPublicable,
  sincronizarDescuentos,
  borrarDescuentos,
  metricasBundles
};
