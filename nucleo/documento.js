// ============================================================
// DOCUMENTO — crear, validar y migrar la página.
//
// Todo lo que entra al sistema pasa por acá: lo que guarda el editor, lo que
// devuelve la IA y lo que se publica a la tienda. Nada se persiste sin validar.
// La IA sobre todo: un modelo puede devolver JSON bien formado y semánticamente
// basura (un tipo que no existe, una prop inventada, cien nodos anidados). Si
// eso llega a la base, el que lo descubre es el merchant.
//
// El esquema JSON no se escribe a mano: se GENERA desde el registro. Escribirlo
// a mano garantiza que algún día el panel permita algo que el validador
// rechaza, o al revés. Generándolo, hay una sola fuente de verdad.
//
// `migrar` corre al LEER, no al escribir. Una página publicada hace tres meses
// con la versión 1 tiene que seguir abriéndose cuando el esquema vaya por la 4.
// Sin esto, el primer cambio de esquema rompe producción entera (invariante I6).
// ============================================================

"use strict";

const Ajv = require("ajv/dist/2020");
const registro = require("./registro");
const { CLAVES_TOKEN, PRESETS, PRESET_POR_DEFECTO, RADIOS, TIPOGRAFIAS, TIPOGRAFIA_POR_DEFECTO } = require("./tokens");
const migraciones = require("./migraciones/indice");
const { hexAleatorio, nuevoId, crearNodo } = require("./nodos");

const VERSION = 1;

// Topes de cordura. No son límites de producto: son diques contra un árbol
// patológico (un bug del editor, o una IA en bucle) que tumbe el render.
const MAX_NODOS = 500;
const MAX_PROFUNDIDAD = 8;

const HEX = "^#[0-9A-Fa-f]{6}$";
const ID_NODO = "^n_[a-z0-9]{6,16}$";
// Los bloques pueden apuntar a Shopify CDN o a una ruta interna, nunca a
// javascript:, data: ni protocolos inventados. El chequeo también se repite
// en el renderer para documentos que llegan a un preview sin pasar por PUT.
const URL_MEDIA = "^(https?:\\/\\/|\\/)[^\\s<>\"']+$";
const URL_ENLACE = "^(https?:\\/\\/|\\/|mailto:|tel:)[^\\s<>\"']+$";

class DocumentoInvalido extends Error {
  constructor(errores) {
    super(`El documento no es válido: ${errores.join("; ")}`);
    this.name = "DocumentoInvalido";
    this.errores = errores;
  }
}

// ---------- generación del esquema ----------

const REFERENCIAS_TOKEN = CLAVES_TOKEN.map((clave) => `@${clave}`);

function fragmentoCampo(campo) {
  switch (campo.tipo) {
    case "texto_plano":
    case "texto_largo":
    case "richtext":
    case "icono":
      return { type: ["string", "null"] };

    case "seleccion":
    case "segmentado":
      return { enum: [...campo.opciones.map((o) => o[0]), null] };

    case "numero":
    case "medida": {
      const frag = { type: ["number", "null"] };
      if (typeof campo.min === "number") frag.minimum = campo.min;
      if (typeof campo.max === "number") frag.maximum = campo.max;
      return frag;
    }

    case "booleano":
      return { type: ["boolean", "null"] };

    // Un color de marca es una referencia conocida o un hex. Que el enum de
    // referencias salga de CLAVES_TOKEN es lo que impide que se guarde
    // "@color_inventado" y el bloque quede sin color en la tienda.
    case "token_color":
      return { anyOf: [{ type: "null" }, { enum: REFERENCIAS_TOKEN }, { type: "string", pattern: HEX }] };

    case "color":
      return { anyOf: [{ type: "null" }, { type: "string", pattern: HEX }] };

    case "imagen":
      return {
        anyOf: [{ type: "null" }, {
          type: "object", required: ["src"], additionalProperties: false,
          properties: { src: { type: "string", pattern: URL_MEDIA }, alt: { type: ["string", "null"] }, id: { type: ["string", "null"] } }
        }]
      };

    case "video":
      return {
        anyOf: [{ type: "null" }, {
          type: "object", required: ["src"], additionalProperties: false,
          properties: { src: { type: "string", pattern: URL_MEDIA }, poster: { type: ["string", "null"], pattern: URL_MEDIA }, id: { type: ["string", "null"] } }
        }]
      };

    case "enlace":
      return {
        anyOf: [{ type: "null" }, {
          type: "object", required: ["url"], additionalProperties: false,
          properties: { url: { type: "string", pattern: URL_ENLACE }, texto: { type: ["string", "null"] }, nueva_pestana: { type: ["boolean", "null"] } }
        }]
      };

    case "producto":
      return { anyOf: [{ type: "null" }, { type: "string", pattern: "^gid://shopify/Product/" }] };

    case "lista": {
      const properties = {};
      for (const item of campo.item_campos) properties[item.clave] = fragmentoCampo(item);
      return {
        anyOf: [{ type: "null" }, {
          type: "array",
          maxItems: campo.max_items || 30,
          items: { type: "object", additionalProperties: false, properties }
        }]
      };
    }

    default:
      // Inalcanzable: el registro ya rechazó las clases desconocidas.
      throw new Error(`clase de campo sin esquema: ${campo.tipo}`);
  }
}

