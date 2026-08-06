// Contrato compartido por el generador, el editor y el renderer de paginas.
// La plantilla define la jerarquia visual; Shopify y el comerciante aportan los
// datos. La IA solo redacta los campos marcados como "ia".

const CAMPOS_COMUNES = Object.freeze([
  { ruta: "fuente.titulo_crudo", tipo: "text", origen: "shopify", editable: false },
  { ruta: "fuente.descripcion_cruda", tipo: "text", origen: "shopify", editable: false },
  { ruta: "fuente.precio", tipo: "number", origen: "shopify", editable: false },
  { ruta: "fuente.precio_comparativo", tipo: "number", origen: "shopify", editable: false },
  { ruta: "facetas.hero.galeria", tipo: "media_list", origen: "shopify", editable: true },
  { ruta: "facetas.hero.titulo", tipo: "text", origen: "ia|merchant", editable: true, max: 5 },
  { ruta: "facetas.hero.subtitulo", tipo: "text", origen: "ia|merchant", editable: true, max: 18 },
  { ruta: "facetas.hero.urgencia", tipo: "text", origen: "ia|merchant", editable: true, max: 7 },
  { ruta: "facetas.hero.bullets", tipo: "list", origen: "ia|merchant", editable: true, count: 4 },
  { ruta: "facetas.hero.puntaje", tipo: "number", origen: "merchant|integration", editable: true },
  { ruta: "facetas.hero.resenas_count", tipo: "number", origen: "merchant|integration", editable: true },
  { ruta: "facetas.iconos", tipo: "benefit_list", origen: "ia|merchant", editable: true, count: 4 },
  { ruta: "facetas.tabla", tipo: "comparison", origen: "ia|merchant", editable: true, count: 5 },
  { ruta: "facetas.stats", tipo: "proof_list", origen: "merchant|integration", editable: true, count: 3 },
  { ruta: "facetas.faq", tipo: "faq_list", origen: "ia|merchant", editable: true, count: 5 },
  { ruta: "facetas.resenas", tipo: "review_guides", origen: "merchant", editable: true },
  { ruta: "facetas.hero.resena_destacada", tipo: "review", origen: "merchant|integration", editable: true },
  { ruta: "global.cta", tipo: "text", origen: "merchant|default", editable: true }
]);

