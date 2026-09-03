// ============================================================
// REGISTRO — el catálogo de tipos de bloque, y el guardián de su forma.
//
// Este archivo es la razón por la que el editor puede tener 39 secciones sin
// tener 39 paneles: el editor NO conoce ningún tipo. Le pregunta al registro
// qué tipos hay, qué campos tiene cada uno y de qué clase es cada campo, y con
// eso arma la UI. Agregar una sección no toca el editor (invariante I3).
//
// La validación de las definiciones corre al cargar el módulo, a propósito. Un
// tipo mal declarado revienta el arranque del servidor y lo agarra `npm run
// probar` en CI. La alternativa —descubrirlo al renderizar— lo agarraría el
// merchant, en su tienda, con tráfico encima.
//
// El conjunto de clases de campo es CERRADO (TIPOS_CAMPO). El panel solo sabe
// dibujar esas. Ampliarlo es una decisión de arquitectura, no un atajo para
// sacar una sección: en la práctica, el 90% de las veces que parece faltar una
// clase de campo, lo que hay es una `lista` mal modelada.
// ============================================================

"use strict";

const definiciones = require("./tipos/indice");

// Las 16 clases de control. Ver docs/arquitectura-editor-v3.md §3.4.
const TIPOS_CAMPO = new Set([
  "texto_plano", "texto_largo", "richtext",
  "numero", "medida", "booleano",
  "seleccion", "segmentado",
  "token_color", "color",
  "imagen", "video", "icono", "enlace",
  "lista", "producto"
]);

// Las categorías de la librería de secciones. Espejan al competidor para que
// el merchant que migra encuentre las cosas donde espera.
const CATEGORIAS = new Set([
  "contenido", "prueba_social", "beneficios", "imagen_contenido",
  "conversion", "faq", "garantia", "layout", "integraciones", "producto"
]);

const NOMBRES_CATEGORIA = {
  contenido: "Contenido",
  prueba_social: "Prueba social y confianza",
  beneficios: "Beneficios y características",
  imagen_contenido: "Imagen y contenido",
  conversion: "Conversión / CTA",
  faq: "Preguntas frecuentes",
  garantia: "Garantía",
  layout: "Estructura",
  integraciones: "Integraciones",
  producto: "Producto"
};

class RegistroInvalido extends Error {
  constructor(errores) {
    super(`Definiciones de tipo inválidas:\n  - ${errores.join("\n  - ")}`);
    this.name = "RegistroInvalido";
    this.errores = errores;
  }
}

const esTexto = (v) => typeof v === "string" && v.length > 0;

// Normaliza un campo y valida su forma. `responsive` efectivo se calcula acá:
// el campo manda sobre el grupo. El resolver lee ese valor ya resuelto y no
// vuelve a mirar el grupo, así no hay dos lugares que puedan discrepar.
function normalizarCampo(campo, grupo, tipo, errores) {
  const donde = `${tipo}.${grupo.id}.${campo && campo.clave}`;
  if (!campo || !esTexto(campo.clave)) {
    errores.push(`${tipo}.${grupo.id}: hay un campo sin clave`);
    return null;
  }
  if (!TIPOS_CAMPO.has(campo.tipo)) {
    errores.push(`${donde}: clase de campo desconocida "${campo.tipo}" (ver TIPOS_CAMPO)`);
    return null;
  }
  if (!esTexto(campo.etiqueta)) errores.push(`${donde}: falta etiqueta`);

  if (campo.tipo === "seleccion" || campo.tipo === "segmentado") {
    const opciones = campo.opciones;
    if (!Array.isArray(opciones) || opciones.length === 0) {
      errores.push(`${donde}: un campo ${campo.tipo} necesita opciones`);
    } else {
      const valores = opciones.map((o) => o && o[0]);
      if (valores.some((v) => !esTexto(v))) errores.push(`${donde}: cada opción es [valor, etiqueta]`);
      if (campo.defecto !== null && campo.defecto !== undefined && !valores.includes(campo.defecto)) {
        errores.push(`${donde}: el defecto "${campo.defecto}" no está entre las opciones`);
      }
      if (campo.mapa_css) {
        const faltan = valores.filter((v) => !Object.prototype.hasOwnProperty.call(campo.mapa_css, v));
        if (faltan.length) errores.push(`${donde}: mapa_css no cubre ${faltan.join(", ")}`);
      }
    }
  }

  if (campo.tipo === "lista" && !Array.isArray(campo.item_campos)) {
    errores.push(`${donde}: un campo lista necesita item_campos`);
  }

  if (campo.mapa_css && !campo.css) errores.push(`${donde}: declara mapa_css pero no css`);
  if (campo.unidad !== undefined && !campo.css) errores.push(`${donde}: declara unidad pero no css`);

  return {
    ...campo,
    responsive: campo.responsive === undefined ? !!grupo.responsive : !!campo.responsive,
    grupo: grupo.id
  };
}

