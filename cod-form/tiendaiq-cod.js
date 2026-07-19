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

    const campos = (c.campos || []).filter((x) => x.visible !== false);

    const campoHTML = (x) => {
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
        <div class="tiq-cod-campo${ancho}" data-campo="${esc(x.id)}" data-obligatorio="${x.obligatorio ? 1 : 0}">
          <label>${esc(x.etiqueta)} ${req}</label>
          <div class="tiq-cod-entrada">${icono}${entrada}</div>
          <span class="tiq-cod-campo__error">Completá este campo</span>
        </div>`;
    };

    const tiers = c.ofertas?.activo ? c.ofertas.tiers || [] : [];
    const ofertasHTML = tiers.length
      ? `<div class="tiq-cod-ofertas" data-zona="ofertas">
          ${tiers
            .map(
              (t, i) => `
              <label class="tiq-cod-oferta${i === 0 ? " tiq-cod-oferta--activa" : ""}">
                <input type="radio" name="tiq-oferta" value="${i}" ${i === 0 ? "checked" : ""}>
                <span class="tiq-cod-oferta__nombre">${esc(t.etiqueta || `${t.cantidad} unidad${t.cantidad > 1 ? "es" : ""}`)}</span>
                ${t.descuento ? `<span class="tiq-cod-oferta__chip">-${esc(t.descuento)}%</span>` : ""}
              </label>`
            )
            .join("")}
        </div>`
      : "";

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
              <div class="tiq-cod-campos">${campos.map(campoHTML).join("")}</div>
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

    function repintar() {
      const t = totales();
      q('[data-zona="precio-unitario"]').textContent =
        plata(t.unitario, producto.moneda) + (t.cant > 1 ? ` × ${t.cant}` : "");
      const zc = q('[data-zona="cantidad"]');
      if (zc) zc.textContent = t.cant;
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
        const entrada = div.querySelector("input,textarea,select");
        const malo = div.dataset.obligatorio === "1" && !entrada.value.trim();
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
      capa.querySelectorAll("[data-campo]").forEach((div) => {
        datos[div.dataset.campo] = div.querySelector("input,textarea,select").value.trim();
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
  window.TiendaIQCOD = { armarModal, armarBoton };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
