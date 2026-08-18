const { test } = require("node:test");
const assert = require("node:assert/strict");
const { urlInicioAppShopify } = require("../shopify-admin-url");

test("App Home usa el handle público, no el client ID", () => {
  assert.equal(
    urlInicioAppShopify("Tienda-Prueba-IQ.myshopify.com", {
      appHandle: "tiendaiq-staging"
    }),
    "https://admin.shopify.com/store/tienda-prueba-iq/apps/tiendaiq-staging/app"
  );
});

test("el retorno de billing conserva App Home y agrega parámetros", () => {
  assert.equal(
    urlInicioAppShopify("prueba.myshopify.com", {
      appHandle: "tiendaiq-app",
      query: { plan: "confirmado" }
    }),
    "https://admin.shopify.com/store/prueba/apps/tiendaiq-app/app?plan=confirmado"
  );
});

test("rechaza dominio o handle inválidos en vez de fabricar un 404", () => {
  assert.throws(
    () => urlInicioAppShopify("otra.example.com", { appHandle: "tiendaiq-app" }),
    /Dominio Shopify inválido/
  );
  assert.throws(
    () => urlInicioAppShopify("prueba.myshopify.com", { appHandle: "" }),
    /SHOPIFY_APP_HANDLE es obligatorio/
  );
  assert.throws(
    () => urlInicioAppShopify("prueba.myshopify.com", { appHandle: "Client_ID/extra" }),
    /slug válido/
  );
});
