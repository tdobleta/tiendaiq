// Contrato puro de la frontera de publicación v1.
//
// Estas pruebas no llaman a Shopify: verifican antes del efecto externo que el
// editor solo pueda publicar un documento válido y ligado al producto de la
// página. La mutación GraphQL queda cubierta por las pruebas del cliente.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const documento = require("../nucleo/documento");
const { documentoParaPublicar } = require("../nucleo/publicar-v1");

function paginaConBorrador() {
  const doc = documento.crear({
    tienda: "demo.myshopify.com",
    producto_id: "gid://shopify/Product/123",
    titulo: "Página v1"
  });
  doc.id = "pag_publicar";
  return {
    id: "pag_publicar",
    tienda: "demo.myshopify.com",
    shopify_product_id: "gid://shopify/Product/123",
    documento_borrador: doc
  };
}

describe("frontera de publicación v1", () => {
  test("publica una copia validada del borrador y conserva la identidad", () => {
    const pagina = paginaConBorrador();
    const salida = documentoParaPublicar(pagina);

    assert.equal(salida.productoId, pagina.shopify_product_id);
    assert.equal(salida.documento.version, 1);
    assert.equal(salida.documento.id, pagina.id);
    assert.notEqual(salida.documento, pagina.documento_borrador);
    assert.equal(salida.documento.titulo, "Página v1");
  });

  test("rechaza publicar sin borrador v1", () => {
    assert.throws(
      () => documentoParaPublicar({ shopify_product_id: "gid://shopify/Product/123" }),
      /borrador v1/
    );
  });

  test("rechaza un documento ligado a otro producto", () => {
    const pagina = paginaConBorrador();
    pagina.documento_borrador = {
      ...pagina.documento_borrador,
      producto_id: "gid://shopify/Product/999"
    };
    assert.throws(() => documentoParaPublicar(pagina), /otro producto/);
  });

  test("rechaza un documento ligado a otra página o tienda", () => {
    const pagina = paginaConBorrador();
    pagina.documento_borrador = { ...pagina.documento_borrador, id: "pag_otra" };
    assert.throws(() => documentoParaPublicar(pagina), /página/);

    const otra = paginaConBorrador();
    otra.documento_borrador = { ...otra.documento_borrador, tienda: "otra.myshopify.com" };
    assert.throws(() => documentoParaPublicar(otra), /tienda/);
  });

  test("rechaza un borrador que dejó de cumplir el schema", () => {
    const pagina = paginaConBorrador();
    pagina.documento_borrador.inventada = true;
    assert.throws(() => documentoParaPublicar(pagina), /no es válido/);
  });
});
