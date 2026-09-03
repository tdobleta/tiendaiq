// ============================================================
// CATÁLOGO PILOTO — bloques atómicos de una página de producto.
//
// Cada pieza visual es un tipo independiente. Esto permite seleccionar y
// editar una sola unidad en el árbol, sin targets CSS que afecten cuatro
// textos a la vez. Los datos de Shopify llegan por `ctx.producto`; el copy y
// los overrides de diseño viven en el documento.
// ============================================================

"use strict";

const base = require("./_base");

const lista = (clave, etiqueta, nombre_item, item_campos, defecto = []) => ({
  clave, tipo: "lista", etiqueta, nombre_item, item_campos, defecto, max_items: 30
});

const campoTexto = (clave, etiqueta, defecto = "") => ({ clave, tipo: "texto_plano", etiqueta, defecto });
const campoLargo = (clave, etiqueta, defecto = "") => ({ clave, tipo: "texto_largo", etiqueta, defecto });
const campoMedida = (clave, etiqueta, defecto, min = 0, max = 240) => ({ clave, tipo: "medida", etiqueta, unidad: "px", defecto, min, max, css: clave.replace(/_/g, "-") });

function comun({ sombra = false } = {}) {
  return base.gruposComunes({ apariencia: { sombra }, espaciado: { margen: true } });
}

function css(nodo, ctx, claves) {
  return ctx.estilos(nodo, claves);
}

function envoltorio(nodo, ctx, clase, contenido, estilos = "") {
  if (!ctx.visible(nodo)) return "";
  const claseSegura = [clase, ctx.escapar(ctx.valores(nodo).clase || "")].filter(Boolean).join(" ");
  return `<section class="${claseSegura}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${contenido}</section>`;
}

function textoSeguro(ctx, valor, fallback = "") {
  return ctx.sanear(typeof valor === "string" && valor ? valor : fallback);
}

function imagenesDelProducto(ctx) {
  const producto = ctx.producto || {};
  return Array.isArray(producto.imagenes) ? producto.imagenes : Array.isArray(producto.images) ? producto.images : [];
}

function imagenProducto(ctx, imagen, alt = "Imagen del producto") {
  if (!imagen) return "";
  const src = typeof imagen === "string" ? imagen : imagen.src || imagen.url;
  if (!ctx.urlSegura(src, { media: true })) return "";
  const textoAlt = typeof imagen === "object" && imagen.alt ? imagen.alt : alt;
  return `<img src="${ctx.escapar(src)}" alt="${ctx.escapar(textoAlt)}" loading="lazy" decoding="async">`;
}

const galeria = {
  tipo: "galeria_producto", nombre: "Galería de producto", categoria: "producto", icono: "galeria",
  admite_hijos: false, limite_por_pagina: 1,
  semilla: { imagenes: [] },
  grupos: [
    { id: "contenido", nombre: "Imágenes", responsive: false, campos: [
      lista("imagenes", "Galería", "Imagen", [
        { clave: "imagen", tipo: "imagen", etiqueta: "Archivo", defecto: null },
        campoTexto("alt", "Texto alternativo", "")
      ], [])
    ] },
    { id: "disposicion", nombre: "Disposición", responsive: true, campos: [
      { clave: "miniaturas", tipo: "booleano", etiqueta: "Mostrar miniaturas", defecto: true },
      { clave: "relacion", tipo: "seleccion", etiqueta: "Relación", opciones: [["original", "Original"], ["cuadrada", "Cuadrada"], ["vertical", "Vertical"]], defecto: "original", css: "aspect-ratio", mapa_css: { original: "", cuadrada: "1 / 1", vertical: "4 / 5" } },
      { clave: "ajuste", tipo: "segmentado", etiqueta: "Ajuste", opciones: [["cubrir", "Cubrir"], ["contener", "Contener"]], defecto: "cubrir", css: "object-fit", mapa_css: { cubrir: "cover", contener: "contain" } }
    ] },
    ...comun({ sombra: true })
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo);
    const definidas = Array.isArray(v.imagenes) ? v.imagenes.map((item) => item?.imagen).filter(Boolean) : [];
    const fotos = definidas.length ? definidas : imagenesDelProducto(ctx);
    const principal = imagenProducto(ctx, fotos[0]);
    if (!principal) return envoltorio(nodo, ctx, "tiq-galeria", `<div class="tiq-galeria__vacio">Añadí imágenes del producto</div>`);
    const miniaturas = v.miniaturas && fotos.length > 1 ? `<div class="tiq-galeria__miniaturas" data-tiq-galeria-mini>${fotos.map((foto, i) => `<button type="button" data-tiq-galeria-indice="${i}" aria-label="Ver imagen ${i + 1}"${i === 0 ? " aria-current=\"true\"" : ""}>${imagenProducto(ctx, foto)}</button>`).join("")}</div>` : "";
    return envoltorio(nodo, ctx, "tiq-galeria", `<div class="tiq-galeria__principal" data-tiq-galeria-principal style="${css(nodo, ctx, ["relacion"])}">${principal}</div>${miniaturas}`, css(nodo, ctx, base.CLAVES_COMUNES));
  }
};

