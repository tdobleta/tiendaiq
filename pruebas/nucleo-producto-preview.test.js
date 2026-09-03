const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { productoPreviewDePagina } = require("../nucleo/producto-preview");

describe("proyección de producto para el preview", () => {
  test("arma galería, precio y variante sin mutar la página", () => {
    const pagina = {
      titulo: "Página",
      urls: { uno: "https://cdn.shopify.com/uno.webp", dos: "https://cdn.shopify.com/dos.webp" },
      data: {
        fuente: { titulo_crudo: "Producto real", precio: "19.95", precio_comparativo: "35.91", moneda: "ARS" },
        facetas: { hero: { galeria: ["uno", "dos"] } },
        content: { offer: { packs: [{ variant_id: "gid://shopify/ProductVariant/7" }] } }
      }
    };
    const salida = productoPreviewDePagina(pagina);
    assert.equal(salida.titulo, "Producto real");
    assert.equal(salida.precio_formateado, "19.95 ARS");
    assert.equal(salida.precio_anterior_formateado, "35.91 ARS");
    assert.equal(salida.variante_id, "gid://shopify/ProductVariant/7");
    assert.deepEqual(salida.imagenes.map((imagen) => imagen.src), [
      "https://cdn.shopify.com/uno.webp", "https://cdn.shopify.com/dos.webp"
    ]);
    assert.equal(Object.hasOwn(pagina, "producto_preview"), false);
  });

  test("no convierte referencias sin URL en imágenes renderizables", () => {
    const salida = productoPreviewDePagina({ data: { facetas: { hero: { galeria: ["gid://shopify/MediaImage/404"] } } } });
    assert.deepEqual(salida.imagenes, []);
  });
});
