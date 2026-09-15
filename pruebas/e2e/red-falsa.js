// ============================================================
// RED FALSA — el único doble del E2E de páginas con IA.
//
// Se carga con `node --require pruebas/e2e/red-falsa.js server.js`, ANTES de
// que el server requiera nada. Desde ahí tapa las dos únicas puertas por las
// que la función de páginas sale a internet:
//
//   1. `fetch` hacia la Admin API de Shopify (y hacia el storefront público).
//   2. El SDK de Anthropic.
//
// Todo lo demás corre de verdad: el router HTTP, la cola de jobs, el worker, el
// registro de tipos, el validador del documento, el render y el publicador. Esa
// es la diferencia entre un E2E y una prueba de unidad con muchos mocks: acá lo
// único de mentira es el mundo exterior.
//
// -------- por qué falla si aparece una llamada desconocida --------
//
// Si el server intenta una operación de Shopify que este archivo no simula, la
// llamada NO se deja pasar ni se responde con {}: se anota y se lanza. Así el
// E2E sabe exactamente qué toca la función en la tienda del merchant, y el día
// que alguien agregue una escritura al tema (que es lo que nos rechazaría la
// ficha del App Store) la prueba se entera sola en vez de aprobarlo en silencio.
//
// -------- cómo se maneja desde afuera --------
//
// El escenario se elige escribiendo `${E2E_DIR}/control.json` y se lee en CADA
// llamada: el runner cambia de escenario sin reiniciar el server. Cada llamada
// queda anotada en `${E2E_DIR}/llamadas.jsonl`, que es lo que después permite
// afirmar sobre lo que se le mandó al modelo y lo que se le escribió a Shopify.
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

const DIR = process.env.E2E_DIR;
if (!DIR) throw new Error("red-falsa.js necesita E2E_DIR");
fs.mkdirSync(DIR, { recursive: true });

const RUTA_CONTROL = path.join(DIR, "control.json");
const RUTA_LLAMADAS = path.join(DIR, "llamadas.jsonl");
const TIENDA = (process.env.SHOPIFY_STORE || "").toLowerCase();

function control() {
  try {
    return JSON.parse(fs.readFileSync(RUTA_CONTROL, "utf8"));
  } catch {
    return {};
  }
}

