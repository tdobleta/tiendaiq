// ============================================================
// TiendaIQ COD — script que corre EN LA TIENDA del merchant.
//
// Lo inyecta snippets/tiendaiq-cod.liquid (que también deja la config en
// window.TIENDAIQ_COD). En una página de producto:
//   1. pone el botón "Comprar contra reembolso" después del form de compra
//      (y una barra adhesiva en móvil, si está activada)
//   2. al tocarlo abre el modal con el formulario configurado por el merchant
//   3. al enviar, POSTea el pedido al server de TiendaIQ, que crea la orden
//      real en Shopify (pago pendiente)
//
// El precio que se muestra acá es informativo: el server recalcula todo
// (precio de variante, oferta de cantidad, tarifa) con la Admin API.
//
// La app del admin carga este mismo archivo para el preview: usa
// window.TiendaIQCOD.armarModal(config, producto, {preview:true}).
// ============================================================

(function () {
  "use strict";

  // ---------- helpers ----------

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  function plata(centavos, moneda) {
    try {
      return new Intl.NumberFormat("es", { style: "currency", currency: moneda || "USD" })
        .format((centavos || 0) / 100);
    } catch {
      return "$" + ((centavos || 0) / 100).toFixed(2);
    }
  }

  const ICONOS = {
    casa: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>`,
    carrito: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.6"/><circle cx="17.5" cy="20" r="1.6"/><path d="M2.5 3.5h3l2.6 12h10.7l2.7-9H6.1"/></svg>`,
    billete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>`,
    camion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h11v11h-11z"/><path d="M13.5 10h4.2l3.3 3.5V17h-7.5"/><circle cx="7" cy="17.8" r="1.8"/><circle cx="17" cy="17.8" r="1.8"/></svg>`,
    persona: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.4-3.2 4.2-5 7.5-5s6.1 1.8 7.5 5"/></svg>`,
    telefono: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5h4l1.5 4.5-2.3 1.8a13 13 0 006 6l1.8-2.3 4.5 1.5v4a1.7 1.7 0 01-1.8 1.7C10 20.2 3.8 14 3.3 5.3A1.7 1.7 0 015 3.5z"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.1-7-11a7 7 0 0114 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>`,
    arroba: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8"/></svg>`,
    nota: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h9"/></svg>`
  };

  const ICONO_CAMPO = {
    nombre: "persona", apellido: "persona", telefono: "telefono",
    direccion: "pin", direccion2: "pin", provincia: "pin",
    ciudad: "pin", codigo_postal: "pin", email: "arroba", nota: "nota"
  };

  // El orden de la columna de campos: claves "c:<campo>" y "e:<elemento>".
  // Si el merchant nunca reordenó, es el orden natural. Se filtra lo que ya
  // no existe y se agrega al final lo nuevo.
  function ordenResuelto(c) {
    const base = (c.campos || []).map((x) => "c:" + x.id).concat((c.elementos || []).map((x) => "e:" + x.id));
    const orden = Array.isArray(c.orden) ? c.orden.filter((k) => base.includes(k)) : [];
    for (const k of base) if (!orden.includes(k)) orden.push(k);
    return orden;
  }

  // ---------- armado del modal ----------

  // config  → la que edita el merchant en la app
  // producto → { titulo, imagen, moneda, variantes:[{id,titulo,precio,disponible}], varianteId }
  // opciones → { preview: true } desactiva el envío real (admin)
  function armarModal(config, producto, opciones = {}) {
    const c = config;
    const preview = !!opciones.preview;

    const variantes = producto.variantes || [];
    const variante =
      variantes.find((v) => String(v.id) === String(producto.varianteId) && v.disponible !== false) ||
      variantes.find((v) => v.disponible !== false) ||
      variantes[0] ||
      { id: null, precio: 0 };

    const estado = {
      cantidad: 1,
      tarifa: (c.tarifas && c.tarifas[0]) || null,
      oferta: null // tier elegido de ofertas de cantidad
    };

    const campoHTML = (x) => {
      if (x.visible === false) return "";
      const icono = ICONOS[ICONO_CAMPO[x.id] || "nota"];
      const req = x.obligatorio ? `<span class="tiq-req">*</span>` : "";
      const ancho = x.id === "nota" ? " tiq-cod-campo--ancho" : "";
      const entrada =
        x.id === "nota"
          ? `<textarea name="${esc(x.id)}" placeholder="${esc(x.etiqueta)}"></textarea>`
          : `<input type="${x.id === "email" ? "email" : x.id === "telefono" ? "tel" : "text"}"
               name="${esc(x.id)}" placeholder="${esc(x.etiqueta)}" autocomplete="${
              { nombre: "given-name", apellido: "family-name", telefono: "tel", direccion: "address-line1",
                direccion2: "address-line2", ciudad: "address-level2", provincia: "address-level1",
                codigo_postal: "postal-code", email: "email" }[x.id] || "on"
            }">`;
      return `
        <div class="tiq-cod-campo${ancho}" data-item="c:${esc(x.id)}" data-campo="${esc(x.id)}" data-obligatorio="${x.obligatorio ? 1 : 0}">
          <label>${esc(x.etiqueta)} ${req}</label>
          <div class="tiq-cod-entrada">${icono}${entrada}</div>
          <span class="tiq-cod-campo__error">Completá este campo</span>
        </div>`;
    };

    // Elementos agregados por el merchant. Todos ocupan el ancho completo.
    const elementoHTML = (el) => {
      const marca = `data-item="e:${esc(el.id)}"`;
      if (el.tipo === "titulo")
        return `<div class="tiq-cod-el tiq-cod-el--titulo tiq-cod-campo--ancho" ${marca}><h3>${esc(el.texto || "Título")}</h3></div>`;
      if (el.tipo === "texto")
        return `<div class="tiq-cod-el tiq-cod-el--texto tiq-cod-campo--ancho" ${marca}><p>${esc(el.texto || "")}</p></div>`;
      if (el.tipo === "imagen")
        return `<div class="tiq-cod-el tiq-cod-el--imagen tiq-cod-campo--ancho" ${marca}>${
          el.url
            ? `<img src="${esc(el.url)}" alt="" style="width:${Math.min(100, Math.max(10, Number(el.tamano) || 100))}%">`
            : `<span class="tiq-cod-el__ph">Imagen sin cargar</span>`
        }</div>`;
      if (el.tipo === "whatsapp") {
        const num = String(el.numero || "").replace(/\D/g, "");
        const mensaje = String(el.mensaje || "").replace("{page_url}", location.href);
        const href = num ? `https://wa.me/${num}${mensaje ? "?text=" + encodeURIComponent(mensaje) : ""}` : "#";
        return `<div class="tiq-cod-el tiq-cod-campo--ancho" ${marca}>
          <a class="tiq-cod-el__wsp" href="${esc(href)}" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5.1-1.3A10 10 0 1012 2zm5.7 14.2c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.1-1.8-.1-.4-.1-.9-.3-1.6-.6-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9s.7-2 .9-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.5c-.1.1-.2.3-.1.5.2.3.8 1.3 1.7 2.1 1.2 1.1 2.2 1.4 2.5 1.5.3.1.5.1.7-.1l.9-1c.2-.2.4-.3.7-.2l2.1.9c.3.1.5.2.6.4 0 .1 0 .5-.2 1.2z"/></svg>
            ${esc(el.texto || "Consultanos por WhatsApp")}
          </a>
        </div>`;
      }
      if (el.tipo === "enlace")
        return `<div class="tiq-cod-el tiq-cod-campo--ancho" ${marca}>
          <a class="tiq-cod-el__enlace" href="${esc(el.url || "#")}" target="_blank" rel="noopener">${esc(el.texto || "Más información")}</a>
        </div>`;
      if (el.tipo === "campo") {
        const req = el.obligatorio ? `<span class="tiq-req">*</span>` : "";
        return `
        <div class="tiq-cod-campo tiq-cod-campo--ancho" ${marca} data-campo="x:${esc(el.id)}" data-obligatorio="${el.obligatorio ? 1 : 0}">
          <label>${esc(el.etiqueta || "Campo")} ${req}</label>
          <div class="tiq-cod-entrada">${ICONOS.nota}<input type="text" name="x_${esc(el.id)}" placeholder="${esc(el.etiqueta || "")}"></div>
          <span class="tiq-cod-campo__error">Completá este campo</span>
        </div>`;
      }
      if (el.tipo === "desplegable" || el.tipo === "fecha") {
        const req = el.obligatorio ? `<span class="tiq-req">*</span>` : "";
        const entrada =
          el.tipo === "fecha"
            ? `<input type="date" name="x_${esc(el.id)}">`
            : `<select name="x_${esc(el.id)}">
                 <option value="">${esc(el.etiqueta || "Elegí una opción")}</option>
                 ${(el.opciones || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
               </select>`;
        return `
        <div class="tiq-cod-campo tiq-cod-campo--ancho" ${marca} data-campo="x:${esc(el.id)}" data-obligatorio="${el.obligatorio ? 1 : 0}">
          <label>${esc(el.etiqueta || "Campo")} ${req}</label>
          <div class="tiq-cod-entrada">${ICONOS.nota}${entrada}</div>
          <span class="tiq-cod-campo__error">Completá este campo</span>
        </div>`;
      }
      if (el.tipo === "seleccion") {
        const req = el.obligatorio ? `<span class="tiq-req">*</span>` : "";
        return `
        <div class="tiq-cod-campo tiq-cod-campo--ancho" ${marca} data-campo="x:${esc(el.id)}" data-obligatorio="${el.obligatorio ? 1 : 0}">
          <label>${esc(el.etiqueta || "Elegí una opción")} ${req}</label>
          <div class="tiq-cod-radios">
            ${(el.opciones || [])
              .map(
                (o, j) => `<label class="tiq-cod-radio"><input type="radio" name="x_${esc(el.id)}" value="${esc(o)}" ${j === 0 ? "checked" : ""}> ${esc(o)}</label>`
              )
              .join("")}
          </div>
          <span class="tiq-cod-campo__error">Elegí una opción</span>
        </div>`;
      }
      if (el.tipo === "casilla") {
        const req = el.obligatorio ? `<span class="tiq-req">*</span>` : "";
        return `
        <div class="tiq-cod-campo tiq-cod-campo--ancho" ${marca} data-campo="x:${esc(el.id)}" data-obligatorio="${el.obligatorio ? 1 : 0}">
          ${el.etiqueta ? `<label>${esc(el.etiqueta)} ${req}</label>` : ""}
          <label class="tiq-cod-check"><input type="checkbox" name="x_${esc(el.id)}" data-si="${esc(el.texto_casilla || "Sí")}"> ${esc(el.texto_casilla || "Casilla de selección")}</label>
          <span class="tiq-cod-campo__error">Marcá esta casilla</span>
        </div>`;
      }
      if (el.tipo === "cantidad") {
        // Con ofertas de cantidad activas el selector sobra: mandan los tiers.
        if (tiers.length) return "";
        return `
        <div class="tiq-cod-el tiq-cod-el--cantidad tiq-cod-campo--ancho" ${marca}>
          <label>${esc(el.etiqueta || "Cantidad")}</label>
          <span class="tiq-cod-cant tiq-cod-cant--grande">
            <button type="button" data-cant="-1">−</button>
            <span data-zona="cantidad">1</span>
            <button type="button" data-cant="1">+</button>
          </span>
        </div>`;
      }
      if (el.tipo === "timer") {
        return `
        <div class="tiq-cod-el tiq-cod-el--timer tiq-cod-campo--ancho" ${marca} data-timer="${Math.max(1, Number(el.minutos) || 10)}">
          <span>⏰ ${esc(el.texto || "Oferta especial: tu pedido queda reservado por")}</span>
          <span class="tiq-cod-el__timer-reloj">${String(Math.max(1, Number(el.minutos) || 10)).padStart(2, "0")}:00</span>
        </div>`;
      }
      if (el.tipo === "pago_shopify") {
        return `
        <div class="tiq-cod-el tiq-cod-campo--ancho" ${marca}>
          <button type="button" class="tiq-cod-el__pago" data-pago-shopify="1">
            ${esc(el.texto || "Pagar con tarjeta")}
            ${el.subtitulo ? `<span class="tiq-cod-el__pago-sub">${esc(el.subtitulo)}</span>` : ""}
          </button>
        </div>`;
      }
      return "";
    };

    // Ofertas de cantidad: tarjetas con precio final, precio tachado, ahorro
    // por unidad y cinta de "más popular". Los números salen del precio de la
    // variante (solo para mostrar: el server recalcula todo al comprar).
    const tiers = c.ofertas?.activo ? c.ofertas.tiers || [] : [];
    const tierHTML = (t, i) => {
      const cant = Math.max(1, Number(t.cantidad) || 1);
      const desc = Number(t.descuento) || 0;
      const unitario = Math.round(variante.precio * (1 - desc / 100));
      const total = unitario * cant;
      const lleno = variante.precio * cant;
      const nombre = t.etiqueta || `${cant} unidad${cant > 1 ? "es" : ""}`;
      return `
        <label class="tiq-cod-oferta${i === 0 ? " tiq-cod-oferta--activa" : ""}${t.popular ? " tiq-cod-oferta--popular" : ""}">
          ${t.popular ? `<span class="tiq-cod-oferta__cinta">${esc(c.textos?.popular || "Más popular")}</span>` : ""}
          <input type="radio" name="tiq-oferta" value="${i}" ${i === 0 ? "checked" : ""}>
          <span class="tiq-cod-oferta__info">
            <span class="tiq-cod-oferta__nombre">${esc(nombre)}${desc ? ` <span class="tiq-cod-oferta__chip">-${esc(desc)}%</span>` : ""}</span>
            ${desc ? `<span class="tiq-cod-oferta__detalle">${plata(unitario, producto.moneda)} c/u · ${esc(c.textos?.ahorras || "ahorrás")} ${plata(lleno - total, producto.moneda)}</span>` : ""}
          </span>
          <span class="tiq-cod-oferta__precios">
            <span class="tiq-cod-oferta__precio">${plata(total, producto.moneda)}</span>
            ${desc ? `<span class="tiq-cod-oferta__tachado">${plata(lleno, producto.moneda)}</span>` : ""}
          </span>
        </label>`;
    };
    const ofertasHTML = tiers.length
      ? `<div class="tiq-cod-ofertas" data-zona="ofertas">${tiers.map(tierHTML).join("")}</div>`
      : "";

    // El cuerpo de campos se arma acá (después de `tiers`: el elemento
    // "selector de cantidad" necesita saber si hay ofertas activas).
    const mapaCampos = Object.fromEntries((c.campos || []).map((x) => [x.id, x]));
    const mapaElementos = Object.fromEntries((c.elementos || []).map((x) => [x.id, x]));
    const cuerpoCampos = ordenResuelto(c)
      .map((k) => {
        if (k.startsWith("c:")) return mapaCampos[k.slice(2)] ? campoHTML(mapaCampos[k.slice(2)]) : "";
        return mapaElementos[k.slice(2)] ? elementoHTML(mapaElementos[k.slice(2)]) : "";
      })
      .join("");

    const tarifasHTML = (c.tarifas || []).length
      ? `<div class="tiq-cod-envio" data-zona="tarifas">
          ${c.tarifas
            .map(
              (t, i) => `
              <label class="tiq-cod-envio__opcion${i === 0 ? " tiq-cod-envio__opcion--activa" : ""}">
                <input type="radio" name="tiq-tarifa" value="${esc(t.id)}" ${i === 0 ? "checked" : ""}>
                <span class="tiq-cod-envio__nombre">${esc(t.nombre)}</span>
                <span>${t.precio > 0 ? plata(Math.round(t.precio * 100), producto.moneda) : esc(c.textos?.gratis || "Gratis")}</span>
              </label>`
            )
            .join("")}
        </div>`
      : "";

    const checksHTML =
      (c.extras?.boletin ? `<label class="tiq-cod-check"><input type="checkbox" name="boletin">${esc(c.textos?.boletin || "Suscribite a nuestro boletín")}</label>` : "") +
      (c.extras?.terminos
        ? `<label class="tiq-cod-check"><input type="checkbox" name="terminos">
             <span>${esc(c.textos?.terminos || "Acepto los")} <a href="${esc(c.extras.terminos_url || "#")}" target="_blank">${esc(c.textos?.terminos_link || "términos y condiciones")}</a></span>
           </label>`
        : "");

    const capa = document.createElement("div");
    capa.id = "tiq-cod-modal";
    capa.style.cssText = variablesForm(c);
    capa.innerHTML = `
      <div class="tiq-cod-caja" role="dialog" aria-modal="true">
        <div class="tiq-cod-cab">
          <span class="tiq-cod-cab__icono">${ICONOS.casa}</span>
          <h2 class="tiq-cod-cab__titulo">${esc(c.textos?.titulo || "Pago contra reembolso")}</h2>
          <button class="tiq-cod-cerrar" type="button" aria-label="Cerrar">×</button>
        </div>

        <form class="tiq-cod-form" novalidate>
          <div class="tiq-cod-cuerpo">
            <div>
              <p class="tiq-cod-sub">${esc(c.textos?.subtitulo || "Ingresá tus datos de envío")}</p>
              <div class="tiq-cod-campos">${cuerpoCampos}</div>
              <div class="tiq-cod-checks">${checksHTML}</div>
              <input class="tiq-cod-hp" type="text" name="sitio_web" tabindex="-1" autocomplete="off">
            </div>

            <div class="tiq-cod-resumen">
              <div class="tiq-cod-prod">
                ${producto.imagen ? `<img class="tiq-cod-prod__foto" src="${esc(producto.imagen)}" alt="">` : `<span class="tiq-cod-prod__foto"></span>`}
                <div class="tiq-cod-prod__info">
                  <p class="tiq-cod-prod__titulo">${esc(producto.titulo || "")}</p>
                  <span class="tiq-cod-prod__precio" data-zona="precio-unitario"></span>
                </div>
                ${tiers.length ? "" : `
                  <span class="tiq-cod-cant">
                    <button type="button" data-cant="-1">−</button>
                    <span data-zona="cantidad">1</span>
                    <button type="button" data-cant="1">+</button>
                  </span>`}
              </div>

              ${ofertasHTML}

              <div class="tiq-cod-caja-gris">
                <div class="tiq-cod-linea"><span>${esc(c.textos?.subtotal || "Subtotal")}</span><span data-zona="subtotal"></span></div>
                ${tarifasHTML}
                <div class="tiq-cod-linea tiq-cod-linea--total"><span>${esc(c.textos?.total || "Total")}</span><span data-zona="total"></span></div>
              </div>

              <div class="tiq-cod-error-envio" data-zona="error"></div>
              <button class="tiq-cod-enviar" type="submit" style="${variablesBoton(c)}" data-zona="cta"></button>
            </div>
          </div>
        </form>
      </div>`;

    // ---- lógica de totales ----

    const q = (sel) => capa.querySelector(sel);
    if (tiers.length) estado.oferta = tiers[0];

    function totales() {
      const cant = estado.oferta ? estado.oferta.cantidad : estado.cantidad;
      const desc = estado.oferta?.descuento || 0;
      const unitario = Math.round(variante.precio * (1 - desc / 100));
      const subtotal = unitario * cant;
      const envio = Math.round((estado.tarifa?.precio || 0) * 100);
      return { cant, unitario, subtotal, envio, total: subtotal + envio };
    }

    // El valor de un campo, sea cual sea su tipo de entrada.
    function valorDe(div) {
      const radio = div.querySelector('input[type="radio"]:checked');
      if (radio) return radio.value;
      const chk = div.querySelector('input[type="checkbox"]');
      if (chk) return chk.checked ? chk.dataset.si || "Sí" : "";
      const e = div.querySelector("input,textarea,select");
      return e ? e.value.trim() : "";
    }

    function repintar() {
      const t = totales();
      q('[data-zona="precio-unitario"]').textContent =
        plata(t.unitario, producto.moneda) + (t.cant > 1 ? ` × ${t.cant}` : "");
      capa.querySelectorAll('[data-zona="cantidad"]').forEach((z) => (z.textContent = t.cant));
      q('[data-zona="subtotal"]').textContent = plata(t.subtotal, producto.moneda);
      q('[data-zona="total"]').textContent = plata(t.total, producto.moneda);
      q('[data-zona="cta"]').textContent = (c.textos?.cta || "Completá tu compra — {total}")
        .replace("{total}", plata(t.total, producto.moneda));
    }

    capa.addEventListener("click", (e) => {
      if (e.target === capa || e.target.closest(".tiq-cod-cerrar")) cerrar();
      const btnCant = e.target.closest("[data-cant]");
      if (btnCant) {
        estado.cantidad = Math.min(10, Math.max(1, estado.cantidad + Number(btnCant.dataset.cant)));
        repintar();
      }
      // Botón de pago de Shopify: permalink de carrito → directo al checkout.
      if (e.target.closest("[data-pago-shopify]")) {
        if (preview) {
          const zonaError = q('[data-zona="error"]');
          zonaError.style.display = "block";
          zonaError.style.background = "#eef4ff";
          zonaError.style.color = "#1d4ed8";
          zonaError.textContent = "Vista previa: este botón lleva al checkout normal de Shopify.";
          return;
        }
        const idNum = String(variante.id).replace(/\D/g, "");
        location.href = `/cart/${idNum}:${totales().cant}`;
      }
    });

    // Timers de urgencia: cuentan para atrás en vivo mientras el modal viva.
    capa.querySelectorAll("[data-timer]").forEach((el) => {
      let seg = Math.max(1, Number(el.dataset.timer) || 10) * 60;
      const reloj = el.querySelector(".tiq-cod-el__timer-reloj");
      const tick = setInterval(() => {
        if (!capa.isConnected) return clearInterval(tick);
        seg = Math.max(0, seg - 1);
        reloj.textContent = `${String(Math.floor(seg / 60)).padStart(2, "0")}:${String(seg % 60).padStart(2, "0")}`;
      }, 1000);
    });

    capa.addEventListener("change", (e) => {
      if (e.target.name === "tiq-tarifa") {
        estado.tarifa = (c.tarifas || []).find((t) => t.id === e.target.value) || null;
        capa.querySelectorAll(".tiq-cod-envio__opcion").forEach((o) =>
          o.classList.toggle("tiq-cod-envio__opcion--activa", o.contains(e.target))
        );
        repintar();
      }
      if (e.target.name === "tiq-oferta") {
        estado.oferta = tiers[Number(e.target.value)] || null;
        capa.querySelectorAll(".tiq-cod-oferta").forEach((o) =>
          o.classList.toggle("tiq-cod-oferta--activa", o.contains(e.target))
        );
        repintar();
      }
    });

    function cerrar() {
      capa.remove();
      document.documentElement.style.overflow = "";
    }

    // ---- validación + envío ----

    q("form").addEventListener("submit", async (e) => {
      e.preventDefault();

      let valido = true;
      capa.querySelectorAll("[data-campo]").forEach((div) => {
        const malo = div.dataset.obligatorio === "1" && !valorDe(div);
        div.classList.toggle("tiq-cod-campo--invalido", malo);
        if (malo) valido = false;
      });
      const terminos = q('input[name="terminos"]');
      const zonaError = q('[data-zona="error"]');
      zonaError.style.display = "none";
      if (terminos && !terminos.checked) {
        zonaError.textContent = c.textos?.error_terminos || "Tenés que aceptar los términos y condiciones.";
        zonaError.style.display = "block";
        valido = false;
      }
      if (!valido) return;

      if (preview) {
        zonaError.style.display = "block";
        zonaError.style.background = "#eef4ff";
        zonaError.style.color = "#1d4ed8";
        zonaError.textContent = "Vista previa: acá se crearía el pedido real en tu tienda.";
        return;
      }

      const datos = {};
      const datosExtra = {};
      capa.querySelectorAll("[data-campo]").forEach((div) => {
        const valor = valorDe(div);
        if (div.dataset.campo.startsWith("x:")) datosExtra[div.dataset.campo.slice(2)] = valor;
        else datos[div.dataset.campo] = valor;
      });

      const t = totales();
      const cta = q('[data-zona="cta"]');
      cta.disabled = true;
      const textoCTA = cta.textContent;
      cta.textContent = c.textos?.enviando || "Enviando tu pedido…";

      try {
        const r = await fetch(`${c.app_url}/cod/pedido`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tienda: c.tienda,
            variante_id: variante.id,
            cantidad: t.cant,
            oferta: estado.oferta ? tiers.indexOf(estado.oferta) : null,
            tarifa_id: estado.tarifa?.id || null,
            campos: datos,
            extras: datosExtra,
            boletin: !!q('input[name="boletin"]')?.checked,
            hp: q('input[name="sitio_web"]').value
          })
        });
        const cuerpo = await r.json().catch(() => ({}));
        if (!r.ok || !cuerpo.ok) throw new Error(cuerpo.error || "No se pudo crear el pedido.");

        q(".tiq-cod-form").innerHTML = `
          <div class="tiq-cod-exito">
            <div class="tiq-cod-exito__tilde">✓</div>
            <h3>${esc(c.textos?.exito_titulo || "¡Pedido confirmado!")}</h3>
            <p>${esc(c.textos?.exito_texto || "Te vamos a contactar para coordinar la entrega. Pagás al recibirlo.")}</p>
            ${cuerpo.orden ? `<p>Tu pedido: <span class="tiq-cod-exito__orden">${esc(cuerpo.orden)}</span></p>` : ""}
            <button type="button" class="tiq-cod-cerrar-exito">${esc(c.textos?.exito_boton || "Seguir comprando")}</button>
          </div>`;
        q(".tiq-cod-cerrar-exito").onclick = cerrar;
      } catch (err) {
        cta.disabled = false;
        cta.textContent = textoCTA;
        zonaError.textContent = err.message;
        zonaError.style.display = "block";
      }
    });

    repintar();
    return capa;
  }

  // ---------- estilos desde la config ----------

  function variablesBoton(c) {
    const b = c.boton || {};
    return (
      `--tiq-fondo:${b.color_fondo || "#000"};` +
      `--tiq-texto:${b.color_texto || "#fff"};` +
      `--tiq-radio:${b.radio ?? 6}px;` +
      `--tiq-tam:${b.tamano ?? 16}px;` +
      `--tiq-borde-ancho:${b.borde_ancho ?? 0}px;` +
      `--tiq-borde-color:${b.borde_color || b.color_fondo || "#000"};` +
      `--tiq-sombra:${b.sombra ? `0 ${b.sombra}px ${b.sombra * 2}px rgba(0,0,0,.25)` : "none"};`
    );
  }

  function variablesForm(c) {
    const f = c.formulario || {};
    return (
      `--tiq-form-fondo:${f.fondo || "#fff"};` +
      `--tiq-form-texto:${f.texto || "#111"};` +
      `--tiq-form-radio:${f.radio ?? 14}px;` +
      `--tiq-form-borde-ancho:${f.borde_ancho ?? 0}px;` +
      `--tiq-form-borde-color:${f.borde_color || "#000"};` +
      `--tiq-campo-fondo:${f.campo_fondo || "#fff"};` +
      `--tiq-campo-texto:${f.campo_texto || "#111"};` +
      `--tiq-campo-borde:${f.campo_borde || "#cbcbcb"};` +
      `--tiq-campo-radio:${f.campo_radio ?? 8}px;`
    );
  }

  function armarBoton(c) {
    const b = c.boton || {};
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className =
      "tiq-cod-boton" +
      (b.animacion === "latido" ? " tiq-cod-boton--latido" : "") +
      (b.animacion === "sacudida" ? " tiq-cod-boton--sacudida" : "");
    boton.style.cssText = variablesBoton(c);
    boton.innerHTML = `
      <span class="tiq-cod-boton__fila">
        ${b.icono === "ninguno" ? "" : `<span class="tiq-cod-boton__icono">${ICONOS[b.icono] || ICONOS.carrito}</span>`}
        <span>${esc(b.texto || "Comprar contra reembolso")}</span>
      </span>
      ${b.subtitulo ? `<span class="tiq-cod-boton__sub">${esc(b.subtitulo)}</span>` : ""}`;
    return boton;
  }

  // ---------- integración con la tienda ----------

  async function leerProducto() {
    // Se conserva el prefijo de idioma (/es/products/...) si el tema lo usa.
    const m = location.pathname.match(/^(.*\/products\/[^/?#]+)/);
    if (!m) return null;
    try {
      const r = await fetch(`${m[1]}.js`);
      if (!r.ok) return null;
      const p = await r.json();
      return {
        titulo: p.title,
        imagen: p.featured_image || (p.images && p.images[0]) || null,
        moneda: (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || null,
        variantes: (p.variants || []).map((v) => ({
          id: v.id, titulo: v.title, precio: v.price, disponible: v.available
        }))
      };
    } catch {
      return null;
    }
  }

  // La variante elegida en el tema: el input name="id" del form de compra.
  function varianteElegida() {
    const input = document.querySelector('form[action*="/cart/add"] [name="id"]');
    return input ? input.value : null;
  }

  // Algunos temas (y nuestras propias landings TiendaIQ) arman el form de
  // compra con JS después del load: se espera hasta 6 segundos antes de caer
  // al final de la página.
  function esperarFormCompra(intentos = 20) {
    return new Promise((resolver) => {
      const buscar = (n) => {
        const f = document.querySelector('form[action*="/cart/add"]');
        if (f || n <= 0) return resolver(f || null);
        setTimeout(() => buscar(n - 1), 300);
      };
      buscar(intentos);
    });
  }

  async function iniciar() {
    const c = window.TIENDAIQ_COD;
    if (!c || !c.activo) return;
    if (document.querySelector(".tiq-cod-boton")) return; // ya montado

    const producto = await leerProducto();
    if (!producto || !producto.variantes.length) return;
    if (!producto.moneda) producto.moneda = c.moneda || "USD";

    function abrir() {
      producto.varianteId = varianteElegida();
      document.body.appendChild(armarModal(c, producto));
      document.documentElement.style.overflow = "hidden";
    }

    // Botón principal, después del formulario de compra del tema.
    const formCompra = await esperarFormCompra();
    if (document.querySelector(".tiq-cod-boton")) return; // otro llamado ganó la carrera
    const boton = armarBoton(c);
    boton.addEventListener("click", abrir);
    if (formCompra) formCompra.insertAdjacentElement("afterend", boton);
    else document.querySelector("main, #MainContent, body").appendChild(boton);

    // Barra adhesiva en móvil.
    if (c.boton?.sticky !== false) {
      const sticky = document.createElement("div");
      sticky.className = "tiq-cod-sticky tiq-cod-sticky--activa";
      const botonSticky = armarBoton(c);
      botonSticky.addEventListener("click", abrir);
      sticky.appendChild(botonSticky);
      document.body.appendChild(sticky);
    }
  }

  // API para el preview de la app del admin.
  window.TiendaIQCOD = { armarModal, armarBoton, ordenResuelto };

  // Config EMBEBIDA (window.TIENDAIQ_COD, inyección directa) o traída por FETCH
  // (app embed del theme app extension, que solo deja window.TIENDAIQ_COD_SRC).
  function correr() {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
  }
  if (window.TIENDAIQ_COD) {
    correr();
  } else if (window.TIENDAIQ_COD_SRC) {
    fetch(window.TIENDAIQ_COD_SRC, { credentials: "omit" })
      .then(function (r) { return r.json(); })
      .then(function (cfg) { window.TIENDAIQ_COD = cfg; correr(); })
      .catch(function (e) { if (window.console) console.warn("[TiendaIQ COD] config", e); });
  }
})();