function esquemaProps(definicion, { soloResponsive = false } = {}) {
  const properties = {};
  for (const campo of definicion.campos) {
    if (soloResponsive && !campo.responsive) continue;
    properties[campo.clave] = fragmentoCampo(campo);
  }
  // additionalProperties:false es lo que caza una prop inventada por la IA o
  // un typo del editor. Sin esto el dato entra y no se ve nunca.
  return { type: "object", additionalProperties: false, properties };
}

function construirEsquema() {
  const tipos = registro.todos();

  const porTipo = tipos.map((definicion) => ({
    if: { required: ["tipo"], properties: { tipo: { const: definicion.tipo } } },
    then: {
      properties: {
        props: esquemaProps(definicion),
        props_movil: esquemaProps(definicion, { soloResponsive: true })
      }
    }
  }));

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["version", "arbol"],
    additionalProperties: false,
    properties: {
      version: { const: VERSION },
      id: { type: ["string", "null"] },
      tienda: { type: ["string", "null"] },
      producto_id: { type: ["string", "null"] },
      titulo: { type: ["string", "null"] },
      branding: {
        type: "object",
        additionalProperties: false,
        properties: {
          preset: { enum: Object.keys(PRESETS) },
          tokens: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(CLAVES_TOKEN.map((c) => [c, { type: "string", pattern: HEX }]))
          },
          radio: { enum: Object.keys(RADIOS) },
          tipografia: {
            type: "object",
            additionalProperties: false,
            properties: {
              titulos: { enum: Object.keys(TIPOGRAFIAS) },
              cuerpo: { enum: Object.keys(TIPOGRAFIAS) }
            }
          }
        }
      },
      seo: {
        type: "object",
        additionalProperties: false,
        properties: {
          descripcion: { type: ["string", "null"], maxLength: 320 },
          palabras_clave: { type: "array", maxItems: 20, items: { type: "string" } }
        }
      },
      // Evidencia separada del copy editable. Piloto la genera con una fuente
      // verificable; conservarla acá evita que la migración la descarte o que
      // una reseña termine pareciendo un hecho editorial sin procedencia.
      evidencia: {
        type: "object",
        additionalProperties: false,
        properties: {
          rating: {
            type: "object", additionalProperties: false,
            required: ["value", "count", "source"],
            properties: {
              value: { type: "number", minimum: 0, maximum: 5 },
              count: { type: "integer", minimum: 1 },
              source: {
                type: "object", additionalProperties: false, required: ["kind", "reference"],
                properties: {
                  kind: { enum: ["shopify_policy", "shopify_review_import", "merchant_document", "declarado_por_merchant"] },
                  reference: { type: "string", minLength: 1, maxLength: 300 }
                }
              }
            }
          },
          testimonial: {
            type: "object", additionalProperties: false,
            required: ["text", "author", "source"],
            properties: {
              text: { type: "string", minLength: 1, maxLength: 600 },
              author: { type: "string", minLength: 1, maxLength: 600 },
              source: {
                type: "object", additionalProperties: false, required: ["kind", "reference"],
                properties: {
                  kind: { enum: ["shopify_policy", "shopify_review_import", "merchant_document", "declarado_por_merchant"] },
                  reference: { type: "string", minLength: 1, maxLength: 300 }
                }
              }
            }
          },
          guarantee: {
            type: "object", additionalProperties: false,
            required: ["heading", "body", "source"],
            properties: {
              heading: { type: "string", minLength: 1, maxLength: 600 },
              body: { type: "string", minLength: 1, maxLength: 600 },
              source: {
                type: "object", additionalProperties: false, required: ["kind", "reference"],
                properties: {
                  kind: { enum: ["shopify_policy", "shopify_review_import", "merchant_document", "declarado_por_merchant"] },
                  reference: { type: "string", minLength: 1, maxLength: 300 }
                }
              }
            }
          }
        }
      },
      arbol: { type: "array", items: { $ref: "#/$defs/nodo" } }
    },
    $defs: {
      nodo: {
        type: "object",
        required: ["id", "tipo"],
        additionalProperties: false,
        properties: {
          id: { type: "string", pattern: ID_NODO },
          tipo: { enum: registro.tipos() },
          props: { type: "object" },
          props_movil: { type: "object" },
          hijos: { type: "array", items: { $ref: "#/$defs/nodo" } }
        },
        allOf: porTipo
      }
    }
  };
}

