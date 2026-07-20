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

    const bullets = (h.bullets ?? [])
      .map((b) => `<li><span class="tick">${ICONO.tick}</span>${esc(b)}</li>`)
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
            <div class="hero__resenas">${estrellas(5)} <span>${esc(h.resenas_count)} reseñas</span></div>
            <h1 class="hero__titulo">${esc(h.titulo)}</h1>
            <div class="hero__precios">
              <span class="hero__precio">${esc(precioBonito(fuente.moneda, fuente.precio))}</span>
              ${comparativo}
            </div>
            <p class="hero__impuestos">Impuestos incluidos.</p>
            <p class="hero__subtitulo">${esc(h.subtitulo)}</p>
            <ul class="hero__bullets">${bullets}</ul>
            <div class="hero__cantidad">
              <label>Cantidad</label>
              <div class="selector-cantidad">
                <button type="button" onclick="tiendaiqCantidad(-1)">−</button><input id="tiendaiq-cantidad" value="1" readonly><button type="button" onclick="tiendaiqCantidad(1)">+</button>
              </div>
            </div>
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
            ${f.cta ? cta(global) : ""}
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

  function faq(f, global) {
    const items = (f.items ?? [])
      .map(
        (q) => `
        <details class="faq__item">
          <summary>${esc(q.pregunta)}</summary>
          <p>${esc(q.respuesta)}</p>
        </details>`
      )
      .join("");

    return `
    <section class="faq">
      <div class="contenedor">
        <div class="faq__cabecera">
          <h2>${esc(f.titular)}</h2>
          <p>${esc(f.subtitulo)}</p>
        </div>
        <div class="faq__lista">${items}</div>
        ${ctaCentro(f, global)}
      </div>
    </section>`;
  }

  function garantia(f, global) {
    return `
    <section class="garantia">
      <div class="contenedor">
        <div class="garantia__icono">📜</div>
        <h2>${esc(f.titular)}</h2>
        <p>${esc(f.parrafo)}</p>
        ${ctaCentro(f, global)}
      </div>
    </section>`;
  }

  function resenas(f) {
    // El muro se muestra siempre, con andamio incluido — igual que PagePilot.
    // El dueño reemplaza las tarjetas guía por reseñas reales desde el editor.
    const items = f.items ?? [];

    const tarjeta = (r) => {
      const modoGuia = !r.autor && !r.imagen; // sin datos reales → tarjeta punteada
      return `
      <div class="tarjeta-resena ${modoGuia ? "tarjeta-resena--vacia" : ""}">
        <div class="tarjeta-resena__img">${r.imagen ? img(r.imagen) : `<div class="ph-img">Foto del cliente</div>`}</div>
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

  const carruselMarco = (clase, cuerpo) => `
        <div class="tiq-carrusel">
          <button class="tiq-carrusel__flecha tiq-carrusel__flecha--izq" type="button" onclick="tiqCarrusel(this,-1)" aria-label="Anterior">${FLECHA_IZQ}</button>
          <div class="tiq-carrusel__track ${clase}">${cuerpo}</div>
          <button class="tiq-carrusel__flecha tiq-carrusel__flecha--der" type="button" onclick="tiqCarrusel(this,1)" aria-label="Siguiente">${FLECHA_DER}</button>
        </div>`;

  function seccionVideos(s) {
    const items = (s.items || []).filter((i) => i.url);
    const cuerpo = items.length
      ? items
          .map(
            (i) => `
          <div class="tiq-video" data-embed="${esc(videoEmbed(i.url))}">
            <div class="tiq-video__poster" onclick="tiqVideoPlay(this)">
              ${posterVideo(i)}
              <button class="tiq-video__play" type="button" aria-label="Reproducir">${PLAY}</button>
            </div>
          </div>`
          )
          .join("")
      : `<div class="tiq-sec__vacio">Tocá <b>Editar</b> y pegá los enlaces de tus videos (YouTube, Vimeo o MP4).</div>`;
    return `
    <section class="tiq-sec tiq-sec--videos" data-seccion="${esc(s.id)}">
      <div class="contenedor">
        ${s.titulo ? `<h2 class="tiq-sec__titulo">${esc(s.titulo)}</h2>` : ""}
        ${carruselMarco("tiq-carrusel__track--videos", cuerpo)}
      </div>
    </section>`;
  }

  function seccionCarrusel(s) {
    const items = (s.items || []).filter((i) => i.media_id || i.url);
    const cuerpo = items.length
      ? items
          .map((i) => {
            const src = i.url ? i.url : urlImagen(i.media_id);
            const inner = `<img src="${esc(src)}" alt="${esc(i.caption || "")}" loading="lazy">${
              i.caption ? `<span class="tiq-imagen__caption">${esc(i.caption)}</span>` : ""
            }`;
            return i.link
              ? `<a class="tiq-imagen" href="${esc(i.link)}" target="_blank" rel="noopener">${inner}</a>`
              : `<div class="tiq-imagen">${inner}</div>`;
          })
          .join("")
      : `<div class="tiq-sec__vacio">Tocá <b>Editar</b> y sumá imágenes de tu producto o subí las tuyas.</div>`;
    return `
    <section class="tiq-sec tiq-sec--carrusel" data-seccion="${esc(s.id)}">
      <div class="contenedor">
        ${s.titulo ? `<h2 class="tiq-sec__titulo">${esc(s.titulo)}</h2>` : ""}
        ${carruselMarco("tiq-carrusel__track--imagenes", cuerpo)}
      </div>
    </section>`;
  }

  function seccionHTML(s) {
    if (s.tipo === "videos") return seccionVideos(s);
    if (s.tipo === "carrusel") return seccionCarrusel(s);
    return "";
  }

  window.tiqCarrusel = function (boton, dir) {
    const track = boton.parentElement.querySelector(".tiq-carrusel__track");
    if (!track) return;
    const card = track.querySelector(":scope > *");
    const paso = card ? card.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
    track.scrollBy({ left: dir * paso, behavior: "smooth" });
  };

  window.tiqVideoPlay = function (el) {
    const cont = el.closest(".tiq-video");
    if (cont && cont.dataset.embed) {
      cont.classList.add("tiq-video--play");
      cont.innerHTML = cont.dataset.embed;
    }
  };

  // ---------- ensamblado ----------

  function render(data) {
    const f = data.facetas;
    const g = data.global;
    // Bloques fijos, cada uno con su id: las sections del merchant se
    // intercalan según su `ancla` (= id del bloque tras el cual va).
    const fijos = [
      ["hero", hero(f, data.fuente, g)],
      ["texto1", dupla(f.texto_img_1, g, false)],
      ["iconos", iconos(f.iconos)],
      ["tabla", tabla(f.tabla, f.hero.titulo, g)],
      ["stats", stats(f.stats, g)],
      ["texto2", dupla(f.texto_img_2, g, true)],
      ["faq", faq(f.faq, g)],
      ["garantia", garantia(f.garantia, g)],
      ["resenas", resenas(f.resenas)],
      ["recomendados", recomendados(f.recomendados)]
    ];
    // Marca cada bloque fijo para que el editor sepa dónde soltar sections.
    const marcar = (id, html) => html.replace(/<section/, `<section data-bloque="${id}" data-fijo="1"`);

    const secciones = Array.isArray(data.secciones) ? data.secciones : [];
    const grupos = {};
    for (const s of secciones) (grupos[s.ancla || "top"] ||= []).push(seccionHTML(s));

    const out = [];
    if (grupos.top) out.push(...grupos.top);
    for (const [id, html] of fijos) {
      out.push(marcar(id, html));
      if (grupos[id]) out.push(...grupos[id]);
    }
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

  // selector de cantidad: 1 a 99, y mantiene sincronizado el hidden del form
  window.tiendaiqCantidad = function (delta) {
    const visible = document.getElementById("tiendaiq-cantidad");
    if (!visible) return;
    const valor = Math.min(99, Math.max(1, (parseInt(visible.value, 10) || 1) + delta));
    visible.value = valor;
    const oculto = document.getElementById("tiendaiq-cantidad-form");
    if (oculto) oculto.value = valor;
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
    document.getElementById("app").innerHTML = render(datos);
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
