// ============================================================
// TIENDAS — el registro de merchants instalados.
//
// La persistencia vive en db.js (Postgres en producción, archivos en local).
// Acá queda solo la lógica: normalizar dominios, validar, armar la sesión.
// Todo lo que toca la base es async.
// ============================================================

const { guardarTiendaDB, leerTiendaDB, borrarTiendaDB, listarTiendasDB } = require("./db");

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

// La sesión es lo que viaja por toda la app: quién es y con qué token.
// Nada llama a Shopify sin una de estas.
async function sesionDe(dominio) {
  const t = await leerTiendaDB(normalizar(dominio));
  if (!t) throw new Error(`La tienda ${normalizar(dominio)} no tiene la app instalada`);
  return { tienda: t.dominio, token: t.token };
}

module.exports = {
  normalizar,
  esDominioValido,
  guardarTienda,
  leerTienda,
  borrarTienda,
  listarTiendas,
  sesionDe
};
