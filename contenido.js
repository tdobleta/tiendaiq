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

// Adopta una página YA existente (no la crea): le pone nuestro templateSuffix.
// Sirve para tiendas que ya traen una About de otro proveedor enlazada en el
// menú (ej. "about-us" de PagePilot) — así muestra nuestra landing sin tocar
// el menú.
async function adoptarSiExiste(sesion, handle, templateSuffix) {
  const p = (await gql(Q_PAGE, { q: `handle:${handle}` }, sesion)).pages.nodes[0];
  if (!p) return null;
  if (p.templateSuffix === templateSuffix) return { handle, accion: "ya-adoptada", id: p.id };
  const r = await gql(M_UPDATE, { id: p.id, page: { templateSuffix } }, sesion);
  if (r.pageUpdate.userErrors?.length) throw new Error("pageUpdate: " + JSON.stringify(r.pageUpdate.userErrors));
  return { handle, accion: "adoptada", id: p.id };
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

  // Bridge para tiendas que ya traen otras handles enlazadas en el menú.
  for (const h of ["about-us", "sobre-nosotros"]) {
    const a = await adoptarSiExiste(sesion, h, "about");
    if (a) resultado.push(a);
  }
  return resultado;
}

module.exports = { montarContenidoNicho, asegurarPagina };
