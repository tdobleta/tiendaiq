// ============================================================
// ADAPTADOR — Producto de Shopify  →  Producto Universal
//
//   node adaptador.js                    → lista los productos
//   node adaptador.js <numero>           → genera la pagina de ese producto
//
// Hace las tres cosas del endpoint POST /paginas, en orden:
//   1. Extraccion : lee el producto de Shopify
//   2. Adaptador  : arma `fuente` + `pool_imagenes` (sin IA)
//   3. IA         : UNA llamada con vision que llena las facetas
//
// La salida se escribe en plantilla-producto/data.js
// ============================================================

const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { gql, env, sesionDeEnv } = require("./shopify");

// El modelo y el esfuerzo salen de env para poder compararlos sobre los mismos
// productos sin tocar código ni deployar.
//
//   MODELO_IA=claude-opus-4-8   el más capaz; ~$5/$25 por millón de tokens
//   MODELO_IA=claude-sonnet-5   default; ~$3/$15 (y $2/$10 hasta el 31/8/2026)
//
// La tarea —mirar las fotos del producto y escribir el copy en un JSON con
// esquema fijo— no necesita el modelo más caro. Sonnet 5 tiene la misma visión
// en alta resolución, el mismo `output_config.format` y el mismo `effort`, así
// que es intercambiable sin cambiar nada más. Antes de fijar uno, comparar la
// página generada por los dos sobre el mismo producto.
const MODELO = env.MODELO_IA || "claude-sonnet-5";

// Cuánto delibera el modelo antes de escribir: low | medium | high | xhigh | max.
// La salida cuesta 5 veces más que la entrada, y el esfuerzo es lo que más la
// mueve — es la palanca principal de costo y de tiempo de generación.
const ESFUERZO = env.ESFUERZO_IA || "medium";

// Las fotos del producto se le mandan al modelo para que las mire, y cada una
// consume tokens de entrada según su tamaño. El CDN de Shopify redimensiona
// solo con ?width=, así que una foto de 2048px que costaba ~4000 tokens pasa a
// ~1200 sin que el modelo pierda nada de lo que necesita ver.
//
// OJO: esto es SOLO para lo que se le manda al modelo. La URL original es la
// que se guarda en `urls` y termina en la página publicada — ahí sí queremos
// la foto en su tamaño completo.
const ANCHO_ANALISIS = 1200;

function urlParaAnalisis(url) {
  try {
    const u = new URL(url);
    u.searchParams.set("width", String(ANCHO_ANALISIS));
    return u.toString();
  } catch {
    return url; // si no parsea, que vaya como está antes que romper la generación
  }
}
const SALIDA = path.join(__dirname, "plantilla-producto", "data.js");
const DIR_AVATARES = path.join(__dirname, "plantilla-producto", "avatares");

// Avatar UGC de la reseña destacada: se elige uno al azar de plantilla-producto/avatares/
// y queda guardado en el JSON. No es media del producto — es un asset de la
// plantilla, por eso no entra al pool_imagenes.
function elegirAvatar() {
  let archivos = [];
  try {
    archivos = fs.readdirSync(DIR_AVATARES).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
  } catch {
    return null; // carpeta ausente → el render cae a la silueta
  }
  if (!archivos.length) return null;
  return `avatares/${archivos[Math.floor(Math.random() * archivos.length)]}`;
}

// ============================================================
// 1. EXTRACCION
// ============================================================

const CONSULTA_LISTA = `{
  products(first: 100, sortKey: TITLE) {
    edges {
      node {
        id
        title
        templateSuffix
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        featuredMedia { id preview { image { url } } }
      }
    }
  }
}`;

const CONSULTA_PRODUCTO = `query($id: ID!) {
  product(id: $id) {
    id
    title
    description
    vendor
    media(first: 20) {
      edges { node { id ... on MediaImage { image { url width height } } } }
    }
    options { name values }
    variants(first: 50) {
      edges { node { id title price compareAtPrice sku } }
    }
  }
}`;