const PLANTILLAS_PRODUCTO = Object.freeze({
  clasico: Object.freeze({
    id: "clasico",
    version: 1,
    nombre: "Clásico",
    descripcion: "Hero claro, beneficios escaneables, prueba social y preguntas frecuentes.",
    intencion: "Convertir con claridad: primero se entiende el producto, despues se reducen las dudas.",
    subtitulo: "Estructura limpia para validar rápido.",
    tags: ["Hero", "Beneficios", "FAQ"],
    tipo: "clasico",
    layout: "clasico",
    tema: "verde",
    orden: ["hero", "iconos", "stats", "resenas", "faq", "garantia"],
    reglasCopy: [
      "Usar lenguaje natural, concreto y facil de escanear.",
      "Priorizar el beneficio visible sobre la especificacion tecnica.",
      "No afirmar resultados, reseñas, garantias ni cifras que no esten respaldados.",
      "Mantener una sola idea principal por bloque."
    ],
    campos: CAMPOS_COMUNES
  }),
  premium: Object.freeze({
    id: "premium",
    version: 1,
    nombre: "Premium",
    descripcion: "Hero editorial, comparacion, prueba social y bloques de confianza para compras meditadas.",
    intencion: "Construir deseo y confianza sin sobrecargar: una lectura visual con jerarquia de marca.",
    subtitulo: "Más secciones para productos con más explicación.",
    tags: ["Oferta", "Comparación", "Reseñas"],
    tipo: "premium",
    layout: "premium",
    tema: "azul",
    orden: ["hero", "stats", "iconos", "tabla", "resenas", "faq", "garantia"],
    reglasCopy: [
      "Escribir con mas criterio editorial y menos lenguaje promocional.",
      "Usar frases cortas en zonas de compra y contexto en las secciones profundas.",
      "Separar hechos del producto, argumentos de venta y prueba social.",
      "No crear testimonios ni metricas que no provengan del comerciante o de una integracion."
    ],
    campos: CAMPOS_COMUNES
  }),
  greens: Object.freeze({
    id: "greens", version: 1, nombre: "Greens",
    descripcion: "Una composición fresca y ordenada para bienestar, nutrición y cuidado diario.",
    intencion: "Transmitir hábito, claridad y confianza con una lectura calmada.",
    subtitulo: "Bienestar diario con una narrativa limpia.",
    tags: ["Bienestar", "Rutina", "Confianza"], tipo: "premium", layout: "premium", tema: "greens",
    orden: ["hero", "stats", "iconos", "resenas", "faq", "garantia"],
    reglasCopy: ["Usar un tono sereno y concreto.", "Explicar el hábito antes que prometer resultados.", "Separar hechos del producto y prueba social."],
    campos: CAMPOS_COMUNES
  }),
  bloom: Object.freeze({
    id: "bloom", version: 1, nombre: "Bloom",
    descripcion: "Una página cálida y expresiva para belleza, autocuidado y productos de regalo.",
    intencion: "Construir deseo desde la experiencia de uso, sin exageraciones.",
    subtitulo: "Beneficios visibles con una presentación más emocional.",
    tags: ["Belleza", "Deseo", "Resultados"], tipo: "premium", layout: "premium", tema: "bloom",
    orden: ["hero", "iconos", "resenas", "stats", "faq", "garantia"],
    reglasCopy: ["Describir sensaciones y uso cotidiano.", "Evitar promesas clínicas o absolutas.", "Mantener el lenguaje elegante y específico."],
    campos: CAMPOS_COMUNES
  }),
  honey: Object.freeze({
    id: "honey", version: 1, nombre: "Honey",
    descripcion: "Una composición cercana para cuidado personal, hogar y productos de uso diario.",
    intencion: "Hacer que la compra se sienta simple, útil y confiable.",
    subtitulo: "Una propuesta cálida, práctica y fácil de entender.",
    tags: ["Rutina", "Práctico", "Confianza"], tipo: "clasico", layout: "clasico", tema: "honey",
    orden: ["hero", "iconos", "resenas", "faq", "garantia"],
    reglasCopy: ["Poner la utilidad en primer plano.", "Usar frases cercanas, sin clichés.", "Reducir dudas antes de pedir la compra."],
    campos: CAMPOS_COMUNES
  }),
  clarity: Object.freeze({
    id: "clarity", version: 1, nombre: "Clarity",
    descripcion: "Una página directa para productos técnicos, funcionales o con muchas objeciones.",
    intencion: "Ordenar la información para que el comprador compare y decida con seguridad.",
    subtitulo: "Información precisa para decidir sin fricción.",
    tags: ["Prueba", "Comparación", "Claridad"], tipo: "premium", layout: "premium", tema: "clarity",
    orden: ["hero", "tabla", "stats", "faq", "resenas", "garantia"],
    reglasCopy: ["Priorizar datos verificables.", "Convertir especificaciones en consecuencias de uso.", "No esconder limitaciones relevantes."],
    campos: CAMPOS_COMUNES
  }),
  aura: Object.freeze({
    id: "aura", version: 1, nombre: "Aura",
    descripcion: "Una composición editorial para belleza, wellness y marcas que buscan más personalidad.",
    intencion: "Crear una experiencia aspiracional sin perder la información esencial.",
    subtitulo: "Una lectura editorial con foco en la experiencia.",
    tags: ["Editorial", "Experiencia", "Marca"], tipo: "premium", layout: "premium", tema: "aura",
    orden: ["hero", "iconos", "stats", "resenas", "faq", "garantia"],
    reglasCopy: ["Usar ritmo y jerarquía, no adjetivos vacíos.", "Mostrar cómo encaja el producto en la vida real.", "Conservar una voz de marca consistente."],
    campos: CAMPOS_COMUNES
  }),
  legacy: Object.freeze({
    id: "legacy", version: 1, nombre: "Legacy",
    descripcion: "Una estructura sobria para productos de postura, rendimiento, hogar y confianza técnica.",
    intencion: "Dar autoridad con una lectura contenida y argumentos ordenados.",
    subtitulo: "Confianza sobria para decisiones meditadas.",
    tags: ["Autoridad", "Prueba", "Garantía"], tipo: "premium", layout: "premium", tema: "legacy",
    orden: ["hero", "stats", "tabla", "resenas", "faq", "garantia"],
    reglasCopy: ["Escribir con autoridad tranquila.", "No usar urgencia artificial.", "Apoyar cada argumento en información disponible."],
    campos: CAMPOS_COMUNES
  }),
  stone: Object.freeze({
    id: "stone", version: 1, nombre: "Stone",
    descripcion: "Una composición sobria y equilibrada para moda, accesorios y productos de diseño.",
    intencion: "Poner el producto y sus detalles por encima del ruido promocional.",
    subtitulo: "Producto al frente, información justa y bien editada.",
    tags: ["Producto", "Detalle", "Estilo"], tipo: "clasico", layout: "clasico", tema: "stone",
    orden: ["hero", "iconos", "tabla", "resenas", "faq", "garantia"],
    reglasCopy: ["Describir materiales y sensaciones solo si están respaldados.", "Mantener frases precisas y sobrias.", "Dar espacio al producto en la lectura."],
    campos: CAMPOS_COMUNES
  }),
  cotton: Object.freeze({
    id: "cotton", version: 1, nombre: "Cotton",
    descripcion: "Una página amable para bebés, hogar y productos donde el cuidado es la decisión principal.",
    intencion: "Transmitir seguridad y comodidad sin dramatizar la necesidad.",
    subtitulo: "Cuidado claro para compras importantes.",
    tags: ["Cuidado", "Comodidad", "Seguridad"], tipo: "clasico", layout: "clasico", tema: "cotton",
    orden: ["hero", "iconos", "resenas", "faq", "garantia"],
    reglasCopy: ["Usar un tono cálido y responsable.", "No convertir tranquilidad en una promesa médica.", "Explicar el uso con sencillez."],
    campos: CAMPOS_COMUNES
  }),
  atelier: Object.freeze({
    id: "atelier", version: 1, nombre: "Atelier",
    descripcion: "Una composicion editorial para productos que necesitan una experiencia de marca mas cuidada.",
    intencion: "Presentar el producto como una pieza: imagen, argumento y prueba avanzan con ritmo y claridad.",
    subtitulo: "Una pagina editorial con galeria, detalle y compra directa.",
    tags: ["Editorial", "Galeria", "Premium"], tipo: "premium", layout: "atelier", tema: "atelier",
    imagen: "https://service.pagepilot.ai/storage/v1/object/public/builder/7f0e5ffb-fba5-4055-ae2f-818e455fa2f2/gallery-images/25627a22-38a7-4e90-88ac-bb785a68d0b7/1785944528407-sto6zivwkf.webp",
    orden: ["hero", "iconos", "stats", "tabla", "resenas", "faq", "garantia"],
    reglasCopy: ["Escribir con criterio editorial y frases concretas.", "Dejar que las imagenes expliquen el producto.", "Usar prueba social solo cuando exista.", "No inventar cifras, resultados ni testimonios."],
    campos: CAMPOS_COMUNES
  })
});

