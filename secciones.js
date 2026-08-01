// ============================================================
// SECCIONES — catálogo estilo Section Store + instalación en el tema.
//
// A diferencia de bundles/cod (que son app embeds vía theme app extension),
// las SECCIONES son archivos Liquid de SECTION que la app ESCRIBE en el tema
// del merchant (sections/… + assets/…). Una vez escritas, Shopify dibuja SOLO
// el panel de edición y los bloques desde el {% schema %} de la section —
// exactamente como Section Store, con selección NATIVA de video.
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
// Los `opcionales` se suben solo si existen en disco (ej. el video demo mp4,
// que lo deja el usuario en secciones-tema/).
const CATALOGO = [
  {
    tipo: "tiendaiq-video-slider",
    nombre: "Video slider",
    desc: "Carrusel de videos verticales con reseña (título + estrellas)",
    cats: ["popular", "video", "testimonial"],
    archivos: [
      { src: "tiendaiq-video-slider.liquid", dest: "sections/tiendaiq-video-slider.liquid" },
      { src: "tiendaiq-vs.css", dest: "assets/tiendaiq-vs.css" },
      { src: "tiendaiq-vs.js", dest: "assets/tiendaiq-vs.js" },
      { src: "tiendaiq-vs-demo.svg", dest: "assets/tiendaiq-vs-demo.svg" }
    ],
    opcionales: [
      { src: "tiendaiq-vs-demo.mp4", dest: "assets/tiendaiq-vs-demo.mp4" }
    ]
  }
];

const seccionPorTipo = (tipo) => CATALOGO.find((s) => s.tipo === tipo);

// El catálogo público para la app (sin las rutas de archivo internas).
function catalogoPublico() {
  return CATALOGO.map(({ tipo, nombre, desc, cats }) => ({ tipo, nombre, desc, cats }));
}

const Q_TEMA = `{ themes(first: 1, roles: [MAIN]) { nodes { id name } } }`;
const Q_TEMAS = `{ themes(first: 25) { nodes { id name role } } }`;

// Lista de temas de la tienda (para el selector estilo Section Store: el
// merchant elige a cuál inyectar). El MAIN/live queda marcado.
async function listarTemas(sesion) {
  const nodes = (await gql(Q_TEMAS, {}, sesion)).themes.nodes || [];
  // Se ocultan los temas descargados/borrador de sistema si hiciera falta; por
  // ahora se muestran todos los que el merchant puede editar.
  return nodes
    .filter((t) => t.role !== "DEMO")
    .map((t) => ({ id: t.id, name: t.name, live: t.role === "MAIN" }));
}

// id numérico del tema (para el deep link del editor) a partir del gid.
const idNumericoTema = (gid) => String(gid || "").split("/").pop();

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

// Los archivos a subir: obligatorios siempre + opcionales si existen en disco.
// El mp4 se sube como binario base64 (BASE64), el resto como texto (TEXT).
function archivosDe(def) {
  const files = def.archivos.map((a) => ({
    filename: a.dest,
    body: { type: "TEXT", value: fs.readFileSync(path.join(DIR, a.src), "utf8") }
  }));
  for (const a of def.opcionales || []) {
    const ruta = path.join(DIR, a.src);
    if (fs.existsSync(ruta)) {
      files.push({ filename: a.dest, body: { type: "BASE64", value: fs.readFileSync(ruta).toString("base64") } });
    }
  }
  return files;
}

// Escribe (idempotente) los archivos de la sección en el tema elegido (gid). Si
// no se pasa themeId, va al MAIN. No toca theme.liquid: el merchant agrega la
// sección desde el editor de temas ("Agregar sección"), que da el panel nativo.
async function instalarSeccion(sesion, tipo, themeId, log = () => {}) {
  const def = seccionPorTipo(tipo);
  if (!def) throw new Error(`Sección desconocida: ${tipo}`);
  const id = themeId || (await temaMain(sesion)).id;

  const files = archivosDe(def);
  const r = await gql(M_ARCHIVOS, { themeId: id, files }, sesion);
  const errs = r.themeFilesUpsert.userErrors;
  if (errs.length) throw new Error("Sección: " + JSON.stringify(errs));
  log(`  archivos · ${r.themeFilesUpsert.upsertedThemeFiles.length} escritos`);
  return { themeId: id, tipo };
}

// ¿Ya está el archivo de section en el tema? (para el estado "Instalada").
async function seccionInstalada(sesion, tipo, themeId) {
  const def = seccionPorTipo(tipo);
  if (!def) return false;
  const id = themeId || (await temaMain(sesion)).id;
  const nombre = def.archivos[0].dest; // sections/….liquid
  const r = await gql(Q_ARCHIVO, { id, nombres: [nombre] }, sesion);
  return (r.theme?.files?.nodes || []).length > 0;
}

module.exports = { CATALOGO, catalogoPublico, seccionPorTipo, instalarSeccion, seccionInstalada, listarTemas, idNumericoTema };