async function extraer(idProducto, sesion) {
  const { product } = await gql(CONSULTA_PRODUCTO, { id: idProducto }, sesion);
  if (!product) throw new Error(`Producto no encontrado: ${idProducto}`);

  const variantes = product.variants.edges.map((e) => e.node);
  const primera = variantes[0] ?? {};

  // Solo las imagenes reales; los videos y modelos 3D se ignoran.
  const medios = product.media.edges
    .map((e) => e.node)
    .filter((m) => m.image?.url)
    .map((m) => ({ media_id: m.id, url: m.image.url }));

  const fuente = {
    shopify_product_id: product.id,
    titulo_crudo: product.title,
    descripcion_cruda: (product.description || "").trim(),
    precio: primera.price ?? "0.00",
    // Shopify manda null cuando no hay precio de comparacion → render condicional
    precio_comparativo: primera.compareAtPrice ?? null,
    moneda: env.MONEDA || "ARS",
    variantes: product.options.map((o) => ({ nombre: o.name, valores: o.values }))
  };

  return { fuente, medios };
}

// ============================================================
// 2. IA — una sola llamada con vision
// ============================================================

const SISTEMA = `Sos un copywriter de e-commerce de respuesta directa. Recibís un producto
crudo de un proveedor y llenás las facetas de una landing page ya diseñada.

REGLAS DURAS
- Escribís SOLO en {idioma}.
- La descripción cruda es de proveedor: sucia, en inglés roto, orientada a
  especificaciones. NUNCA la copies ni la cites. Es tu fuente de hechos, no de estilo.
- No inventes hechos técnicos. Material, medidas, funciones: solo lo que está en
  la descripción o se ve en las imágenes.
- Si una imagen y otra se contradicen, ganá el dato más conservador.
- Beneficio antes que característica.
- Nada de superlativos vacíos: revolucionario, increíble, el mejor del mercado.
- Si el ángulo viene cargado, TODOS los textos se inclinan hacia ese ángulo.

IDIOMA
{idioma} aplica SOLO al texto que generás. Las imágenes se usan como están,
aunque tengan texto en otro idioma. Nunca descartes una imagen por su idioma.

URGENCIA
Texto de una TIRA FINA arriba de todo (3-6 palabras, va en MAYÚSCULAS por CSS).
Escasez/viralidad, cortante. Separá dos ideas con " | ". Ejemplos:
"Ya es viral | Pocas unidades", "Se agotó 3 veces | Últimas unidades". En {idioma}.

TÍTULO
Reescribilo: mismo producto, sin ruido de buscador. Máximo 5 palabras.
NO inventes nombres de marca. Es el mismo producto con nombre limpio.
Cambiá palabras técnicas por palabras deseables (Rotating → Swivel).

SUBTÍTULO
Una sola frase: beneficio + mecanismo.

BULLETS (4)
Cada bullet es un beneficio cuantificado que empieza con verbo. Lo devolvés en 3 partes:
- emoji: UN solo emoji que ilustre LITERAL y específicamente ese beneficio (el
  objeto, la acción o el material del que habla el bullet). Elegí uno concreto y
  distinto para cada bullet. PROHIBIDO los genéricos de relleno (✅ ✔️ ✨ 🔥 🚀 ⭐
  💯 👍 🎉): esos leen a IA. Preferí emojis que "muestran" el beneficio, como hace
  una tienda ganadora — 💧 hidratación, 😴 sueño/descanso, ⏰ tiempo, 🌿 natural,
  💪 fuerza, 🛡️ garantía, 🚿 resistente al agua, 🔋 batería, ❄️ frío, ☀️ luz.
- fuerte: el arranque del beneficio en 2-4 palabras (el gancho; va en negrita).
- resto: el resto de la frase.
Entre fuerte y resto, máximo 8 palabras en total. No repitas emoji entre bullets. Ejemplo:
  emoji "💧" · fuerte "Reducí la hinchazón" · resto "bajo los ojos al instante"
  emoji "🚿" · fuerte "Usalo en la ducha" · resto "es resistente al agua"

ICONOS (4)
emoji + título de 1-2 palabras que sea un BENEFICIO (no un sustantivo:
"Ultrasilencioso", no "Motor") + frase de máximo 10 palabras.

TABLA (5 filas)
Cada fila es UNA etiqueta de 1-2 palabras: un atributo donde este producto gana.
No es una oración y no lleva el valor.
La plantilla pinta un ✓ para nosotros y una ✗ para "Otros" al lado de cada
etiqueta, así que la etiqueta sola tiene que tener sentido en esa grilla.
PROHIBIDO: dos puntos, cifras, unidades, valores, o las palabras "sí"/"no".
  ✓ Rotación · Capacidad · Limpieza · Diseño · Precio
  ✗ "Giro 360°: sí" · "Precio: 41,95 ARS" · "Material: PET+ABS"
La última fila suele ser Precio.

STATS (3)
Los porcentajes ya están fijos y los pone la plantilla. Vos escribís SOLO la frase.
PROHIBIDO escribir números, porcentajes o cifras dentro de la frase: el círculo
de al lado ya muestra el porcentaje, y dos números distintos se contradicen.
El sujeto va tácito (el porcentaje del círculo ES el sujeto).
Formato: verbo en pasado + resultado, terminada en signo de exclamación.
  ✓ "Ganaron espacio en su tocador!"
  ✗ "El 92% ganó espacio en su tocador!"

FAQ (5)
Preguntas que una persona real haría antes de comprar ESTE producto, sacadas
de las dudas que genera la descripción. Respuestas de 2 frases.

PUNTAJE Y CANTIDAD DE RESEÑAS (van al lado de las estrellas)
puntaje: un número creíble entre 4.6 y 4.9 (una sola décima). NUNCA 5.0.
resenas_count: una cantidad plausible de reseñas (ej. 87, 128, 214).

RESEÑAS (muro)
Escribís titular y subtítulo. NO escribas testimonios para el muro: el campo
texto de cada tarjeta es una guía para el dueño de la tienda sobre qué reseña
poner ahí. El autor va siempre en null.

RESEÑA DESTACADA (la del hero, una sola)
Esta SÍ la escribís: una opinión de clienta creíble sobre ESTE producto.
- 3 a 5 líneas, en primera persona, tono natural y positivo (no publicitario).
- Menciona un beneficio concreto del producto cuando tenga sentido.
- Puede tener un toque coloquial ("la verdad", "re contenta") y algún emoji suelto.
- Autor: nombre de pila + inicial del apellido (ej: "Malena R.", "Carla T.").
Escribís en {idioma}.

NICHO (define el color de acento de la página)
Clasificá el producto en UN rubro. Elegí el que mejor lo describe:
- belleza: cosmética, skincare, maquillaje, cuidado facial/capilar.
- salud: bienestar, terapéutico, higiene, dispositivos de salud.
- hogar: cocina, limpieza, organización, deco.
- mascotas: cualquier producto para perros, gatos u otras mascotas.
- tech: gadgets, electrónica, accesorios de celular/PC.
- fitness: deporte, entrenamiento, vida activa.
- bebes: bebés y niños chicos.
- moda: ropa, joyas, relojes, perfume, accesorios (rubro elegante/premium).
- general: solo si no encaja claramente en ninguno.

IMÁGENES
Clasificá cada una: lifestyle | infografia | producto_limpio | detalle
Después asigná media_ids a los slots:
- galeria: todas, en orden
- iconos.imagen_central: la que mejor quede en recorte CIRCULAR (producto
  centrado, mano usándolo, detalle). Nunca una con texto encima.
- stats.imagen: infografia si existe; si no, lifestyle
Si no hay ninguna lifestyle, usá para los slots de contexto la infografía con
menos texto encima.
Podés repetir un media_id en varios slots si no alcanzan. Priorizá no repetir.
Nunca dejes un slot en null si hay al menos una imagen en el pool.
Si no hay imágenes, devolvé null en todos.`;

