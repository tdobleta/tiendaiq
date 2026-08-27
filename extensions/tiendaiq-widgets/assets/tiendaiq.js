// ============================================================
// RENDERER — función pura: entra el Producto Universal, sale HTML.
//
// Reglas del contrato que se implementan acá:
//  - Todo slot de imagen acepta null → placeholder punteado.
//  - media_id se resuelve a img/{id}.jpg; si el archivo no existe,
//    cae al mismo placeholder (onerror). La plantilla nunca rompe.
//  - Precio comparativo: solo se renderiza tachado si existe.
//  - Variantes: si la única opción es "Title"/"Default Title",
//    el bloque no se renderiza (passthrough sucio de Shopify).
//  - texto null en reseñas → tarjeta en modo guía (punteada).
// ============================================================

(function () {
  "use strict";

  // ---------- modo ----------
  // Tienda: la plantilla Liquid deja datos en window.TIENDAIQ_*.
  // Preview local: data.js define DATA y URLS.
  const EN_TIENDA = typeof window.TIENDAIQ_DATA !== "undefined" && !!window.TIENDAIQ_DATA;
  // ?app=1 → preview de la app: ignora data.js y espera los datos por mensaje.
  const MODO_APP = /[?&]app=1/.test(location.search);
  const DATOS = EN_TIENDA
    ? window.TIENDAIQ_DATA
    : MODO_APP ? null : (typeof DATA !== "undefined" ? DATA : null);
  const MAPA_URLS =
    (EN_TIENDA && window.TIENDAIQ_URLS) ||
    (!MODO_APP && typeof URLS !== "undefined" ? URLS : {});

  // ---------- helpers ----------

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  // Older generated payloads can contain UTF-8 decoded as Latin-1. Repair it
  // at the renderer boundary so published pages do not expose mojibake.
  const repararMojibake = (value) => {
    const text = String(value ?? "");
    if (!/[\u00c3\u00c2\u00e2\u00f0]/.test(text)) return text;
    try { return decodeURIComponent(escape(text)); } catch { return text; }
  };

  // El pool guarda media_id; la url se resuelve acá contra MAPA_URLS. En la
  // tienda ese mapa lo arma Liquid con las fotos vivas del producto; en el
  // preview local lo deja el adaptador. Media_id borrado → placeholder.
  const urlImagen = (mediaId) => MAPA_URLS[mediaId] || `img/${mediaId}.jpg`;

  // Reescribe el ancho de una URL del CDN de Shopify (?width=N) para pedir el
  // tamaño justo por dispositivo. Solo aplica si la URL ya trae width=.
  const anchoUrl = (url, w) => url.replace(/([?&]width=)\d+/, "$1" + w);
  const srcsetDe = (url, anchos) =>
    /[?&]width=\d+/.test(url) ? anchos.map((w) => `${anchoUrl(url, w)} ${w}w`).join(", ") : "";

  // <img> que degrada a placeholder si el archivo no existe.
  // opts: { hero } = imagen LCP (eager + fetchpriority + srcset amplio);
  //       { ancho } = miniatura (pide un ancho chico, sin srcset);
  //       resto = lazy + srcset responsive. Todo aditivo: URLs sin width= (dev)
  //       o placeholders siguen igual.
  const img = (mediaId, alt = "", opts = {}) => {
    if (!mediaId) return `<div class="ph-img">Imagen pendiente</div>`;
    let url = urlImagen(mediaId);
    const tieneW = /[?&]width=\d+/.test(url);
    if (opts.ancho && tieneW) url = anchoUrl(url, opts.ancho); // miniatura → ancho chico
    const carga = opts.hero
      ? `loading="eager" fetchpriority="high" decoding="async"`
      : `loading="lazy" decoding="async"`;
    let respons = "";
    if (!opts.ancho && tieneW) {
      const ss = srcsetDe(url, opts.hero ? [400, 600, 900, 1200, 1600] : [400, 700, 1000]);
      const sizes = opts.sizes || (opts.hero ? "(max-width:749px) 100vw, 45vw" : "(max-width:749px) 90vw, 340px");
      respons = ` srcset="${esc(ss)}" sizes="${esc(sizes)}"`;
    }
    return `<img src="${esc(url)}" alt="${esc(alt)}"${respons} ${carga}
      onerror="this.outerHTML='<div class=\\'ph-img\\'>${esc(mediaId)}</div>'">`;
  };

  // Asset de la plantilla (avatares, iconos): ruta directa, no media_id.
  // Si el archivo no está, cae a la silueta en vez de romper.
  const imgAsset = (ruta, respaldo) => {
    if (!ruta) return respaldo;
    // En la tienda los assets viven en el CDN del tema; el publicador guarda
    // solo el nombre del archivo y acá se le antepone la base.
    let src = ruta;
    if (EN_TIENDA && window.TIENDAIQ_ASSET_BASE && !/^https?:/.test(ruta)) {
      src = window.TIENDAIQ_ASSET_BASE + ruta.split("/").pop();
    }
    // encodeURI: los nombres de archivo pueden traer espacios y comas.
    // El fallback viaja en un atributo propio. Inyectarlo dentro de un
    // atributo onerror rompe el HTML cuando el fallback contiene comillas.
    return `<img src="${esc(encodeURI(src))}" alt="" data-fallback="${esc(respaldo)}" onerror="this.outerHTML=this.dataset.fallback">`;
  };

  // role="img" + aria-label: el lector de pantalla anuncia "N de 5 estrellas"
  // en vez de deletrear los glyphs "★★★★★". Sin cambio visual.
  const estrellas = (n = 5) => `<span class="estrellas" role="img" aria-label="${n} de 5 estrellas">${"★".repeat(n)}</span>`;
  // Miles con punto (es-AR): 1205 → "1.205".
  const miles = (n) => String(n ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  // Puntaje siempre con un decimal cuando existe una fuente real.
  const puntaje1 = (n) => Number(n).toFixed(1);
  const estrellasValidas = (n) => {
    const value = Number(n);
    if (!Number.isFinite(value) || value < 1 || value > 5) return "";
    return estrellas(Math.round(value));
  };
  const tienePuntajeReal = (puntaje, cantidad) => {
    const score = Number(puntaje);
    const total = Number(cantidad);
    return Number.isFinite(score) && score > 0 && Number.isFinite(total) && total > 0;
  };
  const resenaCompleta = (r) => !!(r && r.texto && r.autor && estrellasValidas(r.estrellas));
  const estadisticaCompleta = (s) => {
    const pct = Number(s?.pct);
    return Number.isFinite(pct) && pct >= 0 && pct <= 100 && !!s?.frase;
  };

  // Iconos de línea (mismos que usa PagePilot: trazo fino, sin relleno)
  const ICONO = {
    camion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7h13v9H1z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="5.5" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>`,
    paquete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8.5v9L12 22l-9-4.5v-9L12 4l9 4.5z"/><path d="M3 8.5l9 4.5 9-4.5"/><path d="M12 13v9"/><path d="M7.5 6.25l9 4.5"/></svg>`,
    corazon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S3.5 15 3.5 9.3C3.5 6.4 5.7 4.5 8 4.5c1.7 0 3.2.9 4 2.3.8-1.4 2.3-2.3 4-2.3 2.3 0 4.5 1.9 4.5 4.8 0 5.7-8.5 11.2-8.5 11.2z"/></svg>`,
    globo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18z"/></svg>`,
    retorno: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>`,
    // check violeta de los bullets del hero — trazo grueso redondeado, como PagePilot
    tick: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.8l4.7 4.7L19.5 6.8"/></svg>`,
    // sello visual para claims con fuente verificada
    verificado: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="M10.2 16.4l-4-4 1.4-1.4 2.6 2.6 6-6 1.4 1.4z" fill="#fff"/></svg>`
  };

  // los acordeones del hero llevan icono fijo por posición: globo, retorno
  const ICONO_ACORDEON = [ICONO.globo, ICONO.retorno];

  // Set curado de íconos de línea para los bullets (reemplaza el emoji genérico
  // que leía a IA). La IA elige la clave por beneficio; heredan el color del
  // acento del nicho vía currentColor. Trazo fino redondeado, estilo consistente.
  const _sv = (p) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICONOS_BULLET = {
    escudo: _sv(`<path d="M12 3l7 2.5V11c0 4.6-3.1 7.6-7 8.5-3.9-.9-7-3.9-7-8.5V5.5z"/><path d="M9 12l2 2 4-4.2"/>`),
    rayo: _sv(`<path d="M13 2.5 4.5 13.5H11l-1 8L19.5 10H13z"/>`),
    gota: _sv(`<path d="M12 3.5c3 3.4 5.5 6.3 5.5 9.4a5.5 5.5 0 0 1-11 0c0-3.1 2.5-6 5.5-9.4z"/>`),
    reloj: _sv(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.3V12l3.2 2"/>`),
    hoja: _sv(`<path d="M5 19c9 1.4 14-4.6 14-13 0 0-8.6-1.4-12.6 3.6C4 12.5 4.5 16 5 19z"/><path d="M5 19l8-8"/>`),
    corazon: ICONO.corazon,
    brillo: _sv(`<path d="M12 3l1.7 4.6L18.3 9l-4.6 1.4L12 15l-1.7-4.6L5.7 9l4.6-1.4z"/><path d="M18.5 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>`),
    estrella: _sv(`<path d="M12 3.4l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.5l-5.1 2.6 1-5.7-4.1-4 5.7-.8z"/>`),
    pluma: _sv(`<path d="M20.2 8.2A5.5 5.5 0 0 0 11 4.1L5.5 9.6V19h9.4z"/><path d="M16 8 3.5 20.5"/><path d="M15.5 13H9"/>`),
    caja: ICONO.paquete,
    camion: ICONO.camion,
    regla: _sv(`<path d="M3 15 15 3l6 6L9 21z"/><path d="M7.5 10.5l1.6 1.6M10.5 7.5l1.6 1.6M13.5 4.5l1.6 1.6M4.5 13.5l1.6 1.6"/>`),
    sol: _sv(`<circle cx="12" cy="12" r="4.4"/><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/>`),
    luna: _sv(`<path d="M20 14.4A8 8 0 1 1 9.6 4 6.5 6.5 0 0 0 20 14.4z"/>`),
    diana: _sv(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`),
    refresh: _sv(`<path d="M20 11a8 8 0 1 0-2.1 6.4"/><path d="M20 4.5V11h-6.5"/>`),
    candado: _sv(`<rect x="4.8" y="10.5" width="14.4" height="9.7" rx="2"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>`),
    check: _sv(`<circle cx="12" cy="12" r="9"/><path d="M8.4 12.4l2.5 2.5 4.7-5.4"/>`)
  };

  // Estilo del botón de compra (presets elegibles en el editor): forma, borde,
  // mayúsculas e ícono de carrito. El color lo sigue dando el tema (--acento).
  const CART_ICO = '<svg class="cta__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.4"/><circle cx="19" cy="20" r="1.4"/><path d="M2.5 3h2.2l2.2 11.2a1.6 1.6 0 0 0 1.6 1.3h8.5a1.6 1.6 0 0 0 1.6-1.3L21 6.5H6"/></svg>';
  const ctaClase = (g, extra) => {
    const c = ["cta", extra];
    if (g.boton_estilo === "pildora") c.push("cta--pildora");
    else if (g.boton_estilo === "recto") c.push("cta--recto");
    if (g.boton_borde) c.push("cta--borde");
    if (g.boton_mayus) c.push("cta--mayus");
    return c.filter(Boolean).join(" ");
  };
  const ctaContenido = (g) => `${g.boton_icono !== false ? CART_ICO : ""}<span>${esc(g.cta)}</span>`;
  const cta = (global, extra = "") =>
    `<button class="${ctaClase(global || {}, extra)}">${ctaContenido(global || {})}</button>`;

  // Símbolo y lado por divisa. Lo que no figure cae a "$" adelante, que es
  // lo correcto en casi toda LatAm. El código (ARS, MXN…) no se muestra.
  const DIVISAS = {
    USD: "$", ARS: "$", MXN: "$", CLP: "$", COP: "$", UYU: "$",
    PEN: "S/ ", BRL: "R$ ", BOB: "Bs ", PYG: "₲ ", GTQ: "Q ",
    DOP: "RD$ ", CRC: "₡ ", VES: "Bs ", GBP: "£",
    EUR: { simbolo: " €", despues: true }
  };
  const precioBonito = (moneda, valor) => {
    const d = DIVISAS[moneda] ?? "$";
    if (typeof d === "object" && d.despues) return `${valor}${d.simbolo}`;
    return `${d}${valor}`;
  };

  // En la tienda el botón principal agrega al carrito de verdad, pero por
  // AJAX (/cart/add.js): el cliente se queda en la página en vez de irse
  // al carrito. El form clásico queda como fallback si el fetch falla.
  // En el preview local sigue siendo un botón muerto.
  const botonComprar = (global) => {
    const variante = EN_TIENDA ? window.TIENDAIQ_VARIANT : null;
    if (!variante) return cta(global, "cta--full");
    return `
      <form method="post" action="/cart/add" onsubmit="return tiendaiqAgregar(event)">
        <input type="hidden" name="id" value="${esc(variante)}">
        <input type="hidden" name="quantity" value="1" id="tiendaiq-cantidad-form">
        <button type="submit" class="${ctaClase(global, "cta--full")}">${ctaContenido(global)}</button>
      </form>`;
  };

  const ctaCentro = (faceta, global) =>
    faceta.cta ? `<div class="cta-centro">${cta(global)}</div>` : "";

  // ---------- facetas ----------

  // El renderer se selecciona por descriptor estable. El alias sólo se lee
  // para páginas históricas que todavía no tenían `global.template`.
  const DESCRIPTOR_RENDERER_KEYS = Object.freeze({
    "tiendaiq/classic@1": "classic",
    "tiendaiq/premium@1": "premium",
    "tiendaiq/performance-story@1": "performance-story",
    "tiendaiq/pinza-pagepilot@1": "pinza-pagepilot",
    "legacy/pagepilot@1": "pagepilot",
    "legacy/pagepilot-blue@1": "pagepilot-blue"
  });

  function rendererKey(global = {}) {
    const descriptor = global?.template;
    const key = descriptor && `${descriptor.id}@${descriptor.version}`;
    if (key && DESCRIPTOR_RENDERER_KEYS[key]) return DESCRIPTOR_RENDERER_KEYS[key];
    if (global?.estilo === "pagepilot-blue") return "pagepilot-blue";
    if (global?.estilo === "pagepilot") return "pagepilot";
    if (global?.estilo === "performance-story") return "performance-story";
    if (global?.estilo === "pinza-pagepilot") return "pinza-pagepilot";
    if (global?.estilo === "premium") return "premium";
    return "classic";
  }

  function hero(f, fuente, global) {
    const h = f.hero;

    const galeria = h.galeria ?? [];
    const principal = galeria[0] ?? null;
    const miniaturas = galeria
      .map(
        (id, i) =>
          `<button class="hero__mini ${i === 0 ? "activa" : ""}"
             onclick="cambiarPrincipal('${esc(id)}', this)">${img(id, "", { ancho: 160 })}</button>`
      )
      .join("");

    const comparativo = fuente.precio_comparativo
      ? `<span class="hero__comparativo">${esc(precioBonito(fuente.moneda, fuente.precio_comparativo))}</span>`
      : "";

    // Pastilla de % ahorro: se calcula del precio vs el comparativo (dato que
    // ya existe). Solo aparece si el comparativo es MAYOR que el precio actual.
    const pAhora = parseFloat(fuente.precio);
    const pAntes = parseFloat(fuente.precio_comparativo);
    const pctDesc =
      isFinite(pAhora) && isFinite(pAntes) && pAntes > pAhora
        ? Math.round((1 - pAhora / pAntes) * 100)
        : 0;
    const descuento = pctDesc > 0 ? `<span class="hero__descuento">-${pctDesc}%</span>` : "";

    // Bullet nuevo = {emoji, fuerte, resto}: emoji a color relevante + arranque
    // en negrita (estilo SOLUME/PagePilot). Retrocompat: páginas viejas traen
    // {icono} (ícono de línea) o string plano → siguen renderizando igual.
    const bullets = (h.bullets ?? [])
      .map((b) => {
        if (typeof b === "string")
          return `<li><span class="hero__bullet-ico">${ICONOS_BULLET.check}</span><span>${esc(b)}</span></li>`;
        let ico;
        if (b.emoji)
          ico = `<span class="hero__bullet-emoji">${esc(b.emoji)}</span>`;
        else if (b.icono && ICONOS_BULLET[b.icono])
          ico = `<span class="hero__bullet-ico">${ICONOS_BULLET[b.icono]}</span>`;
        else ico = `<span class="hero__bullet-ico">${ICONOS_BULLET.check}</span>`;
        const fuerte = esc(b.fuerte ?? "");
        const resto = esc(b.resto ?? "");
        // "gancho en negrita – detalle": guión entre las dos partes (estilo SOLUME).
        const cuerpo = fuerte && resto ? `<strong>${fuerte}</strong> – ${resto}` : fuerte ? `<strong>${fuerte}</strong>` : resto;
        return `<li>${ico}<span>${cuerpo}</span></li>`;
      })
      .join("");

    // Los selectores de variante (Color, Plug Type, etc.) no se muestran:
    // el hero va directo de los bullets a Cantidad, como la referencia.
    // La compra usa la variante por defecto del producto.
    const variantes = "";

    const badges = `
      <div class="hero__badges">
        <div class="badge"><span class="badge__icono">${ICONO.camion}</span>Envío rastreado y asegurado</div>
        <div class="badge"><span class="badge__icono">${ICONO.paquete}</span>30 días de garantía</div>
        <div class="badge"><span class="badge__icono">${ICONO.corazon}</span>Devoluciones gratis</div>
      </div>`;

    const rd = h.resena_destacada ?? {};
    const rdVisible = resenaCompleta(rd);
    const rdTexto = `"${esc(rd.texto || "")}"`;
    const rdAutor = esc(rd.autor || "");
    const heroResenas = tienePuntajeReal(h.puntaje, h.resenas_count)
      ? `<div class="hero__resenas">${estrellasValidas(h.puntaje)} <span>Calificación ${esc(puntaje1(h.puntaje))}/5.0 (${esc(miles(h.resenas_count))})</span></div>`
      : "";
    // El avatar es un asset de la plantilla (avatares/xx.jpg), no un media_id
    // del producto. Sin carpeta o sin archivo, cae a la silueta.
    const rdAvatar = imgAsset(rd.avatar, `<span class="resena-destacada__silueta">👤</span>`);

    const acordeones = (h.acordeones ?? [])
      .map(
        (a, i) => `
        <details class="acordeon">
          <summary><span class="acordeon__titulo"><span class="acordeon__icono">${ICONO_ACORDEON[i] ?? ICONO.globo}</span>${esc(a.titulo)}</span></summary>
          <p>${esc(a.contenido)}</p>
        </details>`
      )
      .join("");

    return `
    <section class="hero">
      <div class="contenedor">
        <div class="hero__grid">
          <div class="hero__galeria">
            <div class="hero__principal" id="imagen-principal">${img(principal, h.titulo, { hero: true })}</div>
            <div class="hero__miniaturas">${miniaturas}</div>
          </div>
          <div>
            ${rendererKey(global) === "premium"
              ? heroTimer(global)
              : `<div class="hero__urgencia">${esc(h.urgencia ?? "Ya es viral | Pocas unidades")}</div>`}
            ${heroResenas}
            <h1 class="hero__titulo">${esc(h.titulo)}</h1>
            <div class="hero__precios">
              <span class="hero__precio">${esc(precioBonito(fuente.moneda, fuente.precio))}</span>
              ${comparativo}
              ${descuento}
            </div>
            <p class="hero__impuestos">Impuestos incluidos.</p>
            <ul class="hero__bullets">${bullets}</ul>
            ${variantes}
            ${botonComprar(global)}
            ${badges}
            ${rdVisible ? `
            <div class="resena-destacada">
              <div class="resena-destacada__foto">
                <div class="resena-destacada__avatar">${rdAvatar}</div>
                <button class="resena-destacada__editar" type="button">✎ Editar</button>
              </div>
              <div class="resena-destacada__cuerpo">
                ${estrellasValidas(rd.estrellas)}
                <p class="resena-destacada__texto">${rdTexto}</p>
                <div class="resena-destacada__autor">${ICONO.verificado} ${rdAutor}</div>
              </div>
            </div>` : ""}
            ${acordeones}
          </div>
        </div>
      </div>
    </section>`;
  }

  function dupla(f, global, invertida) {
    return `
    <section class="dupla ${invertida ? "dupla--invertida" : ""}">
      <div class="contenedor">
        <div class="dupla__grid">
          <div class="dupla__media">${img(f.imagen)}</div>
          <div>
            <h2>${esc(f.titular)}</h2>
            <p>${esc(f.parrafo)}</p>
          </div>
        </div>
      </div>
    </section>`;
  }

  function iconos(f) {
    const item = (it) => `
      <div class="icono-item">
        <div class="icono-item__emoji">${esc(it.emoji)}</div>
        <div class="icono-item__titulo">${esc(it.titulo)}</div>
        <div class="icono-item__frase">${esc(it.frase)}</div>
      </div>`;

    const items = f.items ?? [];
    return `
    <section class="iconos">
      <div class="contenedor">
        <h2>${esc(f.titular)}</h2>
        <p class="iconos__subtitulo">${esc(f.subtitulo)}</p>
        <div class="iconos__grid">
          <div class="iconos__col">${items.slice(0, 2).map(item).join("")}</div>
          <div class="iconos__centro">${img(f.imagen_central)}</div>
          <div class="iconos__col">${items.slice(2, 4).map(item).join("")}</div>
        </div>
      </div>
    </section>`;
  }

  function tabla(f, heroTitulo, global) {
    const filas = (f.filas ?? [])
      .map(
        (fila) => `
        <tr>
          <td>${esc(fila)}</td>
          <td class="si">✔</td>
          <td class="no">✕</td>
        </tr>`
      )
      .join("");

    return `
    <section class="tabla">
      <div class="contenedor">
        <div class="tabla__grid">
          <div>
            <h2>${esc(f.titular)}</h2>
            <p>${esc(f.parrafo)}</p>
            ${f.cta ? cta(global) : ""}
          </div>
          <table class="tabla-comparativa">
            <thead>
              <tr><th></th><th>${esc(heroTitulo)}</th><th>${esc(f.col_otros ?? "Otros")}</th></tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </div>
    </section>`;
  }

  function stats(f, global) {
    const items = (f.items ?? [])
      .filter(estadisticaCompleta)
      .map(
        (s) => `
        <div class="stat-item">
          <div class="stat-item__circulo">${esc(s.pct)}%</div>
          <div class="stat-item__frase">${esc(s.frase)}</div>
        </div>`
      )
      .join("");
    if (!items) return "";

    return `
    <section class="stats">
      <div class="contenedor">
        <div class="stats__grid">
          <div class="stats__media">${img(f.imagen)}</div>
          <div>
            <h2>${esc(f.titular)}</h2>
            ${items}
            ${f.cta ? `<div style="margin-top:24px">${cta(global)}</div>` : ""}
          </div>
        </div>
      </div>
    </section>`;
  }

  // Media que se auto-reproduce en loop, SIN controles: gif/imagen → <img>;
  // video (mp4/webm/cdn) → <video autoplay muted loop>; YouTube → thumbnail.
  function mediaAuto(url) {
    url = (url || "").trim();
    // Giphy: si pegan el link de la PÁGINA (giphy.com/gifs/slug-ID) lo pasamos
    // al gif directo, así "anda" sin que el usuario tenga que buscar el .gif.
    const gphy = url.match(/giphy\.com\/(?:gifs|clips|stickers)\/(?:[^/]*-)?([A-Za-z0-9]{6,})/i);
    if (gphy) url = `https://media.giphy.com/media/${gphy[1]}/giphy.gif`;
    if (/\.(gif|png|jpe?g|webp|avif)(\?|#|$)/i.test(url))
      return `<img class="muro__media" src="${esc(encodeURI(url))}" alt="" loading="lazy">`;
    const yt = idYouTube(url);
    if (yt) return `<img class="muro__media" src="https://i.ytimg.com/vi/${yt}/hqdefault.jpg" alt="" loading="lazy">`;
    return `<video class="muro__media" src="${esc(encodeURI(url))}" autoplay muted loop playsinline></video>`;
  }

  // Muro de clientes (UGC): sección PROPIA (no la section del constructor).
  // Carrusel de cards verticales que auto-reproducen gif o video. Vacío por
  // defecto; el merchant inyecta desde el editor. Reusa el shell del carrusel.
  function muroClientes(c) {
    if (!c) return "";
    const items = c.items || [];
    const visibles = MODO_APP
      ? items.map((i, j) => [i, j])
      : items.map((i, j) => [i, j]).filter(([i]) => i.url);
    // Sin clips reales, la sección NO se muestra — ni en la tienda ni en el
    // editor. El "carrusel de videos/clientes" se rehará como sección propia
    // (por ahora no lo sembramos en páginas nuevas). Si el merchant ya tenía
    // clips, se siguen viendo.
    if (!visibles.length) return "";
    const paraPintar = visibles.length ? visibles : [[{}, 0]];
    const cards = paraPintar
      .map(([i]) =>
        i.url
          ? `<div class="tiq-video muro-card">${mediaAuto(i.url)}</div>`
          : `<div class="tiq-video muro-card muro-card--vacio"><div class="muro-card__add">${ICONO_VIDEO}<span>Agregar gif o video</span></div></div>`
      )
      .join("");
    return `
    <section class="muro">
      <div class="contenedor">
        <h2 class="muro__titulo">${esc(c.titulo || "Contenido de clientes")}</h2>
        <div class="tiq-vcar" data-idx="0">
          <button class="tiq-vcar__flecha tiq-vcar__flecha--izq" type="button" onclick="tiqVideoNav(this,-1)" aria-label="Anterior">${FLECHA_IZQ}</button>
          <div class="tiq-vcar__viewport"><div class="tiq-vcar__pista">${cards}</div></div>
          <button class="tiq-vcar__flecha tiq-vcar__flecha--der" type="button" onclick="tiqVideoNav(this,1)" aria-label="Siguiente">${FLECHA_DER}</button>
        </div>
      </div>
    </section>`;
  }

  function faq(f, global) {
    // Checkbox tildado a la izquierda de cada pregunta (como la referencia).
    const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3.5"/><path d="M7.5 12.2l3 3 6-6.4"/></svg>`;
    // Olas EN MOVIMIENTO tipo "layered waves" (el efecto clásico más usado): 3
    // capas BLANCAS a distinta opacidad y velocidad que fluyen horizontal en loop
    // sin cortes → parece agua con espuma y profundidad, limpio (sin grises
    // sucios). Onda que se repite (2 períodos de 1440 en viewBox 2880); mover
    // -50% = un período, con tangentes continuas = loop perfecto. La más lenta y
    // baja va atrás; la opaca al frente es el borde real con la página.
    const OLA_TOP = `
      <svg class="ola ola--1" viewBox="0 0 2880 80" preserveAspectRatio="none"><path fill="#ffffff" opacity="0.35" d="M0,54 C240,78 480,78 720,54 C960,30 1200,30 1440,54 C1680,78 1920,78 2160,54 C2400,30 2640,30 2880,54 V0 H0 Z"/></svg>
      <svg class="ola ola--2" viewBox="0 0 2880 80" preserveAspectRatio="none"><path fill="#ffffff" opacity="0.6" d="M0,48 C240,70 480,70 720,48 C960,26 1200,26 1440,48 C1680,70 1920,70 2160,48 C2400,26 2640,26 2880,48 V0 H0 Z"/></svg>
      <svg class="ola ola--3" viewBox="0 0 2880 80" preserveAspectRatio="none"><path fill="#ffffff" d="M0,40 C240,60 480,60 720,40 C960,20 1200,20 1440,40 C1680,60 1920,60 2160,40 C2400,20 2640,20 2880,40 V0 H0 Z"/></svg>`;
    const OLA_BOT = `
      <svg class="ola ola--1" viewBox="0 0 2880 80" preserveAspectRatio="none"><path fill="#ffffff" opacity="0.35" d="M0,26 C240,2 480,2 720,26 C960,50 1200,50 1440,26 C1680,2 1920,2 2160,26 C2400,50 2640,50 2880,26 V80 H0 Z"/></svg>
      <svg class="ola ola--2" viewBox="0 0 2880 80" preserveAspectRatio="none"><path fill="#ffffff" opacity="0.6" d="M0,32 C240,10 480,10 720,32 C960,54 1200,54 1440,32 C1680,10 1920,10 2160,32 C2400,54 2640,54 2880,32 V80 H0 Z"/></svg>
      <svg class="ola ola--3" viewBox="0 0 2880 80" preserveAspectRatio="none"><path fill="#ffffff" d="M0,40 C240,20 480,20 720,40 C960,60 1200,60 1440,40 C1680,20 1920,20 2160,40 C2400,60 2640,60 2880,40 V80 H0 Z"/></svg>`;

    const items = (f.items ?? [])
      .map(
        (q) => `
        <details class="faq__item">
          <summary><span class="faq__q"><span class="faq__check">${CHECK}</span>${esc(q.pregunta)}</span></summary>
          <p>${esc(q.respuesta)}</p>
        </details>`
      )
      .join("");

    return `
    <section class="faq">
      <div class="faq__ola faq__ola--top">${OLA_TOP}</div>
      <div class="contenedor">
        <div class="faq__cabecera">
          <h2>${esc(f.titular)}</h2>
          <p>${esc(f.subtitulo)}</p>
        </div>
        <div class="faq__lista">${items}</div>
      </div>
      <div class="faq__ola faq__ola--bot">${OLA_BOT}</div>
    </section>`;
  }

  function resenas(f) {
    const items = (f.items ?? []).filter(resenaCompleta);
    if (!items.length) return "";

    const tarjeta = (r, j) => {
      // En el editor la foto es clickeable: abre el selector de archivos.
      const clic = MODO_APP ? ` data-imgclick="res:${j}" title="Clic para elegir una imagen"` : "";
      return `
      <div class="tarjeta-resena">
        <div class="tarjeta-resena__img${MODO_APP ? " tiq-clicable" : ""}"${clic}>${r.imagen ? img(r.imagen) : ""}</div>
        <div class="tarjeta-resena__autor">${esc(r.autor)}</div>
        ${estrellasValidas(r.estrellas)}
        <p class="tarjeta-resena__texto">${esc(r.texto)}</p>
      </div>`;
    };

    return `
    <section class="resenas">
      <div class="contenedor">
        <div class="resenas__cabecera">
          <h2>${esc(f.titular)}</h2>
          <p>${esc(f.subtitulo)}</p>
        </div>
        ${EN_TIENDA ? "" : `<button class="resenas__editar">✎ Editar reseñas en lote</button>`}
        <div class="resenas__grid">${items.map(tarjeta).join("")}</div>
      </div>
    </section>`;
  }

  function recomendados(f) {
    if (EN_TIENDA) {
      return `
      <section class="recomendados" data-tiq-live-recommendations hidden>
        <div class="contenedor">
          <h2>Productos recomendados</h2>
          <div class="recomendados__grid"></div>
        </div>
      </section>`;
    }
    const items =
      f.modo === "placeholder" || !(f.items ?? []).length
        ? Array.from({ length: 5 }, (_, i) => ({
            nombre: `Producto ${i + 1}`,
            precio: "—",
            imagen: null
          }))
        : f.items;

    const tarjetas = items
      .map(
        (p) => `
        <div class="tarjeta-producto">
          ${p.imagen ? img(p.imagen, p.nombre) : `<div class="ph-img"></div>`}
          <div class="tarjeta-producto__nombre">${esc(p.nombre)}</div>
          <div class="tarjeta-producto__precio">${esc(p.precio)}</div>
        </div>`
      )
      .join("");

    return `
    <section class="recomendados">
      <div class="contenedor">
        <h2>Productos recomendados</h2>
        <div class="recomendados__grid">${tarjetas}</div>
      </div>
    </section>`;
  }

  // ---------- sections incrustables (carruseles) ----------
  //
  // El merchant las arrastra desde el editor y las intercala entre los bloques
  // fijos. Viven en data.secciones[] con { id, tipo, ancla, ...contenido }.
  // Mismo HTML en la tienda y en el preview; la interactividad es window.tiq*.

  const idYouTube = (url) => {
    const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
    return m ? m[1] : null;
  };
  const idVimeo = (url) => {
    const m = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? m[1] : null;
  };

  // La URL del reproductor embebido, con autoplay al tocar el poster.
  function videoEmbed(url) {
    const yt = idYouTube(url);
    if (yt)
      return `<iframe class="tiq-video__player" src="https://www.youtube.com/embed/${yt}?autoplay=1&rel=0&playsinline=1" title="" frameborder="0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
    const vm = idVimeo(url);
    if (vm)
      return `<iframe class="tiq-video__player" src="https://player.vimeo.com/video/${vm}?autoplay=1" title="" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    return `<video class="tiq-video__player" src="${esc(url)}" controls autoplay playsinline></video>`;
  }

  // El poster: el que puso el merchant (media_id o url), o el thumbnail
  // automático de YouTube, o un fondo oscuro con el play.
  function posterVideo(item) {
    if (item.poster) {
      const src = /^https?:/.test(item.poster) ? item.poster : urlImagen(item.poster);
      return `<img src="${esc(src)}" alt="" loading="lazy">`;
    }
    const yt = idYouTube(item.url);
    if (yt) return `<img src="https://i.ytimg.com/vi/${yt}/hqdefault.jpg" alt="" loading="lazy">`;
    return `<div class="tiq-video__ph"></div>`;
  }

  const FLECHA_IZQ = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`;
  const FLECHA_DER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`;
  const PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

  const ICONO_VIDEO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="M16.5 9.5l5-2.5v10l-5-2.5"/></svg>`;
  const ICONO_IMG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M4 17l4.5-4.5 4 4L15.5 12l4.5 4.5"/></svg>`;

  // Videos: carrusel CENTRADO. Un video protagonista en el medio, los vecinos
  // asomando a los costados; las flechas pasan de a uno (posición fija).
  // En el editor SIEMPRE se ven los espacios (aunque estén vacíos); en la
  // tienda solo los videos ya cargados.
  function seccionVideos(s) {
    const items = s.items || [];
    const visibles = MODO_APP ? items.map((i, j) => [i, j]) : items.map((i, j) => [i, j]).filter(([i]) => i.url);
    if (!visibles.length) return MODO_APP ? "" : ""; // sin nada que mostrar

    const cards = visibles
      .map(([i, j]) => {
        if (!i.url) {
          // espacio vacío (solo editor): clic → cargar video
          return `
          <div class="tiq-video tiq-video--vacio" data-vslot="${esc(s.id)}:${j}" title="Clic para agregar un video">
            <div class="tiq-video__add">${ICONO_VIDEO}<span>Agregar video</span></div>
          </div>`;
        }
        const accion = MODO_APP ? `data-vslot="${esc(s.id)}:${j}" title="Clic para cambiar este video"` : `onclick="tiqVideoPlay(this)"`;
        return `
        <div class="tiq-video" data-embed="${esc(videoEmbed(i.url))}">
          <div class="tiq-video__poster" ${accion}>
            ${posterVideo(i)}
            <button class="tiq-video__play" type="button" aria-label="Reproducir">${PLAY}</button>
          </div>
        </div>`;
      })
      .join("");
    return `
    <section class="tiq-sec tiq-sec--videos" data-seccion="${esc(s.id)}">
      <div class="contenedor">
        ${s.titulo ? `<h2 class="tiq-sec__titulo">${esc(s.titulo)}</h2>` : ""}
        <div class="tiq-vcar" data-idx="0">
          <button class="tiq-vcar__flecha tiq-vcar__flecha--izq" type="button" onclick="tiqVideoNav(this,-1)" aria-label="Anterior">${FLECHA_IZQ}</button>
          <div class="tiq-vcar__viewport"><div class="tiq-vcar__pista">${cards}</div></div>
          <button class="tiq-vcar__flecha tiq-vcar__flecha--der" type="button" onclick="tiqVideoNav(this,1)" aria-label="Siguiente">${FLECHA_DER}</button>
        </div>
      </div>
    </section>`;
  }

  // Fotos: carrusel a lo largo (apaisadas) en fila deslizable, flechas afuera.
  // En el editor cada espacio (incluso vacío) es clic-para-elegir-imagen.
  function seccionCarrusel(s) {
    const items = s.items || [];
    const visibles = MODO_APP ? items.map((i, j) => [i, j]) : items.map((i, j) => [i, j]).filter(([i]) => i.media_id || i.url);
    if (!visibles.length) return "";

    const cuerpo = visibles
      .map(([i, j]) => {
        const clic = MODO_APP ? ` data-imgclick="sec:${esc(s.id)}:${j}"` : "";
        if (!i.media_id && !i.url) {
          return `<div class="tiq-imagen tiq-imagen--vacio tiq-clicable"${clic} title="Clic para elegir una imagen">
            <div class="tiq-imagen__add">${ICONO_IMG}<span>Elegí una imagen</span></div>
          </div>`;
        }
        const src = i.url ? i.url : urlImagen(i.media_id);
        const inner = `<img src="${esc(src)}" alt="${esc(i.caption || "")}" loading="lazy">${
          i.caption ? `<span class="tiq-imagen__caption">${esc(i.caption)}</span>` : ""
        }`;
        if (MODO_APP) return `<div class="tiq-imagen tiq-clicable"${clic} title="Clic para cambiar la imagen">${inner}</div>`;
        return i.link
          ? `<a class="tiq-imagen" href="${esc(i.link)}" target="_blank" rel="noopener">${inner}</a>`
          : `<div class="tiq-imagen">${inner}</div>`;
      })
      .join("");
    return `
    <section class="tiq-sec tiq-sec--carrusel" data-seccion="${esc(s.id)}">
      <div class="contenedor">
        <div class="tiq-carrusel">
          <button class="tiq-carrusel__flecha tiq-carrusel__flecha--izq" type="button" onclick="tiqCarrusel(this,-1)" aria-label="Anterior">${FLECHA_IZQ}</button>
          <div class="tiq-carrusel__track tiq-carrusel__track--imagenes">${cuerpo}</div>
          <button class="tiq-carrusel__flecha tiq-carrusel__flecha--der" type="button" onclick="tiqCarrusel(this,1)" aria-label="Siguiente">${FLECHA_DER}</button>
        </div>
      </div>
    </section>`;
  }

  // ---------- Video slider (estilo Section Store) ----------
  // Carrusel de videos verticales que auto-reproducen (muted), con título +
  // estrellas por slide y controles de pausa/sonido. TODO se maneja por
  // settings (schema-driven): el objeto s.settings pisa estos defaults y se
  // vuelca a variables CSS, así el mismo render honra cualquier configuración.
  // Mirror EXACTO de DEF_VS en app/app.js (mismo set de claves). Es la única
  // fuente de verdad de los settings del Video slider: s.settings las pisa.
  const DEF_VS = {
    cols: 5, colsMobile: 1.5, rotate: 0,
    aspecto: "portrait", aspectoMobile: "portrait",
    radio: 16, bordeSlide: 0, overlay: 0.2, sombra: false,
    hPos: "center", hPosMobile: "center", vPos: "bottom", vPosMobile: "bottom",
    fuenteCustom: false, tituloSize: 16, tituloSizeMobile: 16, lineHeight: 130,
    ocultarEstrellas: false, iconoEstrella: null,
    estrellasSize: 16, estrellasSizeMobile: 16, estrellasMargen: 16, estrellasMargenMobile: 16,
    usarPausa: true, usarSonido: true, ctrlSize: 40, ctrlSizeMobile: 40, ctrlBorde: 0,
    flechas: true, flechasMobile: false, flechaSize: 48, flechaIco: 8,
    flechaRadio: 100, flechaBorde: 0, flechaHover: "color",
    colTitulo: "#ffffff", colEstrellas: "#ffffff", colBorde: "#121212",
    colSombra: "#121212", colOverlay: "#121212",
    colCtrlIco: "#ffffff", colCtrlIcoHover: "#ffffff",
    colCtrlBg: "#ffffff", colCtrlBgHover: "#ffffff",
    colCtrlBorde: "#ffffff", colCtrlBordeHover: "#ffffff",
    colFlechaIcono: "#121212", colFlechaIconoHover: "#ffffff",
    colFlechaFondo: "#ffffff", colFlechaFondoHover: "#121212",
    colFlechaBorde: "#121212", colFlechaBordeHover: "#121212",
    fondoEstilo: "solid", fondo: "#ffffff", fondo2: "#f4f4f7", colBordeSec: "#121212",
    margenTop: 0, margenBottom: 0,
    padTop: 36, padBottom: 36, padSides: 0, padSidesMobile: 0,
    ancho: "page", bordeSec: 0, lazy: true, cssCustom: ""
  };
  const VS_ASPECTO = { portrait: "3 / 4", square: "1 / 1", landscape: "16 / 9" };
  // Mapas de posición del contenido → valores CSS.
  const VS_AI = { left: "flex-start", center: "center", right: "flex-end" };
  const VS_TA = { left: "left", center: "center", right: "right" };
  const VS_JI = { top: "flex-start", bottom: "flex-end" };

  // Estrella SVG (tamaño/color por CSS var), en vez del glyph ★.
  const VS_ESTRELLA = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>`;
  const estrellasVS = (n = 5) => `<span class="tiq-vs__estrellas" aria-label="${n} de 5">${VS_ESTRELLA.repeat(Math.max(0, Math.min(5, Math.round(n))))}</span>`;
  // Estrellas honrando cfg: ícono custom (imagen) si se definió, si no la SVG.
  const estrellasCfg = (cfg, n = 5) => {
    const c = Math.max(0, Math.min(5, Math.round(n)));
    if (cfg.iconoEstrella) {
      const url = /^https?:/.test(cfg.iconoEstrella) ? cfg.iconoEstrella : urlImagen(cfg.iconoEstrella);
      if (url) return `<span class="tiq-vs__estrellas tiq-vs__estrellas--img" aria-label="${c} de 5">${`<img src="${esc(url)}" alt="">`.repeat(c)}</span>`;
    }
    return `<span class="tiq-vs__estrellas" aria-label="${c} de 5">${VS_ESTRELLA.repeat(c)}</span>`;
  };
  const VS_PAUSA = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>`;
  const VS_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  const VS_SONIDO = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9z"/><path d="M16 8a5 5 0 010 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const VS_MUDO = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9z"/><path d="M22 9l-6 6M16 9l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  // El media de un slide: archivo directo (mp4/webm/cdn) → <video> autoplay
  // muteado; YouTube/Vimeo → poster + play (autoplay embebido es poco fiable).
  function mediaVS(item) {
    const url = item.url || "";
    const esArchivo = /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) || /cdn\.shopify/.test(url);
    if (esArchivo) {
      const poster = item.poster ? (/^https?:/.test(item.poster) ? item.poster : urlImagen(item.poster)) : "";
      return `<video class="tiq-vs__vid" src="${esc(encodeURI(url))}" ${poster ? `poster="${esc(poster)}"` : ""} muted loop playsinline preload="metadata"></video>`;
    }
    // YouTube/Vimeo: poster + play (al tocar embebe el reproductor).
    return `<div class="tiq-vs__yt" data-embed="${esc(videoEmbed(url))}">${posterVideo(item)}<button class="tiq-vs__ytplay" type="button" aria-label="Reproducir" onclick="tiqVSplay(this)">${VS_PLAY}</button></div>`;
  }

  function slideVS(s, item, j, cfg) {
    if (!item.url && MODO_APP) {
      return `<div class="tiq-vs__slide tiq-vs__slide--vacio" data-vslot="${esc(s.id)}:${j}" title="Clic para agregar un video">
        <div class="tiq-vs__add">${ICONO_VIDEO}<span>Agregar video</span></div>
      </div>`;
    }
    const editar = MODO_APP ? ` data-vslot="${esc(s.id)}:${j}" title="Clic para editar este video"` : "";
    const botones = [];
    if (cfg.usarPausa) botones.push(`<button class="tiq-vs__cbtn tiq-vs__cbtn--pausa" type="button" aria-label="Pausar" onclick="tiqVSpausa(this)">${VS_PAUSA}</button>`);
    if (cfg.usarSonido) botones.push(`<button class="tiq-vs__cbtn tiq-vs__cbtn--sonido" type="button" aria-label="Activar sonido" onclick="tiqVSsonido(this)">${VS_MUDO}</button>`);
    const ctrl = botones.length ? `<div class="tiq-vs__ctrl">${botones.join("")}</div>` : "";
    const pie = (item.titulo || !cfg.ocultarEstrellas)
      ? `<div class="tiq-vs__pie">
           ${item.titulo ? `<span class="tiq-vs__titulo">${esc(item.titulo)}</span>` : ""}
           ${cfg.ocultarEstrellas ? "" : estrellasCfg(cfg, item.estrellas ?? 5)}
         </div>`
      : "";
    return `<div class="tiq-vs__slide"${editar}>
      <div class="tiq-vs__media">
        ${mediaVS(item)}
        <span class="tiq-vs__overlay"></span>
        ${ctrl}
        ${pie}
      </div>
    </div>`;
  }

  function seccionVideoSlider(s) {
    const cfg = { ...DEF_VS, ...(s.settings || {}) };
    const items = s.items || [];
    const visibles = MODO_APP ? items.map((i, j) => [i, j]) : items.map((i, j) => [i, j]).filter(([i]) => i.url);
    if (!visibles.length) return "";
    const fondo = cfg.fondoEstilo === "gradient"
      ? `linear-gradient(180deg, ${cfg.fondo}, ${cfg.fondo2})`
      : cfg.fondo;
    const vars = [
      // Slider
      `--vs-cols:${cfg.cols}`, `--vs-cols-m:${cfg.colsMobile}`, `--vs-rotate:${cfg.rotate}deg`,
      // Slide
      `--vs-aspect:${VS_ASPECTO[cfg.aspecto] || "3 / 4"}`, `--vs-aspect-m:${VS_ASPECTO[cfg.aspectoMobile] || "3 / 4"}`,
      `--vs-radio:${cfg.radio}px`, `--vs-borde-slide:${cfg.bordeSlide}px`,
      `--vs-overlay:${cfg.overlay}`,
      // Content position
      `--vs-ai:${VS_AI[cfg.hPos] || "center"}`, `--vs-ta:${VS_TA[cfg.hPos] || "center"}`, `--vs-ji:${VS_JI[cfg.vPos] || "flex-end"}`,
      `--vs-ai-m:${VS_AI[cfg.hPosMobile] || "center"}`, `--vs-ta-m:${VS_TA[cfg.hPosMobile] || "center"}`, `--vs-ji-m:${VS_JI[cfg.vPosMobile] || "flex-end"}`,
      // Title
      `--vs-tit:${cfg.tituloSize}px`, `--vs-tit-m:${cfg.tituloSizeMobile}px`, `--vs-lh:${cfg.lineHeight}%`,
      // Stars
      `--vs-estrella:${cfg.estrellasSize}px`, `--vs-estrella-m:${cfg.estrellasSizeMobile}px`,
      `--vs-estrella-mt:${cfg.estrellasMargen}px`, `--vs-estrella-mt-m:${cfg.estrellasMargenMobile}px`,
      // Controls
      `--vs-ctrl:${cfg.ctrlSize}px`, `--vs-ctrl-m:${cfg.ctrlSizeMobile}px`, `--vs-ctrl-borde:${cfg.ctrlBorde}px`,
      // Arrows
      `--vs-fle:${cfg.flechaSize}px`, `--vs-fle-ico-sz:${cfg.flechaIco}px`,
      `--vs-fle-radio:${cfg.flechaRadio}px`, `--vs-fle-borde:${cfg.flechaBorde}px`,
      // Slide colors
      `--vs-col-tit:${cfg.colTitulo}`, `--vs-col-estrella:${cfg.colEstrellas}`,
      `--vs-col-borde:${cfg.colBorde}`, `--vs-col-sombra:${cfg.colSombra}`, `--vs-col-overlay:${cfg.colOverlay}`,
      // Controls colors
      `--vs-col-ctrl-ico:${cfg.colCtrlIco}`, `--vs-col-ctrl-ico-h:${cfg.colCtrlIcoHover}`,
      `--vs-col-ctrl-bg:${cfg.colCtrlBg}`, `--vs-col-ctrl-bg-h:${cfg.colCtrlBgHover}`,
      `--vs-col-ctrl-borde:${cfg.colCtrlBorde}`, `--vs-col-ctrl-borde-h:${cfg.colCtrlBordeHover}`,
      // Arrow colors
      `--vs-fle-ico:${cfg.colFlechaIcono}`, `--vs-fle-ico-h:${cfg.colFlechaIconoHover}`,
      `--vs-fle-bg:${cfg.colFlechaFondo}`, `--vs-fle-bg-h:${cfg.colFlechaFondoHover}`,
      `--vs-fle-bd:${cfg.colFlechaBorde}`, `--vs-fle-bd-h:${cfg.colFlechaBordeHover}`,
      // Section
      `--vs-fondo:${fondo}`, `--vs-col-borde-sec:${cfg.colBordeSec}`, `--vs-borde-sec:${cfg.bordeSec}px`,
      `--vs-mt:${cfg.margenTop}px`, `--vs-mb:${cfg.margenBottom}px`,
      `--vs-pt:${cfg.padTop}px`, `--vs-pb:${cfg.padBottom}px`,
      `--vs-ps:${cfg.padSides}rem`, `--vs-ps-m:${cfg.padSidesMobile}rem`
    ].join(";");
    const clases = ["tiq-sec", "tiq-vs"];
    if (cfg.sombra) clases.push("tiq-vs--sombra");
    if (cfg.ancho === "full") clases.push("tiq-vs--full");
    if (cfg.rotate) clases.push("tiq-vs--rot");
    if (cfg.flechaHover !== "none") clases.push("tiq-vs--flehover");
    if (!cfg.flechasMobile) clases.push("tiq-vs--sinflechasm");
    if (!cfg.flechas) clases.push("tiq-vs--sinflechasd");
    const slides = visibles.map(([i, j]) => slideVS(s, i, j, cfg)).join("");
    const flechas = cfg.flechas || cfg.flechasMobile; // se renderizan; el CSS las oculta por breakpoint
    // CSS personalizado del merchant, scopeado a esta sección.
    const css = (cfg.cssCustom || "").trim();
    const estilo = css ? `<style>${css.replace(/</g, "")}</style>` : "";
    return `
    <section class="${clases.join(" ")}" data-seccion="${esc(s.id)}" style="${vars}">
      ${estilo}
      <div class="contenedor tiq-vs__cont">
        ${s.titulo ? `<h2 class="tiq-sec__titulo">${esc(s.titulo)}</h2>` : ""}
        <div class="tiq-vs__car">
          ${flechas ? `<button class="tiq-vs__flecha tiq-vs__flecha--izq" type="button" onclick="tiqVSnav(this,-1)" aria-label="Anterior">${FLECHA_IZQ}</button>` : ""}
          <div class="tiq-vs__track">${slides}</div>
          ${flechas ? `<button class="tiq-vs__flecha tiq-vs__flecha--der" type="button" onclick="tiqVSnav(this,1)" aria-label="Siguiente">${FLECHA_DER}</button>` : ""}
        </div>
      </div>
    </section>`;
  }

  function seccionHTML(s) {
    if (s.tipo === "videos") return seccionVideos(s);
    if (s.tipo === "carrusel") return seccionCarrusel(s);
    if (s.tipo === "videoslider") return seccionVideoSlider(s);
    return "";
  }

  // Fotos: scroll de a un paso por flecha.
  window.tiqCarrusel = function (boton, dir) {
    const track = boton.parentElement.querySelector(".tiq-carrusel__track");
    if (!track) return;
    const card = track.querySelector(":scope > *");
    const paso = card ? card.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
    track.scrollBy({ left: dir * paso, behavior: "smooth" });
  };

  // Videos: centra el activo desplazando la pista (coverflow).
  function centrarVideo(car) {
    const pista = car.querySelector(".tiq-vcar__pista");
    const items = [...pista.children];
    if (!items.length) return;
    const idx = Math.max(0, Math.min(items.length - 1, +car.dataset.idx || 0));
    car.dataset.idx = idx;
    items.forEach((it, i) => it.classList.toggle("activo", i === idx));
    const activo = items[idx];
    const vp = car.querySelector(".tiq-vcar__viewport");
    const desplazamiento = vp.clientWidth / 2 - (activo.offsetLeft + activo.offsetWidth / 2);
    pista.style.transform = `translateX(${desplazamiento}px)`;
    car.querySelector(".tiq-vcar__flecha--izq").disabled = idx === 0;
    car.querySelector(".tiq-vcar__flecha--der").disabled = idx === items.length - 1;
  }
  window.tiqVideoNav = function (boton, dir) {
    const car = boton.closest(".tiq-vcar");
    car.dataset.idx = (+car.dataset.idx || 0) + dir;
    centrarVideo(car);
  };
  function iniciarVcar() {
    document.querySelectorAll(".tiq-vcar").forEach(centrarVideo);
  }
  window.addEventListener("resize", iniciarVcar);

  // Muro de clientes: los videos arrancan solos al entrar en pantalla y se
  // pausan al salir (muted+playsinline permiten el autoplay; el observer fuerza
  // el play por si el navegador lo frenó estando fuera de vista). Nada de
  // apretar para reproducir.
  function autoplayMuro() {
    const vids = document.querySelectorAll(".muro video.muro__media");
    if (!vids.length) return;
    if (!("IntersectionObserver" in window)) {
      vids.forEach((v) => { v.muted = true; const p = v.play(); if (p) p.catch(() => {}); });
      return;
    }
    const io = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          const v = e.target;
          if (e.isIntersecting) { v.muted = true; const p = v.play(); if (p) p.catch(() => {}); }
          else v.pause();
        }
      },
      { threshold: 0.2 }
    );
    vids.forEach((v) => io.observe(v));
  }

  window.tiqVideoPlay = function (el) {
    const cont = el.closest(".tiq-video");
    if (!cont || cont.classList.contains("tiq-video--play")) return;
    // reproducir SOLO si es el activo; si no, primero lo centra
    const car = cont.closest(".tiq-vcar");
    if (car) {
      const items = [...car.querySelectorAll(".tiq-video")];
      const i = items.indexOf(cont);
      if (i !== +car.dataset.idx) {
        car.dataset.idx = i;
        return centrarVideo(car);
      }
    }
    if (cont.dataset.embed) {
      cont.classList.add("tiq-video--play");
      cont.innerHTML = cont.dataset.embed;
    }
  };

  // ---- Video slider (interactividad) ----
  // Flechas: desplazan el track de a una card (scroll-snap se encarga del resto).
  window.tiqVSnav = function (boton, dir) {
    const track = boton.closest(".tiq-vs__car")?.querySelector(".tiq-vs__track");
    if (!track) return;
    const card = track.querySelector(".tiq-vs__slide");
    const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || "16") || 16;
    const paso = card ? card.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
    track.scrollBy({ left: dir * paso, behavior: "smooth" });
  };
  // Pausa/reanuda el <video> de ESE slide.
  window.tiqVSpausa = function (boton) {
    const v = boton.closest(".tiq-vs__media")?.querySelector("video.tiq-vs__vid");
    if (!v) return;
    if (v.paused) { const p = v.play(); if (p) p.catch(() => {}); boton.setAttribute("aria-label", "Pausar"); boton.classList.remove("is-pausado"); }
    else { v.pause(); boton.setAttribute("aria-label", "Reproducir"); boton.classList.add("is-pausado"); }
  };
  // Silencia/activa el sonido de ESE slide (los demás quedan muteados).
  window.tiqVSsonido = function (boton) {
    const v = boton.closest(".tiq-vs__media")?.querySelector("video.tiq-vs__vid");
    if (!v) return;
    v.muted = !v.muted;
    boton.classList.toggle("is-activo", !v.muted);
    boton.setAttribute("aria-label", v.muted ? "Activar sonido" : "Silenciar");
  };
  // YouTube/Vimeo: al tocar el play, embebe el reproductor.
  window.tiqVSplay = function (boton) {
    const cont = boton.closest(".tiq-vs__yt");
    if (cont?.dataset.embed) cont.outerHTML = cont.dataset.embed;
  };
  // Autoplay muteado al entrar en vista (mismo patrón que el muro).
  function autoplayVS() {
    const vids = document.querySelectorAll("video.tiq-vs__vid");
    if (!vids.length) return;
    if (!("IntersectionObserver" in window)) {
      vids.forEach((v) => { v.muted = true; const p = v.play(); if (p) p.catch(() => {}); });
      return;
    }
    const io = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          const v = e.target;
          if (v.dataset.pausadoManual) continue;
          if (e.isIntersecting) { const p = v.play(); if (p) p.catch(() => {}); }
          else v.pause();
        }
      },
      { threshold: 0.35 }
    );
    vids.forEach((v) => io.observe(v));
  }

  // ---------- estilo "premium" (modelo alternativo de página) ----------
  // Mismo contrato de datos que el clásico; cambia el ARMADO y suma componentes:
  // barra de oferta con countdown, comparación (nosotros vs otros) y reseñas en
  // carrusel infinito. Se elige en el flujo de creación (global.estilo).

  // Timer de oferta que REEMPLAZA la barra de urgencia del hero (no es sección
  // aparte). Color FIJO (no depende del nicho), cuenta regresiva persistente por
  // producto (localStorage): no se reinicia por recarga; al llegar a 0 reinicia.
  const IC_RELOJ = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>`;
  function heroTimer(g) {
    const o = (g && g.oferta) || {};
    const texto = o.texto || "¡Apurate! La oferta termina en";
    const mins = Number(o.minutos) || 30;
    return `
    <div class="hero__timer" data-timer data-mins="${mins}">
      <span class="hero__timer__lead">${IC_RELOJ}<span>${esc(texto)}</span></span>
      <span class="hero__timer__boxes">
        <b data-h>00</b><i>:</i><b data-m>00</b><i>:</i><b data-s>00</b>
      </span>
    </div>`;
  }

  const CHK_OK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;
  const CHK_NO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M6 18L18 6"/></svg>`;

  function comparacion(f, g, compliance) {
    const c = (f && f.comparacion) || {};
    const filas = Array.isArray(c.filas) ? c.filas.filter(Boolean) : [];
    // Una comparación declara hechos sobre alternativas. Solo se muestra con
    // una fuente de comparación atestiguada por el servidor; no existe un
    // fallback editorial que pueda convertir una página incompleta en claim.
    if (!filas.length || compliance?.claims_verified !== true || !compliance.comparison_source) return "";
    const nombre = c.marca || "Producto";
    const otros = c.otros || "Alternativas";
    const titular = c.titular || "Comparación del producto";
    const editar = MODO_APP ? ` data-editar="comparacion" title="Clic para editar"` : "";
    const fila = (t) => `
      <div class="tiq-cmp__row">
        <div class="tiq-cmp__feat">${esc(t)}</div>
        <div class="tiq-cmp__cell tiq-cmp__cell--ok">${CHK_OK}</div>
        <div class="tiq-cmp__cell tiq-cmp__cell--no">${CHK_NO}</div>
      </div>`;
    return `
    <section class="tiq-cmp"${editar}>
      <div class="contenedor">
        <h2 class="tiq-cmp__tit">${esc(titular)}</h2>
        <div class="tiq-cmp__tabla">
          <div class="tiq-cmp__head">
            <div class="tiq-cmp__feat"></div>
            <div class="tiq-cmp__cell tiq-cmp__brand">${esc(nombre)}</div>
            <div class="tiq-cmp__cell tiq-cmp__otros">${esc(otros)}</div>
          </div>
          ${filas.map(fila).join("")}
        </div>
      </div>
    </section>`;
  }

  // Reseñas en carrusel de scroll INFINITO (marquee). Se duplica la fila para
  // que el loop no tenga costura. Pausa al pasar el mouse.
  function resenasMarquee(f) {
    const list = (f.items || []).filter(resenaCompleta);
    if (!list.length) return "";
    const card = (r) => `
      <figure class="tiq-mq__card">
        ${r.imagen ? `<div class="tiq-mq__img">${img(r.imagen)}</div>` : ""}
        <div class="tiq-mq__stars">${estrellasValidas(r.estrellas)}</div>
        <p class="tiq-mq__txt">${esc(r.texto)}</p>
        <figcaption class="tiq-mq__autor">${esc(r.autor)}</figcaption>
      </figure>`;
    const fila = list.map(card).join("");
    const editar = MODO_APP ? `<button class="resenas__editar tiq-mq__editar">✎ Editar reseñas en lote</button>` : "";
    return `
    <section class="resenas tiq-mq" data-bloque="resenas" data-fijo="1">
      <div class="tiq-mq__cab">
        <h2>${esc(f.titular || "Reseñas")}</h2>
        ${f.subtitulo ? `<p>${esc(f.subtitulo)}</p>` : ""}
      </div>
      ${editar}
      <div class="tiq-mq__viewport">
        <div class="tiq-mq__track">${fila}${fila}</div>
      </div>
    </section>`;
  }

  // ---------- estilo "pagepilot" ----------
  // Composición editorial sobre las facetas universales existentes. Mantiene
  // una sola fuente de datos para tienda, preview y páginas ya publicadas.
  const pagepilotBoton = (g) => {
    const variante = EN_TIENDA ? window.TIENDAIQ_VARIANT : null;
    const contenido = `${g.boton_icono !== false ? CART_ICO : ""}<span>${esc(g.cta || "Agregar al carrito")}</span>`;
    if (!variante) return `<button type="button" class="tiq-pp__cta">${contenido}</button>`;
    return `<form method="post" action="/cart/add" onsubmit="return tiendaiqAgregar(event)"><input type="hidden" name="id" value="${esc(variante)}"><input type="hidden" name="quantity" value="1" id="tiendaiq-cantidad-form"><button type="submit" class="tiq-pp__cta">${contenido}</button></form>`;
  };

  function pagepilotHero(f, fuente, g) {
    const h = f.hero || {};
    const galeria = h.galeria || [];
    const thumbs = galeria.map((id, i) => `<button type="button" class="tiq-pp__thumb${i === 0 ? " is-active" : ""}" onclick="cambiarPrincipal('${esc(id)}', this)" aria-label="Imagen ${i + 1}">${img(id, h.titulo || "Producto", { ancho: 160 })}</button>`).join("");
    const bullets = (h.bullets || []).map((b) => {
      const texto = typeof b === "string" ? b : [b.fuerte, b.resto].filter(Boolean).join(" ");
      const icono = typeof b === "object" && b.icono && ICONOS_BULLET[b.icono] ? ICONOS_BULLET[b.icono] : ICONOS_BULLET.check;
      return `<li>${icono}<span>${esc(texto)}</span></li>`;
    }).join("");
    const rd = h.resena_destacada || {};
    const avatar = imgAsset(rd.avatar, `<span class="tiq-pp__avatar-fallback">${esc((rd.autor || "C").slice(0, 1))}</span>`);
    const precio = precioBonito(fuente.moneda, fuente.precio);
    const comparativo = fuente.precio_comparativo ? `<del>${esc(precioBonito(fuente.moneda, fuente.precio_comparativo))}</del>` : "";
    const ratingHtml = tienePuntajeReal(h.puntaje, h.resenas_count)
      ? `<div class="tiq-pp__rating">${estrellasValidas(h.puntaje)} <span>Calificado con <strong>${esc(puntaje1(h.puntaje))}/5</strong> por ${esc(miles(h.resenas_count))} reseñas</span></div>`
      : "";
    const quoteHtml = resenaCompleta(rd)
      ? `<blockquote class="tiq-pp__quote"><div class="tiq-pp__quote-head">${avatar}<span>${estrellasValidas(rd.estrellas)}</span></div><p>"${esc(rd.texto)}"</p><cite>${ICONO.verificado} ${esc(rd.autor)}</cite></blockquote>`
      : "";
    return `<section class="tiq-pp__hero" data-bloque="hero"><div class="tiq-pp__wrap tiq-pp__hero-grid"><div class="tiq-pp__gallery"><div id="imagen-principal" class="tiq-pp__gallery-main">${img(galeria[0], h.titulo || "Producto", { hero: true })}</div><div class="tiq-pp__thumbs">${thumbs}</div></div><div class="tiq-pp__buy">${ratingHtml}<h1>${esc(h.titulo || fuente.titulo_crudo || "Producto")}</h1><p class="tiq-pp__tagline">${esc(h.urgencia || h.subtitulo || "Una mejora simple para todos los días.")}</p><p class="tiq-pp__subtitulo">${esc(h.subtitulo || "Pensado para resolver una necesidad cotidiana con menos esfuerzo.")}</p><ul class="tiq-pp__benefits">${bullets}</ul><div class="tiq-pp__price">${comparativo}<strong>${esc(precio)}</strong>${fuente.precio_comparativo ? `<span class="tiq-pp__save">Oferta especial</span>` : ""}</div>${pagepilotBoton(g)}<div class="tiq-pp__trust"><span>${ICONO.camion} Envío incluido</span><span>${ICONO.retorno} Devolución simple</span></div>${quoteHtml}</div></div></section>`;
  }

  function pagepilotTimeline(f) {
    const s = f.stats || {};
    const items = (s.items || []).map((it, i) => `<article class="tiq-pp__timeline-card"><span class="tiq-pp__eyebrow">Paso ${i + 1}</span><h3>${esc(it.frase || "Un resultado que se nota")}</h3><p>${esc((f.iconos?.items || [])[i]?.frase || "Sumá el producto a tu rutina y hacelo parte de tu día.")}</p></article>`).join("");
    if (!items && !s.imagen) return "";
    return `<section class="tiq-pp__band tiq-pp__timeline" data-bloque="stats"><div class="tiq-pp__wrap"><header class="tiq-pp__section-head"><h2>${esc(s.titular || "Una rutina más simple empieza hoy")}</h2><p>${esc(f.hero?.subtitulo || "Pequeños cambios que se sienten en el día a día.")}</p></header><div class="tiq-pp__timeline-grid"><div class="tiq-pp__feature-image">${img(s.imagen, s.titular || "Producto")}</div><div class="tiq-pp__timeline-list">${items}</div></div></div></section>`;
  }

  function pagepilotReviews(f) {
    const r = f.resenas || {};
    const items = (r.items || []).filter(resenaCompleta).slice(0, 3).map((it) => `<article class="tiq-pp__review"><div class="tiq-pp__review-image">${it.imagen ? img(it.imagen, it.autor) : ""}</div><div class="tiq-pp__review-body"><strong>${esc(it.autor)}</strong>${estrellasValidas(it.estrellas)}<p>${esc(it.texto)}</p></div></article>`).join("");
    if (!items) return "";
    return `<section class="tiq-pp__reviews" data-bloque="resenas"><div class="tiq-pp__wrap"><header class="tiq-pp__section-head"><h2>${esc(r.titular || "Reseñas")}</h2><p>${esc(r.subtitulo || "")}</p></header><div class="tiq-pp__reviews-grid">${items}</div></div></section>`;
  }

  function pagepilotFeature(f, g) {
    const i = f.iconos || {};
    const items = (i.items || []).map((it) => `<li><span class="tiq-pp__feature-icon">${it.emoji ? esc(it.emoji) : ICONOS_BULLET.check}</span><span><strong>${esc(it.titulo)}</strong>${esc(it.frase)}</span></li>`).join("");
    return `<section class="tiq-pp__band tiq-pp__feature" data-bloque="iconos"><div class="tiq-pp__wrap tiq-pp__feature-grid"><div class="tiq-pp__feature-image">${img(i.imagen_central, i.titular || "Producto")}</div><div><h2>${esc(i.titular || "Pensado para tu rutina")}</h2><p>${esc(i.subtitulo || "Todo lo que necesitás, en un solo producto.")}</p><ul class="tiq-pp__feature-list">${items}</ul>${pagepilotBoton(g)}</div></div></section>`;
  }

  function pagepilotProblem(f) {
    const t = f.tabla || {};
    const statsItems = (f.stats?.items || []).filter(estadisticaCompleta).map((it) => `<div class="tiq-pp__stat"><b>${esc(it.pct)}%</b><span>${esc(it.frase)}</span></div>`).join("");
    return `<section class="tiq-pp__dark" data-bloque="tabla"><div class="tiq-pp__wrap tiq-pp__dark-grid"><div><span class="tiq-pp__dark-kicker">Por qué importa</span><h2>${esc(t.titular || "Menos complicaciones, más tranquilidad")}</h2><p>${esc(t.parrafo || "Una solución pensada para hacer más sencillo lo que antes costaba.")}</p></div><div class="tiq-pp__stats">${statsItems}</div></div></section>`;
  }

  function pagepilotSteps(f) {
    const h = f.hero || {};
    const imgs = h.galeria || [];
    const items = (f.iconos?.items || []).slice(0, 3).map((it, i) => `<article class="tiq-pp__step"><div class="tiq-pp__step-image">${img(imgs[i] || imgs[0], it.titulo || "Producto")}</div><span class="tiq-pp__eyebrow">${esc(it.titulo || `Paso ${i + 1}`)}</span><p>${esc(it.frase || "Usá el producto de forma simple y disfrutá el resultado.")}</p></article>`).join("");
    if (!items) return "";
    return `<section class="tiq-pp__steps" data-bloque="iconos"><div class="tiq-pp__wrap"><header class="tiq-pp__section-head"><h2>${esc(f.iconos?.titular || "Es realmente sencillo")}</h2><p>${esc(f.iconos?.subtitulo || "Una experiencia clara desde el primer uso.")}</p></header><div class="tiq-pp__steps-grid">${items}</div></div></section>`;
  }

  function pagepilotFaq(f) {
    const q = f.faq || {};
    const items = (q.items || []).map((it) => `<details><summary>${esc(it.pregunta)}<span>+</span></summary><p>${esc(it.respuesta)}</p></details>`).join("");
    if (!items) return "";
    return `<section class="tiq-pp__faq" data-bloque="faq"><div class="tiq-pp__wrap"><header class="tiq-pp__section-head"><h2>${esc(q.titular || "Preguntas frecuentes")}</h2><p>${esc(q.subtitulo || "Todo lo que necesitás saber antes de comprar.")}</p></header><div class="tiq-pp__faq-list">${items}</div></div></section>`;
  }

  function renderPagepilot(data) {
    const f = data.facetas || {};
    const g = data.global || {};
    return [pagepilotHero(f, data.fuente || {}, g), pagepilotTimeline(f), pagepilotReviews(f), pagepilotFeature(f, g), pagepilotProblem(f), pagepilotSteps(f), pagepilotFaq(f), `<div class="tiq-pp__recommendations">${recomendados(f.recomendados || { modo: "placeholder", items: [] })}</div>`].filter(Boolean).join("\n");
  }

  // ---------- estilo "pagepilot-blue" ----------
  // Composición aditiva de la preview PagePilot. Lee únicamente el contrato
  // universal, por eso también funciona cuando la IA devuelve otro producto,
  // otro nicho o menos imágenes.
  const pagepilotBlueButton = (g, label) => {
    const variante = EN_TIENDA ? window.TIENDAIQ_VARIANT : null;
    const texto = label || g.cta || "Comprar ahora";
    const contenido = `${g.boton_icono !== false ? CART_ICO : ""}<span>${esc(texto)}</span>`;
    if (!variante) return `<button type="button" class="tiq-ppb__cta">${contenido}</button>`;
    return `<form method="post" action="/cart/add" onsubmit="return tiendaiqAgregar(event)"><input type="hidden" name="id" value="${esc(variante)}"><input type="hidden" name="quantity" value="1"><button type="submit" class="tiq-ppb__cta">${contenido}</button></form>`;
  };

  const pagepilotBlueIcon = (item) => {
    if (item?.emoji) return esc(item.emoji);
    return ICONOS_BULLET[item?.icono] || ICONOS_BULLET.check;
  };

  const pagepilotBlueText = (item) => {
    if (typeof item === "string") return item;
    return [item?.fuerte, item?.resto, item?.frase].filter(Boolean).join(" ");
  };

  function pagepilotBlueHero(f, fuente, g) {
    const h = f.hero || {};
    const galeria = h.galeria || [];
    const titulo = h.titulo || fuente.titulo_crudo || "Producto";
    const thumbs = galeria.slice(0, 5).map((id, i) => `<button type="button" class="tiq-ppb__thumb${i === 0 ? " is-active" : ""}" onclick="cambiarPrincipal('${esc(id)}', this)" aria-label="Imagen ${i + 1}">${img(id, titulo, { ancho: 160 })}</button>`).join("");
    const bulletsData = (h.bullets || []).length ? h.bullets : (f.iconos?.items || []).slice(0, 4);
    const bullets = bulletsData.slice(0, 4).map((item) => `<li><span class="tiq-ppb__benefit-icon">${pagepilotBlueIcon(item)}</span><span>${esc(pagepilotBlueText(item) || "Beneficio del producto")}</span></li>`).join("");
    const accordions = (h.acordeones || []).slice(0, 3).map((item) => `<details><summary>${esc(item.titulo || "Información del producto")}<span>⌄</span></summary><p>${esc(item.contenido || "Consultá la información del producto antes de comprar.")}</p></details>`).join("");
    const review = h.resena_destacada?.texto ? h.resena_destacada : {};
    const avatar = imgAsset(review.avatar, `<span class="tiq-ppb__avatar-fallback">${esc((review.autor || "C").slice(0, 1))}</span>`);
    const precio = precioBonito(fuente.moneda, fuente.precio || "");
    const comparativo = fuente.precio_comparativo ? `<del>${esc(precioBonito(fuente.moneda, fuente.precio_comparativo))}</del>` : "";
    const actual = Number(fuente.precio);
    const anterior = Number(fuente.precio_comparativo);
    const ahorro = Number.isFinite(actual) && Number.isFinite(anterior) && anterior > actual ? Math.round((1 - actual / anterior) * 100) : 0;
    const ratingHtml = tienePuntajeReal(h.puntaje, h.resenas_count)
      ? `<div class="tiq-ppb__rating">${estrellasValidas(h.puntaje)} <span>Calificado con <strong>${esc(puntaje1(h.puntaje))}/5</strong> por <strong>${esc(miles(h.resenas_count))}</strong> reseñas</span></div>`
      : "";
    const quoteHtml = resenaCompleta(review)
      ? `<blockquote class="tiq-ppb__quote"><span class="tiq-ppb__quote-avatar">${avatar}</span><div class="tiq-ppb__quote-body"><div class="tiq-ppb__quote-stars">${estrellasValidas(review.estrellas)}</div><p>"${esc(review.texto)}"</p><cite>${ICONO.verificado} ${esc(review.autor)}</cite></div></blockquote>`
      : "";
    return `<section class="tiq-ppb__hero" data-bloque="hero"><div class="tiq-ppb__wrap tiq-ppb__hero-grid"><div class="tiq-ppb__gallery"><div id="tiq-ppb-main" class="tiq-ppb__gallery-main">${img(galeria[0], titulo, { hero: true })}<button type="button" class="tiq-ppb__gallery-arrow tiq-ppb__gallery-arrow--prev" onclick="tiqPpbMover(-1)" aria-label="Imagen anterior">‹</button><button type="button" class="tiq-ppb__gallery-arrow tiq-ppb__gallery-arrow--next" onclick="tiqPpbMover(1)" aria-label="Imagen siguiente">›</button></div><div class="tiq-ppb__thumbs">${thumbs}</div></div><div class="tiq-ppb__buy"><div class="tiq-ppb__badge"><b>★</b><span>${esc(h.urgencia || "Producto destacado")}</span></div><h1>${esc(titulo)}</h1>${ratingHtml}<ul class="tiq-ppb__benefits">${bullets}</ul><div class="tiq-ppb__price">${comparativo}<strong>${esc(precio)}</strong>${ahorro ? `<span class="tiq-ppb__save">AHORRÁ ${ahorro}%</span>` : ""}</div>${pagepilotBlueButton(g, g.cta || "Añadir al carrito")}<div class="tiq-ppb__trust"><span>${ICONO.verificado} Garantía de devolución de 30 días</span><span>${ICONO.paquete} Envío y devoluciones simples</span></div><div class="tiq-ppb__accordions">${accordions}</div>${quoteHtml}${h.urgencia ? `<div class="tiq-ppb__scarcity">${ICONOS_BULLET.rayo}<strong>${esc(h.urgencia)}</strong><span>Consultá disponibilidad y condiciones antes de finalizar tu compra.</span></div>` : ""}</div></div></section>`;
  }

  function pagepilotBlueTicker(f) {
    const labels = ((f.hero?.bullets || []).map(pagepilotBlueText).concat((f.iconos?.items || []).map((item) => item.titulo || item.frase))).filter(Boolean).slice(0, 5);
    if (!labels.length) return "";
    const pills = labels.concat(labels).map((label, i) => `<span><i>${pagepilotBlueIcon(f.iconos?.items?.[i % Math.max(1, (f.iconos?.items || []).length)])}</i>${esc(label)}</span>`).join("");
    return `<section class="tiq-ppb__ticker" aria-label="Beneficios del producto"><div class="tiq-ppb__ticker-track">${pills}</div></section>`;
  }

  function pagepilotBlueSocial(f, g) {
    const r = f.resenas || {};
    const media = (r.items || []).map((item) => item.imagen).filter(Boolean).slice(0, 3);
    const images = media.map((id) => `<article class="tiq-ppb__ugc">${img(id, "Contenido de cliente")}</article>`).join("");
    if (!images) return "";
    return `<section class="tiq-ppb__social" data-bloque="clientes"><div class="tiq-ppb__wrap tiq-ppb__social-grid"><div><h2>${esc(r.titular || "Contenido de clientes")}</h2><p>${esc(r.subtitulo || "")}</p>${pagepilotBlueButton(g, "Obtené el tuyo ahora")}</div><div class="tiq-ppb__ugc-grid">${images}</div></div></section>`;
  }

  function pagepilotBlueTextImage(f, g) {
    const s = f.stats || {};
    const titulo = s.titular || "¿Cómo funciona?";
    const imagen = s.imagen || f.hero?.galeria?.[0];
    if (!titulo && !imagen) return "";
    return `<section class="tiq-ppb__text-image" data-bloque="stats"><div class="tiq-ppb__wrap tiq-ppb__text-image-grid"><div><h2>${esc(titulo)}</h2><p>${esc(f.hero?.subtitulo || "Una experiencia simple, pensada para el uso diario.")}</p>${pagepilotBlueButton(g, "Compralo ahora")}</div><div class="tiq-ppb__media">${img(imagen, titulo || "Producto")}</div></div></section>`;
  }

  function pagepilotBlueFeature(f) {
    const i = f.iconos || {};
    const items = (i.items || []).slice(0, 5).map((item, n) => `<li><span class="tiq-ppb__feature-number">${n + 1}</span><span><strong>${esc(item.titulo || "Beneficio diario")}</strong>${esc(item.frase || "Un detalle que hace más simple el uso del producto.")}</span></li>`).join("");
    if (!items && !i.imagen_central) return "";
    return `<section class="tiq-ppb__feature" data-bloque="iconos"><div class="tiq-ppb__wrap tiq-ppb__feature-grid"><div class="tiq-ppb__media tiq-ppb__feature-media">${img(i.imagen_central || f.hero?.galeria?.[0], i.titular || "Producto")}</div><div><h2>${esc(i.titular || "Beneficios diarios del producto")}</h2><p>${esc(i.subtitulo || "Todo lo que necesitás para sumar una mejora real a tu rutina.")}</p><ul class="tiq-ppb__feature-list">${items}</ul></div></div></section>`;
  }

  function pagepilotBlueReviews(f) {
    const r = f.resenas || {};
    const visibles = (r.items || []).filter(resenaCompleta);
    const items = visibles.slice(0, 4).map((item) => `<article class="tiq-ppb__review"><div class="tiq-ppb__review-media">${item.imagen ? img(item.imagen, item.autor) : ""}</div><strong>${esc(item.autor)}</strong>${estrellasValidas(item.estrellas)}<p>${esc(item.texto)}</p></article>`).join("");
    if (!items) return "";
    return `<section class="tiq-ppb__reviews" data-bloque="resenas"><div class="tiq-ppb__wrap"><header class="tiq-ppb__section-head"><h2>${esc(r.titular || "Reseñas")}</h2><p>${esc(r.subtitulo || "")}</p></header><div class="tiq-ppb__reviews-grid">${items}</div></div></section>`;
  }

  function pagepilotBlueStats(f) {
    const s = f.stats || {};
    const items = (s.items || []).filter(estadisticaCompleta).slice(0, 4).map((item) => `<article><b>${esc(item.pct)}%</b><p>${esc(item.frase)}</p></article>`).join("");
    if (!items) return "";
    return `<section class="tiq-ppb__stats-section" data-bloque="stats"><div class="tiq-ppb__wrap"><header class="tiq-ppb__section-head"><h2>${esc(s.titular || "Lo que notaron quienes lo usan")}</h2></header><div class="tiq-ppb__stats-grid">${items}</div></div></section>`;
  }

  function pagepilotBlueComparison() {
    // Este renderer histórico no recibe una atestación de comparación.
    // Mantenerlo vacío evita reactivar claims competitivos por accidente.
    return "";
  }

  function pagepilotBlueCtaPanel(f, g) {
    const titulo = "Una mejora simple para cada día";
    const imagen = f.stats?.imagen || f.hero?.galeria?.[0];
    if (!titulo && !imagen) return "";
    return `<section class="tiq-ppb__cta-panel"><div class="tiq-ppb__wrap tiq-ppb__cta-panel-grid"><div class="tiq-ppb__media">${img(imagen, titulo || "Producto")}</div><div><div class="tiq-ppb__cta-panel-icon">${ICONO.corazon}</div><h2>${esc(titulo)}</h2><p>${esc(f.hero?.subtitulo || "Hacelo parte de tu rutina con una experiencia clara y sin complicaciones.")}</p>${pagepilotBlueButton(g, "Compralo ahora")}</div></div></section>`;
  }

  function pagepilotBlueFaq(f) {
    const q = f.faq || {};
    const items = (q.items || []).map((item) => `<details><summary>${esc(item.pregunta || "Pregunta frecuente")}<span>+</span></summary><p>${esc(item.respuesta || "Consultá las condiciones y el modo de uso del producto.")}</p></details>`).join("");
    if (!items) return "";
    return `<section class="tiq-ppb__faq" data-bloque="faq"><div class="tiq-ppb__wrap"><header class="tiq-ppb__section-head"><h2>${esc(q.titular || "Preguntas frecuentes")}</h2><p>${esc(q.subtitulo || "Todo lo que necesitás saber antes de comprar.")}</p></header><div class="tiq-ppb__faq-list">${items}</div></div></section>`;
  }

  function pagepilotBlueSticky(f, g) {
    const titulo = f.hero?.titulo || "Producto";
    return `<div class="tiq-ppb__sticky"><div class="tiq-ppb__sticky-inner"><div class="tiq-ppb__sticky-product">${img(f.hero?.galeria?.[0], titulo, { ancho: 64 })}<strong>${esc(titulo)}</strong></div>${pagepilotBlueButton(g, "Añadir al carrito")}</div></div>`;
  }

  function renderPagepilotBlue(data) {
    return renderPagepilotBlueExact(data);
  }

  const PPB_ASSETS = {
    ugc: ["tiq-placeholder-ugc-1.svg", "tiq-placeholder-ugc-2.svg", "tiq-placeholder-ugc-3.svg"],
    review: "tiq-placeholder-review.svg",
    detail: "tiq-placeholder-detail.svg",
    payments: {
      amex: "tiq-payment-amex.svg", apple: "tiq-payment-apple.svg", visa: "tiq-payment-visa.svg",
      mastercard: "tiq-payment-mastercard.svg", paypal: "tiq-payment-paypal.svg", gpay: "tiq-payment-gpay.svg", shop: "tiq-payment-shop.svg"
    }
  };
  const PPB_DEFAULTS = {
    badge: "PRODUCTO DESTACADO",
    ticker: ["Aplicación sencilla", "Calidad diaria", "Resultados rápidos", "Naturalidad total", "Mirada realzada"],
    social: { titular: "Contenido de clientes", enfasis: "", subtitulo: "Agregá contenido autorizado para mostrar esta sección.", cta: "Obtené el tuyo ahora", rating: "", imagenes: [] },
    como_funciona: { titular: "¿Cómo funciona este producto?", parrafos: ["Su diseño está pensado para resolver una necesidad cotidiana de forma simple.", "Usalo como parte de tu rutina y disfrutá una experiencia cómoda desde el primer momento.", "Una propuesta práctica para acompañarte todos los días, sin pasos innecesarios."], cta: "Compralo ahora", imagen: null },
    feature: { titular: "5 beneficios diarios del producto", subtitulo: "Potenciá tu rutina para disfrutar un resultado que se nota.", items: ["Uso sencillo", "Diseño práctico", "Resultados claros", "Mantenimiento simple", "Para todos los días"].map((titulo) => ({ titulo, frase: "Pensado para acompañarte con comodidad." })), imagen: null },
    reviews: { badge: "Reseñas", titular: "Experiencias de clientes", subtitulo: "Importá reseñas reales para mostrar esta sección.", items: [] },
    blue_stats: { titular: "Estadísticas", subtitulo: "Agregá una fuente válida para publicar estadísticas.", items: [] },
    panel: { titular: "Una mejora simple para cada día", subtitulo: "Sumá una solución pensada para acompañarte con comodidad.", cta: "Compralo ahora", imagen: null },
    faq: { titular: "Preguntas frecuentes", subtitulo: "Todo lo que necesitás saber antes de comprarlo.", items: ["¿De qué material está hecho?", "¿Cómo se usa?", "¿Cómo se limpia o mantiene?", "¿Qué colores tiene disponibles?", "¿Qué pasa si no estoy conforme?"].map((pregunta) => ({ pregunta, respuesta: "Consultá la ficha del producto y la política de devolución para conocer todos los detalles." })) },
    acordeones: [{ titulo: "Descripción", contenido: "Conocé los detalles y beneficios del producto." }, { titulo: "Cómo usar", contenido: "Usalo siguiendo las indicaciones de la ficha del producto." }, { titulo: "Envíos y devoluciones", contenido: "Consultá las condiciones de envío y devolución antes de comprar." }],
    recomendados: []
  };

  const ppbPick = (obj, key, fallback) => obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== "" ? obj[key] : fallback;
  const ppbAssetUrl = (name) => {
    if (!name) return "";
    if (/^(https?:|data:|\/)/.test(name)) return name;
    if (EN_TIENDA && window.TIENDAIQ_ASSET_BASE) return window.TIENDAIQ_ASSET_BASE + name;
    return `/widgets/${name}`;
  };
  const ppbAssetImg = (name, alt = "") => `<img src="${esc(ppbAssetUrl(name))}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  const ppbAssetOrMedia = (value, alt, fallback) => value ? (/\.svg$|\.png$|\.jpe?g$|\.webp$/.test(String(value)) ? ppbAssetImg(value, alt) : img(value, alt)) : ppbAssetImg(fallback, alt);
  const ppbText = (value, fallback) => esc(value || fallback);
  const ppbEmphasis = (value, emphasis) => {
    const text = esc(value || "");
    const term = esc(emphasis || "");
    return term && text.includes(term) ? text.replace(term, `<em>${term}</em>`) : text;
  };

  function ppbBlue(data) {
    const f = data.facetas || {};
    const raw = f.pagepilot_blue || {};
    const b = {
      ...PPB_DEFAULTS,
      ...raw,
      social: { ...PPB_DEFAULTS.social, ...(raw.social || {}) },
      como_funciona: { ...PPB_DEFAULTS.como_funciona, ...(raw.como_funciona || {}) },
      feature: { ...PPB_DEFAULTS.feature, ...(raw.feature || {}) },
      reviews: { ...PPB_DEFAULTS.reviews, ...(raw.reviews || {}) },
      blue_stats: { ...PPB_DEFAULTS.blue_stats, ...(raw.blue_stats || {}) },
      comparison: raw.comparison || {},
      panel: { ...PPB_DEFAULTS.panel, ...(raw.panel || {}) },
      faq: { ...PPB_DEFAULTS.faq, ...(raw.faq || {}) },
      acordeones: Array.isArray(raw.acordeones) && raw.acordeones.length ? raw.acordeones : PPB_DEFAULTS.acordeones,
      recomendados: Array.isArray(raw.recomendados) ? raw.recomendados : PPB_DEFAULTS.recomendados
    };
    b.ticker = Array.isArray(raw.ticker) && raw.ticker.length ? raw.ticker : PPB_DEFAULTS.ticker;
    // Los logos de pago son una afirmación comercial. No se infieren del
    // modelo ni de contenido heredado hasta contar con una atestación propia.
    b.pagos = [];
    b.social.imagenes = Array.isArray(raw.social?.imagenes) ? raw.social.imagenes : [];
    b.como_funciona.parrafos = Array.isArray(raw.como_funciona?.parrafos) && raw.como_funciona.parrafos.length ? raw.como_funciona.parrafos : PPB_DEFAULTS.como_funciona.parrafos;
    b.feature.items = Array.isArray(raw.feature?.items) && raw.feature.items.length ? raw.feature.items : PPB_DEFAULTS.feature.items;
    b.reviews.items = Array.isArray(raw.reviews?.items) ? raw.reviews.items : [];
    b.blue_stats.items = Array.isArray(raw.blue_stats?.items) ? raw.blue_stats.items : [];
    b.faq.items = Array.isArray(raw.faq?.items) && raw.faq.items.length ? raw.faq.items : PPB_DEFAULTS.faq.items;
    if (!Array.isArray(raw.faq?.items) || !raw.faq.items.length) b.faq.items = (f.faq?.items || []).filter((item) => item?.pregunta).slice(0, 5).length ? (f.faq.items || []).filter((item) => item?.pregunta).slice(0, 5) : b.faq.items;
    return b;
  }

  function ppbAddButton(g, label, extra = "") {
    const variante = EN_TIENDA ? window.TIENDAIQ_VARIANT : null;
    const contenido = `${g.boton_icono !== false ? CART_ICO : ""}<span>${esc(label || g.cta || "Comprar ahora")}</span>`;
    const attrs = `class="tiq-ppb__cta ${extra}" data-ppb-add`;
    if (!variante) return `<button type="button" ${attrs}>${contenido}</button>`;
    return `<form method="post" action="/cart/add" onsubmit="return tiqPpbAgregar(event)"><input type="hidden" name="id" value="${esc(variante)}"><input type="hidden" name="quantity" value="1"><button type="submit" ${attrs}>${contenido}</button></form>`;
  }

  function ppbHero(data, b) {
    const f = data.facetas || {}, h = f.hero || {}, fuente = data.fuente || {}, g = data.global || {};
    const titulo = h.titulo || fuente.titulo_crudo || "Producto";
    const gallery = Array.isArray(h.galeria) && h.galeria.length ? h.galeria : [null, null, null, null, null];
    const thumbs = gallery.slice(0, 5).map((id, i) => `<button type="button" class="tiq-ppb__thumb${i === 0 ? " is-active" : ""}" onclick="cambiarPrincipal('${esc(id || "")}', this)" aria-label="Imagen ${i + 1}">${id ? img(id, titulo, { ancho: 160 }) : ppbAssetImg(PPB_ASSETS.detail, titulo)}</button>`).join("");
    const bullets = (Array.isArray(h.bullets) && h.bullets.length ? h.bullets : [{ fuerte: "Mirada más expresiva", resto: "" }, { fuerte: "Rutina más rápida", resto: "" }, { fuerte: "Sensación muy ligera", resto: "" }, { fuerte: "Uso diario sencillo", resto: "" }]).slice(0, 4).map((item) => `<li><span class="tiq-ppb__benefit-icon">${pagepilotBlueIcon(item)}</span><span>${esc(pagepilotBlueText(item) || "Beneficio del producto")}</span></li>`).join("");
    const accordionData = (Array.isArray(b.acordeones) ? b.acordeones : []).slice(0, 3);
    const accordionDefaults = [{ titulo: "Descripción", contenido: "Conocé los detalles y beneficios del producto." }, { titulo: "Cómo usar", contenido: "Usalo siguiendo las indicaciones de la ficha del producto." }, { titulo: "Envíos y devoluciones", contenido: "Consultá las condiciones de envío y devolución antes de comprar." }];
    while (accordionData.length < 3) accordionData.push(accordionDefaults[accordionData.length]);
    const accordions = accordionData.map((item) => `<details><summary>${esc(item.titulo || "Información del producto")}<span>⌄</span></summary><p>${esc(item.contenido || "Consultá la información del producto antes de comprar.")}</p></details>`).join("");
    const review = h.resena_destacada || {};
    const avatar = imgAsset(review.avatar, `<span class="tiq-ppb__avatar-fallback">${esc((review.autor || "C").slice(0, 1))}</span>`);
    const reviewPool = [review, ...(Array.isArray(f.resenas?.items) ? f.resenas.items : [])].filter(resenaCompleta).slice(0, 5);
    const precio = precioBonito(fuente.moneda, fuente.precio || "0.00");
    const anterior = fuente.precio_comparativo ? precioBonito(fuente.moneda, fuente.precio_comparativo) : "";
    const ahorro = Number(fuente.precio) && Number(fuente.precio_comparativo) > Number(fuente.precio) ? Math.round((1 - Number(fuente.precio) / Number(fuente.precio_comparativo)) * 100) : 0;
    const badge = String(b.badge || PPB_DEFAULTS.badge).trim();
    const badgeMatch = badge.match(/^(#[0-9]+)\s+(.+)$/);
    const badgeMark = badgeMatch ? badgeMatch[1] : "★";
    const badgeLabel = badgeMatch ? badgeMatch[2] : badge;
    const ratingHtml = tienePuntajeReal(h.puntaje, h.resenas_count)
      ? `<div class="tiq-ppb__rating">${estrellasValidas(h.puntaje)} <span>Calificado con <strong>${esc(puntaje1(h.puntaje))}/5</strong> por <strong>${esc(miles(h.resenas_count))}</strong> reseñas</span></div>`
      : "";
    const quoteHtml = reviewPool.length
      ? `<blockquote class="tiq-ppb__quote" data-ppb-review-pool='${esc(JSON.stringify(reviewPool))}' data-ppb-review-index="0"><button type="button" onclick="tiqPpbReviewMover(-1)" aria-label="Reseña anterior">‹</button><span class="tiq-ppb__quote-avatar">${avatar}</span><div class="tiq-ppb__quote-body"><div class="tiq-ppb__quote-stars">${estrellasValidas(reviewPool[0].estrellas)}</div><p>"${esc(reviewPool[0].texto)}"</p><cite>${ICONO.verificado} ${esc(reviewPool[0].autor)}</cite></div><button type="button" onclick="tiqPpbReviewMover(1)" aria-label="Reseña siguiente">›</button></blockquote>`
      : "";
    const paymentsHtml = b.pagos.length
      ? `<div class="tiq-ppb__payments" aria-label="Medios de pago">${b.pagos.slice(0, 7).map((id) => PPB_ASSETS.payments[id] ? ppbAssetImg(PPB_ASSETS.payments[id], id) : "").join("")}</div>`
      : "";
    return `<section class="tiq-ppb__hero" data-bloque="hero"><div class="tiq-ppb__wrap tiq-ppb__hero-grid"><div class="tiq-ppb__gallery"><div id="tiq-ppb-main" class="tiq-ppb__gallery-main">${gallery[0] ? img(gallery[0], titulo, { hero: true }) : ppbAssetImg(PPB_ASSETS.detail, titulo)}<button type="button" class="tiq-ppb__gallery-arrow tiq-ppb__gallery-arrow--prev" onclick="tiqPpbMover(-1)" aria-label="Imagen anterior">‹</button><button type="button" class="tiq-ppb__gallery-arrow tiq-ppb__gallery-arrow--next" onclick="tiqPpbMover(1)" aria-label="Imagen siguiente">›</button></div><div class="tiq-ppb__thumbs">${thumbs}</div></div><div class="tiq-ppb__buy"><div class="tiq-ppb__badge"><b>${esc(badgeMark)}</b><span>${esc(badgeLabel)}</span></div><h1>${esc(titulo)}</h1>${ratingHtml}<ul class="tiq-ppb__benefits">${bullets}</ul><div class="tiq-ppb__price">${anterior ? `<del>${esc(anterior)}</del>` : ""}<strong>${esc(precio)}</strong>${ahorro ? `<span class="tiq-ppb__save">AHORRA ${ahorro}%</span>` : ""}</div>${ppbAddButton(g, g.cta || "Añadir al carrito")}<div class="tiq-ppb__trust"><span>${ICONO.verificado} Garantía de devolución de 30 días</span><span>${ICONO.paquete} Devoluciones en 30 días</span></div>${paymentsHtml}<div class="tiq-ppb__accordions">${accordions}</div>${quoteHtml}</div></div></section>`;
  }

  function ppbTicker(b) {
    const items = b.ticker.slice(0, 5).map((item) => typeof item === "string" ? { texto: item } : item);
    const pills = items.concat(items).map((item, i) => `<span><i>${ICONOS_BULLET[item.icono] || ICONOS_BULLET.check}</i>${esc(item.texto || "Beneficio del producto")}</span>`).join("");
    return `<section class="tiq-ppb__ticker" aria-label="Beneficios del producto"><div class="tiq-ppb__ticker-track">${pills}</div></section>`;
  }

  function ppbSocial(data, b) {
    const existing = (data.facetas?.resenas?.items || []).map((item) => item?.imagen).filter(Boolean).slice(0, 3);
    const images = b.social.imagenes.length ? b.social.imagenes.slice(0, 3) : existing;
    if (!images.length) return "";
    return `<section class="tiq-ppb__social" data-bloque="clientes"><div class="tiq-ppb__wrap tiq-ppb__social-grid"><div><h2>${ppbEmphasis(b.social.titular, b.social.enfasis)}</h2><p>${esc(b.social.subtitulo)}</p>${ppbAddButton(data.global || {}, b.social.cta)}</div><div class="tiq-ppb__ugc-grid">${images.map((id) => `<article class="tiq-ppb__ugc">${ppbAssetOrMedia(id, "Contenido de cliente", "")}</article>`).join("")}</div></div></section>`;
  }

  function ppbTextImage(data, b) {
    const imagen = b.como_funciona.imagen || data.facetas?.stats?.imagen || data.facetas?.hero?.galeria?.[0];
    return `<section class="tiq-ppb__text-image" data-bloque="stats"><div class="tiq-ppb__wrap tiq-ppb__text-image-grid"><div><h2>${esc(b.como_funciona.titular)}</h2>${b.como_funciona.parrafos.slice(0, 3).map((p) => `<p>${esc(p)}</p>`).join("")}${ppbAddButton(data.global || {}, b.como_funciona.cta)}</div><div class="tiq-ppb__media">${ppbAssetOrMedia(imagen, b.como_funciona.titular, PPB_ASSETS.detail)}</div></div></section>`;
  }

  function ppbFeature(data, b) {
    const imagen = b.feature.imagen || data.facetas?.iconos?.imagen_central || data.facetas?.hero?.galeria?.[0];
    const items = b.feature.items.slice(0, 5).map((item, i) => `<li><span class="tiq-ppb__feature-number">${i + 1}</span><span><strong>${esc(item.titulo || "Beneficio diario")}</strong>${esc(item.frase || "Pensado para acompañarte con comodidad.")}</span></li>`).join("");
    return `<section class="tiq-ppb__feature" data-bloque="iconos"><div class="tiq-ppb__wrap tiq-ppb__feature-grid"><div class="tiq-ppb__media tiq-ppb__feature-media">${ppbAssetOrMedia(imagen, b.feature.titular, PPB_ASSETS.detail)}</div><div><h2>${esc(b.feature.titular)}</h2><p>${esc(b.feature.subtitulo)}</p><ul class="tiq-ppb__feature-list">${items}</ul></div></div></section>`;
  }

  function ppbReviews(b) {
    const reviews = b.reviews.items.filter(resenaCompleta);
    if (!reviews.length) return "";
    const items = reviews.slice(0, 4).map((item) => `<article class="tiq-ppb__review"><div class="tiq-ppb__review-media">${item.imagen ? ppbAssetOrMedia(item.imagen, item.autor, "") : ""}</div><strong>${esc(item.autor)}</strong>${estrellasValidas(item.estrellas)}<p>${esc(item.texto)}</p></article>`).join("");
    return `<section class="tiq-ppb__reviews" data-bloque="resenas"><div class="tiq-ppb__wrap"><header class="tiq-ppb__section-head"><h2>${esc(b.reviews.titular)}</h2><p>${esc(b.reviews.subtitulo)}</p></header><div class="tiq-ppb__reviews-grid">${items}</div></div></section>`;
  }

  function ppbStats(b) {
    const items = b.blue_stats.items.filter(estadisticaCompleta);
    if (!items.length) return "";
    return `<section class="tiq-ppb__stats-section" data-bloque="stats"><div class="tiq-ppb__wrap"><header class="tiq-ppb__section-head"><h2>${esc(b.blue_stats.titular)}</h2><p>${esc(b.blue_stats.subtitulo)}</p></header><div class="tiq-ppb__stats-grid">${items.slice(0, 4).map((item) => `<article><b>${esc(item.pct)}%</b><p>${esc(item.frase)}</p></article>`).join("")}</div></div></section>`;
  }

  function ppbComparison(data, b) {
    const comparison = b.comparison || {};
    const rows = Array.isArray(comparison.filas) ? comparison.filas.filter(Boolean).slice(0, 6) : [];
    const compliance = data?.compliance || {};
    if (!rows.length || compliance.claims_verified !== true || !compliance.comparison_source) return "";
    const rowsHtml = rows.map((fila) => `<div class="tiq-ppb__compare-row"><span>${esc(fila)}</span><b>${ICONOS_BULLET.check}</b><b class="is-no">×</b></div>`).join("");
    return `<section class="tiq-ppb__comparison" data-bloque="tabla"><div class="tiq-ppb__wrap tiq-ppb__comparison-grid"><div><h2>${esc(comparison.titular || "Comparación del producto")}</h2><p>${esc(comparison.parrafo || "")}</p>${ppbAddButton(data.global || {}, comparison.cta)}</div><div class="tiq-ppb__compare"><div class="tiq-ppb__compare-head"><span></span><strong>${esc(comparison.marca || "Producto")}</strong><strong>${esc(comparison.otros || "Alternativas")}</strong></div>${rowsHtml}</div></div></section>`;
  }

  function ppbPanel(data, b) {
    const imagen = b.panel.imagen || data.facetas?.stats?.imagen || data.facetas?.hero?.galeria?.[0];
    return `<section class="tiq-ppb__cta-panel"><div class="tiq-ppb__wrap tiq-ppb__cta-panel-grid"><div class="tiq-ppb__media">${ppbAssetOrMedia(imagen, b.panel.titular, PPB_ASSETS.detail)}</div><div><div class="tiq-ppb__cta-panel-icon">${ICONO.corazon}</div><h2>${esc(b.panel.titular)}</h2><p>${esc(b.panel.subtitulo)}</p>${ppbAddButton(data.global || {}, b.panel.cta)}</div></div></section>`;
  }

  function ppbFaq(b) {
    return `<section class="tiq-ppb__faq" data-bloque="faq"><div class="tiq-ppb__wrap"><header class="tiq-ppb__section-head"><h2>${esc(b.faq.titular)}</h2><p>${esc(b.faq.subtitulo)}</p></header><div class="tiq-ppb__faq-list">${b.faq.items.slice(0, 5).map((item) => `<details><summary>${esc(item.pregunta)}<span>+</span></summary><p>${esc(item.respuesta)}</p></details>`).join("")}</div></div></section>`;
  }

  function ppbRecommendations(data, b) {
    if (EN_TIENDA) {
      return `<section class="tiq-ppb__recommendations" data-tiq-live-recommendations hidden><div class="tiq-ppb__wrap"><header class="tiq-ppb__section-head"><h2>Productos recomendados</h2></header><div class="tiq-ppb__rec-track"></div></div></section>`;
    }
    const moneda = data.fuente?.moneda;
    const items = b.recomendados.length
      ? b.recomendados.slice(0, 5)
      : Array.from({ length: 5 }, () => ({ imagen: null, titulo: "Producto del catálogo", precio: "", comparativo: "", descuento: "" }));
    const cards = items.map((item) => `<article class="tiq-ppb__rec-card"><div class="tiq-ppb__rec-image">${ppbAssetOrMedia(item.imagen, item.titulo, PPB_ASSETS.detail)}</div><strong>${esc(item.titulo || "Producto del catálogo")}</strong><div class="tiq-ppb__rec-price">${item.precio ? esc(precioBonito(moneda, item.precio)) : "Precio de Shopify"}${item.comparativo ? ` <del>${esc(precioBonito(moneda, item.comparativo))}</del>` : ""}</div>${item.descuento ? `<span>${esc(item.descuento)} DE DESCUENTO</span>` : ""}</article>`).join("");
    return `<section class="tiq-ppb__recommendations"><div class="tiq-ppb__wrap"><header class="tiq-ppb__section-head"><h2>Productos recomendados</h2></header><div class="tiq-ppb__rec-track">${cards}</div></div></section>`;
  }

  function ppbSticky(data) {
    const h = data.facetas?.hero || {}, titulo = h.titulo || data.fuente?.titulo_crudo || "Producto";
    const mensaje = EN_TIENDA ? "Producto agregado al carrito" : "Vista previa: el carrito no cambia";
    return `<div class="tiq-ppb__sticky"><div class="tiq-ppb__sticky-inner"><div class="tiq-ppb__sticky-product">${h.galeria?.[0] ? img(h.galeria[0], titulo, { ancho: 64 }) : ppbAssetImg(PPB_ASSETS.detail, titulo)}<strong>${esc(titulo)}</strong></div>${ppbAddButton(data.global || {}, data.global?.cta || "Añadir al carrito", "tiq-ppb__sticky-cta")}</div></div><div class="tiq-ppb__toast" role="status" aria-live="polite">${mensaje}</div>`;
  }

  function renderPagepilotBlueExact(data) {
    const b = ppbBlue(data);
    return repararMojibake(`<div class="tiq-ppb">${[ppbHero(data, b), ppbTicker(b), ppbSocial(data, b), ppbTextImage(data, b), ppbFeature(data, b), ppbReviews(b), ppbStats(b), ppbComparison(data, b), ppbPanel(data, b), ppbFaq(b), ppbRecommendations(data, b), ppbSticky(data)].join("\n")}</div>`);
  }

  function filtrarClaimsSinFuente(html, datos) {
    const compliance = datos?.compliance || {};
    const verificado = compliance.claims_verified === true;
    const selectores = [];

    if (!verificado || !compliance.review_source) {
      selectores.push(
        ".hero__resenas", ".resena-destacada", ".resenas", ".tiq-mq",
        ".tiq-pp__rating", ".tiq-pp__quote", ".tiq-pp__reviews",
        ".tiq-ppb__rating", ".tiq-ppb__quote", ".tiq-ppb__social", ".tiq-ppb__reviews"
      );
    }
    if (!verificado || !compliance.statistics_source) {
      selectores.push(".stats", ".tiq-pp__dark", ".tiq-ppb__stats-section", ".tiq-ppb__comparison");
    }
    if (!verificado || !compliance.policy_source) {
      selectores.push(".hero__urgencia", ".hero__timer", ".hero__badges", ".tiq-pp__trust", ".tiq-ppb__trust", ".tiq-ppb__guarantee");
    }
    if (!verificado) selectores.push(".tiq-ppb__badge");
    if (!selectores.length) return html;

    const fragmento = document.createElement("template");
    fragmento.innerHTML = html;
    fragmento.content.querySelectorAll([...new Set(selectores)].join(",")).forEach((nodo) => nodo.remove());
    return fragmento.innerHTML;
  }

  function renderPremium(data, opts = {}) {
    const f = data.facetas;
    const g = data.global;
    const partes = [];
    if (!opts.sinHero) partes.push(hero(f, data.fuente, g)); // el SSR ya lo pintó
    partes.push(
      comparacion(f, g, data.compliance),
      iconos(f.iconos),
      resenasMarquee(f.resenas),
      recomendados(f.recomendados)
    );
    // Las sections del merchant se agregan al final (el premium tiene orden fijo).
    const secs = Array.isArray(data.secciones) ? data.secciones.map(seccionHTML) : [];
    return partes.concat(secs).join("\n");
  }

  // Plantilla editorial para productos donde el comprador necesita entender
  // materiales, uso o especificaciones antes de decidir. Es deliberadamente
  // sobria: no agrega reseñas, garantías, urgencia, porcentajes ni comparativas
  // que el merchant no haya demostrado por separado.
  function renderPerformanceStory(data, opts = {}) {
    const f = data.facetas || {};
    const g = data.global || {};
    const h = f.hero || {};
    const fuente = data.fuente || {};
    const title = h.titulo || fuente.titulo_crudo || "Producto";
    const subtitle = h.subtitulo || "";
    const gallery = Array.isArray(h.galeria) ? h.galeria.filter(Boolean) : [];
    const purchaseGlobal = { ...g, cta: g.cta || "Agregar al carrito" };
    const bullets = (Array.isArray(h.bullets) ? h.bullets : [])
      .map((item) => {
        const text = typeof item === "string" ? item : [item?.fuerte, item?.resto].filter(Boolean).join(" — ");
        return text ? `<li>${ICONOS_BULLET.check}<span>${esc(text)}</span></li>` : "";
      })
      .filter(Boolean)
      .join("");
    const details = (Array.isArray(h.acordeones) ? h.acordeones : [])
      .filter((item) => item?.titulo && item?.contenido)
      .map((item) => `<details><summary>${esc(item.titulo)}</summary><p>${esc(item.contenido)}</p></details>`)
      .join("");
    const features = (Array.isArray(f.iconos?.items) ? f.iconos.items : [])
      .filter((item) => item?.titulo || item?.frase)
      .slice(0, 4)
      .map((item) => `<article><span aria-hidden="true">${esc(item.emoji || "•")}</span><h3>${esc(item.titulo || "")}</h3><p>${esc(item.frase || "")}</p></article>`)
      .join("");
    const story = [f.dupla1, f.dupla2]
      .filter((item) => item?.titular || item?.parrafo || item?.imagen)
      .map((item, index) => `<section class="tiq-ps__story${index % 2 ? " tiq-ps__story--reverse" : ""}"><div>${item.imagen ? img(item.imagen, item.titular || title) : ""}</div><div><p class="tiq-ps__eyebrow">${esc(index ? "Detalles" : "Diseñado para usar")}</p><h2>${esc(item.titular || "")}</h2><p>${esc(item.parrafo || "")}</p></div></section>`)
      .join("");
    const questions = (Array.isArray(f.faq?.items) ? f.faq.items : [])
      .filter((item) => item?.pregunta && item?.respuesta)
      .map((item) => `<details><summary>${esc(item.pregunta)}</summary><p>${esc(item.respuesta)}</p></details>`)
      .join("");
    const merchantSections = Array.isArray(data.secciones) ? data.secciones.map(seccionHTML).join("\n") : "";

    const hero = `
      <section class="tiq-ps__hero" data-bloque="hero">
        <div class="tiq-ps__wrap tiq-ps__hero-grid">
          <div class="tiq-ps__gallery">
            <div class="tiq-ps__main" id="imagen-principal">${img(gallery[0] || null, title, { hero: true })}</div>
            ${gallery.length > 1 ? `<div class="tiq-ps__thumbs">${gallery.map((id, index) => `<button type="button" class="${index === 0 ? "activa" : ""}" onclick="cambiarPrincipal('${esc(id)}', this)" aria-label="Ver imagen ${index + 1}">${img(id, "", { ancho: 160 })}</button>`).join("")}</div>` : ""}
          </div>
          <div class="tiq-ps__buy">
            ${subtitle ? `<p class="tiq-ps__eyebrow">${esc(subtitle)}</p>` : ""}
            <h1>${esc(title)}</h1>
            <div class="tiq-ps__price"><strong>${esc(precioBonito(fuente.moneda, fuente.precio))}</strong>${fuente.precio_comparativo ? `<del>${esc(precioBonito(fuente.moneda, fuente.precio_comparativo))}</del>` : ""}</div>
            ${bullets ? `<ul class="tiq-ps__benefits">${bullets}</ul>` : ""}
            ${botonComprar(purchaseGlobal)}
            ${details ? `<div class="tiq-ps__details">${details}</div>` : ""}
          </div>
        </div>
      </section>`;

    return `<div class="tiq-ps">${opts.sinHero ? "" : hero}${story}${features ? `<section class="tiq-ps__features"><div class="tiq-ps__wrap">${f.iconos?.titular ? `<h2>${esc(f.iconos.titular)}</h2>` : ""}<div>${features}</div></div></section>` : ""}${questions ? `<section class="tiq-ps__faq"><div class="tiq-ps__wrap"><h2>${esc(f.faq?.titular || "Preguntas frecuentes")}</h2>${questions}</div></section>` : ""}${merchantSections}</div>`;
  }

  // Cuenta regresiva: end guardado por producto en localStorage (persistente).
  function iniciarTimers() {
    document.querySelectorAll("[data-timer]").forEach((el) => {
      const mins = Number(el.dataset.mins) || 30;
      const pid = window.TIENDAIQ_PRODUCT_ID || location.pathname;
      const key = "tiq_oferta_" + pid;
      let fin = Number(localStorage.getItem(key));
      const ahora = Date.now();
      if (!fin || fin < ahora) { fin = ahora + mins * 60000; try { localStorage.setItem(key, fin); } catch {} }
      const h = el.querySelector("[data-h]"), m = el.querySelector("[data-m]"), s = el.querySelector("[data-s]");
      const pad = (n) => String(n).padStart(2, "0");
      const tick = () => {
        let d = Math.max(0, fin - Date.now());
        if (d <= 0) { fin = Date.now() + mins * 60000; try { localStorage.setItem(key, fin); } catch {} d = fin - Date.now(); }
        const tot = Math.floor(d / 1000);
        h.textContent = pad(Math.floor(tot / 3600));
        m.textContent = pad(Math.floor((tot % 3600) / 60));
        s.textContent = pad(tot % 60);
      };
      tick();
      clearInterval(el._t); el._t = setInterval(tick, 1000);
    });
  }

  // ---------- ensamblado ----------

  // opts.sinHero: no emite el bloque hero (lo pintó el SSR de pagina.liquid);
  // igual mantiene las sections ancladas a "hero" en su lugar.
  function render(data, opts = {}) {
    const f = data.facetas;
    const g = data.global;
    const renderer = rendererKey(g);
    if (renderer === "pagepilot-blue") return renderPagepilotBlue(data, opts);
    if (renderer === "pagepilot") return renderPagepilot(data, opts);
    if (renderer === "premium") return renderPremium(data, opts);
    if (renderer === "performance-story") return renderPerformanceStory(data, opts);
    // Bloques fijos, cada uno con su id: las sections del merchant se
    // intercalan según su `ancla` (= id del bloque tras el cual va).
    const fijos = [
      ["hero", hero(f, data.fuente, g)],
      ["clientes", muroClientes(f.clientes)],
      ["faq", faq(f.faq, g)],
      ["iconos", iconos(f.iconos)],
      ["stats", stats(f.stats, g)],
      ["resenas", resenas(f.resenas)],
      ["recomendados", recomendados(f.recomendados)]
    ];
    // Marca cada bloque fijo para que el editor sepa dónde soltar sections.
    const marcar = (id, html) => html.replace(/<section/, `<section data-bloque="${id}" data-fijo="1"`);

    const secciones = Array.isArray(data.secciones) ? data.secciones : [];
    const grupos = {};
    for (const s of secciones) (grupos[s.ancla || "top"] ||= []).push(seccionHTML(s));

    // Bloques que el merchant eliminó desde el editor (botón borrar al pasar el
    // cursor). Se saltea su HTML, pero las sections ancladas ahí igual se pintan.
    const ocultas = new Set(Array.isArray(data.ocultas) ? data.ocultas : []);

    const out = [];
    if (grupos.top) out.push(...grupos.top);
    const usados = new Set(["top"]);
    for (const [id, html] of fijos) {
      // sinHero: saltea el HTML del hero (ya está en el SSR) pero deja pasar las
      // sections ancladas a "hero".
      if (!ocultas.has(id) && !(id === "hero" && opts.sinHero)) out.push(marcar(id, html));
      if (grupos[id]) out.push(...grupos[id]);
      usados.add(id);
    }
    // Secciones ancladas a un bloque que ya no existe (p. ej. la tabla, que
    // se eliminó): no las perdemos, van al final en vez de desaparecer.
    for (const ancla of Object.keys(grupos))
      if (!usados.has(ancla)) out.push(...grupos[ancla]);
    return out.join("\n");
  }

  // Recomendados en vivo: precios, descuentos e imágenes salen siempre del
  // catálogo de Shopify. Si ambas APIs fallan, la sección permanece oculta.
  async function cargarRecomendados(moneda) {
    const grids = Array.from(document.querySelectorAll(".recomendados__grid"));
    const ppbTracks = Array.from(document.querySelectorAll(".tiq-ppb__rec-track"));
    const idProducto = window.TIENDAIQ_PRODUCT_ID;
    if ((!grids.length && !ppbTracks.length) || !idProducto) return;

    const importe = (value) => {
      if (value == null || value === "") return null;
      const number = Number(value);
      if (!Number.isFinite(number)) return null;
      return typeof value === "number" ? number / 100 : number;
    };

    const normalizar = (p) => ({
      nombre: p.title,
      url: p.url || `/products/${p.handle}`,
      imagen: p.featured_image?.src || p.featured_image || p.images?.[0]?.src || null,
      // la API AJAX da centavos (número); /products.json da "19.95" (string)
      precio:
        typeof p.price === "number"
          ? (p.price / 100).toFixed(2)
          : p.price ?? p.variants?.[0]?.price ?? "",
      comparativo:
        typeof p.compare_at_price === "number"
          ? (p.compare_at_price / 100).toFixed(2)
          : p.compare_at_price ?? p.variants?.[0]?.compare_at_price ?? ""
    });

    let productos = [];
    try {
      const r = await fetch(`/recommendations/products.json?product_id=${idProducto}&limit=5`);
      if (r.ok) productos = (await r.json()).products || [];
    } catch {}
    if (!productos.length) {
      try {
        const r = await fetch(`/products.json?limit=8`);
        if (r.ok)
          productos = ((await r.json()).products || [])
            .filter((p) => p.id !== idProducto)
            .slice(0, 5);
      } catch {}
    }
    if (!productos.length) return;

    const reales = productos.map(normalizar);
    const genericHtml = reales.map(
        (p) => `
        <a class="tarjeta-producto" href="${esc(p.url)}">
          ${
            p.imagen
              ? `<img class="tarjeta-producto__img" src="${esc(p.imagen)}" alt="${esc(p.nombre)}" loading="lazy">`
              : `<div class="ph-img"></div>`
          }
          <div class="tarjeta-producto__nombre">${esc(p.nombre)}</div>
          <div class="tarjeta-producto__precio">${esc(precioBonito(moneda ?? "", p.precio))}</div>
        </a>`
      )
      .join("");
    grids.forEach((grid) => {
      grid.innerHTML = genericHtml;
      const section = grid.closest("[data-tiq-live-recommendations]");
      if (section) section.hidden = false;
    });

    const ppbHtml = reales.map((p) => {
      const price = importe(p.precio);
      const compareAt = importe(p.comparativo);
      const hasDiscount = price != null && compareAt != null && compareAt > price;
      const discount = hasDiscount ? Math.round((1 - price / compareAt) * 100) : null;
      return `<a class="tiq-ppb__rec-card" href="${esc(p.url)}"><div class="tiq-ppb__rec-image">${p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" loading="lazy">` : `<div class="tiq-ppb__asset-placeholder" aria-hidden="true"></div>`}</div><strong>${esc(p.nombre)}</strong><div class="tiq-ppb__rec-price">${esc(precioBonito(moneda ?? "", p.precio))}${hasDiscount ? ` <del>${esc(precioBonito(moneda ?? "", p.comparativo))}</del>` : ""}</div>${discount ? `<span>${discount}% DE DESCUENTO</span>` : ""}</a>`;
    }).join("");
    ppbTracks.forEach((track) => {
      track.innerHTML = ppbHtml;
      const section = track.closest("[data-tiq-live-recommendations]");
      if (section) section.hidden = false;
    });
  }

  // interacción mínima de la galería
  window.cambiarPrincipal = function (mediaId, boton) {
    const principal = document.getElementById("imagen-principal") || document.getElementById("tiq-ppb-main");
    if (!principal) return;
    principal.innerHTML = img(mediaId);
    document.querySelectorAll(".hero__mini, .tiq-pp__thumb, .tiq-ppb__thumb").forEach((m) => {
      m.classList.remove("activa");
      m.classList.remove("is-active");
    });
    boton.classList.add(boton.classList.contains("tiq-pp__thumb") || boton.classList.contains("tiq-ppb__thumb") ? "is-active" : "activa");
  };

  window.tiqPpbMover = function (delta) {
    const thumbs = Array.from(document.querySelectorAll(".tiq-ppb__thumb"));
    if (!thumbs.length) return;
    const actual = Math.max(0, thumbs.findIndex((thumb) => thumb.classList.contains("is-active")));
    thumbs[(actual + delta + thumbs.length) % thumbs.length].click();
  };

  window.tiqPpbReviewMover = function (delta) {
    const quote = document.querySelector(".tiq-ppb__quote[data-ppb-review-pool]");
    if (!quote) return;
    let pool;
    try { pool = JSON.parse(quote.dataset.ppbReviewPool || "[]"); } catch { pool = []; }
    if (pool.length < 2) return;
    const current = Number(quote.dataset.ppbReviewIndex) || 0;
    const next = (current + delta + pool.length) % pool.length;
    const review = pool[next] || {};
    if (!resenaCompleta(review)) return;
    quote.dataset.ppbReviewIndex = String(next);
    const body = quote.querySelector(".tiq-ppb__quote-body");
    if (body) {
      const rating = body.querySelector(".tiq-ppb__quote-stars");
      const text = body.querySelector("p");
      const author = body.querySelector("cite");
      if (rating) rating.textContent = "★".repeat(Math.round(Number(review.estrellas)));
      if (text) text.textContent = `"${review.texto}"`;
      if (author) author.textContent = `✓ ${review.autor}`;
    }
    const avatar = quote.querySelector(".tiq-ppb__quote-avatar");
    if (avatar) avatar.innerHTML = `<span class="tiq-ppb__avatar-fallback">${esc((review.autor || "C").slice(0, 1))}</span>`;
  };

  window.tiqPpbMostrarToast = function () {
    const toast = document.querySelector(".tiq-ppb__toast");
    if (!toast) return;
    toast.classList.add("is-visible");
    clearTimeout(toast._tiqTimer);
    toast._tiqTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  };
  window.tiqPpbAgregar = function (ev) {
    return window.tiendaiqAgregar(ev);
  };

  // Agregar al carrito sin salir de la página: POST a /cart/add.js (la API
  // AJAX de Shopify), feedback en el botón y aviso al tema por si tiene
  // contador de carrito. Si el fetch falla, cae al POST clásico del form.
  window.tiendaiqAgregar = function (ev) {
    ev.preventDefault();
    const form = ev.target;
    const boton = form.querySelector("button[type=submit]");
    const cantidad = parseInt(document.getElementById("tiendaiq-cantidad")?.value, 10) || 1;
    const textoOriginal = boton.textContent;
    boton.disabled = true;

    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: Number(form.querySelector("input[name=id]").value),
        quantity: cantidad
      })
    })
      .then((r) => {
        if (!r.ok) throw new Error("cart/add.js " + r.status);
        return r.json();
      })
      .then(() => {
        boton.textContent = "✓ Agregado al carrito";
        if (boton.matches("[data-ppb-add]")) window.tiqPpbMostrarToast();
        document.documentElement.dispatchEvent(
          new CustomEvent("cart:refresh", { bubbles: true })
        );
        setTimeout(() => {
          boton.textContent = textoOriginal;
          boton.disabled = false;
        }, 2000);
      })
      .catch(() => {
        // sin AJAX no dejamos al cliente colgado: flujo clásico de Shopify
        boton.disabled = false;
        form.submit();
      });
    return false;
  };

  async function montar(datos) {
    if (EN_TIENDA) document.body.classList.add("publicada");
    const app = document.getElementById("app");
    app.classList.toggle("tiq-claims-unverified", datos?.compliance?.claims_verified !== true);
    // El nicho define el color de acento (skin por rubro). Sin dato → general.
    app.dataset.nicho = datos?.global?.nicho || "general";
    // Variante de color elegida por el merchant: pisa el acento del nicho. Sin
    // variante → queda el color del rubro (comportamiento de siempre).
    if (datos?.global?.tema) app.dataset.tema = datos.global.tema;
    else app.removeAttribute("data-tema");
    // SSR: si pagina.liquid ya pintó el hero (#tiq-hero + #tiq-resto), pintamos
    // SOLO el resto y dejamos el hero server-side intacto (mejor LCP/CLS/SEO).
    // Los handlers del hero son inline globales (cambiarPrincipal / tiendaiqAgregar)
    // → funcionan sobre el DOM del SSR sin re-montar nada. Fallback: render total.
    const renderer = rendererKey(datos?.global || {});
    if (renderer === "pinza-pagepilot") {
      if (!window.TiendaIQPinzaPagepilotV1) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = `${window.TIENDAIQ_ASSET_BASE || ""}tiq-pinzapilot-v1.js`;
          script.defer = true;
          script.onload = resolve;
          script.onerror = () => reject(new Error("No se pudo cargar el runtime de la plantilla fija"));
          document.head.append(script);
        });
      }
      const source = datos?.fuente || {};
      const hero = datos?.facetas?.hero || {};
      const gallery = Array.isArray(hero.galeria) ? hero.galeria : [];
      const media = gallery
        .map((id) => ({ id, url: MAPA_URLS[id] }))
        .filter((item) => typeof item.url === "string" && /^https:\/\//.test(item.url));
      const evidence = {
        reviews: datos?.compliance?.claims_verified === true && Boolean(datos?.compliance?.review_source),
        ugc: datos?.compliance?.claims_verified === true && Boolean(datos?.compliance?.ugc_source),
        policies: datos?.compliance?.claims_verified === true && Boolean(datos?.compliance?.policy_source),
        comparison: datos?.compliance?.claims_verified === true && Boolean(datos?.compliance?.comparison_source),
        logos: datos?.compliance?.claims_verified === true && Boolean(datos?.compliance?.logo_source),
        statistics: datos?.compliance?.claims_verified === true && Boolean(datos?.compliance?.statistics_source),
        payments: false
      };
      await window.TiendaIQPinzaPagepilotV1.mount(app, {
        assetUrl: `${window.TIENDAIQ_ASSET_BASE || ""}tiq-pinzapilot-v1.html`,
        view: {
          product: {
            title: hero.titulo || source.titulo_crudo || "",
            description: hero.subtitulo || source.descripcion_cruda || "",
            price: source.precio ?? null,
            compareAtPrice: source.precio_comparativo ?? null,
            currency: source.moneda || "",
            variantId: window.TIENDAIQ_VARIANT || null,
            money: window.TIENDAIQ_VARIANT_MONEY || null,
            media
          },
          content: {
            hero: { bullets: Array.isArray(hero.bullets) ? hero.bullets : [] },
            timeline: datos?.facetas?.texto_img_1 || null,
            feature: datos?.facetas?.texto_img_2 || datos?.facetas?.iconos || null,
            iconItems: Array.isArray(datos?.facetas?.iconos?.items) ? datos.facetas.iconos.items : [],
            faq: datos?.facetas?.faq || null,
            recommendations: datos?.facetas?.recomendados || null,
            cta: datos?.global?.cta || "Agregar al carrito"
          },
          evidence
        }
      });
      app.style.minHeight = "";
      return;
    }
    const resto = app.dataset.ssr === "1" ? document.getElementById("tiq-resto") : null;
    if (resto) resto.innerHTML = filtrarClaimsSinFuente(render(datos, { sinHero: true }), datos);
    else app.innerHTML = filtrarClaimsSinFuente(render(datos), datos);
    app.style.minHeight = ""; // la reserva de CLS (pagina.liquid) ya cumplió; altura real
    iniciarVcar(); // centra los carruseles de video
    autoplayMuro(); // los videos del muro se reproducen solos al entrar en vista
    autoplayVS(); // los slides del video slider también auto-reproducen en vista
    iniciarTimers(); // countdown de la barra de oferta (estilo premium)
    // Solo en la tienda: el preview no tiene storefront al que preguntarle.
    if (EN_TIENDA) cargarRecomendados(datos?.fuente?.moneda);
    if (!document.documentElement._tiqPpbClick) {
      document.documentElement._tiqPpbClick = true;
      document.addEventListener("click", (ev) => {
        const btn = ev.target.closest?.("[data-ppb-add]");
        if (btn && !btn.closest("form")) window.tiqPpbMostrarToast();
      });
    }
  }

  if (DATOS) {
    // Tienda (TIENDAIQ_DATA) o preview local por archivo (data.js).
    montar(DATOS).catch((error) => {
      const app = document.getElementById("app");
      if (app) app.textContent = "No se pudo cargar la plantilla de producto.";
      console.error("TiendaIQ renderer", error);
    });
  } else {
    // Preview de la app: el padre manda los datos de SU página por mensaje.
    // Así cada merchant ve la suya y no un data.js global compartido.
    window.addEventListener("message", (e) => {
      if (!e.data || !e.data.tiendaiq) return;
      Object.assign(MAPA_URLS, e.data.urls || {});
      montar(e.data.data).catch((error) => console.error("TiendaIQ renderer", error));
    });
  }
})();
