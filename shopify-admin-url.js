// Construye la URL canónica de App Home dentro de Shopify Admin.
// El client ID identifica la app para OAuth, pero no es su slug de navegación.

function slugTienda(tienda) {
  const dominio = String(tienda || "").trim().toLowerCase();
  const match = /^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/.exec(dominio);
  if (!match) throw new Error("Dominio Shopify inválido para App Home");
  return match[1];
}

function handleApp(valor) {
  const handle = String(valor || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(handle)) {
    throw new Error("SHOPIFY_APP_HANDLE es obligatorio y debe ser un slug válido");
  }
  return handle;
}

function urlInicioAppShopify(tienda, { appHandle, query = {} } = {}) {
  const url = new URL(
    `https://admin.shopify.com/store/${slugTienda(tienda)}/apps/${handleApp(appHandle)}/app`
  );

  for (const [key, value] of Object.entries(query)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

module.exports = { urlInicioAppShopify, slugTienda, handleApp };