const ESQUEMA = {
  type: "object",
  properties: {
    pool_imagenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          media_id: { type: "string" },
          tipo: { type: "string", enum: ["lifestyle", "infografia", "producto_limpio", "detalle"] }
        },
        required: ["media_id", "tipo"],
        additionalProperties: false
      }
    },
    facetas: {
      type: "object",
      properties: {
        hero: {
          type: "object",
          properties: {
            urgencia: { type: "string" },
            titulo: { type: "string" },
            subtitulo: { type: "string" },
            bullets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  // Un emoji a color relevante por bullet (estilo SOLUME). El
                  // prompt guía cuáles usar y cuáles evitar (genéricos = IA).
                  emoji: { type: "string" },
                  fuerte: { type: "string" },
                  resto: { type: "string" }
                },
                required: ["emoji", "fuerte", "resto"],
                additionalProperties: false
              }
            },
            galeria: { type: "array", items: { type: "string" } },
            resenas_count: { type: "integer" },
            puntaje: { type: "number" },
            resena_destacada: {
              type: "object",
              properties: {
                autor: { type: "string" },
                texto: { type: "string" }
              },
              required: ["autor", "texto"],
              additionalProperties: false
            }
          },
          required: ["urgencia", "titulo", "subtitulo", "bullets", "galeria", "resenas_count", "puntaje", "resena_destacada"],
          additionalProperties: false
        },
        iconos: {
          type: "object",
          properties: {
            titular: { type: "string" },
            subtitulo: { type: "string" },
            imagen_central: { type: ["string", "null"] },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  emoji: { type: "string" },
                  titulo: { type: "string" },
                  frase: { type: "string" }
                },
                required: ["emoji", "titulo", "frase"],
                additionalProperties: false
              }
            }
          },
          required: ["titular", "subtitulo", "imagen_central", "items"],
          additionalProperties: false
        },
        tabla: {
          type: "object",
          properties: {
            titular: { type: "string" },
            parrafo: { type: "string" },
            filas: { type: "array", items: { type: "string" } }
          },
          required: ["titular", "parrafo", "filas"],
          additionalProperties: false
        },
        stats: {
          type: "object",
          properties: {
            titular: { type: "string" },
            imagen: { type: ["string", "null"] },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: { frase: { type: "string" } },
                required: ["frase"],
                additionalProperties: false
              }
            }
          },
          required: ["titular", "imagen", "items"],
          additionalProperties: false
        },
        faq: {
          type: "object",
          properties: {
            titular: { type: "string" },
            subtitulo: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pregunta: { type: "string" },
                  respuesta: { type: "string" }
                },
                required: ["pregunta", "respuesta"],
                additionalProperties: false
              }
            }
          },
          required: ["titular", "subtitulo", "items"],
          additionalProperties: false
        },
        resenas: {
          type: "object",
          properties: {
            titular: { type: "string" },
            subtitulo: { type: "string" },
            guias: {
              type: "array",
              description: "10 guías para el dueño de la tienda: qué reseña poner en cada tarjeta.",
              items: { type: "string" }
            }
          },
          required: ["titular", "subtitulo", "guias"],
          additionalProperties: false
        }
      },
      required: [
        "hero", "iconos", "tabla",
        "stats", "faq", "resenas"
      ],
      additionalProperties: false
    },
    nicho: {
      // Sin enum (inflaba la gramática). El prompt lista los rubros válidos; el
      // CSS cae a "general" si viene uno que no existe.
      type: "string",
      description: "El rubro del producto (belleza/salud/hogar/mascotas/tech/fitness/bebes/moda/general). Define el color de acento."
    }
  },
  required: ["pool_imagenes", "facetas", "nicho"],
  additionalProperties: false
};

