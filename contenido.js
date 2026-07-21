// ============================================================
// CONTENIDO DE TIENDA — páginas/menús que la inyección crea en la tienda
// del cliente para que el theme del nicho quede completo.
//
// Idempotente: si la página ya existe, no la duplica; solo se asegura de que
// tenga el templateSuffix correcto (para que tome el template del nicho).
//
// Necesita sesión con scope write_content (read_content para buscar).
// ============================================================

const { gql } = require("./shopify");

const Q_PAGE = `query($q: String!) {
  pages(first: 1, query: $q) { nodes { id handle templateSuffix title } }
}`;

const M_CREATE = `mutation($page: PageCreateInput!) {
  pageCreate(page: $page) { page { id handle templateSuffix } userErrors { field message } }
}`;

const M_UPDATE = `mutation($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) { page { id handle templateSuffix } userErrors { field message } }
}`;

// Asegura que exista una página con ese handle y templateSuffix. Devuelve la acción.
async function asegurarPagina(sesion, { title, handle, templateSuffix, body = "" }) {
  const encontrada = (await gql(Q_PAGE, { q: `handle:${handle}` }, sesion)).pages.nodes[0];

  if (encontrada) {
    if (encontrada.templateSuffix !== templateSuffix) {
      const r = await gql(M_UPDATE, { id: encontrada.id, page: { templateSuffix } }, sesion);
      if (r.pageUpdate.userErrors?.length) throw new Error("pageUpdate: " + JSON.stringify(r.pageUpdate.userErrors));
      return { handle, accion: "template-actualizado", id: encontrada.id };
    }
    return { handle, accion: "ya-existía", id: encontrada.id };
  }

  const r = await gql(M_CREATE, { page: { title, handle, templateSuffix, isPublished: true, body } }, sesion);
  if (r.pageCreate.userErrors?.length) throw new Error("pageCreate: " + JSON.stringify(r.pageCreate.userErrors));
  return { handle, accion: "creada", id: r.pageCreate.page.id };
}

// Monta el contenido base del nicho: las páginas que el theme necesita.
// (Menús y políticas se suman después, mismo patrón idempotente.)
async function montarContenidoNicho(sesion) {
  const paginas = [
    { title: "Sobre nosotros", handle: "about", templateSuffix: "about" },
    { title: "Contacto", handle: "contact", templateSuffix: "contact" }
  ];
  const resultado = [];
  for (const p of paginas) resultado.push(await asegurarPagina(sesion, p));
  return resultado;
}

module.exports = { montarContenidoNicho, asegurarPagina };
