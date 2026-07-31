// ============================================================
// SECCIONES — catálogo estilo Section Store + instalación en el tema.
//
// A diferencia de bundles/cod (que son app embeds vía theme app extension),
// las SECCIONES son archivos Liquid de SECTION que la app ESCRIBE en el tema
// del merchant (sections/… + assets/…). Una vez escritas, Shopify dibuja SOLO
// el panel de edición y los bloques desde el {% schema %} de la section —
// exactamente como Section Store.
//
// OJO compliance: esto usa write_themes. Requiere la exención de escritura de
// temas de Shopify para publicar en el App Store (categoría page-builder/
// sections). En dev/testing funciona apenas la tienda re-autoriza. Ver
// appstore-compliance.
// ============================================================

const fs = require("fs");
const path = require("path");
const { gql } = require("./shopify");

const DIR = path.join(__dirname, "secciones-tema");

// Catálogo. Cada sección: tipo (= nombre de la section en el tema, sin ext),
// metadata para la galería y los archivos a escribir (origen → destino).
const CATALOGO = [
  {
    tipo: "tiendaiq-video-slider",
    nombre: "Video slider",
    desc: "Carrusel de videos verticales con reseña (título + estrellas)",
    cats: ["popular", "video", "testimonial"],
    archivos: [
      { src: "tiendaiq-video-slider.liquid", dest: "sections/tiendaiq-video-slider.liquid" },
      { src: "tiendaiq-vs.css", dest: "assets/tiendaiq-vs.css" },
      { src: "tiendaiq-vs.js", dest: "assets/tiendaiq-vs.js" }
    ]
  }
];

const seccionPorTipo = (tipo) => CATALOGO.find((s) => s.tipo === tipo);

// El catálogo público para la app (sin las rutas de archivo internas).
function catalogoPublico() {
  return CATALOGO.map(({ tipo, nombre, desc, cats }) => ({ tipo, nombre, desc, cats }));
}

const Q_TEMA = `{ themes(first: 1, roles: [MAIN]) { nodes { id name } } }`;

const Q_ARCHIVO = `query($id: ID!, $nombres: [String!]!) {
  theme(id: $id) {
    files(filenames: $nombres, first: 1) {
      nodes { filename }
    }
  }
}`;

const M_ARCHIVOS = `mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { field message }
  }
}`;

async function temaMain(sesion) {
  const tema = (await gql(Q_TEMA, {}, sesion)).themes.nodes[0];
  if (!tema) throw new Error("La tienda no tiene tema principal.");
  return tema;
}

// Escribe (idempotente) los archivos de la sección en el tema principal.
// Devuelve { tema, tipo }. No toca theme.liquid: el merchant agrega la sección
// desde el editor de temas ("Agregar sección"), que es lo que da el panel nativo.
async function instalarSeccion(sesion, tipo, log = () => {}) {
  const def = seccionPorTipo(tipo);
  if (!def) throw new Error(`Sección desconocida: ${tipo}`);
  const tema = await temaMain(sesion);
  log(`  tema · ${tema.name}`);

  const files = def.archivos.map((a) => ({
    filename: a.dest,
    body: { type: "TEXT", value: fs.readFileSync(path.join(DIR, a.src), "utf8") }
  }));
  const r = await gql(M_ARCHIVOS, { themeId: tema.id, files }, sesion);
  const errs = r.themeFilesUpsert.userErrors;
  if (errs.length) throw new Error("Sección: " + JSON.stringify(errs));
  log(`  archivos · ${r.themeFilesUpsert.upsertedThemeFiles.length} escritos`);
  return { tema: tema.name, tipo };
}

// ¿Ya está el archivo de section en el tema? (para el estado "Instalada").
async function seccionInstalada(sesion, tipo) {
  const def = seccionPorTipo(tipo);
  if (!def) return false;
  const tema = await temaMain(sesion);
  const nombre = def.archivos[0].dest; // sections/….liquid
  const r = await gql(Q_ARCHIVO, { id: tema.id, nombres: [nombre] }, sesion);
  return (r.theme?.files?.nodes || []).length > 0;
}

module.exports = { CATALOGO, catalogoPublico, seccionPorTipo, instalarSeccion, seccionInstalada };