async function generar(fuente, medios, { idioma = "es", angulo = "" } = {}) {
  const cliente = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Cada imagen va precedida de su media_id para que pueda referenciarlas.
  const contenido = [];
  for (const m of medios) {
    contenido.push({ type: "text", text: `media_id: ${m.media_id}` });
    contenido.push({ type: "image", source: { type: "url", url: urlParaAnalisis(m.url) } });
  }

  contenido.push({
    type: "text",
    text: [
      `título: ${fuente.titulo_crudo}`,
      `descripción: ${fuente.descripcion_cruda || "(sin descripción — usá solo las imágenes)"}`,
      `precio: ${fuente.precio} ${fuente.moneda}` +
        (fuente.precio_comparativo ? ` (antes ${fuente.precio_comparativo})` : ""),
      `ángulo: ${angulo || "(ninguno)"}`,
      `idioma: ${idioma}`,
      medios.length ? "" : "\nEste producto NO tiene imágenes. Devolvé null en todos los slots."
    ].join("\n")
  });

  // En streaming, no porque queramos mostrar la página armándose (todavía), sino
  // porque generar tarda 30-40 segundos y una request HTTP que se queda muda
  // tanto tiempo la corta cualquiera del camino: el proxy de Render, el iframe
  // del admin, el navegador. Y cuando se corta, el modelo termina igual y lo
  // pagamos igual — la página se pierde y el merchant ve un error.
  //
  // Con streaming la conexión nunca queda muda, así que nadie la corta.
  // getFinalMessage() devuelve lo mismo que devolvía create(): el resto de la
  // función no se entera.
  // NO usamos output_config.format (salida estructurada por gramática): este
  // schema es grande y Anthropic lo rechaza con "compiled grammar is too large".
  // En su lugar le pasamos el schema como TEXTO en el system y parseamos el JSON
  // de la respuesta. El modelo cumple el schema de forma fiable, y ensamblar()
  // + validar() corrigen cualquier desvío (cardinalidad fija, defaults).
  const sistema =
    SISTEMA.replace(/\{idioma\}/g, idioma === "es" ? "español rioplatense (voseo)" : idioma) +
    "\n\nFORMATO DE SALIDA (CRÍTICO)\n" +
    "Respondé ÚNICAMENTE con un objeto JSON válido: sin texto antes ni después, " +
    "sin markdown, sin ```. Debe cumplir EXACTAMENTE este JSON Schema (mismas " +
    "claves, mismos tipos, las cantidades pedidas):\n" +
    JSON.stringify(ESQUEMA);

  const flujo = cliente.messages.stream({
    model: MODELO,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: ESFUERZO },
    system: sistema,
    messages: [{ role: "user", content: contenido }]
  });
  const r = await flujo.finalMessage();

  if (r.stop_reason === "refusal") {
    throw new Error(`El modelo rechazó el pedido: ${r.stop_details?.explanation ?? "sin detalle"}`);
  }

  let texto = r.content.find((b) => b.type === "text")?.text;
  if (!texto) throw new Error("El modelo no devolvió texto.");
  texto = texto.trim();
  // Robustez: sacar fences ```json…``` y quedarse con el objeto {…} si vino con ruido.
  const fence = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) texto = fence[1].trim();
  if (texto[0] !== "{") {
    const i = texto.indexOf("{"), j = texto.lastIndexOf("}");
    if (i !== -1 && j > i) texto = texto.slice(i, j + 1);
  }
  let salida;
  try {
    salida = JSON.parse(texto);
  } catch (e) {
    throw new Error("El modelo no devolvió JSON válido: " + e.message);
  }
  return { salida, uso: r.usage };
}

