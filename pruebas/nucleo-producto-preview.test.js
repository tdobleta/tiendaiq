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

  test("usa la fuente y los medios de Piloto 01 cuando no existe faceta legacy", () => {
    const media = "gid://shopify/MediaImage/9";
    const salida = productoPreviewDePagina({
      titulo: "Fallback",
      urls: { [media]: "https://cdn.shopify.com/piloto.webp" },
      data: {
        piloto_pdp_01: {
          source_fields: { title: "Producto Piloto", media_ids: [media], variants: [] },
          content: { media: { hero_media_id: media, gallery_media_ids: [media] }, offer: { packs: [{ variant_id: "gid://shopify/ProductVariant/9" }] } }
        }
      }
    });
    assert.equal(salida.titulo, "Producto Piloto");
    assert.equal(salida.imagenes[0].src, "https://cdn.shopify.com/piloto.webp");
    assert.equal(salida.variante_id, "gid://shopify/ProductVariant/9");
  });

  test("expone variantes reales para que el editor no dibuje un selector decorativo", () => {
    const salida = productoPreviewDePagina({
      titulo: "Variantes",
      data: { source_fields: { title: "Producto", variants: [
        { id: "gid://shopify/ProductVariant/1", title: "Negro" },
        { id: "gid://shopify/ProductVariant/2", title: "Azul", available: false }
      ] } }
    });
    assert.deepEqual(salida.variantes, [
      { id: "gid://shopify/ProductVariant/1", titulo: "Negro", disponible: true },
      { id: "gid://shopify/ProductVariant/2", titulo: "Azul", disponible: false }
    ]);
    assert.deepEqual(salida.variants, salida.variantes);
  });
});
