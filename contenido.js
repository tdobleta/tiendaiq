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

// ---------- menú principal ----------
//
// El menú es contenido de TIENDA, no del theme: los 7 themes de nicho comparten
// el mismo, así que si quedó en inglés (heredado de PagePilot) se ve en todos.
// Necesita scope write_online_store_navigation.

const Q_MENUS = `{ menus(first: 20) { nodes { id handle title items { id title } } } }`;

const M_MENU_CREATE = `mutation($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
  menuCreate(title: $title, handle: $handle, items: $items) {
    menu { id handle }
    userErrors { field message }
  }
}`;

const M_MENU_UPDATE = `mutation($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
  menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
    menu { id handle }
    userErrors { field message }
  }
}`;

// Los ítems en español. "Nosotros"/"Contacto" solo si existen esas páginas.
function itemsEnEspanol(idAbout, idContact) {
  const items = [
    { title: "Inicio", type: "FRONTPAGE" },
    { title: "Comprar", type: "CATALOG" }
  ];
  if (idAbout) items.push({ title: "Nosotros", type: "PAGE", resourceId: idAbout });
  if (idContact) items.push({ title: "Contacto", type: "PAGE", resourceId: idContact });
  return items;
}

// Deja el menú principal en español. Idempotente: si ya tiene exactamente esos
// títulos, no lo reescribe.
async function asegurarMenu(sesion, { about, contact } = {}) {
  const menus = (await gql(Q_MENUS, {}, sesion)).menus.nodes || [];
  const principal = menus.find((m) => m.handle === "main-menu") || menus[0];
  const items = itemsEnEspanol(about, contact);
  const esperado = items.map((i) => i.title).join("|");

  if (principal) {
    const actual = (principal.items || []).map((i) => i.title).join("|");
    if (actual === esperado) return { handle: principal.handle, accion: "menú-ya-estaba" };

    const r = await gql(
      M_MENU_UPDATE,
      { id: principal.id, title: principal.title || "Menú principal", handle: principal.handle, items },
      sesion
    );
    if (r.menuUpdate.userErrors?.length) throw new Error("menuUpdate: " + JSON.stringify(r.menuUpdate.userErrors));
    return { handle: principal.handle, accion: "menú-traducido" };
  }

  const r = await gql(M_MENU_CREATE, { title: "Menú principal", handle: "main-menu", items }, sesion);
  if (r.menuCreate.userErrors?.length) throw new Error("menuCreate: " + JSON.stringify(r.menuCreate.userErrors));
  return { handle: "main-menu", accion: "menú-creado" };
}

// Monta el contenido base del nicho: las páginas que el theme necesita y el
// menú principal en español.
async function montarContenidoNicho(sesion) {
  const paginas = [
    { title: "Sobre nosotros", handle: "about", templateSuffix: "about" },
    { title: "Contacto", handle: "contact", templateSuffix: "contact" }
  ];
  const resultado = [];
  const ids = {};
  for (const p of paginas) {
    const r = await asegurarPagina(sesion, p);
    ids[p.handle] = r.id;
    resultado.push(r);
  }

  // Bridge para tiendas que ya traen otras handles enlazadas en el menú.
  for (const h of ["about-us", "sobre-nosotros"]) {
    const a = await adoptarSiExiste(sesion, h, "about");
    if (a) resultado.push(a);
  }

  // El menú no debe tumbar el resto si falta el scope: se avisa y sigue.
  try {
    resultado.push(await asegurarMenu(sesion, { about: ids.about, contact: ids.contact }));
  } catch (e) {
    resultado.push({ handle: "main-menu", accion: "menú-falló", error: e.message.slice(0, 160) });
  }

  return resultado;
}

module.exports = { montarContenidoNicho, asegurarPagina, asegurarMenu };
