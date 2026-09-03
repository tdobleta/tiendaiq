// Contratos de la frontera entre el envoltorio histórico y el documento v1.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const documento = require("../nucleo/documento");
const { documentoDePagina, guardarBorradorV1 } = require("../nucleo/migraciones/pagina");

function paginaVieja() {
  return {
    id: "pag_123",
    tienda: "demo.myshopify.com",
    shopify_product_id: "gid://shopify/Product/123",
    data: { facetas: { hero: { titulo: "Producto demo", galeria: [] } } }
  };
}

function paginaModerna() {
  const medios = [
    "gid://shopify/MediaImage/1",
    "gid://shopify/MediaImage/2",
    "gid://shopify/MediaImage/3"
  ];
  return {
    id: "pag_moderno",
    tienda: "demo.myshopify.com",
    shopify_product_id: "gid://shopify/Product/987",
    urls: Object.fromEntries(medios.map((id, i) => [id, `https://cdn.shopify.com/${i}.webp`])),
    data: {
      fuente: { title: "Producto moderno", product_gid: "gid://shopify/Product/987" },
      content: {
        hero: { claim: "Una mejora visible desde el primer uso.", bullets: ["Rápido", "Suave"], quote: { text: "Me encantó", attribution: "Ana" } },
        offer: { heading: "Elegí tu pack", packs: [{ id: "uno", label: "1 unidad", subtitle: "Para probar", quantity: 1, mechanism: "multi_quantity", variant_id: "gid://shopify/ProductVariant/1" }], accordions: [{ question: "¿Cómo se usa?", answer: "Muy fácil." }] },
        why: { eyebrow: "Por qué", heading: "Pensado para vos", body: "Diseño cuidado.", points: ["Cómodo", "Durable"] },
        timeline: { heading: "Qué esperar", intro: "Paso a paso.", steps: [{ label: "Hoy", heading: "Lo recibís", body: "En tu casa." }, { label: "Después", heading: "Lo usás", body: "Sin complicaciones." }] },
        faq: { heading: "Preguntas", items: [{ question: "¿Duele?", answer: "No." }, { question: "¿Cuánto dura?", answer: "Mucho." }, { question: "¿Tiene garantía?", answer: "Sí." }] },
        media: { hero_media_id: medios[0], gallery_media_ids: medios, comparison_media_id: medios[1], community_media_id: medios[2] }
      },
      evidence: {
        rating: { value: 4.8, count: 123, source: { kind: "shopify_review_import", reference: "reviews:987" } },
        testimonial: { text: "Excelente", author: "Ana", source: { kind: "merchant_document", reference: "doc:1" } }
      }
    }
  };
}