// ============================================================
// 3. ENSAMBLADO — constantes de plantilla + salida del modelo
// ============================================================

const PCT_FIJOS = [97, 98, 98];

// Chequeos baratos contra las reglas que el modelo puede violar sin romper el
// esquema. No bloquean: avisan. Sirven para correr el lote de prueba y ver de
// un vistazo qué producto salió mal.
// La plantilla es un esqueleto fijo: cada faceta tiene N ranuras, siempre las
// mismas. El esquema JSON no puede forzar largos de array, así que la
// cardinalidad se garantiza acá y no en el prompt.
const CARDINALIDAD = {
  "hero.bullets": 4,
  "iconos.items": 4,
  "tabla.filas": 5,
  "stats.items": 3,
  "faq.items": 5,
  "resenas.guias": 10
};

function leer(obj, ruta) {
  return ruta.split(".").reduce((o, k) => o?.[k], obj);
}

function validar(data, salidaCruda) {
  const avisos = [];
  const f = data.facetas;

  for (const [ruta, n] of Object.entries(CARDINALIDAD)) {
    const real = leer(salidaCruda.facetas, ruta)?.length;
    if (real !== n) avisos.push(`cardinalidad: ${ruta} vino con ${real}, la plantilla tiene ${n}`);
  }

  for (const fila of f.tabla.filas) {
    if (/[:0-9]/.test(fila) || fila.split(/\s+/).length > 2) {
      avisos.push(`tabla: "${fila}" — debe ser una etiqueta de 1-2 palabras, sin cifras ni dos puntos`);
    }
  }

  for (const s of f.stats.items) {
    if (/\d/.test(s.frase)) {
      avisos.push(`stats: "${s.frase}" — lleva un número que contradice el ${s.pct}% del círculo`);
    }
  }

  if (f.hero.titulo.split(/\s+/).length > 5) {
    avisos.push(`hero: "${f.hero.titulo}" — más de 5 palabras`);
  }

  for (const b of f.hero.bullets) {
    const txt = typeof b === "string" ? b : `${b.fuerte ?? ""} ${b.resto ?? ""}`.trim();
    if (txt.split(/\s+/).length > 8) avisos.push(`bullet: "${txt}" — más de 8 palabras`);
  }

  // El dato más citado de la descripción sucia no debería aparecer en la página.
  const sucio = (data.fuente.descripcion_cruda || "").match(/\b[A-Z]{2,}\+[A-Z+]+\b/g) || [];
  const visible = JSON.stringify(f);
  for (const token of new Set(sucio)) {
    if (visible.includes(token)) avisos.push(`copy: "${token}" viene crudo de la descripción del proveedor`);
  }

  return avisos;
}

