// ============================================================
// PRODUCTO DE PREVIEW — proyección segura de una página histórica.
//
// El documento v1 guarda el contenido editorial, no una copia mutable del
// producto Shopify. El editor, sin embargo, necesita datos vivos para que
// precio, galería y CTA no aparezcan como placeholders mientras se diseña.
// Esta proyección es de solo lectura y se reconstruye desde la fuente y las
// URLs persistidas; nunca entra al documento ni se publica como verdad de
// producto.
// ============================================================

"use strict";

function texto(valor) {
  return valor === null || valor === undefined ? "" : String(valor).trim();
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function urlDe(referencia, urls) {
  const valor = texto(referencia);
  if (/^https?:\/\//i.test(valor) || valor.startsWith("/")) return valor;
  return typeof urls?.[valor] === "string" ? urls[valor] : "";
}

function imagenDe(referencia, urls, alt) {
  const src = urlDe(referencia, urls);
  return src ? { src, alt: texto(alt) || null, id: texto(referencia) || null } : null;
}

function productoPreviewDePagina(pagina) {
  if (!pagina || typeof pagina !== "object") return null;
  const data = pagina.data && typeof pagina.data === "object" ? pagina.data : {};
  const piloto = data.piloto_pdp_01 || {};
  const fuente = {
    ...(piloto.source_fields || {}),
    ...(data.source_fields || {}),
    ...(data.fuente || {})
  };
  const facetas = data.facetas || {};
  const hero = facetas.hero || {};
  const urls = pagina.urls || {};
  const media = data.content?.media || piloto.content?.media || {};
  const referencias = [
    ...lista(media.gallery_media_ids),
    media.hero_media_id,
    ...lista(hero.galeria)
  ].filter(Boolean);
  const unicas = [...new Set(referencias)];
  const titulo = texto(fuente.titulo_crudo || fuente.title || hero.titulo || pagina.titulo) || "Producto";
  const imagenes = unicas.map((id) => imagenDe(id, urls, titulo)).filter(Boolean);
  // Las páginas v1 nuevas guardan `source_fields.variants`; algunos datos
  // históricos usaban `variantes`. Solo aceptamos entradas que realmente
  // tengan id de variante: las opciones de producto (nombre/valores) no son
  // seleccionables en un formulario de carrito.
  const variantes = lista(fuente.variants).concat(lista(fuente.variantes))
    .filter((v) => v && (v.variant_id || v.variantId || v.id))
    .map((v) => ({
      id: texto(v.variant_id || v.variantId || v.id),
      titulo: texto(v.titulo || v.title) || "Variante",
      disponible: v.disponible !== false && v.available !== false
    }))
    .filter((v, i, todas) => v.id && todas.findIndex((otra) => otra.id === v.id) === i);
  const primeraVariante = variantes[0] || null;
  const packs = lista(data.content?.offer?.packs || piloto.content?.offer?.packs);
  const variante = packs.find((p) => p && (p.variant_id || p.variantId)) || primeraVariante || {};
  const precio = texto(fuente.precio || fuente.price);
  const anterior = texto(fuente.precio_comparativo || fuente.compare_at_price || fuente.precio_anterior);
  const moneda = texto(fuente.moneda || fuente.currency);
  const formatear = (valor) => valor ? `${valor}${moneda ? ` ${moneda}` : ""}` : "";
  return {
    titulo,
    title: titulo,
    imagenes,
    images: imagenes,
    precio_formateado: formatear(precio),
    precio_anterior_formateado: formatear(anterior),
    precio,
    precio_anterior: anterior,
    moneda,
    variante_id: texto(variante.variant_id || variante.variantId || variante.id) || null,
    variant_id: texto(variante.variant_id || variante.variantId || variante.id) || null,
    variantes,
    variants: variantes,
    resenas: []
  };
}

module.exports = { productoPreviewDePagina };