describe("frontera de migración de páginas", () => {
  test("lee un envoltorio v0 como documento v1 sin mutar el registro", () => {
    const pagina = paginaVieja();
    const doc = documentoDePagina(pagina);
    assert.equal(doc.version, 1);
    assert.equal(doc.id, pagina.id);
    assert.equal(doc.producto_id, pagina.shopify_product_id);
    assert.equal(Object.hasOwn(pagina, "documento_borrador"), false);
  });

  test("prefiere el borrador v1 existente", () => {
    const pagina = paginaVieja();
    const borrador = documento.crear({ tienda: pagina.tienda, producto_id: pagina.shopify_product_id, titulo: "Editado" });
    borrador.id = pagina.id;
    pagina.documento_borrador = borrador;
    assert.equal(documentoDePagina(pagina).titulo, "Editado");
  });

  test("lee también un documento v1 guardado directamente en data", () => {
    const pagina = paginaVieja();
    const directo = documento.crear({
      tienda: pagina.tienda,
      producto_id: pagina.shopify_product_id,
      titulo: "Documento directo"
    });
    directo.id = pagina.id;
    pagina.data = directo;
    const doc = documentoDePagina(pagina);
    assert.equal(doc.titulo, "Documento directo");
    assert.equal(doc.id, pagina.id);
  });

  test("guarda una copia validada y conserva el legado como fallback", () => {
    const pagina = paginaVieja();
    const doc = documentoDePagina(pagina);
    doc.titulo = "Título nuevo";
    const salida = guardarBorradorV1(pagina, doc, { tienda: pagina.tienda, productoId: pagina.shopify_product_id });
    assert.notEqual(salida, pagina);
    assert.equal(salida.documento_borrador.version, 1);
    assert.equal(salida.titulo, "Título nuevo");
    assert.equal(salida.data, pagina.data);
    assert.equal(pagina.documento_borrador, undefined);
  });

  test("rechaza cambiar la identidad de la página o del producto", () => {
    const pagina = paginaVieja();
    const doc = documentoDePagina(pagina);
    assert.throws(() => guardarBorradorV1(pagina, { ...doc, id: "pag_otro" }), /id.*coincide/);
    assert.throws(() => guardarBorradorV1(pagina, { ...doc, id: null }), /id.*coincide/);
    assert.throws(() => guardarBorradorV1(pagina, { ...doc, tienda: null }, { tienda: pagina.tienda }), /tienda.*coincide/);
    assert.throws(() => guardarBorradorV1(pagina, { ...doc, producto_id: "gid:\/\/shopify\/Product\/999" }, { productoId: pagina.shopify_product_id }), /producto_id.*coincide/);
    assert.throws(() => guardarBorradorV1(pagina, { ...doc, producto_id: null }, { productoId: pagina.shopify_product_id }), /producto_id.*coincide/);
  });

  test("migra el contrato moderno completo, todas las imágenes y la evidencia", () => {
    const pagina = paginaModerna();
    const doc = documentoDePagina(pagina);
    assert.equal(doc.titulo, "Producto moderno");
    assert.equal(doc.evidencia.rating.value, 4.8);
    assert.equal(doc.evidencia.testimonial.author, "Ana");
    const imagenes = doc.arbol.flatMap((seccion) => (seccion.hijos || []).filter((nodo) => nodo.tipo === "imagen"));
    assert.equal(imagenes.length, 5); // héroe (3) + comparación + comunidad
    const html = require("../nucleo/render").render(doc, { modo: "editor" }).html;
    assert.match(html, /Una mejora visible/);
    assert.match(html, /Preguntas/);
  });

  test("migrar todas las imágenes de la galería legacy y no duplica el titular", () => {
    const pagina = paginaVieja();
    pagina.urls = {
      uno: "https://cdn.shopify.com/uno.webp",
      dos: "https://cdn.shopify.com/dos.webp",
      tres: "https://cdn.shopify.com/tres.webp"
    };
    pagina.data.facetas.hero.galeria = ["uno", "dos", "tres"];
    pagina.data.facetas.beneficios = { titular: "Beneficios", puntos: ["Suave"] };
    const doc = documentoDePagina(pagina);
    const hero = doc.arbol[0];
    assert.equal(hero.tipo, "seccion");
    const galeria = hero.hijos.find((nodo) => nodo.tipo === "galeria_producto");
    assert.equal(galeria.props.imagenes.length, 3);
    assert.equal(galeria.props.imagenes[0].imagen.src, "https://cdn.shopify.com/uno.webp");
    const beneficios = doc.arbol.find((nodo) => nodo.hijos.some((hijo) => hijo.props?.html === "Beneficios"));
    assert.equal(beneficios.hijos.filter((hijo) => hijo.props?.html === "Beneficios").length, 1);
  });

  test("la página real de producto entra al catálogo atómico sin inventar reseñas", () => {
    const archivo = path.join(__dirname, "..", "paginas", "emfgq0-he.myshopify.com", "15018479518063.json");
    const pagina = JSON.parse(fs.readFileSync(archivo, "utf8"));
    const doc = documentoDePagina(pagina);
    const recolectar = (nodos) => (nodos || []).flatMap((nodo) => [nodo, ...recolectar(nodo.hijos)]);
    const tipos = recolectar(doc.arbol).map((nodo) => nodo.tipo);
    assert.equal(tipos.includes("galeria_producto"), true);
    assert.equal(tipos.includes("titulo_producto"), true);
    assert.equal(tipos.includes("precio_producto"), true);
    assert.equal(tipos.includes("beneficios_producto"), true);
    assert.equal(tipos.includes("boton_carrito"), true);
    assert.equal(tipos.includes("acordeon_faq"), true);
    assert.equal(tipos.includes("imagen_texto"), true);
    assert.equal(tipos.includes("tabla_comparacion"), true);
    assert.equal(tipos.includes("estadisticas"), true);
    assert.equal(tipos.includes("garantia"), true);
    assert.equal(tipos.filter((tipo) => tipo === "imagen_texto").length, 2);
    assert.equal(tipos.includes("carrusel_resenas"), false);
    const salida = require("../nucleo/render").render(doc, { modo: "editor" });
    assert.match(salida.html, /tiq-galeria/);
    assert.match(salida.html, /Tiras Nariz Carbón Activado/);
    assert.match(salida.html, /Precio del producto|19\.95/);
  });
});