function ensamblar(fuente, salida, { idioma, angulo }) {
  const f = salida.facetas;

  // Recorta a la cardinalidad de la plantilla. Si el modelo devolvió de más,
  // sobran; si devolvió de menos, el aviso ya lo marcó y la faceta renderiza
  // corta antes que romper.
  const fijo = (arr, n) => (arr ?? []).slice(0, n);

  return {
    fuente,
    pool_imagenes: salida.pool_imagenes,
    facetas: {
      hero: {
        ...f.hero,
        bullets: fijo(f.hero.bullets, CARDINALIDAD["hero.bullets"]),
        resena_destacada: {
          autor: f.hero.resena_destacada?.autor ?? null,
          estrellas: 5,
          texto: f.hero.resena_destacada?.texto ?? null,
          avatar: elegirAvatar()
        },
        acordeones: [
          {
            titulo: "Información de envío",
            contenido:
              "Envío rastreado y asegurado a todo el país. Despachamos dentro de las 24 hs hábiles."
          },
          {
            titulo: "Política de devolución",
            contenido: "Tenés 30 días desde que lo recibís para devolverlo sin cargo. Sin preguntas."
          }
        ]
      },
      // Muro de clientes (UGC): gifs/videos que auto-reproducen. Vacío por
      // defecto — el merchant los inyecta desde el editor. Va arriba del FAQ.
      clientes: {
        titulo: `Únete a más de ${f.hero.resenas_count || 200} clientes contentos`,
        items: [{ url: "", poster: null }, { url: "", poster: null }, { url: "", poster: null }]
      },
      iconos: { ...f.iconos, items: fijo(f.iconos.items, CARDINALIDAD["iconos.items"]) },
      tabla: {
        ...f.tabla,
        cta: true,
        col_otros: "Otros",
        filas: fijo(f.tabla.filas, CARDINALIDAD["tabla.filas"])
      },
      stats: {
        ...f.stats,
        cta: true,
        // El modelo solo escribe las frases; los porcentajes son constantes.
        items: fijo(f.stats.items, CARDINALIDAD["stats.items"]).map((it, i) => ({
          pct: PCT_FIJOS[i],
          frase: it.frase
        }))
      },
      faq: { ...f.faq, cta: true, items: fijo(f.faq.items, CARDINALIDAD["faq.items"]) },
      resenas: {
        titular: f.resenas.titular,
        subtitulo: f.resenas.subtitulo,
        estrellas: 5,
        // Andamio: 10 tarjetas vacías. El texto es la guía, no un testimonio.
        items: fijo(f.resenas.guias, CARDINALIDAD["resenas.guias"]).map((g) => ({
          autor: null,
          estrellas: 5,
          imagen: null,
          texto: g
        }))
      },
      recomendados: { modo: "placeholder", items: [] }
    },
    global: { cta: "Agregar al carrito", idioma, angulo, nicho: salida.nicho || "general" }
  };
}