function normalizar(definicion, errores) {
  const tipo = definicion && definicion.tipo;
  if (!esTexto(tipo)) {
    errores.push("hay una definición sin `tipo`");
    return null;
  }
  if (!esTexto(definicion.nombre)) errores.push(`${tipo}: falta nombre`);
  if (!CATEGORIAS.has(definicion.categoria)) errores.push(`${tipo}: categoría desconocida "${definicion.categoria}"`);
  if (typeof definicion.render !== "function") errores.push(`${tipo}: falta la función render`);
  if (typeof definicion.admite_hijos !== "boolean") errores.push(`${tipo}: admite_hijos tiene que ser booleano`);

  const limite = definicion.limite_por_pagina;
  if (limite !== null && limite !== undefined && !(Number.isInteger(limite) && limite >= 1)) {
    errores.push(`${tipo}: limite_por_pagina tiene que ser null o un entero >= 1`);
  }

  if (!Array.isArray(definicion.grupos) || definicion.grupos.length === 0) {
    errores.push(`${tipo}: necesita al menos un grupo de campos`);
    return null;
  }

  const grupos = [];
  const campos = [];
  const porClave = Object.create(null);

  for (const grupo of definicion.grupos) {
    if (!grupo || !esTexto(grupo.id) || !esTexto(grupo.nombre) || !Array.isArray(grupo.campos)) {
      errores.push(`${tipo}: grupo mal formado (${grupo && grupo.id})`);
      continue;
    }
    const camposGrupo = [];
    for (const crudo of grupo.campos) {
      const campo = normalizarCampo(crudo, grupo, tipo, errores);
      if (!campo) continue;
      if (porClave[campo.clave]) {
        errores.push(`${tipo}: la clave "${campo.clave}" está repetida en dos grupos`);
        continue;
      }
      porClave[campo.clave] = campo;
      camposGrupo.push(campo);
      campos.push(campo);
    }
    grupos.push({ id: grupo.id, nombre: grupo.nombre, responsive: !!grupo.responsive, campos: camposGrupo });
  }

  return {
    tipo: definicion.tipo,
    nombre: definicion.nombre,
    categoria: definicion.categoria,
    icono: definicion.icono || definicion.tipo,
    admite_hijos: definicion.admite_hijos,
    limite_por_pagina: limite === undefined ? null : limite,
    tipos_hijos: definicion.tipos_hijos || null,   // null = cualquiera
    // Contenido mínimo con el que se inserta el bloque. Solo contenido: los
    // estilos NO se siembran, porque escribirlos en props los convertiría en
    // overrides y el bloque dejaría de seguir al branding (invariante I4).
    semilla: definicion.semilla || {},
    grupos,
    campos,
    porClave,
    render: definicion.render,
    visible_en_catalogo: definicion.visible_en_catalogo !== false
  };
}

const errores = [];
const PorTipo = new Map();

