// ============================================================
// TIENDAS — el registro de merchants instalados.
//
// La persistencia vive en db.js (Postgres en producción, archivos en local).
// Acá queda solo la lógica: normalizar dominios, validar, armar la sesión.
// Todo lo que toca la base es async.
// ============================================================

const { guardarTiendaDB, leerTiendaDB, borrarTiendaDB, listarTiendasDB,
        incrementarUsoDB, decrementarUsoDB, actualizarCamposTiendaDB } = require("./db");
const { TenantContext } = require("./src/tenancy/tenant-context");

// Shopify manda el dominio de mil formas: con https://, con barra, en el claim
// `dest` del pase. Se normaliza siempre a "xxx.myshopify.com".
function normalizar(dominio) {
  return String(dominio || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function esDominioValido(dominio) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalizar(dominio));
}

async function guardarTienda(dominio, token, extra = {}) {
  const d = normalizar(dominio);
  if (!esDominioValido(d)) throw new Error(`Dominio inválido: ${dominio}`);

  const previo = (await leerTiendaDB(d)) || {};
  const registro = {
    dominio: d,
    token,
    instalada: previo.instalada || new Date().toISOString(),
    actualizada: new Date().toISOString(),
    ...extra
  };
  await guardarTiendaDB(d, registro);
  return registro;
}

async function leerTienda(dominio) {
  return leerTiendaDB(normalizar(dominio));
}

async function borrarTienda(dominio) {
  return borrarTiendaDB(normalizar(dominio));
}

async function listarTiendas() {
  return listarTiendasDB();
}

// Reserva ATÓMICA de una página del cupo del mes. Devuelve el nuevo total, o
// null si no queda cupo (sin pisarse entre requests concurrentes). limite null
// = sin tope (pro).
async function consumirCupoTienda(dominio, mes, limite) {
  return incrementarUsoDB(normalizar(dominio), mes, limite);
}
// Devuelve una página al cupo (si la generación falló tras reservar).
async function revertirCupoTienda(dominio, mes) {
  return decrementarUsoDB(normalizar(dominio), mes);
}
// Actualiza SOLO ciertos campos (plan, plan_verificado…) sin reescribir todo el
// registro → no pisa uso ni token (fin de los lost updates).
async function actualizarCamposTienda(dominio, campos) {
  return actualizarCamposTiendaDB(normalizar(dominio), campos);
}

// La sesión es lo que viaja por toda la app: quién es y con qué token.
// Nada llama a Shopify sin una de estas.
async function sesionDe(dominio) {
  const context = dominio instanceof TenantContext ? dominio : null;
  const tienda = context ? context.tenantId : normalizar(dominio);
  const t = await leerTiendaDB(context || tienda);
  if (!t) {
    const e = new Error(`La tienda ${tienda} no tiene la app instalada`);
    e.code = "TIENDA_NO_INSTALADA";
    e.status = 401;
    e.tienda = tienda;
    throw e;
  }
  return { tienda: t.dominio, token: t.token };
}

module.exports = {
  normalizar,
  esDominioValido,
  guardarTienda,
  leerTienda,
  borrarTienda,
  listarTiendas,
  consumirCupoTienda,
  revertirCupoTienda,
  actualizarCamposTienda,
  sesionDe
};