// El esquema se construye una vez. `strict:false` por el mismo motivo que en
// src/piloto/pdp01-contract.js: los `if/then` anidados disparan avisos
// estrictos de Ajv aunque el esquema sea correcto.
const esquema = construirEsquema();
const ajv = new Ajv({ allErrors: true, strict: false });
const validarEsquema = ajv.compile(esquema);

// ---------- chequeos semánticos ----------

// Lo que el esquema JSON no puede expresar: unicidad de ids, límites por tipo,
// anidamiento permitido y tamaño del árbol.
function revisarArbol(arbol, errores) {
  const vistos = new Set();
  // Los límites pertenecen a una composición, no a la página entera. Un
  // mismo bloque puede aparecer una vez en cada sección (por ejemplo, un
  // precio en el héroe y otro en una sección de compra). Los nodos que aún
  // cuelgan de la raíz usan la página como ámbito de compatibilidad.
  const conteoPorAmbito = new Map();
  const AMBITO_PAGINA = "__pagina__";
  let total = 0;

  function incrementar(tipo, ambito) {
    if (!conteoPorAmbito.has(ambito)) conteoPorAmbito.set(ambito, new Map());
    const conteo = conteoPorAmbito.get(ambito);
    conteo.set(tipo, (conteo.get(tipo) || 0) + 1);
  }

  function recorrer(nodos, profundidad, ruta, ambito = AMBITO_PAGINA) {
    if (profundidad > MAX_PROFUNDIDAD) {
      errores.push(`${ruta}: el árbol supera ${MAX_PROFUNDIDAD} niveles de anidamiento`);
      return;
    }
    for (let i = 0; i < nodos.length; i++) {
      const nodo = nodos[i];
      const aqui = `${ruta}[${i}]`;
      total++;
      if (total > MAX_NODOS) {
        errores.push(`el documento supera ${MAX_NODOS} nodos`);
        return;
      }
      if (vistos.has(nodo.id)) errores.push(`${aqui}: el id "${nodo.id}" está repetido`);
      vistos.add(nodo.id);

      if (!registro.existe(nodo.tipo)) continue; // ya lo reportó el esquema
      const definicion = registro.definicion(nodo.tipo);
      incrementar(nodo.tipo, ambito);

      const hijos = nodo.hijos || [];
      if (hijos.length && !definicion.admite_hijos) {
        errores.push(`${aqui}: el tipo "${nodo.tipo}" no admite hijos`);
        continue;
      }
      if (definicion.tipos_hijos) {
        for (const hijo of hijos) {
          if (!definicion.tipos_hijos.includes(hijo.tipo)) {
            errores.push(`${aqui}: "${nodo.tipo}" no admite hijos de tipo "${hijo.tipo}"`);
          }
        }
      }
      // Una sección abre un ámbito nuevo para todos sus descendientes. El
      // propio nodo sección sigue contando en el ámbito de su padre, aunque
      // hoy ninguna sección tenga límite.
      const ambitoHijos = nodo.tipo === "seccion" ? nodo.id : ambito;
      if (hijos.length) recorrer(hijos, profundidad + 1, `${aqui}.hijos`, ambitoHijos);
    }
  }

  recorrer(arbol || [], 1, "arbol");

  for (const [ambito, conteo] of conteoPorAmbito) {
    for (const [tipo, cantidad] of conteo) {
      const limite = registro.definicion(tipo).limite_por_pagina;
      if (limite && cantidad > limite) {
        if (ambito === AMBITO_PAGINA) {
          errores.push(`"${tipo}" admite ${limite} por página y hay ${cantidad}`);
        } else {
          errores.push(`"${tipo}" admite ${limite} por sección y hay ${cantidad} en la sección "${ambito}"`);
        }
      }
    }
  }
}

