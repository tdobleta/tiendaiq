// ============================================================
// MIGRACIÓN v0 -> v1 — de facetas de plantilla a árbol de nodos.
//
// La plantilla vieja guardaba contenido en bolsas con rutas fijas
// (`facetas.hero`, `facetas.faq`, etc.). El editor v3 no puede trabajar sobre
// esas rutas: necesita nodos con ids estables y props declaradas por el
// registro. Esta función hace una sola conversión, sin mutar el documento de
// origen y sin conservar una segunda representación editable.
//
// Durante la transición la base puede entregar tanto el registro completo de
// una página ({ data, urls, ... }) como el objeto `data` directamente. Se
// aceptan ambos para que la migración pueda ejecutarse al leer, antes de que
// el repositorio cambie su envoltorio HTTP.
// ============================================================

"use strict";

const ID_VALIDO = /^[a-z0-9][a-z0-9_-]*$/i;

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function texto(valor) {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  return "";
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

// FNV-1a alcanza para ids deterministas de migración. El sufijo se agrega si
// dos rutas distintas producen el mismo hash dentro del mismo documento.
function hash(clave) {
  let h = 2166136261;
  for (const caracter of String(clave)) {
    h ^= caracter.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, "0").slice(0, 12);
}

function generadorIds() {
  const usados = new Set();
  return (clave) => {
    const base = `n_${hash(clave)}`;
    let id = base;
    let numero = 2;
    while (usados.has(id)) id = `${base.slice(0, 15)}${numero++}`;
    usados.add(id);
    return id;
  };
}

function normalizarUrl(valor, urls) {
  const referencia = texto(valor);
  if (!referencia) return null;
  if (/^https?:\/\//i.test(referencia) || referencia.startsWith("/")) return referencia;
  const url = urls && urls[referencia];
  return typeof url === "string" && url ? url : null;
}

function imagen(id, referencia, urls, alt) {
  const src = normalizarUrl(referencia, urls);
  if (!src) return null;
  return {
    id: id(`imagen:${referencia}`),
    tipo: "imagen",
    props: { imagen: { src, alt: texto(alt) || null, id: texto(referencia) || null } }
  };
}

function nodoTexto(id, clave, contenido, opciones = {}) {
  const html = texto(contenido);
  if (!html) return null;
  const props = { html };
  if (opciones.etiqueta) props.etiqueta = opciones.etiqueta;
  return { id: id(`texto:${clave}`), tipo: "texto", props };
}

function seccion(id, clave, titulo, hijos) {
  const contenido = hijos.filter(Boolean);
  if (!contenido.length) return null;
  const tituloNodo = nodoTexto(id, `${clave}:titulo`, titulo, { etiqueta: "h2" });
  return {
    id: id(`seccion:${clave}`),
    tipo: "seccion",
    // La migración solo conserva contenido. Sembrar espaciado acá convertiría
    // cada sección histórica en un override y rompería la herencia de marca.
    props: {},
    hijos: [tituloNodo, ...contenido].filter(Boolean)
  };
}

function lineaDeBullets(bullets) {
  return lista(bullets).map((bullet) => {
    if (typeof bullet === "string") return texto(bullet);
    return [texto(bullet?.emoji), texto(bullet?.fuerte), texto(bullet?.resto)]
      .filter(Boolean).join(" ");
  }).filter(Boolean).join("<br>");
}

function paresDeLista(items, claves) {
  return lista(items).map((item, indice) => {
    if (typeof item === "string") return item;
    return claves.map((clave) => texto(item?.[clave])).filter(Boolean).join(" — ") || `Elemento ${indice + 1}`;
  }).filter(Boolean);
}

function contenidoDeSeccion(seccionVieja) {
  if (!seccionVieja || typeof seccionVieja !== "object") return [];
  const campos = ["titulo", "titular", "heading", "subtitulo", "parrafo", "texto", "descripcion", "body", "cta"];
  const salida = [];
  for (const campo of campos) {
    // `cta` en las facetas suele ser solo un interruptor; mostrar "true" en
    // la tienda es un artefacto de la migración, no contenido editorial.
    if (campo === "cta" && typeof seccionVieja[campo] !== "string") continue;
    const valor = texto(seccionVieja[campo]);
    if (valor) salida.push(valor);
  }
  for (const campo of ["items", "filas", "puntos", "beneficios", "steps", "preguntas"]) {
    const valores = paresDeLista(seccionVieja[campo], ["titulo", "frase", "pregunta", "respuesta", "heading", "body", "label"]);
    if (valores.length) salida.push(valores.join("<br>"));
  }
  return salida;
}

function textoDeItem(item, indice) {
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item);
  if (!item || typeof item !== "object") return `Elemento ${indice + 1}`;
  return Object.entries(item)
    .filter(([clave]) => !["id", "media_id", "variant_id", "source", "discount_source"].includes(clave))
    .map(([, valor]) => {
      if (Array.isArray(valor)) return valor.map((v, i) => textoDeItem(v, i)).filter(Boolean).join(", ");
      return texto(valor);
    })
    .filter(Boolean)
    .join(" — ") || `Elemento ${indice + 1}`;
}

function nodoLista(ids, clave, items, opciones = {}) {
  const valores = lista(items).map(textoDeItem).filter(Boolean);
  return nodoTexto(ids, clave, valores.join("<br>"), { etiqueta: opciones.etiqueta || "p" });
}

// Nodo atómico para una sección de producto. A diferencia de `nodoTexto`,
// conserva la forma declarada por el catálogo v1 (listas e imágenes incluidas)
// y por eso cada control del inspector puede editar la unidad correcta.
function nodoTipo(ids, tipo, clave, props = {}, hijos) {
  const limpios = Object.fromEntries(Object.entries(props).filter(([, valor]) => valor !== undefined));
  const nodo = { id: ids(`${tipo}:${clave}`), tipo, props: limpios };
  if (Array.isArray(hijos)) nodo.hijos = hijos;
  return nodo;
}

function imagenProp(referencia, urls, alt) {
  const src = normalizarUrl(referencia, urls);
  if (!src) return null;
  return { src, alt: texto(alt) || null, id: texto(referencia) || null };
}

function itemsGaleria(referencias, urls, alt) {
  return lista(referencias)
    .map((referencia) => imagenProp(referencia, urls, alt))
    .filter(Boolean)
    .map((imagen) => ({ imagen, alt: imagen.alt || "" }));
}

function textoBullet(bullet) {
  if (typeof bullet === "string") return bullet;
  if (!bullet || typeof bullet !== "object") return "";
  return [texto(bullet.fuerte), texto(bullet.resto)].filter(Boolean).join(" — ");
}

function puntosDeBullets(bullets) {
  return lista(bullets).map((bullet) => ({
    icono: typeof bullet === "object" ? texto(bullet.emoji) || "✓" : "✓",
    texto: textoBullet(bullet)
  })).filter((punto) => punto.texto);
}

function preguntasDe(items) {
  return lista(items).map((item) => {
    if (!item || typeof item !== "object") return null;
    const pregunta = texto(item.pregunta) || texto(item.titulo) || texto(item.question);
    const respuesta = texto(item.respuesta) || texto(item.contenido) || texto(item.answer);
    return pregunta && respuesta ? { pregunta, respuesta } : null;
  }).filter(Boolean);
}

function pasosDe(steps) {
  return lista(steps).map((step, indice) => {
    if (!step || typeof step !== "object") return null;
    const etiqueta = texto(step.label) || `Paso ${indice + 1}`;
    const titulo = texto(step.heading) || `Etapa ${indice + 1}`;
    const cuerpo = texto(step.body);
    return cuerpo ? { etiqueta, titulo, texto: cuerpo } : null;
  }).filter(Boolean);
}

function resenasConProcedencia(items, urls) {
  // Las tarjetas de la IA que contienen instrucciones ("Reseña que…") no son
  // testimonios. No se migran a una superficie visible hasta que exista autor,
  // texto y fuente verificable.
  return lista(items).map((item) => {
    if (!item || typeof item !== "object") return null;
    const autor = texto(item.autor) || texto(item.author);
    const comentario = texto(item.texto) || texto(item.comentario) || texto(item.review);
    if (!autor || !comentario || !item.fuente && !item.source) return null;
    return {
      autor,
      texto: comentario,
      puntaje: Number(item.puntaje ?? item.estrellas ?? item.rating) || 5,
      imagen: imagenProp(item.imagen, urls, autor)
    };
  }).filter(Boolean).map(({ imagen, ...item }) => ({ ...item, imagen: imagen || null }));
}

// Convierte el héroe de la plantilla vieja en una composición de dos columnas
// con unidades seleccionables. El wrapper sigue siendo `seccion` para que el
// editor pueda moverlo y cambiar su disposición; los hijos son tipos del
// registro, nunca targets CSS compartidos.
function heroAtomico(facetasHero, viejo, urls, ids, titulo) {
  const hero = facetasHero || {};
  const galeria = itemsGaleria(hero.galeria, urls, titulo);
  const detalles = [];
  detalles.push(nodoTipo(ids, "titulo_producto", "hero", { texto: texto(hero.titulo) || titulo }));
  detalles.push(nodoTipo(ids, "precio_producto", "hero", {}));
  const puntos = puntosDeBullets(hero.bullets);
  if (puntos.length) detalles.push(nodoTipo(ids, "beneficios_producto", "hero", {
    titulo: texto(hero.subtitulo) || "Detalles que marcan la diferencia",
    puntos
  }));
  const cta = texto(viejo?.global?.cta);
  if (cta) detalles.push(nodoTipo(ids, "boton_carrito", "hero", { texto: cta }));
  const destacada = hero.resena_destacada || {};
  if (texto(destacada.autor) && texto(destacada.texto)) {
    detalles.push(nodoTipo(ids, "resena_destacada", "hero", {
      autor: texto(destacada.autor), texto: texto(destacada.texto), puntaje: Number(hero.puntaje) || 5,
      avatar: imagenProp(destacada.avatar, urls, texto(destacada.autor))
    }));
  }
  const acordeones = preguntasDe(hero.acordeones);
  if (acordeones.length) detalles.push(nodoTipo(ids, "acordeon_faq", "hero", {
    titulo: "Información del producto", items: acordeones
  }));

  const hijos = [];
  if (galeria.length) hijos.push(nodoTipo(ids, "galeria_producto", "hero", { imagenes: galeria }));
  if (detalles.length) hijos.push(nodoTipo(ids, "seccion", "hero:detalles", { direccion: "vertical", gap: 18 }, detalles));
  if (!hijos.length) return null;
  return nodoTipo(ids, "seccion", "hero", {
    ancho: "pagina", ancho_contenido: "pagina", direccion: "horizontal", gap: 32
  }, hijos);
}

// Facetas históricas que ya tenían una forma semántica clara. Se convierten
// directamente al tipo atómico equivalente para que el inspector pueda editar
// cada propiedad (imagen, fila, porcentaje o pregunta) sin volver a una bolsa
// de texto. Si faltan datos esenciales devolvemos null y el camino genérico de
// compatibilidad conserva la sección en vez de perderla.
function facetaAtomica(clave, datos, urls, ids, titulo) {
  if (!datos || typeof datos !== "object") return null;
  const titular = texto(datos.titular) || texto(datos.titulo) || titulo;

  if (clave === "texto_img_1" || clave === "texto_img_2") {
    const imagen = imagenProp(datos.imagen || datos.imagen_central, urls, titular);
    const copy = { titulo: titular, texto: texto(datos.parrafo) || texto(datos.texto) };
    if (imagen) copy.imagen = imagen;
    if (!copy.titulo && !copy.texto && !copy.imagen) return null;
    return nodoTipo(ids, "imagen_texto", `faceta:${clave}`, copy);
  }

  if (clave === "iconos") {
    const puntos = lista(datos.items).map((item) => ({
      icono: texto(item?.emoji) || "✓",
      texto: [texto(item?.titulo), texto(item?.frase) || texto(item?.texto)].filter(Boolean).join(" — ")
    })).filter((punto) => punto.texto);
    if (!puntos.length) return null;
    const props = { titulo: titular, puntos };
    const imagen = imagenProp(datos.imagen_central || datos.imagen, urls, titular);
    if (imagen) props.imagen = imagen;
    return nodoTipo(ids, "beneficios_producto", `faceta:${clave}`, props);
  }

  if (clave === "tabla") {
    const filas = lista(datos.filas).map((fila) => {
      const etiqueta = texto(typeof fila === "object" ? fila.etiqueta || fila.titulo : fila);
      return etiqueta ? { etiqueta, nosotros: true, otro: false } : null;
    }).filter(Boolean);
    if (!filas.length && !titular && !texto(datos.parrafo)) return null;
    return nodoTipo(ids, "tabla_comparacion", `faceta:${clave}`, {
      titulo: titular, intro: texto(datos.parrafo), otro: texto(datos.col_otros) || "Otros", filas
    });
  }

  if (clave === "stats") {
    const items = lista(datos.items).map((item) => {
      const porcentaje = Number(item?.porcentaje ?? item?.pct);
      const textoItem = texto(item?.frase) || texto(item?.texto);
      return textoItem && Number.isFinite(porcentaje) ? { porcentaje: Math.max(0, Math.min(100, porcentaje)), texto: textoItem } : null;
    }).filter(Boolean);
    if (!items.length) return null;
    const props = { titulo: titular, items };
    const imagen = imagenProp(datos.imagen, urls, titular);
    if (imagen) props.imagen = imagen;
    return nodoTipo(ids, "estadisticas", `faceta:${clave}`, props);
  }

  if (clave === "garantia") {
    const copy = { titulo: titular, texto: texto(datos.parrafo) || texto(datos.texto) };
    if (!copy.titulo && !copy.texto) return null;
    return nodoTipo(ids, "garantia", `faceta:${clave}`, copy);
  }

  return null;
}

function evidenciaDe(origen) {
  if (!origen || typeof origen !== "object") return undefined;
  const salida = {};
  for (const clave of ["rating", "testimonial", "guarantee"]) {
    const valor = origen[clave];
    if (valor && typeof valor === "object") salida[clave] = clonar(valor);
  }
  return Object.keys(salida).length ? salida : undefined;
}

// El contrato moderno de Piloto (`content.*`) y el legado (`facetas.*`) son
// ambos v0 desde el punto de vista del editor v3. Si hay contenido moderno,
// tiene precedencia: no se crean dos héroes ni dos bloques de reseñas.
function arbolDesdeContenidoModerno(contenido, media, urls, ids, titulo) {
  if (!contenido || typeof contenido !== "object") return [];
  const arbol = [];
  const hero = contenido.hero || {};
  const heroHijos = [];
  const galeria = lista(media?.gallery_media_ids);
  const heroMedia = media?.hero_media_id || galeria[0];
  for (const [indice, referencia] of [...new Set([heroMedia, ...galeria].filter(Boolean))].entries()) {
    const foto = imagen(ids, referencia, urls, titulo);
    if (foto) heroHijos.push(foto);
  }
  heroHijos.push(nodoTexto(ids, "content:hero:claim", hero.claim));
  heroHijos.push(nodoLista(ids, "content:hero:bullets", hero.bullets));
  if (hero.quote) {
    heroHijos.push(nodoTexto(ids, "content:hero:quote", `${texto(hero.quote.text)} — ${texto(hero.quote.attribution)}`));
  }
  const heroSeccion = seccion(ids, "content:hero", titulo, heroHijos);
  if (heroSeccion) arbol.push(heroSeccion);

  const oferta = contenido.offer || {};
  const ofertaHijos = [
    nodoTexto(ids, "content:offer:heading", oferta.heading, { etiqueta: "h2" }),
    nodoLista(ids, "content:offer:packs", oferta.packs),
    nodoLista(ids, "content:offer:accordions", oferta.accordions)
  ];
  const ofertaSeccion = seccion(ids, "content:offer", texto(oferta.heading) || "Oferta", ofertaHijos);
  if (ofertaSeccion) arbol.push(ofertaSeccion);

  const porQue = contenido.why || {};
  const porQueHijos = [
    nodoTexto(ids, "content:why:eyebrow", porQue.eyebrow),
    nodoTexto(ids, "content:why:heading", porQue.heading, { etiqueta: "h2" }),
    nodoTexto(ids, "content:why:body", porQue.body),
    nodoLista(ids, "content:why:points", porQue.points)
  ];
  const whyMedia = imagen(ids, media?.comparison_media_id, urls, texto(porQue.heading) || titulo);
  if (whyMedia) porQueHijos.unshift(whyMedia);
  const porQueSeccion = seccion(ids, "content:why", texto(porQue.heading) || "Por qué elegirlo", porQueHijos);
  if (porQueSeccion) arbol.push(porQueSeccion);

  const linea = contenido.timeline || {};
  const lineaHijos = [
    nodoTexto(ids, "content:timeline:heading", linea.heading, { etiqueta: "h2" }),
    nodoTexto(ids, "content:timeline:intro", linea.intro),
    nodoLista(ids, "content:timeline:steps", linea.steps)
  ];
  const lineaSeccion = seccion(ids, "content:timeline", texto(linea.heading) || "Línea de tiempo", lineaHijos);
  if (lineaSeccion) arbol.push(lineaSeccion);

  const faq = contenido.faq || {};
  const faqHijos = [
    nodoTexto(ids, "content:faq:heading", faq.heading, { etiqueta: "h2" }),
    nodoLista(ids, "content:faq:items", faq.items)
  ];
  const faqSeccion = seccion(ids, "content:faq", texto(faq.heading) || "Preguntas frecuentes", faqHijos);
  if (faqSeccion) arbol.push(faqSeccion);

  const comunidad = imagen(ids, media?.community_media_id, urls, "Experiencia de clientes");
  if (comunidad) {
    const comunidadSeccion = seccion(ids, "content:community", "Experiencia de clientes", [comunidad]);
    if (comunidadSeccion) arbol.push(comunidadSeccion);
  }
  return arbol;
}

// Piloto 01 ya no guarda facetas de texto: guarda copy editorial y comercio
// vivo en `piloto_pdp_01`.  La primera versión del editor sólo miraba
// `data.content`, por lo que las páginas recién creadas llegaban con un árbol
// vacío aunque la generación hubiera terminado correctamente.  Este camino
// convierte el contrato de Piloto en los mismos bloques atómicos que usa el
// editor y el storefront; no crea una segunda representación editable.
function arbolDesdePiloto(piloto, urls, ids, titulo) {
  if (!piloto || typeof piloto !== "object") return [];
  const content = piloto.content || {};
  const media = content.media || {};
  const arbol = [];

  const referenciasGaleria = [...new Set([
    media.hero_media_id,
    ...lista(media.gallery_media_ids)
  ].filter(Boolean))];
  const galeria = referenciasGaleria.length
    ? nodoTipo(ids, "galeria_producto", "piloto:hero:galeria", {
      imagenes: itemsGaleria(referenciasGaleria, urls, titulo)
    })
    : null;

  const hero = content.hero || {};
  const beneficiosHero = puntosDeBullets(hero.bullets);
  const detalleHijos = [
    nodoTipo(ids, "titulo_producto", "piloto:hero:titulo", { texto: "" }),
    nodoTipo(ids, "precio_producto", "piloto:hero:precio", {}),
    nodoTipo(ids, "texto", "piloto:hero:claim", { html: texto(hero.claim), etiqueta: "p" }),
    beneficiosHero.length
      ? nodoTipo(ids, "beneficios_producto", "piloto:hero:beneficios", {
        titulo: "Detalles que marcan la diferencia", puntos: beneficiosHero
      })
      : null
  ].filter(Boolean);

  const packs = lista(content.offer?.packs).map((pack, indice) => ({
    titulo: texto(pack?.label) || `Opción ${indice + 1}`,
    subtitulo: texto(pack?.subtitle) || "Presentación del producto",
    cantidad: String(pack?.quantity || indice + 1),
    precio: "",
    badge: "",
    imagen: null
  }));
  if (packs.length) detalleHijos.push(nodoTipo(ids, "packs_compra", "piloto:hero:packs", {
    titulo: texto(content.offer?.heading) || "Opciones de compra", packs
  }));
  const quick = preguntasDe(content.quick?.items);
  if (quick.length) detalleHijos.push(nodoTipo(ids, "acordeon_faq", "piloto:hero:quick", {
    titulo: "Información del producto", items: quick
  }));
  detalleHijos.push(nodoTipo(ids, "boton_carrito", "piloto:hero:boton", { texto: "Añadir al carrito" }));

  const detalles = nodoTipo(ids, "seccion", "piloto:hero:detalles", {
    ancho: "pagina", ancho_contenido: "pagina", direccion: "vertical", gap: 16
  }, detalleHijos);
  const heroHijos = [galeria, detalles].filter(Boolean);
  if (heroHijos.length) arbol.push(nodoTipo(ids, "seccion", "piloto:hero", {
    ancho: "pagina", ancho_contenido: "pagina", direccion: "horizontal", gap: 32
  }, heroHijos));

  const why = content.why || {};
  const whyPoints = lista(why.points).map((point) => ({ icono: "✓", texto: texto(point) })).filter((point) => point.texto);
  if (whyPoints.length || texto(why.body)) {
    arbol.push(nodoTipo(ids, "beneficios_producto", "piloto:why", {
      titulo: texto(why.heading) || "Por qué elegirlo",
      puntos: whyPoints.length ? whyPoints : [{ icono: "✓", texto: texto(why.body) || "Información clara para elegir." }],
      ...(imagenProp(media.comparison_media_id, urls, texto(why.heading) || titulo)
        ? { imagen: imagenProp(media.comparison_media_id, urls, texto(why.heading) || titulo) } : {})
    }));
  }

  const stories = content.stories || {};
  const storyMedia = lista(media.story_media_ids);
  for (const [indice, card] of lista(stories.cards).entries()) {
    if (!card || typeof card !== "object") continue;
    const copy = { titulo: texto(card.title) || `Sobre el producto ${indice + 1}`, texto: texto(card.body) || texto(card.product_note) };
    const foto = imagenProp(storyMedia[indice] || storyMedia[0], urls, copy.titulo);
    if (foto) copy.imagen = foto;
    if (copy.titulo || copy.texto || copy.imagen) arbol.push(nodoTipo(ids, "imagen_texto", `piloto:stories:${indice}`, copy));
  }

  const timeline = content.timeline || {};
  const pasos = pasosDe(timeline.steps);
  if (pasos.length) arbol.push(nodoTipo(ids, "linea_tiempo", "piloto:timeline", {
    titulo: texto(timeline.heading) || "Línea de tiempo",
    intro: texto(timeline.intro), pasos
  }));

  const faq = preguntasDe(content.faq?.items);
  if (faq.length) arbol.push(nodoTipo(ids, "acordeon_faq", "piloto:faq", {
    titulo: texto(content.faq?.heading) || "Preguntas frecuentes", items: faq
  }));

  const community = imagenProp(media.community_media_id, urls, "Experiencia de clientes");
  if (community) arbol.push(nodoTipo(ids, "seccion", "piloto:community", {
    ancho: "pagina", ancho_contenido: "pagina", direccion: "vertical", gap: 12
  }, [
    nodoTipo(ids, "imagen", "piloto:community:imagen", { imagen: community }),
    nodoTipo(ids, "texto", "piloto:community:texto", {
      html: "Explorá las imágenes y la información disponible del producto.", etiqueta: "p"
    })
  ]));

  const cierre = content.closing || {};
  const cierreHijos = [
    nodoTexto(ids, "piloto:closing:eyebrow", cierre.eyebrow),
    nodoTexto(ids, "piloto:closing:heading", cierre.heading, { etiqueta: "h2" }),
    nodoTexto(ids, "piloto:closing:body", cierre.body),
    nodoTexto(ids, "piloto:closing:secondary", cierre.secondary_body)
  ].filter(Boolean);
  const cierreSeccion = seccion(ids, "piloto:closing", texto(cierre.heading) || "Conocé el producto", cierreHijos);
  if (cierreSeccion) arbol.push(cierreSeccion);

  const newsletter = content.newsletter || {};
  const newsletterHijos = [
    nodoTexto(ids, "piloto:newsletter:heading", newsletter.heading, { etiqueta: "h2" }),
    nodoTexto(ids, "piloto:newsletter:body", newsletter.body)
  ].filter(Boolean);
  const newsletterSeccion = seccion(ids, "piloto:newsletter", texto(newsletter.heading) || "Novedades", newsletterHijos);
  if (newsletterSeccion) arbol.push(newsletterSeccion);

  return arbol;
}

function migrar(entrada) {
  const original = clonar(entrada || {});
  const envoltorio = original.data && typeof original.data === "object" ? original : null;
  const viejo = envoltorio ? original.data : original;
  const facetas = viejo.facetas && typeof viejo.facetas === "object" ? viejo.facetas : {};
  const urls = envoltorio?.urls || original.urls || {};
  const ids = generadorIds();
  const hero = facetas.hero || {};
  const piloto = viejo.piloto_pdp_01 && typeof viejo.piloto_pdp_01 === "object" ? viejo.piloto_pdp_01 : null;
  const fuente = {
    ...(piloto?.source_fields || {}),
    ...(viejo.source_fields || {}),
    ...(viejo.fuente || {})
  };
  const titulo = texto(hero.titulo) || texto(fuente.title) || texto(envoltorio?.titulo) || "Página de producto";
  const productoId = texto(envoltorio?.shopify_product_id) || texto(fuente.product_gid) || null;
  const arbol = [];

  const contenidoModerno = viejo.content && typeof viejo.content === "object" ? viejo.content : null;
  if (piloto?.content) {
    arbol.push(...arbolDesdePiloto(piloto, urls, ids, titulo));
  } else if (contenidoModerno) {
    arbol.push(...arbolDesdeContenidoModerno(contenidoModerno, contenidoModerno.media || {}, urls, ids, titulo));
  }

  const heroHijos = [];
  const galeria = lista(hero.galeria);
  // La galería histórica es una lista ordenada; migrarla como un solo bloque
  // de imagen perdería miniaturas y deja al merchant sin forma de recuperarlas.
  for (const referencia of galeria) {
    const foto = imagen(ids, referencia, urls, titulo);
    if (foto) heroHijos.push(foto);
  }
  // La página nueva usa bloques atómicos para el héroe. El camino genérico de
  // texto queda solo como fallback para un registro sin datos de producto.
  const heroNuevo = !piloto?.content ? heroAtomico(hero, viejo, urls, ids, titulo) : null;
  if (heroNuevo) arbol.push(heroNuevo);
  heroHijos.push(nodoTexto(ids, "hero:subtitulo", hero.subtitulo));
  heroHijos.push(nodoTexto(ids, "hero:bullets", lineaDeBullets(hero.bullets)));
  const rating = [hero.puntaje, hero.resenas_count].filter((valor) => valor !== undefined && valor !== null && valor !== "").join(" · ");
  heroHijos.push(nodoTexto(ids, "hero:rating", rating));
  // Si no hay suficientes datos para una composición atómica, se conserva un
  // héroe de texto mínimo para que la página histórica siga siendo editable.
  if (!contenidoModerno && !heroNuevo) {
    const heroSeccion = seccion(ids, "hero", hero.urgencia || titulo, heroHijos);
    if (heroSeccion) arbol.push(heroSeccion);
  }

  const imagenesUsadas = new Set(galeria);
  for (const [clave, datos] of Object.entries(contenidoModerno ? {} : facetas)) {
    if (clave === "hero" || clave === "pagepilot_blue") continue;
    if (!datos || typeof datos !== "object") continue;
    const atomica = facetaAtomica(clave, datos, urls, ids, titulo);
    if (atomica) {
      arbol.push(atomica);
      continue;
    }
    const hijos = [];
    const referenciaImagen = datos.imagen || datos.imagen_central;
    if (referenciaImagen && !imagenesUsadas.has(referenciaImagen)) {
      const foto = imagen(ids, referenciaImagen, urls, titulo);
      if (foto) { hijos.push(foto); imagenesUsadas.add(referenciaImagen); }
    }
    const tituloSeccion = texto(datos.titular) || texto(datos.titulo) || clave;
    for (const [indice, valor] of contenidoDeSeccion(datos).entries()) {
      // El encabezado ya vive como hijo de `seccion`; no lo dupliques en el
      // cuerpo cuando la faceta usa el mismo titular.
      if (indice === 0 && valor === tituloSeccion) continue;
      hijos.push(nodoTexto(ids, `${clave}:${indice}`, valor, { etiqueta: indice === 0 ? "h2" : "p" }));
    }
    const convertida = seccion(ids, clave, tituloSeccion, hijos);
    // FAQ y reseñas tienen una representación atómica propia. No agregues
    // además la copia genérica o el editor mostraría dos secciones con el
    // mismo contenido.
    if (convertida && clave !== "faq" && clave !== "resenas") arbol.push(convertida);

    // Las secciones estructuradas se migran a su repetidor real cuando hay
    // datos editoriales suficientes. Una tarjeta sin autor/fuente no se hace
    // pasar por testimonio: queda fuera del carrusel hasta que el merchant la
    // complete.
    if (clave === "faq") {
      const preguntas = preguntasDe(datos.items);
      if (preguntas.length) arbol.push(nodoTipo(ids, "acordeon_faq", "faceta:faq", {
        titulo: tituloSeccion, items: preguntas
      }));
    }
    if (clave === "resenas") {
      const verificadas = resenasConProcedencia(datos.items, urls);
      if (verificadas.length) arbol.push(nodoTipo(ids, "carrusel_resenas", "faceta:resenas", {
        titulo: tituloSeccion, resenas: verificadas
      }));
    }
  }

  for (const [indice, datos] of lista(viejo.secciones).entries()) {
    const tituloSeccion = texto(datos?.titulo) || texto(datos?.tipo) || `Sección ${indice + 1}`;
    const hijos = contenidoDeSeccion(datos)
      .filter((valor, n) => !(n === 0 && valor === tituloSeccion))
      .map((valor, n) => nodoTexto(ids, `secciones:${indice}:${n}`, valor, { etiqueta: n === 0 ? "h2" : "p" }));
    const convertida = seccion(ids, `secciones:${indice}`, tituloSeccion, hijos);
    if (convertida) arbol.push(convertida);
  }

  const evidencia = evidenciaDe(viejo.evidence || viejo.evidencia);
  return {
    version: 1,
    id: texto(envoltorio?.id) || texto(original.id) || `pag_${hash(titulo)}`,
    tienda: texto(envoltorio?.tienda) || texto(viejo.tienda) || null,
    producto_id: productoId,
    titulo,
    branding: {
      preset: "verde",
      tokens: {},
      radio: "pequeno",
      tipografia: { titulos: "grotesca", cuerpo: "sistema" }
    },
    seo: {
      descripcion: texto(viejo.seo?.descripcion) || texto(viejo.descripcion) || null,
      palabras_clave: lista(viejo.seo?.palabras_clave).map(texto).filter(Boolean)
    },
    ...(evidencia ? { evidencia } : {}),
    arbol
  };
}

module.exports = { desde: 0, hasta: 1, migrar };
