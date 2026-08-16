"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { montarContenidoNicho, esErrorPermisoMenu } = require("../contenido");

function dependencies(asegurarMenu) {
  return {
    async asegurarPagina(_session, page) {
      return { handle: page.handle, accion: "created", id: `gid://shopify/Page/${page.handle}` };
    },
    async adoptarSiExiste() { return null; },
    asegurarMenu
  };
}

test("el scope ausente del menu conserva las paginas y devuelve un aviso explicito", async () => {
  const result = await montarContenidoNicho({}, dependencies(async () => {
    throw new Error("Access denied: requires write_online_store_navigation");
  }));

  assert.equal(result.length, 3);
  assert.deepEqual(result.at(-1), {
    handle: "main-menu",
    accion: "menu-fallo",
    code: "NAVIGATION_SCOPE_UNAVAILABLE",
    error: "Access denied: requires write_online_store_navigation"
  });
});

test("un timeout de Shopify no se transforma en un aviso de menu", async () => {
  const timeout = new Error("Shopify request timed out");
  await assert.rejects(
    montarContenidoNicho({}, dependencies(async () => { throw timeout; })),
    (error) => error === timeout
  );
});

test("el clasificador de scope no acepta errores genericos ni limites temporales", () => {
  assert.equal(esErrorPermisoMenu(new Error("write_online_store_navigation missing")), true);
  assert.equal(esErrorPermisoMenu(new Error("rate limit exceeded")), false);
  assert.equal(esErrorPermisoMenu(new Error("network timeout")), false);
});