// Solo las plantillas con HTML real integrado se muestran al comerciante.
// Los contratos anteriores se conservan para no romper paginas ya creadas.
const PLANTILLAS_DISPONIBLES = Object.freeze({ atelier: PLANTILLAS_PRODUCTO.atelier });

function obtenerPlantilla(id) {
  return PLANTILLAS_PRODUCTO[id] || PLANTILLAS_PRODUCTO.clasico;
}

function resumenContrato(plantilla) {
  const activa = typeof plantilla === "string" ? obtenerPlantilla(plantilla) : (plantilla || PLANTILLAS_PRODUCTO.clasico);
  return JSON.stringify({
    id: activa.id,
    version: activa.version,
    intencion: activa.intencion,
    orden: activa.orden,
    reglasCopy: activa.reglasCopy,
    campos: activa.campos
  });
}

function cardinalidadDe(plantilla) {
  const activa = typeof plantilla === "string" ? obtenerPlantilla(plantilla) : (plantilla || PLANTILLAS_PRODUCTO.clasico);
  return Object.fromEntries(
    activa.campos
      .filter((campo) => Number.isInteger(campo.count))
      .map((campo) => [campo.ruta.replace(/^facetas\./, ""), campo.count])
  );
}

module.exports = { PLANTILLAS_PRODUCTO, PLANTILLAS_DISPONIBLES, obtenerPlantilla, resumenContrato, cardinalidadDe };
