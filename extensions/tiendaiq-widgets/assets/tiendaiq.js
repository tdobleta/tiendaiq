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

  // El pool guarda media_id; la url se resuelve acá contra MAPA_URLS. En la
  // tienda ese mapa lo arma Liquid con las fotos vivas del producto; en el
  // preview local lo deja el adaptador. Media_id borrado → placeholder.
  const urlImagen = (mediaId) => MAPA_URLS[mediaId] || `img/${mediaId}.jpg`;

  // <img> que degrada a placeholder si el archivo no existe
  const img = (mediaId, alt = "") => {
    if (!mediaId) return `<div class="ph-img">Imagen pendiente</div>`;
    return `<img src="${esc(urlImagen(mediaId))}" alt="${esc(alt)}"
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
    return `<img src="${esc(encodeURI(src))}" alt="" onerror="this.outerHTML='${respaldo.replace(/'/g, "\\'")}'">`;
  };

  const estrellas = (n = 5) => `<span class="estrellas">${"★".repeat(n)}</span>`;
  // Miles con punto (es-AR): 1205 → "1.205".
  const miles = (n) => String(n ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  // Puntaje siempre con un decimal: 4.9 → "4.9", 5 → "5.0".
  const puntaje1 = (n) => Number(n).toFixed(1);

  // Iconos de línea (mismos que usa PagePilot: trazo fino, sin relleno)
  const ICONO = {
    camion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7h13v9H1z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="5.5" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>`,
    paquete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8.5v9L12 22l-9-4.5v-9L12 4l9 4.5z"/><path d="M3 8.5l9 4.5 9-4.5"/><path d="M12 13v9"/><path d="M7.5 6.25l9 4.5"/></svg>`,
    corazon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S3.5 15 3.5 9.3C3.5 6.4 5.7 4.5 8 4.5c1.7 0 3.2.9 4 2.3.8-1.4 2.3-2.3 4-2.3 2.3 0 4.5 1.9 4.5 4.8 0 5.7-8.5 11.2-8.5 11.2z"/></svg>`,
    globo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18z"/></svg>`,
    retorno: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>`,
    // check violeta de los bullets del hero — trazo grueso redondeado, como PagePilot
    tick: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.8l4.7 4.7L19.5 6.8"/></svg>`,
    // sello azul de comprador verificado
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

  const cta = (global, extra = "") =>
    `<button class="cta ${extra}">${esc(global.cta)}</button>`;

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
        <button type="submit" class="cta cta--full">${esc(global.cta)}</button>
      </form>`;
  };

  const ctaCentro = (faceta, global) =>
    faceta.cta ? `<div class="cta-centro">${cta(global)}</div>` : "";

  // ---------- facetas ----------

  function hero(f, fuente, global) {
    const h = f.hero;

    const galeria = h.galeria ?? [];
    const principal = galeria[0] ?? null;
    const miniaturas = galeria
      .map(
        (id, i) =>
          `<button class="hero__mini ${i === 0 ? "activa" : ""}"
             onclick="cambiarPrincipal('${esc(id)}', this)">${img(id)}</button>`
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
    // En la tienda, una reseña sin texto real no se muestra: el placeholder
    // de guía es para el editor, no para el cliente.
    const rdVisible = !EN_TIENDA || !!rd.texto;
    const rdTexto = rd.texto
      ? `"${esc(rd.texto)}"`
      : `"Acá va tu mejor reseña. Pasá el mouse por el texto y hacé clic en el lápiz para editarla. Pegá una reseña real y guardá."`;
    const rdAutor = rd.autor ? esc(rd.autor) : `Nombre del cliente`;
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
            <div class="hero__principal" id="imagen-principal">${img(principal, h.titulo)}</div>
            <div class="hero__miniaturas">${miniaturas}</div>
          </div>
          <div>
            ${global && global.estilo === "premium"
              ? heroTimer(global)
              : `<div class="hero__urgencia">${esc(h.urgencia ?? "Ya es viral | Pocas unidades")}</div>`}
            <div class="hero__resenas">${estrellas(5)} <span>Calificación ${esc(puntaje1(h.puntaje ?? 4.9))}/5.0 (${esc(miles(h.resenas_count))})</span></div>
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
                ${estrellas(rd.estrellas ?? 5)}
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
      .map(
        (s) => `
        <div class="stat-item">
          <div class="stat-item__circulo">${esc(s.pct)}%</div>
          <div class="stat-item__frase">${esc(s.frase)}</div>
        </div>`
      )
      .join("");

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
        <h2 class="muro__titulo">${esc(c.titulo || "Únete a más de 200 clientes contentos")}</h2>
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
    // El muro se muestra siempre, con andamio incluido — igual que PagePilot.
    // El dueño reemplaza las tarjetas guía por reseñas reales desde el editor.
    const items = f.items ?? [];

    const tarjeta = (r, j) => {
      const modoGuia = !r.autor && !r.imagen; // sin datos reales → tarjeta punteada
      // En el editor la foto es clickeable: abre el selector de archivos.
      const clic = MODO_APP ? ` data-imgclick="res:${j}" title="Clic para elegir una imagen"` : "";
      return `
      <div class="tarjeta-resena ${modoGuia ? "tarjeta-resena--vacia" : ""}">
        <div class="tarjeta-resena__img${MODO_APP ? " tiq-clicable" : ""}"${clic}>${r.imagen ? img(r.imagen) : `<div class="ph-img">Foto del cliente</div>`}</div>
        <div class="tarjeta-resena__autor ${r.autor ? "" : "guia"}">${r.autor ? esc(r.autor) : "Nombre del cliente"}</div>
        <div class="tarjeta-resena__verificado"><span class="verificado">✔</span> Comprador verificado</div>
        ${estrellas(r.estrellas ?? 5)}
        <p class="tarjeta-resena__texto ${r.autor ? "" : "guia"}">${esc(r.texto)}</p>
      </div>`;
    };

    return `
    <section class="resenas">
      <div class="contenedor">
        <div class="resenas__cabecera">
          <div class="estrellas">★★★★★</div>
          <h2>${esc(f.titular)}</h2>
          <p>${esc(f.subtitulo)}</p>
        </div>
        ${EN_TIENDA ? "" : `<button class="resenas__editar">✎ Editar reseñas en lote</button>`}
        <div class="resenas__grid">${items.map(tarjeta).join("")}</div>
      </div>
    </section>`;
  }

  function recomendados(f) {
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

  const COMPARA_DEF = [
    "Calidad premium comprobada",
    "Envío rápido y seguro",
    "Garantía de 30 días",
    "Soporte que responde",
    "Materiales de primera"
  ];
  const CHK_OK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;
  const CHK_NO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M6 18L18 6"/></svg>`;

  function comparacion(f, g) {
    const c = (f && f.comparacion) || {};
    const filas = Array.isArray(c.filas) && c.filas.length ? c.filas : COMPARA_DEF;
    const nombre = c.marca || "Nuestro producto";
    const otros = c.otros || "Otras marcas";
    const titular = c.titular || "¿Por qué elegirnos?";
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
    const reales = (f.items || []).filter((r) => r.autor || r.texto);
    const list = reales.length ? reales : [
      { autor: "@sofia.m", estrellas: 5, texto: "La calidad me sorprendió, la volvería a comprar sin dudar." },
      { autor: "@martin_ok", estrellas: 5, texto: "Llegó rapidísimo y es tal cual las fotos. Recomendadísimo." },
      { autor: "@caro.diaz", estrellas: 5, texto: "Uso diario, no me decepcionó. El soporte respondió al toque." },
      { autor: "@lucas.p", estrellas: 4, texto: "Muy bueno por el precio. Mejor de lo que esperaba." },
      { autor: "@vale.ríos", estrellas: 5, texto: "Ya la recomendé a toda mi familia. Encantada." }
    ];
    const card = (r) => `
      <figure class="tiq-mq__card">
        ${r.imagen ? `<div class="tiq-mq__img">${img(r.imagen)}</div>` : ""}
        <div class="tiq-mq__stars">${estrellas(r.estrellas ?? 5)}</div>
        <p class="tiq-mq__txt">${esc(r.texto)}</p>
        <figcaption class="tiq-mq__autor">${esc(r.autor || "Cliente verificado")}</figcaption>
      </figure>`;
    const fila = list.map(card).join("");
    const editar = MODO_APP ? `<button class="resenas__editar tiq-mq__editar">✎ Editar reseñas en lote</button>` : "";
    return `
    <section class="resenas tiq-mq" data-bloque="resenas" data-fijo="1">
      <div class="tiq-mq__cab">
        <div class="estrellas">★★★★★</div>
        <h2>${esc(f.titular || "Amado por miles de clientes")}</h2>
        ${f.subtitulo ? `<p>${esc(f.subtitulo)}</p>` : ""}
      </div>
      ${editar}
      <div class="tiq-mq__viewport">
        <div class="tiq-mq__track">${fila}${fila}</div>
      </div>
    </section>`;
  }

  function renderPremium(data) {
    const f = data.facetas;
    const g = data.global;
    const partes = [
      hero(f, data.fuente, g),
      comparacion(f, g),
      iconos(f.iconos),
      resenasMarquee(f.resenas),
      recomendados(f.recomendados)
    ];
    // Las sections del merchant se agregan al final (el premium tiene orden fijo).
    const secs = Array.isArray(data.secciones) ? data.secciones.map(seccionHTML) : [];
    return partes.concat(secs).join("\n");
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

  function render(data) {
    const f = data.facetas;
    const g = data.global;
    // Modelo de página elegido en la creación. "clasico" = comportamiento de
    // siempre; "premium" = armado alternativo (timer + comparación + marquee).
    if (g && g.estilo === "premium") return renderPremium(data);
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
      if (!ocultas.has(id)) out.push(marcar(id, html));
      if (grupos[id]) out.push(...grupos[id]);
      usados.add(id);
    }
    // Secciones ancladas a un bloque que ya no existe (p. ej. la tabla, que
    // se eliminó): no las perdemos, van al final en vez de desaparecer.
    for (const ancla of Object.keys(grupos))
      if (!usados.has(ancla)) out.push(...grupos[ancla]);
    return out.join("\n");
  }

  // Recomendados en vivo: en la tienda se piden a la API de recomendaciones
  // de Shopify (la misma que usan los temas), así la sección refleja SIEMPRE
  // el catálogo real, sin congelar nada en la generación. Si no devuelve
  // nada útil cae a /products.json; si tampoco, quedan los placeholders.
  async function cargarRecomendados(moneda) {
    const grid = document.querySelector(".recomendados__grid");
    const idProducto = window.TIENDAIQ_PRODUCT_ID;
    if (!grid || !idProducto) return;

    const normalizar = (p) => ({
      nombre: p.title,
      url: p.url || `/products/${p.handle}`,
      imagen: p.featured_image?.src || p.featured_image || p.images?.[0]?.src || null,
      // la API AJAX da centavos (número); /products.json da "19.95" (string)
      precio:
        typeof p.price === "number"
          ? (p.price / 100).toFixed(2)
          : p.price ?? p.variants?.[0]?.price ?? ""
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

    grid.innerHTML = productos
      .map(normalizar)
      .map(
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
  }

  // interacción mínima de la galería
  window.cambiarPrincipal = function (mediaId, boton) {
    document.getElementById("imagen-principal").innerHTML = img(mediaId);
    document.querySelectorAll(".hero__mini").forEach((m) => m.classList.remove("activa"));
    boton.classList.add("activa");
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

  function montar(datos) {
    if (EN_TIENDA) document.body.classList.add("publicada");
    const app = document.getElementById("app");
    // El nicho define el color de acento (skin por rubro). Sin dato → general.
    app.dataset.nicho = datos?.global?.nicho || "general";
    // Variante de color elegida por el merchant: pisa el acento del nicho. Sin
    // variante → queda el color del rubro (comportamiento de siempre).
    if (datos?.global?.tema) app.dataset.tema = datos.global.tema;
    else app.removeAttribute("data-tema");
    app.innerHTML = render(datos);
    iniciarVcar(); // centra los carruseles de video
    autoplayMuro(); // los videos del muro se reproducen solos al entrar en vista
    autoplayVS(); // los slides del video slider también auto-reproducen en vista
    iniciarTimers(); // countdown de la barra de oferta (estilo premium)
    // Solo en la tienda: el preview no tiene storefront al que preguntarle.
    if (EN_TIENDA) cargarRecomendados(datos?.fuente?.moneda);
  }

  if (DATOS) {
    // Tienda (TIENDAIQ_DATA) o preview local por archivo (data.js).
    montar(DATOS);
  } else {
    // Preview de la app: el padre manda los datos de SU página por mensaje.
    // Así cada merchant ve la suya y no un data.js global compartido.
    window.addEventListener("message", (e) => {
      if (!e.data || !e.data.tiendaiq) return;
      Object.assign(MAPA_URLS, e.data.urls || {});
      montar(e.data.data);
    });
  }
})();