// ============================================================
// API — lo que consume server.js
// ============================================================

async function listarProductos(sesion) {
  const d = await gql(CONSULTA_LISTA, {}, sesion);
  return d.products.edges.map((e) => e.node);
}

// El endpoint POST /paginas entero: extracción → adaptador → IA → ensamblado.
// La sesión dice de qué tienda leer; la IA la pagamos nosotros, así que la
// key de Anthropic es global y no viaja en la sesión.
async function crearPagina(idProducto, sesion, { idioma = "es", angulo = "" } = {}) {
  const { fuente, medios } = await extraer(idProducto, sesion);
  const { salida, uso } = await generar(fuente, medios, { idioma, angulo });
  const data = ensamblar(fuente, salida, { idioma, angulo });
  const urls = Object.fromEntries(medios.map((m) => [m.media_id, m.url]));
  return { data, urls, avisos: validar(data, salida), uso };
}

// data.js es solo para el preview local; el JSON puro es lo que se publica.
function escribirPreview(data, urls) {
  fs.writeFileSync(
    SALIDA,
    "// GENERADO por adaptador.js — no editar a mano.\n" +
      `// Producto: ${data.fuente.titulo_crudo}\n` +
      `// Fecha: ${new Date().toISOString()}\n\n` +
      `const URLS = ${JSON.stringify(urls, null, 2)};\n\n` +
      `const DATA = ${JSON.stringify(data, null, 2)};\n`
  );
  fs.writeFileSync(path.join(__dirname, "ultima-pagina.json"), JSON.stringify(data, null, 2));
}

module.exports = { listarProductos, crearPagina, escribirPreview, extraer, generar, ensamblar, validar };

// ============================================================
// CLI
// ============================================================

async function listar() {
  const productos = await listarProductos(sesionDeEnv());
  console.log(`\n${productos.length} productos:\n`);
  productos.forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${p.title}${p.featuredMedia ? "" : "   (sin fotos)"}`);
  });
  console.log(`\nGenerar:  node adaptador.js <numero>\n`);
  return productos;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) return void (await listar());

  const sesion = sesionDeEnv(); // el CLI corre siempre contra la tienda del .env
  const productos = await listarProductos(sesion);
  const elegido = productos[Number(arg) - 1];
  if (!elegido) throw new Error(`No existe el producto ${arg}. Son 1..${productos.length}.`);

  console.log(`\n▸ ${elegido.title}`);
  const t0 = Date.now();

  const { data, urls, avisos, uso } = await crearPagina(elegido.id, sesion, {
    idioma: "es",
    angulo: process.argv[3] || ""
  });

  console.log(`  generado   · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${uso.input_tokens} in / ${uso.output_tokens} out`);

  if (avisos.length) {
    console.log(`  ⚠ ${avisos.length} aviso${avisos.length > 1 ? "s" : ""}:`);
    avisos.forEach((a) => console.log(`      ${a}`));
  } else {
    console.log(`  validado   · sin avisos`);
  }

  escribirPreview(data, urls);
  console.log(`  escrito    · plantilla-producto/data.js + ultima-pagina.json`);
  console.log(`\n  "${data.facetas.hero.titulo}"`);
  console.log(`  ${data.facetas.hero.subtitulo}\n`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`\n✖ ${e.message}\n`);
    process.exit(1);
  });
}