const titulo = {
  tipo: "titulo_producto", nombre: "Título del producto", categoria: "producto", icono: "titulo",
  admite_hijos: false, limite_por_pagina: 1, semilla: { texto: "" },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [campoTexto("texto", "Título", "")] },
    { id: "tipografia", nombre: "Tipografía", responsive: true, campos: [
      { clave: "color", tipo: "token_color", etiqueta: "Color de marca", defecto: "@titulos", css: "color" },
      { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 40, min: 16, max: 100, css: "font-size" },
      { clave: "peso", tipo: "seleccion", etiqueta: "Grosor", opciones: [["regular", "Regular"], ["medium", "Medium"], ["semibold", "Semibold"], ["bold", "Bold"]], defecto: "semibold", css: "font-weight", mapa_css: { regular: "400", medium: "500", semibold: "600", bold: "700" } },
      base.alineacion()
    ] },
    ...comun()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo);
    const contenido = textoSeguro(ctx, v.texto, ctx.producto?.titulo || ctx.producto?.title || "Título del producto");
    return envoltorio(nodo, ctx, "tiq-titulo-producto", `<h1 style="${css(nodo, ctx, ["color", "tamano", "peso", "alineacion"])}">${contenido}</h1>`, css(nodo, ctx, base.CLAVES_COMUNES));
  }
};

const precio = {
  tipo: "precio_producto", nombre: "Precio del producto", categoria: "producto", icono: "precio",
  admite_hijos: false, limite_por_pagina: 1, semilla: { prefijo: "", oferta: "Oferta" },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [campoTexto("prefijo", "Prefijo", ""), campoTexto("oferta", "Etiqueta de oferta", "Oferta"), { clave: "mostrar_comparacion", tipo: "booleano", etiqueta: "Mostrar precio anterior", defecto: true }] },
    { id: "tipografia", nombre: "Tipografía", responsive: true, campos: [
      { clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@primario", css: "color" },
      { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 22, min: 12, max: 64, css: "font-size" },
      { clave: "peso", tipo: "seleccion", etiqueta: "Grosor", opciones: [["regular", "Regular"], ["medium", "Medium"], ["bold", "Bold"]], defecto: "bold", css: "font-weight", mapa_css: { regular: "400", medium: "500", bold: "700" } }
    ] },
    ...comun()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const p = ctx.producto || {};
    const actual = p.precio_formateado || p.price || p.precio || "Precio del producto";
    const anterior = p.precio_anterior_formateado || p.compare_at_price || p.precio_anterior;
    const comparacion = v.mostrar_comparacion && anterior ? `<s>${ctx.escapar(anterior)}</s>` : "";
    const badge = v.oferta && anterior ? `<span class="tiq-precio__badge">${textoSeguro(ctx, v.oferta)}</span>` : "";
    return envoltorio(nodo, ctx, "tiq-precio-producto", `<p style="${css(nodo, ctx, ["color", "tamano", "peso"])}">${textoSeguro(ctx, v.prefijo)}${ctx.escapar(String(actual))} ${comparacion}${badge}</p>`, css(nodo, ctx, base.CLAVES_COMUNES));
  }
};