function anotar(registro) {
  fs.appendFileSync(RUTA_LLAMADAS, JSON.stringify({ t: Date.now(), escenario: control().escenario || null, ...registro }) + "\n");
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// EL PRODUCTO DE MENTIRA
//
// Los textos son deliberadamente reconocibles ("Aurora", "PET reciclado",
// "12 horas"): el E2E afirma que ESOS datos llegaron al prompt y de ahí a la
// página. Si la generación se desconectara de la ficha real del producto, la
// prueba lo vería aunque la página siguiera siendo válida.
// ============================================================

const PRODUCTO = {
  id: "gid://shopify/Product/9001",
  title: "Lampara Aurora 360 RGB Rotating Night Light For Bedroom",
  description: "Rotating projector night light. Material: PET reciclado. Bateria 12 horas de autonomia. USB-C. 8 colores.",
  vendor: "Aurora",
  productType: "Iluminacion",
  templateSuffix: null,
  handle: "lampara-aurora-360",
  media: {
    edges: [
      { node: { id: "gid://shopify/MediaImage/1", image: { url: "https://cdn.shopify.com/s/files/1/0001/aurora-1.jpg", width: 1200, height: 1200 } } },
      { node: { id: "gid://shopify/MediaImage/2", image: { url: "https://cdn.shopify.com/s/files/1/0001/aurora-2.jpg", width: 1200, height: 1200 } } }
    ]
  },
  featuredMedia: { id: "gid://shopify/MediaImage/1", preview: { image: { url: "https://cdn.shopify.com/s/files/1/0001/aurora-1.jpg" } } },
  priceRangeV2: { minVariantPrice: { amount: "41.95", currencyCode: "ARS" } },
  options: [{ name: "Color", values: ["Blanco", "Negro"] }],
  variants: {
    edges: [
      { node: { id: "gid://shopify/ProductVariant/1", title: "Blanco", price: "41.95", compareAtPrice: "69.90", sku: "AUR-B", availableForSale: true } },
      { node: { id: "gid://shopify/ProductVariant/2", title: "Negro", price: "41.95", compareAtPrice: "69.90", sku: "AUR-N", availableForSale: true } }
    ]
  }
};

// ============================================================
// SHOPIFY DE MENTIRA
// ============================================================

const estadoTienda = {
  metafields: new Map(),   // ownerId:namespace.key -> value
  templateSuffix: null,
  publicaciones: 0
};

function operacionDe(query) {
  const q = String(query);
  if (q.includes("currentAppInstallation")) return "leer-suscripciones";
  if (q.includes("appSubscriptionCreate")) return "crear-suscripcion";
  if (q.includes("metafieldsSet")) return "escribir-metafield";
  if (q.includes("productUpdate")) return "actualizar-producto";
  if (q.includes("product(id: $id)")) return "leer-producto";
  if (q.includes("products(first")) return "listar-productos";
  if (q.includes("stagedUploadsCreate")) return "subir-archivo";
  if (q.includes("fileCreate") || q.includes("productCreateMedia")) return "crear-media";
  if (q.includes("discountAutomaticBasicCreate") || q.includes("discountAutomaticDelete")) return "descuentos";
  return "desconocida";
}

function responderGraphql(query, variables) {
  const c = control();
  const op = operacionDe(query);
  anotar({ tipo: "shopify", op, variables });

  if (op === "leer-suscripciones") {
    return { currentAppInstallation: { activeSubscriptions: c.shopify?.suscripcionActiva ? [{ id: "gid://shopify/AppSubscription/1", status: "ACTIVE", name: "Pro" }] : [] } };
  }

  if (op === "listar-productos") {
    return { products: { edges: [{ node: { ...PRODUCTO, templateSuffix: estadoTienda.templateSuffix } }] } };
  }

  if (op === "leer-producto") {
    if (c.shopify?.producto === "inexistente") return { product: null };
    if (c.shopify?.producto === "error") {
      const e = new Error("Shopify devolvió errores de GraphQL");
      e.detalle = '[{"message":"Throttled"}]';
      throw e;
    }
    return { product: { ...PRODUCTO, templateSuffix: estadoTienda.templateSuffix } };
  }

  if (op === "escribir-metafield") {
    if (c.shopify?.errorMetafield) {
      return { metafieldsSet: { metafields: [], userErrors: [{ field: ["value"], message: "Value is too long" }] } };
    }
    for (const m of variables.metafields || []) {
      estadoTienda.metafields.set(`${m.ownerId}:${m.namespace}.${m.key}`, m.value);
      anotar({ tipo: "metafield", ownerId: m.ownerId, namespace: m.namespace, key: m.key, type: m.type, bytes: String(m.value).length });
    }
    return { metafieldsSet: { metafields: (variables.metafields || []).map((_, i) => ({ id: `gid://shopify/Metafield/${i + 1}` })), userErrors: [] } };
  }

  if (op === "actualizar-producto") {
    if (c.shopify?.errorSufijo) {
      return { productUpdate: { product: null, userErrors: [{ field: ["templateSuffix"], message: "Template not found" }] } };
    }
    estadoTienda.templateSuffix = variables.product?.templateSuffix ?? null;
    if (estadoTienda.templateSuffix) estadoTienda.publicaciones += 1;
    return {
      productUpdate: {
        product: {
          id: variables.product?.id || PRODUCTO.id,
          handle: PRODUCTO.handle,
          templateSuffix: estadoTienda.templateSuffix,
          onlineStoreUrl: `https://${TIENDA}/products/${PRODUCTO.handle}`
        },
        userErrors: []
      }
    };
  }

  // Fallar acá es la gracia: una operación que nadie declaró es una operación
  // que nadie revisó. Incluye cualquier escritura al tema.
  const e = new Error(`Operación Shopify no simulada en el E2E: ${op} — ${String(query).slice(0, 120).replace(/\s+/g, " ")}`);
  e.detalle = "red-falsa.js";
  throw e;
}

// ============================================================
// ANTHROPIC DE MENTIRA
//
// Devuelve JSON con la forma exacta que produce el modelo real (incluido el
// vicio de envolverlo en ``` cuando se le pide), para que `extraerJson`,
// `componer` y el bucle de reintento corran de verdad.
// ============================================================

const contadores = new Map();

function tituloDelPedido(mensajes) {
  const texto = JSON.stringify(mensajes || "");
  const m = texto.match(/t[ií]tulo: ([^\\"]+)/);
  return m ? m[1].trim() : "Producto";
}

function arbolBueno(titulo) {
  const limpio = titulo.split(" ").slice(0, 2).join(" ");
  return {
    arbol: [
      {
        tipo: "seccion",
        hijos: [
          { tipo: "galeria_producto" },
          { tipo: "titulo_producto", props: { texto: `${limpio}: la luz que acompaña tu noche` } },
          { tipo: "precio_producto", props: { prefijo: "Hoy", oferta: "Oferta" } },
          {
            tipo: "beneficios_producto",
            props: {
              titulo: "Por qué la vas a dejar prendida todas las noches",
              puntos: [
                { icono: "🌙", texto: "Proyecta 8 colores y baja la luz sin levantarte" },
                { icono: "🔋", texto: "12 horas de autonomía con una sola carga USB-C" },
                { icono: "♻️", texto: "Cuerpo de PET reciclado, liviano y sin bordes" }
              ]
            }
          },
          { tipo: "boton_carrito", props: { texto: "Quiero la mía" } }
        ]
      },
      {
        tipo: "seccion",
        hijos: [{
          tipo: "carrusel_resenas",
          props: {
            titulo: "Lo que dicen quienes ya duermen con ella",
            resenas: [
              { autor: "Malena", texto: "La dejo en el pasillo y mi hija ya no pide que quede la luz grande prendida." },
              { autor: "Ezequiel", texto: "La cargo una vez por semana y listo. El giro es silencioso." }
            ]
          }
        }]
      },
      {
        tipo: "seccion",
        hijos: [{
          tipo: "acordeon_faq",
          props: {
            titulo: "Preguntas frecuentes",
            items: [
              { pregunta: "¿Cuánto dura la batería?", respuesta: "Hasta 12 horas seguidas según la ficha del producto." },
              { pregunta: "¿Se puede dejar toda la noche?", respuesta: "Sí, y se apaga sola cuando se queda sin carga." }
            ]
          }
        }]
      },
      {
        tipo: "seccion",
        hijos: [{
          tipo: "garantia",
          props: { titulo: "Compra tranquila", texto: "Si la lámpara llega dañada, escribinos y la reemplazamos." }
        }]
      }
    ]
  };
}

// Lo que un modelo devuelve un mal día: tipos que no existen, campos de estilo,
// props inventadas, anidamiento infinito y un tipo repetido que tiene tope de 1.
function arbolSucio(titulo) {
  const bueno = arbolBueno(titulo);
  return {
    arbol: [
      { tipo: "seccion_magica", props: { titulo: "No existo" } },
      {
        ...bueno.arbol[0],
        hijos: [
          ...bueno.arbol[0].hijos.map((h) => (h.tipo === "titulo_producto"
            ? { ...h, props: { ...h.props, tamano: 88, color: "#ff0000", subtitulo_inventado: "nada" } }
            : h)),
          { tipo: "seccion", hijos: [{ tipo: "seccion", hijos: [{ tipo: "seccion", hijos: [{ tipo: "garantia" }] }] }] }
        ]
      },
      bueno.arbol[3],
      { ...bueno.arbol[3] },                               // garantia admite 1 por página
      { tipo: "seccion", hijos: [{ tipo: "acordeon_faq", props: { items: "esto no es una lista" } }] }
    ]
  };
}

function salidaDelModelo(mensajes, sistemaPrompt = "") {
  const c = control();
  const modo = c.ia?.modo || "ok";
  const clave = `${c.escenario || "sin-escenario"}:${modo}`;
  const numero = (contadores.get(clave) || 0) + 1;
  contadores.set(clave, numero);
  const titulo = tituloDelPedido(mensajes);

  // El pipeline actual investiga primero y después adapta una composición de
  // secciones. El doble debe hablar ese contrato para que el E2E no apruebe
  // por accidente el árbol legacy v0.
  const sistema = String(sistemaPrompt || "");
  if (sistema.includes("Analizás un producto para completar únicamente el contenido editable")) {
    if (modo === "red_caida") throw new Error("socket hang up");
    if (modo === "no_json") return { texto: "no es JSON" };
    return { texto: JSON.stringify({
      summary: "Una lámpara compacta para crear una atmósfera cálida.",
      claims: [
        { text: "Batería de 12 horas de autonomía.", source: "shopify_description", verified: true },
        { text: "Carga mediante USB-C.", source: "shopify_description", verified: true }
      ],
      visualObservations: [
        { text: "Producto de formato compacto visible en la primera imagen.", mediaId: "gid://shopify/MediaImage/1" },
        { text: "Se aprecia una segunda vista del producto.", mediaId: "gid://shopify/MediaImage/2" }
      ],
      sectionCopy: {
        productBenefits: ["12 horas de autonomía", "Carga por USB-C", "8 colores disponibles"],
        imageWithTextBody: "Una luz compacta para acompañar la rutina nocturna."
      },
      copy_slots_v1: {
        version: 1,
        slots: [
          {
            target: { section_id: "product-information", occurrence: 1, block_type: "benefit", block_index: 0, field: "text" },
            value: "12 horas de autonomía",
            evidence: [{ kind: "shopify_description", reference: "Bateria 12 horas de autonomia" }]
          },
          {
            target: { section_id: "image-with-text", occurrence: 1, field: "body" },
            value: "Una luz compacta para acompañar la rutina nocturna.",
            evidence: [{ kind: "shopify_description", reference: "Rotating projector night light" }]
          }
        ]
      }
    }) };
  }

  if (modo === "red_caida") throw new Error("socket hang up");
  if (modo === "rechazo") return { refusal: true };
  if (modo === "no_json") return { texto: "Perdón, no puedo ayudarte con eso." };
  if (modo === "markdown") return { texto: "```json\n" + JSON.stringify(arbolBueno(titulo)) + "\n```" };
  if (modo === "sucio") return { texto: JSON.stringify(arbolSucio(titulo)) };
  if (modo === "vacio_siempre") return { texto: JSON.stringify({ arbol: [{ tipo: "no_existe" }] }) };
  if (modo === "reintento") {
    return numero === 1
      ? { texto: JSON.stringify({ arbol: [{ tipo: "no_existe_este_tipo" }] }) }
      : { texto: JSON.stringify(arbolBueno(titulo)) };
  }
  return { texto: JSON.stringify(arbolBueno(titulo)) };
}

function mensajeFinal(parametros) {
  const salida = salidaDelModelo(parametros.messages, parametros.system);
  if (salida.refusal) {
    return { stop_reason: "refusal", stop_details: { explanation: "contenido no permitido" }, content: [], usage: { input_tokens: 10, output_tokens: 0 } };
  }
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: salida.texto }],
    usage: { input_tokens: 4321, output_tokens: 1234 }
  };
}

class AnthropicFalso {
  constructor(opciones = {}) {
    this.apiKey = opciones.apiKey;
    this.messages = {
      stream: (parametros, opciones2) => {
        anotar({
          tipo: "ia",
          via: "stream",
          modelo: parametros.model,
          esfuerzo: parametros.output_config?.effort || null,
          timeout: opciones2?.timeout || null,
          sistema: String(parametros.system || "").slice(0, 20000),
          mensajes: parametros.messages
        });
        const c = control();
        return {
          async finalMessage() {
            if (c.ia?.demora_ms) await dormir(Number(c.ia.demora_ms));
            return mensajeFinal(parametros);
          }
        };
      },
      create: async (parametros) => {
        anotar({ tipo: "ia", via: "create", modelo: parametros.model, sistema: String(parametros.system || "").slice(0, 4000), mensajes: parametros.messages });
        const c = control();
        if (c.ia?.demora_ms) await dormir(Number(c.ia.demora_ms));
        if (c.ia?.modo === "red_caida") throw new Error("socket hang up");
        if (String(parametros.system || "").includes("Analizás un producto para completar únicamente el contenido editable")) {
          return mensajeFinal(parametros);
        }
        return { content: [{ type: "text", text: "Texto reescrito por el asistente del editor." }], usage: { input_tokens: 100, output_tokens: 20 } };
      }
    };
  }
}

// ============================================================
// LOS DOS PARCHES
// ============================================================

const cargar = Module._load;
Module._load = function (peticion, padre, esPrincipal) {
  if (peticion === "@anthropic-ai/sdk") return AnthropicFalso;
  return cargar.apply(this, [peticion, padre, esPrincipal]);
};

const fetchReal = globalThis.fetch;
globalThis.fetch = async function (recurso, opciones = {}) {
  const url = typeof recurso === "string" ? recurso : recurso?.url || String(recurso);
  let destino;
  try {
    destino = new URL(url);
  } catch {
    return fetchReal(recurso, opciones);
  }

  const esAdmin = destino.host === TIENDA && destino.pathname.startsWith("/admin/api/");
  if (esAdmin) {
    const cuerpo = JSON.parse(String(opciones.body || "{}"));
    // El token tiene que viajar: sin esto, un bug que pierda la sesión pasaría
    // desapercibido porque el doble responde igual.
    if (!opciones.headers?.["X-Shopify-Access-Token"]) {
      return new Response(JSON.stringify({ errors: [{ message: "sin token" }] }), { status: 401 });
    }
    try {
      const data = responderGraphql(cuerpo.query, cuerpo.variables || {});
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
    } catch (error) {
      anotar({ tipo: "shopify-error", mensaje: error.message });
      return new Response(JSON.stringify({ errors: [{ message: error.message }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
  }

  // El storefront público: lo consulta /api/pagina-estado para saber si la
  // plantilla quedó activada en el tema.
  if (destino.host === TIENDA) {
    anotar({ tipo: "storefront", url });
    const publicada = estadoTienda.templateSuffix === "tiendaiq";
    return new Response(
      publicada ? '<html><body><div class="tiq-doc">pagina de tiendaiq</div></body></html>' : "<html><body>producto nativo</body></html>",
      { status: 200, headers: { "content-type": "text/html" } }
    );
  }

  if (destino.host.endsWith("anthropic.com")) {
    anotar({ tipo: "fuga", url });
    throw new Error("El E2E intentó salir a Anthropic de verdad");
  }

  anotar({ tipo: "fetch-externo", url });
  throw new Error(`El E2E intentó salir a ${destino.host}, que no está simulado`);
};

module.exports = { PRODUCTO, estadoTienda };
