// ============================================================
// TOKENS — la paleta de la página, con nombre y no con hex sueltos.
//
// Un bloque nunca guarda "#1D3B1D": guarda "@titulos". La diferencia parece
// cosmética y no lo es. Si cada bloque guarda el hex, cambiar el branding no
// cambia nada de lo ya creado y el sistema de colores queda de adorno; el
// merchant termina editando cincuenta bloques a mano. Guardando la referencia,
// cambiar de preset son nueve valores y la página entera se mueve con él.
//
// Los tokens salen al DOM como custom properties (--tiq-*). Por eso cambiar de
// preset NO re-renderiza el árbol: reescribe nueve variables de CSS.
//
// Invariante I4 (ver docs/arquitectura-editor-v3.md §2): lo que no está escrito
// en el nodo se hereda. Este archivo es la parte de "de dónde se hereda".
// ============================================================

"use strict";

// El orden importa: es el que se muestra en el panel de Branding.
const CLAVES_TOKEN = [
  "primario",
  "primario_suave",
  "secundario",
  "secundario_suave",
  "boton_fondo",
  "boton_texto",
  "titulos",
  "subtitulos",
  "parrafos"
];

// Etiquetas para el panel. Viven acá y no en el frontend porque el mismo mapa
// lo necesita el prompt de la IA cuando le explicamos qué significa cada token.
const NOMBRES_TOKEN = {
  primario: "Primario",
  primario_suave: "Primario suave",
  secundario: "Secundario",
  secundario_suave: "Secundario suave",
  boton_fondo: "Fondo de botones",
  boton_texto: "Texto de botones",
  titulos: "Títulos",
  subtitulos: "Subtítulos",
  parrafos: "Párrafos"
};

const PRESETS = {
  verde: {
    nombre: "Verde",
    tokens: {
      primario: "#1D3B1D", primario_suave: "#FCFCF7",
      secundario: "#E9F0CA", secundario_suave: "#F8FAEF",
      boton_fondo: "#1D3B1D", boton_texto: "#FCFCF7",
      titulos: "#1D3B1D", subtitulos: "#1D3B1D", parrafos: "#1D3B1D"
    }
  },
  azul: {
    nombre: "Azul",
    tokens: {
      primario: "#12305C", primario_suave: "#F7FAFF",
      secundario: "#CFE0F7", secundario_suave: "#F0F5FD",
      boton_fondo: "#12305C", boton_texto: "#F7FAFF",
      titulos: "#0E2547", subtitulos: "#1B3D6E", parrafos: "#233247"
    }
  },
  violeta: {
    nombre: "Violeta",
    tokens: {
      primario: "#4A2A7A", primario_suave: "#FAF8FF",
      secundario: "#DED2F5", secundario_suave: "#F4F0FD",
      boton_fondo: "#4A2A7A", boton_texto: "#FAF8FF",
      titulos: "#331E56", subtitulos: "#4A2A7A", parrafos: "#332B3F"
    }
  },
  rosa: {
    nombre: "Rosa",
    tokens: {
      primario: "#9B2058", primario_suave: "#FFF8FB",
      secundario: "#F7D3E2", secundario_suave: "#FDF1F6",
      boton_fondo: "#9B2058", boton_texto: "#FFF8FB",
      titulos: "#3D1024", subtitulos: "#7A1A46", parrafos: "#42222E"
    }
  },
  amarillo: {
    nombre: "Amarillo",
    tokens: {
      primario: "#7A5A05", primario_suave: "#FFFCF2",
      secundario: "#FBE7A1", secundario_suave: "#FEF8E4",
      boton_fondo: "#7A5A05", boton_texto: "#FFFCF2",
      titulos: "#3F2E02", subtitulos: "#7A5A05", parrafos: "#3B3327"
    }
  },
  turquesa: {
    nombre: "Turquesa",
    tokens: {
      primario: "#0C4F52", primario_suave: "#F5FDFD",
      secundario: "#C7EBEA", secundario_suave: "#EDF9F9",
      boton_fondo: "#0C4F52", boton_texto: "#F5FDFD",
      titulos: "#08383A", subtitulos: "#0C4F52", parrafos: "#20383A"
    }
  },
  gris: {
    nombre: "Gris",
    tokens: {
      primario: "#1F2328", primario_suave: "#FBFBFC",
      secundario: "#E4E6E9", secundario_suave: "#F4F5F6",
      boton_fondo: "#1F2328", boton_texto: "#FBFBFC",
      titulos: "#14171A", subtitulos: "#1F2328", parrafos: "#3A4046"
    }
  }
};