for (const definicion of definiciones) {
  const normalizada = normalizar(definicion, errores);
  if (!normalizada) continue;
  if (PorTipo.has(normalizada.tipo)) {
    errores.push(`el tipo "${normalizada.tipo}" está declarado dos veces`);
    continue;
  }
  PorTipo.set(normalizada.tipo, normalizada);
}

if (errores.length) throw new RegistroInvalido(errores);

function todos() {
  return [...PorTipo.values()];
}

function existe(tipo) {
  return PorTipo.has(tipo);
}

function definicion(tipo) {
  const encontrada = PorTipo.get(tipo);
  if (!encontrada) throw new Error(`tipo de bloque desconocido: "${tipo}"`);
  return encontrada;
}

// El backend sigue siendo estricto al validar y guardar documentos. El editor
// necesita, sin embargo, abrir una página creada con una versión más nueva sin
// congelarse entero: usa esta definición de presentación para dejar el nodo
// visible y permitir que el merchant lo elimine o lo reemplace.
function definicionParaEditor(tipo) {
  if (existe(tipo)) return definicion(tipo);
  return {
    tipo: String(tipo || "desconocido"),
    nombre: "Bloque no disponible",
    categoria: "layout",
    icono: "error",
    admite_hijos: false,
    limite_por_pagina: null,
    tipos_hijos: null,
    semilla: {},
    grupos: [],
    campos: [],
    porClave: Object.create(null),
    desconocido: true
  };
}

function tipos() {
  return [...PorTipo.keys()];
}

// Lo que necesita la librería de secciones del editor. No lleva render ni
// campos: la librería solo muestra tarjetas.
function catalogo() {
  const porCategoria = new Map();
  for (const def of PorTipo.values()) {
    if (def.visible_en_catalogo === false) continue;
    if (!porCategoria.has(def.categoria)) porCategoria.set(def.categoria, []);
    porCategoria.get(def.categoria).push({
      tipo: def.tipo,
      nombre: def.nombre,
      icono: def.icono,
      admite_hijos: def.admite_hijos,
      limite_por_pagina: def.limite_por_pagina
    });
  }
  return [...porCategoria.entries()].map(([id, items]) => ({
    id,
    nombre: NOMBRES_CATEGORIA[id] || id,
    items
  }));
}

// Lo que necesita el panel de propiedades: grupos y campos, sin la función de
// render (que no es serializable y no le sirve al cliente).
function esquemaPanel(tipo) {
  const def = definicion(tipo);
  return {
    tipo: def.tipo,
    nombre: def.nombre,
    admite_hijos: def.admite_hijos,
    grupos: def.grupos.map((g) => ({
      id: g.id,
      nombre: g.nombre,
      responsive: g.responsive,
      campos: g.campos.map(({ render, ...campo }) => campo)
    }))
  };
}

function esquemaPanelParaEditor(tipo) {
  const def = definicionParaEditor(tipo);
  if (!def.desconocido) return esquemaPanel(tipo);
  return { tipo: def.tipo, nombre: def.nombre, admite_hijos: false, desconocido: true, grupos: [] };
}

// Descripción compacta para el prompt de la IA (Fase 6). Vive acá para que sea
// imposible que la IA conozca un catálogo distinto del que valida el backend.
function resumenParaIA() {
  return todos().map((def) => ({
    tipo: def.tipo,
    nombre: def.nombre,
    categoria: def.categoria,
    admite_hijos: def.admite_hijos,
    campos: def.campos
      .filter((c) => c.tipo === "richtext" || c.tipo === "texto_plano" || c.tipo === "texto_largo" || c.tipo === "lista" || c.tipo === "imagen")
      .map((c) => ({ clave: c.clave, tipo: c.tipo, etiqueta: c.etiqueta }))
  }));
}

module.exports = {
  TIPOS_CAMPO, CATEGORIAS, NOMBRES_CATEGORIA, RegistroInvalido,
  todos, tipos, existe, definicion, definicionParaEditor, catalogo, esquemaPanel, esquemaPanelParaEditor, resumenParaIA,
  // expuesto solo para las pruebas del propio registro
  _normalizar: normalizar
};