const beneficios = {
  tipo: "beneficios_producto", nombre: "Beneficios destacados", categoria: "beneficios", icono: "beneficios",
  admite_hijos: false, limite_por_pagina: null,
  semilla: { titulo: "Detalles que marcan la diferencia", puntos: [{ icono: "✓", texto: "Un beneficio claro para tu rutina." }] },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [{ clave: "imagen", tipo: "imagen", etiqueta: "Imagen", defecto: null }, campoTexto("titulo", "Título", "Detalles que marcan la diferencia"), lista("puntos", "Puntos", "Punto", [campoTexto("icono", "Icono", "✓"), campoLargo("texto", "Texto", "")], [])] },
    { id: "tipografia", nombre: "Tipografía", responsive: true, campos: [{ clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" }, { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 15, min: 10, max: 32, css: "font-size" }] },
    ...comun()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const puntos = Array.isArray(v.puntos) ? v.puntos : [];
    const imagen = v.imagen ? `<div class="tiq-beneficios__imagen">${imagenProducto(ctx, v.imagen, v.titulo)}</div>` : "";
    const contenido = `${imagen}${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}<ul>${puntos.map((p) => `<li><span>${textoSeguro(ctx, p.icono, "✓")}</span><div>${textoSeguro(ctx, p.texto)}</div></li>`).join("")}</ul>`;
    return envoltorio(nodo, ctx, "tiq-beneficios", contenido, `${css(nodo, ctx, ["color", "tamano", ...base.CLAVES_COMUNES])}`);
  }
};

const packs = {
  tipo: "packs_compra", nombre: "Packs de compra", categoria: "conversion", icono: "packs",
  admite_hijos: false, limite_por_pagina: 1,
  semilla: { titulo: "Opciones de compra", packs: [{ titulo: "1 unidad", subtitulo: "Presentación del producto", cantidad: "1", precio: "", badge: "" }] },
  grupos: [
    { id: "contenido", nombre: "Packs", responsive: false, campos: [campoTexto("titulo", "Título", "Opciones de compra"), lista("packs", "Packs", "Pack", [campoTexto("titulo", "Título"), campoTexto("subtitulo", "Subtítulo"), campoTexto("cantidad", "Cantidad", "1"), campoTexto("precio", "Precio"), campoTexto("badge", "Etiqueta", ""), { clave: "imagen", tipo: "imagen", etiqueta: "Miniatura", defecto: null }], [])] },
    { id: "apariencia", nombre: "Apariencia", responsive: true, campos: [{ clave: "color_activo", tipo: "token_color", etiqueta: "Borde activo", defecto: "@primario", css: "--tiq-pack-activo" }, { clave: "radio_pack", tipo: "seleccion", etiqueta: "Esquinas", opciones: [["marca", "De la marca"], ["rectas", "Rectas"], ["redondas", "Redondas"]], defecto: "marca", css: "border-radius", mapa_css: { marca: "var(--tiq-radio)", rectas: "0", redondas: "16px" } }] },
    ...comun()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const items = Array.isArray(v.packs) ? v.packs : [];
    const html = `${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}<div class="tiq-packs">${items.map((pack, i) => `<label class="tiq-pack${i === 0 ? " es-activo" : ""}"><input type="radio" name="pack-${ctx.escapar(nodo.id)}" value="${ctx.escapar(String(pack.cantidad || i + 1))}"${i === 0 ? " checked" : ""}><span class="tiq-pack__imagen">${imagenProducto(ctx, pack.imagen)}</span><span class="tiq-pack__copy"><b>${textoSeguro(ctx, pack.titulo, `Pack ${i + 1}`)}</b><small>${textoSeguro(ctx, pack.subtitulo)}</small>${pack.badge ? `<em>${textoSeguro(ctx, pack.badge)}</em>` : ""}</span><strong>${ctx.escapar(String(pack.precio || ""))}</strong></label>`).join("")}</div>`;
    return envoltorio(nodo, ctx, "tiq-packs-compra", html, css(nodo, ctx, ["radio_pack", "color_activo", ...base.CLAVES_COMUNES]));
  }
};

const boton = {
  tipo: "boton_carrito", nombre: "Añadir al carrito", categoria: "conversion", icono: "carrito",
  admite_hijos: false, limite_por_pagina: 1, semilla: { texto: "Añadir al carrito" },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [campoTexto("texto", "Texto", "Añadir al carrito"), { clave: "mostrar_pago_rapido", tipo: "booleano", etiqueta: "Mostrar pago acelerado", defecto: false }] },
    { id: "apariencia", nombre: "Botón", responsive: true, campos: [{ clave: "color_boton", tipo: "token_color", etiqueta: "Color de fondo", defecto: "@boton_fondo", css: "background-color" }, { clave: "color_texto", tipo: "token_color", etiqueta: "Color de texto", defecto: "@boton_texto", css: "color" }, { clave: "tamano_boton", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 16, min: 11, max: 28, css: "font-size" }, { clave: "radio_boton", tipo: "seleccion", etiqueta: "Esquinas", opciones: [["marca", "De la marca"], ["rectas", "Rectas"], ["redondas", "Redondas"]], defecto: "marca", css: "border-radius", mapa_css: { marca: "var(--tiq-radio)", rectas: "0", redondas: "999px" } }] },
    ...comun()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const textoBoton = v.texto || "Añadir al carrito";
    return envoltorio(nodo, ctx, "tiq-boton-carrito", `<form action="${ctx.escapar(ctx.carritoUrl || "/cart/add")}" method="post"><input type="hidden" name="id" value="${ctx.escapar(ctx.producto?.variante_id || ctx.producto?.variant_id || "")}" data-tiq-variante-form><input type="hidden" name="quantity" value="1" data-tiq-cantidad-form><button type="submit" style="${css(nodo, ctx, ["color_boton", "color_texto", "tamano_boton", "radio_boton"])}">${textoSeguro(ctx, textoBoton)}</button></form>`, css(nodo, ctx, base.CLAVES_COMUNES));
  }
};