const PRESET_POR_DEFECTO = "verde";

// Tres pasos, no un número libre: el merchant elige una intención, no un píxel.
// Un slider de radio suelto es la forma más rápida de que una tienda quede fea.
const RADIOS = { ninguno: "0px", pequeno: "8px", grande: "20px" };
const RADIO_POR_DEFECTO = "pequeno";

const TIPOGRAFIAS = {
  sistema: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  grotesca: '"Archivo", "Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: '"Instrument Serif", Georgia, "Times New Roman", serif'
};
const TIPOGRAFIA_POR_DEFECTO = { titulos: "grotesca", cuerpo: "sistema" };

const HEX = /^#[0-9A-Fa-f]{6}$/;

// Una referencia es "@nombre_de_token". Sin arroba es un valor literal.
function esReferencia(valor) {
  return typeof valor === "string" && valor.startsWith("@");
}

// Resuelve los nueve tokens de un branding: preset + overrides puntuales.
// Un branding vacío es válido y devuelve el preset por defecto completo.
function tokensDe(branding = {}) {
  const preset = PRESETS[branding.preset] || PRESETS[PRESET_POR_DEFECTO];
  const propios = branding.tokens || {};
  const salida = {};
  for (const clave of CLAVES_TOKEN) {
    const override = propios[clave];
    salida[clave] = HEX.test(override) ? override : preset.tokens[clave];
  }
  return salida;
}

// Convierte "@titulos" en el hex correspondiente. Un token desconocido devuelve
// null (= "sin color") en vez de romper: el render nunca tira la página abajo.
// Que la referencia sea válida lo garantiza el validador en el borde, no acá.
function desreferenciar(valor, tokens) {
  if (!esReferencia(valor)) return valor;
  const clave = valor.slice(1);
  return Object.prototype.hasOwnProperty.call(tokens, clave) ? tokens[clave] : null;
}

function radioDe(branding = {}) {
  return RADIOS[branding.radio] || RADIOS[RADIO_POR_DEFECTO];
}

function tipografiasDe(branding = {}) {
  const elegidas = { ...TIPOGRAFIA_POR_DEFECTO, ...(branding.tipografia || {}) };
  return {
    titulos: TIPOGRAFIAS[elegidas.titulos] || TIPOGRAFIAS.grotesca,
    cuerpo: TIPOGRAFIAS[elegidas.cuerpo] || TIPOGRAFIAS.sistema
  };
}

// Las variables que se pintan en el contenedor del documento. Es la única vía
// por la que un color de marca llega al CSS: ningún bloque escribe un hex.
function variablesCss(branding = {}) {
  const tokens = tokensDe(branding);
  const fuentes = tipografiasDe(branding);
  const partes = CLAVES_TOKEN.map((clave) => `--tiq-${clave}:${tokens[clave]}`);
  partes.push(`--tiq-radio:${radioDe(branding)}`);
  partes.push(`--tiq-fuente-titulos:${fuentes.titulos}`);
  partes.push(`--tiq-fuente-cuerpo:${fuentes.cuerpo}`);
  return partes.join(";") + ";";
}

// Para la librería de presets del panel de Branding.
function listaPresets() {
  return Object.entries(PRESETS).map(([id, preset]) => ({
    id,
    nombre: preset.nombre,
    muestra: [preset.tokens.primario, preset.tokens.secundario_suave, preset.tokens.secundario]
  }));
}

module.exports = {
  CLAVES_TOKEN, NOMBRES_TOKEN, PRESETS, PRESET_POR_DEFECTO,
  RADIOS, RADIO_POR_DEFECTO, TIPOGRAFIAS, TIPOGRAFIA_POR_DEFECTO,
  esReferencia, tokensDe, desreferenciar, radioDe, tipografiasDe,
  variablesCss, listaPresets
};