// ---------- API ----------

function crear({ tienda = null, producto_id = null, titulo = null } = {}) {
  return {
    version: VERSION,
    id: "pag_" + hexAleatorio(6),
    tienda,
    producto_id,
    titulo,
    branding: { preset: PRESET_POR_DEFECTO, tokens: {}, radio: "pequeno", tipografia: { ...TIPOGRAFIA_POR_DEFECTO } },
    seo: { descripcion: null, palabras_clave: [] },
    arbol: []
  };
}

// Devuelve una copia validada. Lanza DocumentoInvalido con el detalle de cada
// problema (todos juntos: `allErrors`, para no obligar a arreglar de a uno).
function validar(documento) {
  const errores = [];
  if (!documento || typeof documento !== "object") throw new DocumentoInvalido(["no es un objeto"]);

  const copia = JSON.parse(JSON.stringify(documento));

  if (!validarEsquema(copia)) {
    for (const error of validarEsquema.errors) {
      // Los `if/then` de Ajv generan ruido: el error útil es el de adentro.
      if (error.keyword === "if") continue;
      errores.push(`${error.instancePath || "/"} ${error.message}`);
    }
  }

  revisarArbol(copia.arbol, errores);

  if (errores.length) throw new DocumentoInvalido(errores);
  return copia;
}

function esValido(documento) {
  try {
    validar(documento);
    return true;
  } catch (error) {
    if (error instanceof DocumentoInvalido) return false;
    throw error;
  }
}

// Aplica en cadena las migraciones pendientes. Se llama al leer de la base y
// al leer el metafield; nunca al escribir.
function migrar(documento) {
  if (!documento || typeof documento !== "object") throw new DocumentoInvalido(["no es un objeto"]);
  // Los documentos v0 históricos no tenían campo `version`. Se normalizan a
  // 0 únicamente para elegir la migración; la función no muta el original.
  let actual = documento.version === undefined ? { ...documento, version: 0 } : documento;
  let vueltas = 0;

  while (actual.version !== VERSION) {
    const paso = migraciones.find((m) => m.desde === actual.version);
    if (!paso) {
      throw new DocumentoInvalido([`no hay migración desde la versión ${JSON.stringify(actual.version)} hasta la ${VERSION}`]);
    }
    actual = paso.migrar(actual);
    if (++vueltas > migraciones.length + 1) throw new DocumentoInvalido(["las migraciones ciclan"]);
  }
  return actual;
}

module.exports = {
  VERSION, MAX_NODOS, MAX_PROFUNDIDAD, DocumentoInvalido,
  esquema, crear, crearNodo, nuevoId, validar, esValido, migrar
};