const reseña = {
  tipo: "resena_destacada", nombre: "Reseña destacada", categoria: "prueba_social", icono: "resena",
  admite_hijos: false, limite_por_pagina: null,
  semilla: { autor: "Nombre del cliente", texto: "Escribí la reseña de tu cliente.", puntaje: 5, verificada: true },
  grupos: [
    { id: "contenido", nombre: "Reseña", responsive: false, campos: [campoTexto("autor", "Nombre", "Nombre del cliente"), campoLargo("texto", "Texto", "Escribí la reseña de tu cliente."), { clave: "puntaje", tipo: "numero", etiqueta: "Puntaje", defecto: 5, min: 1, max: 5 }, { clave: "verificada", tipo: "booleano", etiqueta: "Compra verificada", defecto: true }, { clave: "avatar", tipo: "imagen", etiqueta: "Avatar", defecto: null }] },
    { id: "tipografia", nombre: "Tipografía", responsive: true, campos: [{ clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" }, { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 14, min: 10, max: 28, css: "font-size" }] },
    ...comun({ sombra: true })
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const estrellas = "★".repeat(Math.max(0, Math.min(5, Number(v.puntaje) || 0)));
    const avatar = v.avatar ? imagenProducto(ctx, v.avatar, v.autor) : "";
    return envoltorio(nodo, ctx, "tiq-resena", `<div class="tiq-resena__avatar">${avatar}</div><div><div class="tiq-resena__estrellas" aria-label="${ctx.escapar(String(v.puntaje || 0))} de 5">${estrellas}</div><blockquote>${textoSeguro(ctx, v.texto)}</blockquote><p><b>${textoSeguro(ctx, v.autor, "Cliente")}</b>${v.verificada ? ` <span class="tiq-verificada">✓ Compra verificada</span>` : ""}</p></div>`, css(nodo, ctx, ["color", "tamano", ...base.CLAVES_COMUNES]));
  }
};

const carrusel = {
  tipo: "carrusel_resenas", nombre: "Carrusel de reseñas", categoria: "prueba_social", icono: "carrusel",
  admite_hijos: false, limite_por_pagina: 1,
  semilla: { titulo: "Lo que dicen nuestros clientes", resenas: [] },
  grupos: [
    { id: "contenido", nombre: "Reseñas", responsive: false, campos: [campoTexto("titulo", "Título", "Lo que dicen nuestros clientes"), lista("resenas", "Tarjetas", "Reseña", [campoTexto("autor", "Nombre"), campoLargo("texto", "Comentario"), { clave: "puntaje", tipo: "numero", etiqueta: "Puntaje", defecto: 5, min: 1, max: 5 }, { clave: "imagen", tipo: "imagen", etiqueta: "Imagen", defecto: null }], [])] },
    { id: "disposicion", nombre: "Disposición", responsive: true, campos: [{ clave: "columnas", tipo: "numero", etiqueta: "Columnas", defecto: 3, min: 1, max: 4, css: "--tiq-columnas" }, base.alineacion()] },
    ...comun({ sombra: false })
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const items = Array.isArray(v.resenas) ? v.resenas : [];
    const datos = items.length ? items : (ctx.producto?.resenas || ctx.producto?.reviews || []);
    const cuerpo = datos.length
      ? `<div class="tiq-carrusel-resenas__pista" style="${css(nodo, ctx, ["columnas"])}">${datos.map((item) => `<article>${item.imagen ? `<figure>${imagenProducto(ctx, item.imagen, item.autor)}</figure>` : ""}<div class="tiq-resena__estrellas">${"★".repeat(Math.max(0, Math.min(5, Number(item.puntaje) || 0)))}</div><p>${textoSeguro(ctx, item.texto || item.comentario)}</p><b>${textoSeguro(ctx, item.autor, "Cliente")}</b></article>`).join("")}</div>`
      : (ctx.modo === "editor" ? `<p class="tiq-carrusel-resenas__vacio">Agregá reseñas aportadas por tus clientes para mostrarlas acá.</p>` : "");
    return envoltorio(nodo, ctx, "tiq-carrusel-resenas", `${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}${cuerpo}`, css(nodo, ctx, base.CLAVES_COMUNES));
  }
};

const acordeon = {
  tipo: "acordeon_faq", nombre: "Preguntas frecuentes", categoria: "faq", icono: "faq",
  admite_hijos: false, limite_por_pagina: null,
  semilla: { titulo: "Preguntas frecuentes", items: [{ pregunta: "¿Cómo funciona?", respuesta: "Agregá la respuesta para tus clientes." }] },
  grupos: [
    { id: "contenido", nombre: "Preguntas", responsive: false, campos: [campoTexto("titulo", "Título", "Preguntas frecuentes"), lista("items", "Preguntas", "Pregunta", [campoTexto("pregunta", "Pregunta"), campoLargo("respuesta", "Respuesta")], [])] },
    { id: "tipografia", nombre: "Tipografía", responsive: true, campos: [{ clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" }, { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 16, min: 11, max: 28, css: "font-size" }] },
    ...comun()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const items = Array.isArray(v.items) ? v.items : [];
    return envoltorio(nodo, ctx, "tiq-acordeon-faq", `${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}${items.map((item) => `<details><summary>${textoSeguro(ctx, item.pregunta)}</summary><div>${textoSeguro(ctx, item.respuesta)}</div></details>`).join("")}`, css(nodo, ctx, ["color", "tamano", ...base.CLAVES_COMUNES]));
  }
};

const lineaTiempo = {
  tipo: "linea_tiempo", nombre: "Línea de tiempo", categoria: "beneficios", icono: "tiempo",
  admite_hijos: false, limite_por_pagina: null,
  semilla: { titulo: "Qué esperar", intro: "Una guía simple para acompañar tu rutina.", pasos: [] },
  grupos: [
    { id: "contenido", nombre: "Contenido", responsive: false, campos: [campoTexto("titulo", "Título", "Qué esperar"), campoLargo("intro", "Introducción", ""), lista("pasos", "Pasos", "Paso", [campoTexto("etiqueta", "Etiqueta"), campoTexto("titulo", "Título"), campoLargo("texto", "Texto")], [])] },
    { id: "disposicion", nombre: "Disposición", responsive: true, campos: [{ clave: "direccion", tipo: "segmentado", etiqueta: "Dirección", opciones: [["vertical", "Vertical"], ["horizontal", "Horizontal"]], defecto: "vertical", css: "flex-direction", mapa_css: { vertical: "column", horizontal: "row" } }, { clave: "gap", tipo: "medida", etiqueta: "Separación", unidad: "px", defecto: 32, min: 8, max: 120, css: "gap" }] },
    ...comun()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo); const pasos = Array.isArray(v.pasos) ? v.pasos : [];
    return envoltorio(nodo, ctx, "tiq-linea-tiempo", `${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}${v.intro ? `<p>${textoSeguro(ctx, v.intro)}</p>` : ""}<div class="tiq-linea-tiempo__pasos" style="${css(nodo, ctx, ["direccion", "gap"])}">${pasos.map((paso) => `<article><span>${textoSeguro(ctx, paso.etiqueta)}</span><h3>${textoSeguro(ctx, paso.titulo)}</h3><p>${textoSeguro(ctx, paso.texto)}</p></article>`).join("")}</div>`, css(nodo, ctx, base.CLAVES_COMUNES));
  }
};

const contador = {
  tipo: "contador_oferta", nombre: "Contador de oferta", categoria: "conversion", icono: "contador",
  admite_hijos: false, limite_por_pagina: 1, semilla: { texto: "La oferta finaliza en", minutos: 60 },
  grupos: [
    { id: "contenido", nombre: "Oferta", responsive: false, campos: [campoTexto("texto", "Texto", "La oferta finaliza en"), { clave: "minutos", tipo: "numero", etiqueta: "Minutos", defecto: 60, min: 1, max: 1440 }] },
    { id: "apariencia", nombre: "Apariencia", responsive: true, campos: [{ clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@primario", css: "color" }, { clave: "tamano", tipo: "medida", etiqueta: "Tamaño", unidad: "px", defecto: 14, min: 10, max: 28, css: "font-size" }] },
    ...comun()
  ],
  render(nodo, ctx) {
    const v = ctx.valores(nodo);
    const minutos = Math.max(1, Math.floor(Number(v.minutos) || 60));
    return envoltorio(nodo, ctx, "tiq-contador-oferta", `<span>${textoSeguro(ctx, v.texto)}</span><strong data-tiq-contador data-tiq-minutos="${minutos}"><span data-tiq-tiempo>${String(minutos).padStart(2, "0")}:00</span></strong>`, css(nodo, ctx, ["color", "tamano", ...base.CLAVES_COMUNES]));
  }
};

module.exports = [galeria, titulo, precio, beneficios, packs, boton, reseña, carrusel, acordeon, lineaTiempo, contador];
