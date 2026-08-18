// ============================================================
// TiendaIQ — el frontend.
//
// Tres pantallas, el flujo tal cual:
//   1. lista        elegir un producto de tu tienda
//   2. informacion  ángulo + idioma + medios  → "Crear página con IA"
//   3. preview      la página + "Publicar"
//
// Todo el trabajo real ocurre en el server; acá solo hay pantallas.
// ============================================================

(function () {
  "use strict";


  const $ = (id) => document.getElementById(id);
  const vista = $("vista");

  // Embebida = corriendo adentro del iframe del admin de Shopify.
  // Ahí el header y el ancho los pone Shopify, así que los nuestros sobran.
  const EMBEBIDA = window.top !== window.self;
  if (EMBEBIDA) document.body.classList.add("embebida");

  const estado = {
    pantalla: "inicio",
    productos: [],
    paginas: [], // resumen de páginas para el inicio y la tabla
    plan: null,
    filtro: "",
    filtroEstado: "todos", // segmento del picker: todos | sin | publicada | borrador
    producto: null, // el elegido
    pagina: null, // el registro que devuelve el server
    volverA: "lista", // desde dónde se abrió el editor: "lista" o "paginas"
    bundles: null, // { config, vista, editIdx, tab, sucio } de la pantalla Bundles
    seccionesElegidas: [], // tipos mandados desde la galería a la columna "Secciones"
    galeriaCat: "popular", // pestaña activa de la galería de secciones
    galeriaQ: "", // búsqueda de la galería
    error: null
  };
  // Chips de la columna sobreviven recargas del editor.
  try { estado.seccionesElegidas = JSON.parse(localStorage.getItem("tiq_sec_chips") || "[]"); } catch {}

  // ---------- api ----------

  // El pase de sesión: App Bridge lo firma y dice "soy la tienda tal".
  // Vence a los pocos minutos, así que se pide fresco en cada llamada.
  // Fuera del iframe del admin no hay App Bridge: en modo dev el server usa
  // la tienda del .env, así que las llamadas van sin pase.
  async function pase() {
    if (window.shopify?.idToken) return await window.shopify.idToken();
    return null;
  }

  async function api(ruta, opciones = {}) {
    const p = await pase();
    const headers = { "Content-Type": "application/json" };
    if (p) headers.Authorization = `Bearer ${p}`;
    const r = await fetch(`/api${ruta}`, {
      ...opciones,
      headers,
      body: opciones.body ? JSON.stringify(opciones.body) : undefined
    });
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(cuerpo.error || `Error ${r.status}`);
      e.status = r.status;
      e.reinstalar = cuerpo.reinstalar;
      e.actualizar = cuerpo.actualizar || r.status === 402;
      if (e.reinstalar) {
        e.message = "Volvé a abrir TiendaIQ desde Apps en Shopify Admin para autorizarla.";
      }
      throw e;
    }
    return cuerpo;
  }

  async function esperarJob(id, { timeoutMs = 180000, onUpdate = () => {} } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { job } = await api(`/jobs/${id}`);
      onUpdate(job);
      if (job.status === "succeeded") return job;
      if (job.status === "failed" || job.status === "cancelled") {
        const error = new Error(job.lastError || "La operación no pudo completarse.");
        error.terminal = true;
        error.job = job;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("La operación continúa en segundo plano. Podés volver a esta página en unos minutos.");
  }

  const SUSCRIPCION_PENDIENTE = `tiq_suscripcion_pendiente:${(
    new URLSearchParams(location.search).get("shop") || "local"
  ).toLowerCase()}`;
  let suscripcionEnCurso = null;

  function leerSuscripcionPendiente() {
    try {
      const pending = JSON.parse(localStorage.getItem(SUSCRIPCION_PENDIENTE) || "null");
      return pending?.requestId ? pending : null;
    } catch {
      return null;
    }
  }

  function guardarSuscripcionPendiente(pending) {
    localStorage.setItem(SUSCRIPCION_PENDIENTE, JSON.stringify(pending));
  }

  function limpiarSuscripcionPendiente() {
    localStorage.removeItem(SUSCRIPCION_PENDIENTE);
  }

  // Cupo agotado: crear una intencion durable antes de redirigir a Shopify.
  async function irASuscripcion() {
    if (suscripcionEnCurso) return suscripcionEnCurso;
    suscripcionEnCurso = (async () => {
      let pending = leerSuscripcionPendiente();
      if (!pending) {
        pending = { requestId: crypto.randomUUID() };
        guardarSuscripcionPendiente(pending);
      }

      try {
        if (!pending.jobId) {
          const { job } = await api("/plan/suscribir", {
            method: "POST",
            body: { request_id: pending.requestId }
          });
          pending.jobId = job.id;
          guardarSuscripcionPendiente(pending);
        }

        const completed = await esperarJob(pending.jobId, { timeoutMs: 90 * 1000 });
        const result = completed.result || {};
        if (result.status === "active") {
          limpiarSuscripcionPendiente();
          window.location.reload();
          return;
        }
        if (!result.confirmationUrl) {
          const error = new Error("Shopify no devolvio una URL de confirmacion valida.");
          error.terminal = true;
          throw error;
        }
        // La confirmacion de Shopify no puede vivir en el iframe. El job ya
        // conserva el resultado durable, por lo que el navegador puede soltar
        // su marcador local antes de abandonar la app.
        limpiarSuscripcionPendiente();
        (window.top || window).location.href = result.confirmationUrl;
      } catch (error) {
        // Un timeout conserva requestId/jobId: el siguiente intento reanuda el
        // mismo trabajo. Solo se descarta cuando el servidor demuestra que el
        // trabajo termino o ya no existe.
        if (error?.terminal === true || error?.status === 404) {
          limpiarSuscripcionPendiente();
        }
        throw error;
      }
    })();
    try {
      return await suscripcionEnCurso;
    } finally {
      suscripcionEnCurso = null;
    }
  }

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  // ---------- íconos ----------
  // Un solo lugar para los íconos: SVG feather-style (trazo, hereda color y
  // tamaño del contenedor). Reemplaza a los glyphs de texto (✕ ✓ ⚠ → ★) que
  // delataban el look "hecho con prompts". Uso: ico("basura"), ico("x"), etc.
  const ICONOS = {
    x: `<path d="M18 6L6 18M6 6l12 12"/>`,
    basura: `<path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6"/><path d="M10 11v6M14 11v6"/>`,
    check: `<path d="M5 12.5l4.5 4.5L19 7"/>`,
    checkCirculo: `<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>`,
    aviso: `<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>`,
    flecha: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
    estrella: `<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>`,
    lapiz: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>`,
    chispa: `<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.4L12 17l-1.9-5.6L4.5 10l5.6-1.4z"/>`,
    documento: `<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/>`,
    bolsa: `<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 01-8 0"/>`,
    flechaArriba: `<path d="M12 19V5M5 12l7-7 7 7"/>`,
    flechaAbajo: `<path d="M12 5v14M5 12l7 7 7-7"/>`,
    subir: `<path d="M12 15V3M8 7l4-4 4 4"/><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"/>`,
    importar: `<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>`,
    engranaje: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.3v.1a2 2 0 01-4 0v-.2a1.6 1.6 0 00-2.7-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 004.6 12H4.5a2 2 0 010-4h.2a1.6 1.6 0 001.2-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 002.7-1.2V1.4a2 2 0 014 0v.2a1.6 1.6 0 002.7 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 2.4 1.6 1.6 0 001.5 1h.1a2 2 0 010 4h-.2a1.6 1.6 0 00-1.4 1z"/>`,
    externo: `<path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>`,
    cursor: `<path d="M4 3l16 7-6.5 2.2L11 20z"/>`,
    imagen: `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>`,
    casilla: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12l3 3 5-6"/>`,
    calendario: `<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>`,
    tarjeta: `<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>`,
    chat: `<path d="M21 11.5a8 8 0 01-11.5 7.2L3 20l1.3-6.5A8 8 0 1121 11.5z"/>`,
    enlace: `<path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/>`,
    regalo: `<path d="M20 12v9H4v-9"/><path d="M2 7h20v5H2z"/><path d="M12 7v14"/><path d="M12 7S12 3 9 3a2.5 2.5 0 000 4zM12 7s0-4 3-4a2.5 2.5 0 010 4z"/>`,
    camion: `<path d="M14 16V5a1 1 0 00-1-1H2a1 1 0 00-1 1v11h13z"/><path d="M14 8h5l3 3v5h-8"/><circle cx="6.5" cy="18.5" r="1.5"/><circle cx="17.5" cy="18.5" r="1.5"/>`,
    tipografia: `<path d="M4 7V4h16v3M9 20h6M12 4v16"/>`,
    parrafo: `<path d="M17 4H9a4 4 0 000 8h4M13 4v16M17 4v16"/>`,
    campoTexto: `<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11v2"/>`,
    desplegable: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 10l4 4 4-4"/>`,
    radio: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>`,
    reloj: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
    cantidad: `<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 12h2M16 12h2M17 11v2"/>`,
    chevron: `<path d="M6 9l6 6 6-6"/>`,
    mas: `<path d="M12 5v14M5 12h14"/>`,
    menos: `<path d="M5 12h14"/>`,
    info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.4"/>`,
    kebab: `<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/>`,
    deshacer: `<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>`,
    rehacer: `<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h4"/>`,
    grip: `<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>`
  };
  const ico = (nombre, cls = "") =>
    `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ""}</svg>`;

  // ---------- barra de pasos ----------

  function pintarPasos() {
    const cont = $("pasos");
    // El stepper es SOLO del flujo de CREACIÓN. En el resto (inicio, tabla,
    // bundles) no va. Y una vez PUBLICADA, el asistente terminó: la
    // pantalla pasa a modo editor, sin stepper (patrón page-builder).
    const previewPublicada = estado.pantalla === "preview" && estado.pagina?.estado === "publicada";
    if (previewPublicada || estado.pantalla === "lista" || estado.pantalla === "plantillas" || !["informacion", "generando", "preview"].includes(estado.pantalla)) {
      cont.innerHTML = "";
      return;
    }
    const pasos = [
      { id: "lista", texto: "Producto" },
      { id: "informacion", texto: "Estrategia" },
      { id: "plantillas", texto: "Plantillas" },
      { id: "preview", texto: "Publicar" }
    ];
    const actual = estado.pantalla === "generando" ? "plantillas" : estado.pantalla;
    const i = pasos.findIndex((p) => p.id === actual);
    const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;

    const cuerpo = pasos
      .map((p, n) => {
        const clase = n < i ? "es-hecho" : n === i ? "es-activo" : "es-futuro";
        const linea = n > 0 ? `<div class="stepper__linea ${n <= i ? "es-hecho" : ""}"></div>` : "";
        return (
          linea +
          `<div class="stepper__paso ${clase}">
             <span class="stepper__num">${n < i ? CHECK : n + 1}</span>
             <span class="stepper__label">${p.texto}</span>
           </div>`
        );
      })
      .join("");

    cont.innerHTML = `<div class="stepper" role="list" aria-label="Paso ${i + 1} de ${pasos.length}">${cuerpo}</div>`;
  }

  // ---------- 0. inicio (panel principal, estilo PagePilot) ----------
  //
  // Todo lo que muestra es REAL: páginas y plan salen del server. Nada de
  // métricas de venta que no medimos ni links a cosas que no existen.

  async function pantallaInicio() {
    const confirmandoPlan = new URLSearchParams(location.search).get("plan") === "confirmado";
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Leyendo tu tienda…</h2></div>`;
    try {
      // Bundles es para los "primeros pasos": si falla, la home igual
      // se dibuja (por eso el catch por separado, no dentro del Promise.all).
      const [plan, paginas, bundles] = await Promise.all([
        api(confirmandoPlan ? "/plan?confirmar=1" : "/plan"),
        api("/paginas"),
        api("/bundles").catch(() => null)
      ]);
      estado.plan = plan;
      estado.paginas = paginas;
      estado.inicioBundles = bundles;
    } catch (e) {
      vista.innerHTML = `<div class="error">${ico("x","ico--banner")} No se pudo leer la tienda: ${esc(e.message)}</div>`;
      return;
    }
    if (estado.pantalla !== "inicio") return; // navegó mientras cargaba

    if (confirmandoPlan) {
      const limpia = new URL(location.href);
      limpia.searchParams.delete("plan");
      history.replaceState(history.state, "", limpia.pathname + limpia.search + limpia.hash);
      toast(estado.plan?.plan === "pro" ? "Plan Pro activado" : "Shopify todavía está confirmando el plan");
    }

    const plan = estado.plan;
    const creadas = estado.paginas.length;
    const publicadas = estado.paginas.filter((p) => p.estado === "publicada").length;

    // Un paso está "hecho" cuando la feature quedó realmente andando en la
    // tienda: configurada Y activa/inyectada. Configurarla sin inyectarla no
    // le sirve de nada al merchant, así que no cuenta.
    const bundlesListo = !!(
      estado.inicioBundles?.instalado && (estado.inicioBundles?.lista || []).some((b) => b.activo !== false)
    );

    const TOTAL_PASOS = 3;
    const hechos =
      (creadas > 0 ? 1 : 0) + (publicadas > 0 ? 1 : 0) + (bundlesListo ? 1 : 0);
    const sinCupo = plan.plan !== "pro" && plan.usadas >= plan.limite;
    const bundlesActivos = (estado.inicioBundles?.lista || []).filter((b) => b.activo !== false).length;
    const esPro = plan.plan === "pro";
    // Uso del cupo para el medidor: entre 0 y 1 (Pro va lleno con el gradiente).
    const usoPct = esPro ? 100 : Math.min(100, Math.round((plan.usadas / Math.max(1, plan.limite)) * 100));

    // Íconos de línea monocromos, como PagePilot: círculo negro sólido si el
    // paso está hecho, punteado si falta.
    const ICONO_PASO = {
      chispa: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 2l1.7 5.4L18 9l-5.3 1.6L11 16l-1.7-5.4L4 9l5.3-1.6z"/><path d="M18.5 14l.9 2.8 2.8.9-2.8.9-.9 2.8-.9-2.8-2.8-.9 2.8-.9z"/></svg>`,
      publicar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="M7 9l5-5 5 5"/><path d="M4 19h16"/></svg>`,
      tienda: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4h13.6L20 9"/><path d="M4 9c0 1.4 1.2 2.5 2.7 2.5S9.3 10.4 9.3 9c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.2 2.5 2.7 2.5S20 10.4 20 9"/><path d="M5 11.5V20h14v-8.5"/><path d="M10 20v-5h4v5"/></svg>`,
      bundle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/></svg>`
    };

    // Check que se posa sobre el ícono cuando el paso ya está hecho: el estado
    // lo comunica el propio ícono, no solo el chip de abajo.
    const IC_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;

    // Tarjeta de paso, nativa Polaris: contenedor s-box con el ícono, el estado
    // (badge "Completado" cuando está hecho) y, si falta, el botón de acción.
    const pasoCard = (icono, titulo, texto, hecho, boton) => `
      <div class="tiq-paso">
        <span class="paso-ico ${hecho ? "is-done" : ""}">${icono}</span>
        <s-heading>${titulo}</s-heading>
        <s-text color="subdued">${texto}</s-text>
        <div class="tiq-paso__accion">${hecho ? `<s-badge tone="success">Completado</s-badge>` : boton}</div>
      </div>`;

    // Tiles de métrica al estilo PagePilot: ícono + label arriba, valor
    // grande abajo alineado con el label.
    const ICONO_METRICA = {
      pagina: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8.5h6M9 12h6M9 15.5h4"/></svg>`,
      check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.4 2.4 4.6-5.4"/></svg>`,
      lapiz: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.7 3.8l3.5 3.5L7.5 20H4v-3.5z"/><path d="M14.5 6l3.5 3.5"/></svg>`,
      estrella: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.5 5.4 5.9.7-4.4 4 1.2 5.9L12 16.6l-5.2 2.9 1.2-5.9-4.4-4 5.9-.7z"/></svg>`
    };

    // Tile de métrica, nativo Polaris: label con ícono arriba, valor grande abajo.
    const metrica = (icono, nombre, valor) => `
      <s-box padding="large-100" borderRadius="base" background="subdued">
        <s-stack direction="block" gap="small-500">
          <s-stack direction="inline" gap="small-500" alignItems="center">
            <span class="tiq-ini-ico tiq-ini-ico--sm">${icono}</span>
            <s-text color="subdued">${nombre}</s-text>
          </s-stack>
          <s-heading>${valor}</s-heading>
        </s-stack>
      </s-box>`;

    // Iconos de los botones de la cabecera (SVG de línea, no glyphs).
    const IC_PAGINAS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8.5h6M9 12h6M9 15.5h4"/></svg>`;

    // ⚠ Reemplazar por la URL real de la comunidad (TikTok del usuario).
    const TIKTOK_URL = "https://www.tiktok.com/@tiendaiq";
    if (window.TiendaIQHomeV2) {
      window.TiendaIQHomeV2.mount({
        root: vista,
        data: {
          created: creadas,
          published: publicadas,
          activeBundles: bundlesActivos,
          planName: esPro ? "Pro" : "Inicial",
          isPro: esPro,
          used: plan.usadas,
          limit: plan.limite,
          usagePercent: usoPct,
          outOfQuota: sinCupo,
          pages: estado.paginas
        },
        actions: {
          create: () => cargarLista(),
          pages: () => ir("paginas"),
          bundles: () => ir("bundles"),
          inspiration: () => ir("inspiracion"),
          plan: irASuscripcion,
          support: () => window.open("mailto:soporte@tiendaiq.com", "_blank"),
          legal: () => window.open("/terminos", "_blank")
        }
      });
      return;
    }
    const ICO_INFO = {
      chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/></svg>`,
      gente: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18.5 19a5.2 5.2 0 0 0-3-4.7"/></svg>`,
      estrella: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.5 5.4 5.9.7-4.4 4 1.2 5.9L12 16.6l-5.2 2.9 1.2-5.9-4.4-4 5.9-.7z"/></svg>`,
      ayuda: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7"/><path d="M12 17h.01"/></svg>`
    };

    vista.innerHTML = `
      <style>
        .tiq-pasos-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
        .tiq-paso{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;min-width:0}
        .paso-ico{width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#8a8a8a;background:#f1f1f1;margin-bottom:4px}
        .paso-ico svg{width:20px;height:20px}
        .paso-ico.is-done{background:var(--negro);color:#fff}
        .tiq-paso__accion{margin-top:auto;padding-top:8px}
        .tiq-prog{display:flex;align-items:center;gap:10px}
        .tiq-prog__bar{width:120px;height:6px;border-radius:3px;background:#e3e3e3;overflow:hidden}
        .tiq-prog__fill{height:100%;background:var(--negro);border-radius:3px}
        .tiq-tools{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
        .tiq-tool{background:#fff;border:1px solid var(--borde);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;min-width:0}
        .tiq-tool__body{padding:16px;display:flex;flex-direction:column;gap:6px}
        .tiq-tool__prev{margin-top:auto;height:168px;background:#f6f6f7;border-top:1px solid #ececec;overflow:hidden;display:flex;flex-direction:column}
        /* previews mockup (placeholders sin imagen real): estructura sobre base clara, nunca gradiente pleno */
        .mb-bar{height:28px;background:#ededed;display:flex;align-items:center;gap:6px;padding:0 10px}
        .mb-bar .dot{width:8px;height:8px;border-radius:50%;background:#c9c9c9}
        .mb-url{flex:1;height:10px;border-radius:5px;background:#fff;margin-left:8px}
        .mb-body{padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:#fff;flex:1}
        .mb-hero{height:52px;border-radius:8px;background:linear-gradient(135deg,#e7ecff,#dce4ff)}
        .mb-line{height:9px;border-radius:5px;background:#e8e8e8}
        .mb-line.w80{width:80%}.mb-line.w60{width:60%}
        .mb-cta{width:96px;height:22px;border-radius:6px;background:var(--negro)}
        .pg-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 14px;background:#fff;flex:1}
        .pg-card{background:#fafafa;border:1px solid #eee;border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:5px}
        .pg-thumb{height:30px;border-radius:6px}
        .pg-thumb.t1{background:linear-gradient(135deg,#ffe1cc,#ffd0b0)}
        .pg-thumb.t2{background:linear-gradient(135deg,#d6f0e0,#bfe8d0)}
        .pg-thumb.t3{background:linear-gradient(135deg,#dce4ff,#c9d6ff)}
        .pg-thumb.t4{background:linear-gradient(135deg,#f3ddf7,#e9cbf0)}
        .pg-t{height:7px;width:70%;border-radius:4px;background:#e6e6e6}
        .pg-price{height:7px;width:34%;border-radius:4px;background:var(--negro)}
        @media (max-width:1040px){.tiq-pasos-grid,.tiq-tools{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:560px){.tiq-pasos-grid,.tiq-tools{grid-template-columns:1fr}}
        .tiq-tool__prev img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
        .tiq-bmini{padding:14px;display:flex;flex-direction:column;gap:8px;height:100%;background:linear-gradient(135deg,#eef4ff,#f5f0ff)}
        .tiq-bmini__row{display:flex;align-items:center;justify-content:space-between;gap:8px;white-space:nowrap;background:#fff;border:1px solid #e7e7ee;border-radius:8px;padding:8px 11px;font-size:12px;color:var(--negro)}
        .tiq-bmini__row.sel{border-color:#111;border-width:1.5px}
        .tiq-bmini__tag{background:#111;color:#fff;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:600;margin-left:6px;white-space:nowrap}
        .tiq-bmini__old{color:#9ca3af;text-decoration:line-through;margin-left:6px}
        .tiq-info{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
        .tiq-infocard{background:#fff;border:1px solid var(--borde);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:8px}
        .tiq-infocard__ic{width:34px;height:34px;border-radius:9px;background:var(--fondo);display:flex;align-items:center;justify-content:center;color:var(--negro)}
        .tiq-infocard__ic svg{width:19px;height:19px}
      </style>
      <s-page heading="Bienvenido a TiendaIQ" inlineSize="large">
        <s-button slot="primary-action" variant="primary" id="ir-crear">Crear página con IA</s-button>
        <s-button slot="secondary-actions" id="ir-paginas">Ver mis páginas</s-button>

        <s-paragraph>Generá páginas de producto con IA y armá descuentos por volumen — todo desde acá.</s-paragraph>

        ${
          sinCupo
            ? `<s-banner tone="warning" heading="Necesitás una suscripción activa">
                 <s-paragraph>Para crear más páginas de producto necesitás una suscripción activa.</s-paragraph>
                 <s-button slot="secondary-actions" id="ir-plan">Actualizar plan</s-button>
               </s-banner>`
            : ""
        }

        <s-section heading="Primeros pasos">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-text color="subdued">Completá estos pasos para empezar a vender con TiendaIQ</s-text>
              <div class="tiq-prog">
                <div class="tiq-prog__bar"><div class="tiq-prog__fill" style="width:${Math.round((hechos / TOTAL_PASOS) * 100)}%"></div></div>
                <s-text color="subdued">${hechos} de ${TOTAL_PASOS} completado${hechos === 1 ? "" : "s"}</s-text>
              </div>
            </s-stack>
            <div class="tiq-pasos-grid">
              ${pasoCard(
                ICONO_PASO.chispa,
                "Crear página de producto",
                "Generá tu primera página de producto con IA.",
                creadas > 0,
                `<s-button variant="primary" id="paso-crear">Crear página</s-button>`
              )}
              ${pasoCard(
                ICONO_PASO.publicar,
                "Publicar en la tienda",
                "Publicá una página de producto en tu tienda.",
                publicadas > 0,
                `<s-button variant="primary" id="paso-publicar">Publicar página</s-button>`
              )}
              ${pasoCard(
                ICONO_PASO.bundle,
                "Crear tu primer bundle",
                "Descuentos por volumen para subir el valor del pedido.",
                bundlesListo,
                `<s-button variant="primary" id="paso-bundles">${(estado.inicioBundles?.lista || []).length ? "Inyectar en el tema" : "Crear bundle"}</s-button>`
              )}
              <!-- 4ª casilla (placeholder a definir): se rellena para igualar la grilla 4-up de PagePilot. -->
              <div class="tiq-paso">
                <span class="paso-ico">${ICONO_PASO.tienda}</span>
                <s-heading>Personalizá tu tienda</s-heading>
                <s-text color="subdued">Ajustá el look de tus páginas y bundles.</s-text>
                <div class="tiq-paso__accion"><s-button disabled>Próximamente</s-button></div>
              </div>
            </div>
          </s-stack>
        </s-section>

        <s-section heading="Herramientas útiles">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">Explorá lo que TiendaIQ hace por tu tienda.</s-text>
            <div class="tiq-tools">
              <div class="tiq-tool">
                <div class="tiq-tool__body">
                  <s-heading>Páginas de producto con IA</s-heading>
                  <s-text color="subdued">Elegí un producto y la IA arma la landing completa: copy, reseñas, FAQ y diseño.</s-text>
                  <div style="margin-top:4px"><s-button variant="primary" id="herr-crear">Crear página de producto</s-button></div>
                </div>
                <div class="tiq-tool__prev"><img src="/portadas/portada-paginas.png" alt="" loading="lazy"></div>
              </div>
              <div class="tiq-tool">
                <div class="tiq-tool__body">
                  <s-heading>Creá paquetes y aumentá el AOV</s-heading>
                  <s-text color="subdued">Descuentos por volumen y "comprá X y llevá Y". El precio lo hace cumplir Shopify.</s-text>
                  <div style="margin-top:4px"><s-button variant="primary" id="herr-bundles">Crear bundles</s-button></div>
                </div>
                <div class="tiq-tool__prev">
                  <div class="tiq-bmini">
                    <div class="tiq-bmini__row"><span>Comprá 1</span><span>$ 24,99</span></div>
                    <div class="tiq-bmini__row sel"><span>Comprá 2 <span class="tiq-bmini__tag">10% OFF</span></span><span>$ 44,98<span class="tiq-bmini__old">$ 49,98</span></span></div>
                    <div class="tiq-bmini__row"><span>Comprá 3 <span class="tiq-bmini__tag">15% OFF</span></span><span>$ 63,72<span class="tiq-bmini__old">$ 74,97</span></span></div>
                  </div>
                </div>
              </div>
              <!-- 3ª y 4ª herramienta (placeholders a definir): rellenas con preview genérico para igualar la grilla 4-up de PagePilot. -->
              <div class="tiq-tool">
                <div class="tiq-tool__body">
                  <s-heading>Inspírate de los mejores</s-heading>
                  <s-text color="subdued">Estudiá videos de venta orgánica que explotaron en TikTok.</s-text>
                  <div style="margin-top:4px"><s-button variant="primary" id="herr-inspiracion">Ver videos</s-button></div>
                </div>
                <div class="tiq-tool__prev">
                  <div class="pg-grid">
                    <div class="pg-card"><div class="pg-thumb t1"></div><div class="pg-t"></div><div class="pg-price"></div></div>
                    <div class="pg-card"><div class="pg-thumb t2"></div><div class="pg-t"></div><div class="pg-price"></div></div>
                    <div class="pg-card"><div class="pg-thumb t3"></div><div class="pg-t"></div><div class="pg-price"></div></div>
                    <div class="pg-card"><div class="pg-thumb t4"></div><div class="pg-t"></div><div class="pg-price"></div></div>
                  </div>
                </div>
              </div>
              <div class="tiq-tool">
                <div class="tiq-tool__body">
                  <s-heading>Curso de ecommerce</s-heading>
                  <s-text color="subdued">Aprendé a escalar tu tienda paso a paso.</s-text>
                  <div style="margin-top:4px"><s-button disabled>Próximamente</s-button></div>
                </div>
                <div class="tiq-tool__prev">
                  <div class="mb-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><div class="mb-url"></div></div>
                  <div class="mb-body"><div class="mb-hero"></div><div class="mb-line w80"></div><div class="mb-line w60"></div><div class="mb-cta"></div></div>
                </div>
              </div>
            </div>
          </s-stack>
        </s-section>

        <s-section heading="Información y comunidad">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">Recursos y ayuda para sacarle el jugo a TiendaIQ.</s-text>
            <div class="tiq-info">
              <div class="tiq-infocard">
                <div class="tiq-infocard__ic">${ICO_INFO.chat}</div>
                <s-heading>Soporte</s-heading>
                <s-text color="subdued">¿Trabado con algo? Escribinos y te damos una mano.</s-text>
                <div style="margin-top:4px"><s-button variant="secondary" id="info-soporte">Escribir a soporte</s-button></div>
              </div>
              <div class="tiq-infocard">
                <div class="tiq-infocard__ic">${ICO_INFO.gente}</div>
                <s-heading>Comunidad</s-heading>
                <s-text color="subdued">Seguinos para tips de dropshipping y productos ganadores.</s-text>
                <div style="margin-top:4px"><s-button variant="secondary" id="info-comunidad">Ir a la comunidad</s-button></div>
              </div>
              <div class="tiq-infocard">
                <div class="tiq-infocard__ic">${ICO_INFO.estrella}</div>
                <s-heading>¿Te sirve TiendaIQ?</s-heading>
                <s-text color="subdued">Contanos qué te gustaría mejorar — leemos todo.</s-text>
                <div style="margin-top:4px"><s-button variant="secondary" id="info-feedback">Dejar mi opinión</s-button></div>
              </div>
              <div class="tiq-infocard">
                <div class="tiq-infocard__ic">${ICO_INFO.ayuda}</div>
                <s-heading>Legales</s-heading>
                <s-text color="subdued">Términos de uso y política de privacidad.</s-text>
                <div style="margin-top:4px"><s-button variant="secondary" id="info-legales">Términos y privacidad</s-button></div>
              </div>
            </div>
          </s-stack>
        </s-section>
      </s-page>`;

    const aLista = () => cargarLista();
    ["ir-crear", "paso-crear", "herr-crear"].forEach((id) => {
      const b = $(id);
      if (b) b.onclick = aLista;
    });
    // Ver/gestionar páginas → la tabla de páginas (ahí se publica y edita).
    ["ir-paginas", "paso-publicar"].forEach((id) => {
      const b = $(id);
      if (b) b.onclick = () => ir("paginas");
    });
    ["ir-plan", "plan-mejorar"].forEach((id) => {
      const b = $(id);
      if (b) b.onclick = irASuscripcion;
    });
    // Bundles: tanto desde "Herramientas" como desde "Primeros pasos".
    ["herr-bundles", "paso-bundles"].forEach((id) => {
      const b = $(id);
      if (b) b.onclick = () => ir("bundles");
    });
    { const b = $("herr-inspiracion"); if (b) b.onclick = () => ir("inspiracion"); }
    // Cards de Información: cada botón nativo abre su link en pestaña nueva.
    const abrirInfo = (id, url) => { const b = $(id); if (b) b.onclick = () => window.open(url, "_blank"); };
    abrirInfo("info-soporte", "mailto:soporte@tiendaiq.com");
    abrirInfo("info-comunidad", TIKTOK_URL);
    abrirInfo("info-feedback", "mailto:soporte@tiendaiq.com?subject=Feedback%20TiendaIQ");
    abrirInfo("info-legales", "/terminos");
  }

  // ---------- 0b. mis páginas (tabla de páginas generadas) ----------

  const fechaCorta = (iso) => {
    if (!iso) return "";
    const f = new Date(iso);
    return isNaN(f) ? "" : f.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
  };

  async function pantallaPaginas() {
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Leyendo tus páginas…</h2></div>`;
    try {
      estado.paginas = await api("/paginas");
    } catch (e) {
      vista.innerHTML = `<div class="error">${ico("x","ico--banner")} No se pudieron leer las páginas: ${esc(e.message)}</div>`;
      return;
    }
    if (estado.pantalla !== "paginas") return;

    const paginas = [...estado.paginas].sort((a, b) =>
      (b.actualizado || "").localeCompare(a.actualizado || "")
    );

    // Cada página son 5 celdas sueltas de un mismo s-grid (foto · producto ·
    // estado · tienda · acción) → todas las filas comparten columnas y quedan
    // alineadas como una tabla, sin s-table.
    const TONO_ESTADO = {
      publicada: "success",
      borrador: "info",
      publicando: "attention",
      necesita_atencion: "critical"
    };
    const fila = (p) => `
      <span class="pagina-fila__foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : ico("imagen", "ico--ph")}</span>
      <s-stack direction="block" gap="small-500">
        <s-text type="strong">${esc(p.titulo || "Sin título")}</s-text>
        <s-text color="subdued">${esc(fechaCorta(p.actualizado))}</s-text>
      </s-stack>
      <s-badge tone="${TONO_ESTADO[p.estado] || "neutral"}">${ESTADO_ETQ[p.estado] || esc(p.estado)}</s-badge>
      ${
        p.url_publica
          ? `<s-link href="${esc(p.url_publica)}" target="_blank">Ver en la tienda</s-link>`
          : `<s-text></s-text>`
      }
      <s-button data-editar="${esc(p.id)}">Editar y publicar</s-button>`;

    vista.innerHTML = `
      <s-page heading="Páginas de producto">
        <s-button slot="primary-action" variant="primary" id="ir-crear">Crear página de producto con IA</s-button>

        <div id="banner-pagina"></div>

        <s-section heading="Páginas de producto">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">Administrá tus páginas de producto generadas por IA</s-text>
            ${
              paginas.length
                ? `<s-grid gridTemplateColumns="auto minmax(0, 1fr) auto auto auto" gap="base" alignItems="center">
                     <s-text color="subdued"></s-text>
                     <s-text color="subdued">Producto</s-text>
                     <s-text color="subdued">Estado</s-text>
                     <s-text color="subdued">Tienda</s-text>
                     <s-text color="subdued"></s-text>
                     ${paginas.map(fila).join("")}
                   </s-grid>`
                : `<s-stack direction="block" gap="base" alignItems="center">
                     ${ico("documento")}
                     <s-heading>Todavía no generaste ninguna página</s-heading>
                     <s-paragraph>Elegí un producto de tu tienda y armamos su página de venta con IA en pocos minutos.</s-paragraph>
                     <s-button variant="primary" id="vacio-crear">Crear página con IA</s-button>
                   </s-stack>`
            }
          </s-stack>
        </s-section>
      </s-page>`;

    const crear = $("ir-crear") || $("vacio-crear");
    if (crear) crear.onclick = () => cargarLista();
    const vacioCrear = $("vacio-crear");
    if (vacioCrear) vacioCrear.onclick = () => cargarLista();
    vista.querySelectorAll("[data-editar]").forEach((b) => {
      b.onclick = () => abrirDesdeTabla(b.dataset.editar);
    });

    // Banner persistente + AUTO-DIAGNÓSTICO: ¿las páginas publicadas se ven, y
    // CÓMO? Distingue "no se ve" (falta la plantilla) de "plantilla vieja pegada
    // al tema" (de la época de inyección — le gana al app block) y ofrece
    // re-verificar en vivo sin recargar (fresh=1 saltea el cache del server).
    if (paginas.some((p) => p.estado === "publicada")) {
      const banner = (e) => {
        const st = e && e.estado;
        const abrir = `<s-link href="${esc(e.setupUrl)}" target="_blank">Abrir editor de temas</s-link>`;
        const verif = `<s-button id="pag-verificar">Verificar de nuevo</s-button>`;
        if (st === "legacy") return `<s-banner tone="warning" heading="Tenés una plantilla vieja pegada a tu tema">
          <s-paragraph>Tu página la está pintando una versión anterior que quedó escrita en tu tema (de cuando la app inyectaba en el tema) — por eso podés ver un diseño viejo o desactualizado. Borrá del tema la plantilla <s-text type="strong">product.tiendaiq</s-text> y los assets <s-text type="strong">tiendaiq.js</s-text>/<s-text type="strong">tiendaiq.css</s-text>, y dejá activo el bloque nuevo.</s-paragraph>
          ${abrir}${verif}
        </s-banner>`;
        if (st === "inactiva") return `<s-banner tone="warning" heading="Tus páginas no se ven en la tienda">
          <s-paragraph>Caen a la página de producto nativa. Creá una vez la plantilla <s-text type="strong">tiendaiq</s-text> con el bloque <s-text type="strong">TiendaIQ Página</s-text> en tu tema.</s-paragraph>
          ${abrir}${verif}
        </s-banner>`;
        return ""; // app_block (todo bien) o null (no verificable) → sin alarma
      };
      const verificar = (fresh) => {
        const cont = $("banner-pagina");
        if (cont && fresh) cont.innerHTML = `<div style="padding:8px 0"><s-spinner accessibilityLabel="Verificando en tu tienda"></s-spinner></div>`;
        api("/pagina-estado" + (fresh ? "?fresh=1" : ""))
          .then((e) => {
            if (estado.pantalla !== "paginas") return;
            const c = $("banner-pagina");
            if (!c) return;
            c.innerHTML = banner(e);
            const rb = $("pag-verificar");
            if (rb) rb.onclick = () => verificar(true);
          })
          .catch(() => {});
      };
      verificar(false);
    }
  }

  async function abrirDesdeTabla(id) {
    const resumen = estado.paginas.find((p) => p.id === id);
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Abriendo la página…</h2></div>`;
    try {
      estado.pagina = await api(`/paginas/${id}`);
      estado.producto = {
        id: estado.pagina.shopify_product_id,
        titulo: resumen?.titulo || estado.pagina.data?.fuente?.titulo_crudo || "",
        imagen: resumen?.imagen || null,
        estado: estado.pagina.estado
      };
      estado.volverA = "paginas";
      ir("preview");
    } catch (e) {
      ir("paginas");
      requestAnimationFrame(() =>
        vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} ${esc(e.message)}</div>`)
      );
    }
  }

  // ---------- 1. lista ----------

  // Símbolo por divisa (subconjunto LatAm + majors); lo que no figure cae a "$".
  const SIMBOLO_MONEDA = {
    USD: "US$", ARS: "$", MXN: "$", CLP: "$", COP: "$", UYU: "$", PEN: "S/",
    BRL: "R$", BOB: "Bs", PYG: "₲", GTQ: "Q", DOP: "RD$", CRC: "₡", EUR: "€", GBP: "£"
  };
  const SIN_DECIMALES = ["CLP", "COP", "PYG"];
  function precioLindo(monto, moneda) {
    if (monto == null || monto === "") return "";
    const n = Number(monto);
    if (!isFinite(n)) return "";
    // Sin decimales para divisas que no los usan y para montos enteros
    // (los "$ 24.990,00" sobran); con 2 decimales solo cuando hay centavos.
    const dec = SIN_DECIMALES.includes(moneda) || Number.isInteger(n) ? 0 : 2;
    const txt = n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return `${SIMBOLO_MONEDA[moneda] || "$"} ${txt}`;
  }

  const ESTADO_ETQ = {
    publicada: "Publicada",
    borrador: "Borrador",
    publicando: "Publicando",
    necesita_atencion: "Necesita atención"
  };
  // Tono del s-badge de estado (Polaris). pend = "Cambios sin publicar".
  const TONO_ESTADO = {
    publicada: "success",
    borrador: "info",
    publicando: "attention",
    necesita_atencion: "critical",
    pend: "warning"
  };

  // Variantes de color de la plantilla (solo pisan el acento; la lógica queda
  // igual). "auto" = usa el color del rubro. Los hex viven en styles.css
  // (#app[data-tema=...]); acá solo el swatch para el editor y el paso previo.
  const TEMAS = [
    ["auto", "Automático (por rubro)", ""],
    ["rosa", "Rosa", "#db2777"],
    ["negro", "Negro", "#1a1a1a"],
    ["marron", "Marrón", "#7a4a24"],
    ["azul", "Azul", "#2563eb"],
    ["verde", "Verde", "#16a34a"]
  ];
  const swatchesTema = (actual) =>
    `<div class="temas">${TEMAS.map(
      ([k, n, c]) =>
        `<button type="button" class="tema ${(actual || "auto") === k ? "is-sel" : ""}${c ? "" : " tema--auto"}" data-tema-pick="${k}" title="${n}" aria-label="${n}"${c ? ` style="--sw:${c}"` : ""}></button>`
    ).join("")}</div>`;

  // Clasifica el link de un clip del muro (mismo criterio que render.js, pero
  // marca como "invalido" lo que NO es un archivo/host de video conocido — así
  // avisamos cuando pegan el link de una página web en vez del archivo).
  function tipoMedia(url) {
    url = (url || "").trim();
    if (!url) return null;
    if (/giphy\.com\/(?:gifs|clips|stickers)\//i.test(url)) return "img";
    if (/\.(gif|png|jpe?g|webp|avif)(\?|#|$)/i.test(url)) return "img";
    if (/(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(url)) return "yt";
    if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) || /cdn\.shopify\.com/i.test(url)) return "video";
    return "invalido";
  }
  // Estado/vista previa de un clip: miniatura si el link sirve, aviso claro si no.
  function estadoClip(url) {
    const t = tipoMedia(url);
    if (!t) return "";
    if (t === "invalido")
      return `<div class="clip-mal">${ico("x","ico--banner")} Ese link es una página web, no un archivo. Pegá el enlace <strong>directo</strong> (termina en .gif/.mp4), uno de Giphy/YouTube, o subí/arrastrá el archivo.</div>`;
    if (t === "img") {
      const g = url.match(/giphy\.com\/(?:gifs|clips|stickers)\/(?:[^/]*-)?([A-Za-z0-9]{6,})/i);
      const src = g ? `https://media.giphy.com/media/${g[1]}/giphy.gif` : url;
      return `<div class="clip-ok"><img src="${esc(encodeURI(src))}" alt="" loading="lazy">${ico("check")} Se ve bien</div>`;
    }
    return `<div class="clip-ok">${ico("check")} ${t === "yt" ? "Video de YouTube" : "Video"}</div>`;
  }

  // ---------- 1. elegir producto ----------
  //
  // Primera pantalla del asistente: una entrada sobria con un CTA que abre el
  // selector de productos. Elegir producto no avanza solo; el merchant confirma
  // con Continuar.
  function pantallaLista() {
    const seleccionado = estado.producto;
    const totalProductos = estado.productos.length;
    const productosConPagina = estado.productos.filter((p) => p.estado).length;
    const productosSinPagina = Math.max(0, totalProductos - productosConPagina);

    if (!estado.productos.length) {
      vista.innerHTML = `
        <button class="volver-flecha" id="volver-inicio"></button>
        <div class="cabecera"><h1>Crear página de producto con IA</h1></div>
        <div class="vacio-panel">
          <div class="vacio-panel__ico">${ico("bolsa")}</div>
          <div class="vacio-panel__tit">Todavía no tenés productos en tu tienda</div>
          <p>Agregá al menos un producto en Shopify y volvé para armar su página con IA.</p>
        </div>`;
      $("volver-inicio").onclick = () => ir("inicio");
      return;
    }

    const galeria = estado.productos
      .filter((p) => p.imagen)
      .slice(0, 6)
      .map((p, i) => `
        <figure class="crear-shot crear-shot--${i + 1}" title="${esc(p.titulo)}">
          <img src="${esc(p.imagen)}" alt="${esc(p.titulo)}" loading="lazy">
        </figure>`)
      .join("");

    const productoHTML = seleccionado
      ? `<div class="crear-prod is-ready">
          <span class="crear-prod__thumb">${seleccionado.imagen ? `<img src="${esc(seleccionado.imagen)}" alt="" loading="lazy">` : ico("bolsa")}</span>
          <span class="crear-prod__txt">
            <span class="crear-prod__label">Producto seleccionado</span>
            <strong>${esc(seleccionado.titulo)}</strong>
            <span>${seleccionado.precio != null ? esc(precioLindo(seleccionado.precio, seleccionado.moneda)) : "Precio no disponible"}${seleccionado.estado ? ` · ${ESTADO_ETQ[seleccionado.estado] || esc(seleccionado.estado)}` : ""}</span>
          </span>
          ${seleccionado.estado ? `<s-badge tone="${TONO_ESTADO[seleccionado.estado] || "neutral"}">${ESTADO_ETQ[seleccionado.estado] || esc(seleccionado.estado)}</s-badge>` : ""}
        </div>`
      : `<div class="crear-prod">
          <span class="crear-prod__thumb">${ico("bolsa")}</span>
          <span class="crear-prod__txt">
            <span class="crear-prod__label">Producto de Shopify</span>
            <strong>Elegí el producto que querés convertir en una página de venta</strong>
            <span>TiendaIQ toma sus fotos, precio, variantes y descripción como punto de partida.</span>
          </span>
        </div>`;

    const accionesHTML = seleccionado
      ? `<s-button id="elegir-shopify">Cambiar producto</s-button>
         <s-button variant="primary" id="continuar-producto">Continuar</s-button>`
      : `<s-button variant="primary" id="elegir-shopify">Elegir producto de Shopify</s-button>`;

    vista.innerHTML = `
      <div class="crear">
        <button class="volver-flecha" id="volver-inicio"></button>
        <div class="crear-stage">
          <section class="crear-hero-panel">
            <div class="crear-hero-panel__copy">
              <span class="crear__eyebrow">Páginas con IA para Shopify</span>
              <h1>Una página mejor para cada producto</h1>
              <p>Elegí un producto. TiendaIQ prepara copy, estructura e imágenes listas para editar.</p>
            </div>

            <div class="crear-visual" aria-label="Productos del catálogo">
              ${galeria || `<div class="crear-visual__empty">${ico("bolsa")} Las imágenes se leen al generar la página.</div>`}
              <div class="crear-visual__count"><b>${totalProductos}</b><span>productos conectados</span></div>
            </div>

            <div class="crear-card">
              <div class="crear-card__head">
                <div>
                  <div class="crear-card__kicker">Catálogo conectado</div>
                  <h2>Elegí el producto base</h2>
                </div>
                <span class="crear-card__meta">${productosSinPagina} sin página</span>
              </div>
              ${productoHTML}
              <div class="crear-card__acciones">
                ${accionesHTML}
              </div>
            </div>

            <div class="crear-market-note">
              <b>Dropshipping, con mejor ejecución</b>
              <p>El modelo creció fuerte en Estados Unidos y Europa. En Sudamérica todavía hay espacio para marcas que validan rápido, comunican claro y publican páginas mejores antes que el resto.</p>
            </div>

            <div class="crear-flow crear-flow--rail" aria-label="Preparación de la página">
              <div class="crear-flow__item is-active">
                <span></span>
                <div><b>Producto</b><small>Elegí el ítem correcto del catálogo.</small></div>
              </div>
              <div class="crear-flow__item">
                <span></span>
                <div><b>Estrategia</b><small>Definí idioma, público y ángulo.</small></div>
              </div>
              <div class="crear-flow__item">
                <span></span>
                <div><b>Plantilla</b><small>Seleccioná el estilo antes de generar.</small></div>
              </div>
            </div>
          </section>
        </div>
      </div>`;

    $("volver-inicio").onclick = () => ir("inicio");
    $("elegir-shopify").onclick = () => abrirPickerTodos();
    const continuar = $("continuar-producto");
    if (continuar) continuar.onclick = () => { if (estado.producto) ir("informacion"); };

  }

  function elegirProducto(id) {
    estado.producto = estado.productos.find((p) => p.id === id);
    if (estado.producto && estado.pantalla === "lista") pantallaLista();
  }

  // Sube una imagen (add-on del bundle) a Shopify Files y guarda su URL en la
  // oferta. Endpoint genérico /api/imagen (subida por tienda, no atada a página).
  async function subirImagenBundle(archivo, oferta) {
    try {
      const base64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1]);
        fr.onerror = () => rej(new Error("No se pudo leer el archivo"));
        fr.readAsDataURL(archivo);
      });
      const r = await api("/imagen", { method: "POST", body: { nombre: archivo.name, mime: archivo.type, base64 } });
      oferta.addons = oferta.addons || {};
      oferta.addons.imagen = { on: true, url: r.url };
      marcarSucioBundles();
      pintarPreviewBundle();
      pintarEditorBundle();
    } catch (e) {
      vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} No se pudo subir la imagen: ${esc(e.message)}</div>`);
    }
  }

  // "Ver todos los productos": modal con la lista completa, buscable, estilo el
  // selector nativo de Shopify. Reusa estado.productos (sin backend) y la misma
  // selección (elegirProducto).
  function abrirPickerTodos(onPick) {
    const IC_LUPA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
    const cont = document.createElement("div");
    cont.className = "picker-modal";
    cont.innerHTML = `
      <div class="picker" role="dialog" aria-modal="true" aria-label="Todos los productos">
        <div class="picker__cab">
          <h2>Todos los productos</h2>
          <s-button id="pk-x">Cerrar</s-button>
        </div>
        <div class="picker__buscar">
          <span class="picker__lupa">${IC_LUPA}</span>
          <input id="pk-q" type="text" autocomplete="off" spellcheck="false" placeholder="Buscar productos…">
        </div>
        <div class="picker__lista" id="pk-lista"></div>
        <div class="picker__pie picker__pie--acciones">
          <span id="pk-conteo"></span>
          <span class="picker__acciones">
            <s-button id="pk-cancelar">Cancelar</s-button>
            <s-button variant="primary" id="pk-seleccionar" disabled>Seleccionar producto</s-button>
          </span>
        </div>
      </div>`;
    document.body.appendChild(cont);
    let seleccionadoId = onPick ? null : estado.producto?.id || null;

    const filaP = (p) => `
      <button class="fila picker__fila ${p.id === seleccionadoId ? "is-selected" : ""}" type="button" data-id="${esc(p.id)}">
        <span class="fila__thumb">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : `<span class="fila__ph">${ico("bolsa")}</span>`}</span>
        <span class="fila__txt">
          <span class="fila__tit">${esc(p.titulo)}</span>
          ${p.precio != null ? `<span class="fila__precio">${esc(precioLindo(p.precio, p.moneda))}</span>` : ""}
        </span>
        ${
          p.estado
            ? `<s-badge tone="${TONO_ESTADO[p.estado] || "neutral"}">${ESTADO_ETQ[p.estado] || esc(p.estado)}</s-badge>`
            : `<span class="fila__cta">Elegir ${ico("flecha")}</span>`
        }
      </button>`;

    const lista = cont.querySelector("#pk-lista");
    const conteo = cont.querySelector("#pk-conteo");
    const confirmar = cont.querySelector("#pk-seleccionar");
    const refrescarConfirmar = () => {
      if (confirmar) confirmar.toggleAttribute("disabled", !seleccionadoId);
    };
    const pintar = (q = "") => {
      const t = q.trim().toLowerCase();
      const arr = t ? estado.productos.filter((p) => p.titulo.toLowerCase().includes(t)) : estado.productos;
      lista.innerHTML = arr.length ? arr.map(filaP).join("") : `<div class="vacio">Ningún producto coincide.</div>`;
      conteo.textContent = `${arr.length} producto${arr.length === 1 ? "" : "s"}`;
      lista.querySelectorAll(".fila").forEach((b) => {
        b.onclick = () => {
          if (onPick) {
            cerrar();
            onPick((estado.productos || []).find((p) => p.id === b.dataset.id) || { id: b.dataset.id });
            return;
          }
          seleccionadoId = b.dataset.id;
          lista.querySelectorAll(".fila").forEach((x) => x.classList.toggle("is-selected", x === b));
          refrescarConfirmar();
        };
      });
      refrescarConfirmar();
    };
    const onKey = (e) => { if (e.key === "Escape") cerrar(); };
    function cerrar() { cont.remove(); document.removeEventListener("keydown", onKey); }

    cont.addEventListener("click", (e) => {
      if (e.target === cont || e.target.closest("#pk-x")) cerrar();
    });
    cont.querySelector("#pk-cancelar").onclick = cerrar;
    confirmar.onclick = () => {
      if (!seleccionadoId) return;
      cerrar();
      if (onPick) onPick((estado.productos || []).find((p) => p.id === seleccionadoId) || { id: seleccionadoId });
      else elegirProducto(seleccionadoId);
    };
    document.addEventListener("keydown", onKey);
    const pkq = cont.querySelector("#pk-q");
    pkq.oninput = () => pintar(pkq.value);
    pintar("");
    pkq.focus();
  }

  // ---------- 2. información del producto ----------

  async function pantallaInformacion() {
    const p = estado.producto;
    estado.audienciaPagina ||= "unisex";
    estado.anguloPreset ||= "problema";
    estado.idiomaPagina ||= "es";

    const audiencia = estado.audienciaPagina;
    const preset = estado.anguloPreset;
    const detalleInicial = estado.anguloExtra || "";
    const audienciaTexto = { mujer: "Mujer", hombre: "Hombre", unisex: "Unisex" };
    const angulos = [
      ["problema", "Problema concreto", "Para compradores que buscan resolver una molestia puntual.", "Dolor-solución"],
      ["rutina", "Rutina diaria", "Muestra cómo el producto entra en el uso cotidiano.", "Uso real"],
      ["regalo", "Regalo útil", "Enfoca la página en practicidad, deseo y ocasión de compra.", "Lifestyle"],
      ["confianza", "Confianza primero", "Prioriza claridad, prueba social y reducción de dudas.", "Prueba social"],
      ["resultado", "Antes y después", "Contrasta la situación actual con el resultado esperado.", "Resultado"],
      ["oferta", "Oferta directa", "Va al punto con beneficios, precio y decisión rápida.", "Direct response"]
    ];
    const textoAngulo = (k) => (angulos.find((a) => a[0] === k) || angulos[0])[1];
    const textoDesc = (k) => (angulos.find((a) => a[0] === k) || angulos[0])[2];
    const anguloInicial = [
      `Público: ${audienciaTexto[audiencia] || "Unisex"}.`,
      `Ángulo: ${textoAngulo(preset)}.`,
      textoDesc(preset)
    ].join(" ");

    vista.innerHTML = `
      <div class="estrategia">
        <div class="estrategia__top">
          <s-button id="volver">Elegir otro producto</s-button>
          <div>
            <h1>Definí la estrategia de venta</h1>
            <p>Elegí público, enfoque y ajustes básicos antes de generar la página.</p>
          </div>
          <s-button variant="primary" id="continuar-top">Continuar a plantillas</s-button>
        </div>

        <div class="estrategia__panel">
          <section class="estrategia__main" aria-label="Estrategia de copywriting">
            <div class="estrategia__bloque">
              <h2>Público objetivo</h2>
              <p>La IA adapta el tono del texto, los beneficios y la forma de presentar el producto.</p>
              <div class="audiencias" id="audiencias">
                <button type="button" data-audiencia="mujer" class="${audiencia === "mujer" ? "is-sel" : ""}">Mujer</button>
                <button type="button" data-audiencia="hombre" class="${audiencia === "hombre" ? "is-sel" : ""}">Hombre</button>
                <button type="button" data-audiencia="unisex" class="${audiencia === "unisex" ? "is-sel" : ""}">Unisex</button>
              </div>
            </div>

            <div class="estrategia__bloque">
              <h2>Ángulo de venta</h2>
              <p>Seleccioná la lectura comercial que mejor encaja con este producto.</p>
              <div class="angulos" id="angulos">
                ${angulos.map(([k, t, d, tag]) => `
                  <button type="button" data-angulo-preset="${k}" class="angulo-card ${preset === k ? "is-sel" : ""}">
                    <span></span>
                    <b>${t}</b>
                    <small>${d}</small>
                    <em>${tag}</em>
                  </button>`).join("")}
              </div>
            </div>

            <div class="estrategia__bloque estrategia__bloque--nota">
              <label for="angulo-extra">Detalle opcional</label>
              <textarea id="angulo-extra" rows="3" placeholder="Ejemplo: para madres primerizas, oficinas pequeñas o piel sensible.">${esc(detalleInicial)}</textarea>
              <input type="hidden" id="angulo" value="${esc(anguloInicial)}">
            </div>
          </section>

          <aside class="estrategia__side" aria-label="Preparación de generación">
            <section class="side-card side-card--producto">
              <span class="side-card__label">Producto</span>
              <div class="side-prod">
                <span class="side-prod__img">${p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.titulo)}" loading="lazy">` : ico("bolsa")}</span>
                <div>
                  <strong id="f-titulo">${esc(p.titulo)}</strong>
                  <small id="f-meta">Cargando...</small>
                </div>
              </div>
              <p id="f-desc">La descripción del proveedor se lee al generar y no se muestra al cliente.</p>
            </section>

            <section class="side-card side-card--resumen">
              <span class="side-card__label">Tu estrategia</span>
              <div class="strategy-chips">
                <span id="chip-audiencia">${esc(audienciaTexto[audiencia] || "Unisex")}</span>
                <span id="chip-angulo">${esc(textoAngulo(preset))}</span>
                <span>Copy editable</span>
              </div>
              <p>La plantilla del próximo paso toma esta estrategia como guía visual.</p>
            </section>

            <section class="side-card">
              <span class="side-card__label">Idioma</span>
              <s-select id="idioma" value="${esc(estado.idiomaPagina || "es")}">
                <s-option value="es">Español</s-option>
                <s-option value="en">English</s-option>
                <s-option value="pt">Português</s-option>
              </s-select>
            </section>

            <section class="side-card">
              <span class="side-card__label">Color de acento</span>
              <div id="tema-previo">${swatchesTema(estado.temaElegido === "auto" ? null : estado.temaElegido)}</div>
            </section>

            <section class="side-card">
              <span class="side-card__label">Medios</span>
              <div class="medios medios--compactos" id="medios"><span class="ayuda">Cargando...</span></div>
              <div class="nota" id="nota-medios"></div>
            </section>

            <s-button variant="primary" id="continuar">Continuar a plantillas</s-button>
            ${p.estado ? `<s-button id="abrir">Editar la página existente</s-button>` : ""}
          </aside>
        </div>
      </div>`;

    $("volver").onclick = () => ir("lista");
    const syncAngulo = () => {
      const aud = audienciaTexto[estado.audienciaPagina || "unisex"] || "Unisex";
      const pre = estado.anguloPreset || "problema";
      const extra = ($("angulo-extra")?.value || "").trim();
      estado.anguloExtra = extra;
      const partes = [`Público: ${aud}.`, `Ángulo: ${textoAngulo(pre)}.`, textoDesc(pre)];
      if (extra) partes.push(`Detalle: ${extra}`);
      $("angulo").value = partes.join(" ");
      const chipAud = $("chip-audiencia");
      const chipAng = $("chip-angulo");
      if (chipAud) chipAud.textContent = aud;
      if (chipAng) chipAng.textContent = textoAngulo(pre);
    };
    const continuarPlantillas = () => {
      syncAngulo();
      estado.anguloFinal = $("angulo").value.trim();
      estado.idiomaPagina = $("idioma")?.value || "es";
      ir("plantillas");
    };
    $("continuar").onclick = continuarPlantillas;
    $("continuar-top").onclick = continuarPlantillas;
    const auds = $("audiencias");
    if (auds) auds.onclick = (e) => {
      const b = e.target.closest("[data-audiencia]");
      if (!b) return;
      estado.audienciaPagina = b.dataset.audiencia;
      auds.querySelectorAll("button").forEach((x) => x.classList.toggle("is-sel", x === b));
      syncAngulo();
    };
    const angs = $("angulos");
    if (angs) angs.onclick = (e) => {
      const b = e.target.closest("[data-angulo-preset]");
      if (!b) return;
      estado.anguloPreset = b.dataset.anguloPreset;
      angs.querySelectorAll(".angulo-card").forEach((x) => x.classList.toggle("is-sel", x === b));
      syncAngulo();
    };
    const extra = $("angulo-extra");
    if (extra) extra.oninput = syncAngulo;
    const idioma = $("idioma");
    if (idioma) idioma.onchange = () => { estado.idiomaPagina = idioma.value || "es"; };
    // Swatches de color (opción previa): guarda la elección para el generado.
    const tp = $("tema-previo");
    if (tp) tp.onclick = (e) => {
      const b = e.target.closest("[data-tema-pick]");
      if (!b) return;
      estado.temaElegido = b.dataset.temaPick;
      tp.innerHTML = swatchesTema(estado.temaElegido === "auto" ? null : estado.temaElegido);
    };
    const abrir = $("abrir");
    if (abrir) abrir.onclick = abrirExistente;
    syncAngulo();

    // La ficha se llena con lo que ya sabemos del producto en Shopify.
    try {
      const info = await api(`/productos`);
      const actual = info.find((x) => x.id === p.id);
      if (actual) estado.producto = { ...p, ...actual };
    } catch {}

    pintarFicha();
  }

  async function pintarFicha() {
    // Reusa el detalle que devuelve el server al crear; si no hay, muestra
    // lo mínimo. El detalle real lo trae la extracción al generar.
    const p = estado.producto;
    const medios = $("medios");
    if (medios) {
      medios.innerHTML = p.imagen
        ? `<div class="medio"><img src="${esc(p.imagen)}" alt=""></div>
           <span class="ayuda" style="align-self:center">Las demás fotos del producto se leen al generar.</span>`
        : `<span class="ayuda">Este producto no tiene fotos. La página se genera igual y los huecos quedan en placeholder.</span>`;
    }
    const nota = $("nota-medios");
    if (nota) {
      nota.textContent = p.imagen
        ? "La IA mira todas las fotos, las clasifica y las asigna a cada bloque."
        : "Cuando subas fotos al producto en Shopify, regenerá la página y se llenan solas.";
    }
    const meta = $("f-meta");
    if (meta) meta.textContent = p.estado ? `Ya tiene página · ${p.estado}` : "Sin página todavía";
    const desc = $("f-desc");
    if (desc) desc.textContent = "La descripción del proveedor se lee al generar y no se muestra al cliente.";
  }

  // ---------- 3. plantillas ----------

  function previewPlantilla(tipo = "clasico", id = tipo, imagen = "") {
    const portada = imagen
      ? `<div class="tpl-preview__cover"><img src="${esc(imagen)}" alt="Vista previa de la plantilla" loading="lazy"></div>`
      : `<div class="tpl-preview__hero"><i></i><i></i><i></i></div>`;
    return `
      <div class="tpl-preview tpl-preview--${esc(tipo)} tpl-preview--theme-${esc(id)}" aria-hidden="true">
        ${portada}
        <div class="tpl-preview__cols">
          <span></span><span></span><span></span>
        </div>
        <div class="tpl-preview__body">
          <i></i><i></i><i></i><i></i>
        </div>
      </div>`;
  }

  async function pantallaPlantillas() {
    // Se mantiene el DISEÑO del selector; ofrece los modelos reales que arma
    // el pipeline normal (no plantillas fijas). El render branchea por
    // global.estilo con estos ids (ver adaptador.crearPagina y tiendaiq.js).
    const plantillas = [
      {
        id: "clasico",
        nombre: "Clásico",
        subtitulo: "Estructura limpia para validar rápido.",
        tags: ["Hero", "Beneficios", "FAQ"],
        activa: true,
        tipo: "clasico"
      },
      {
        id: "premium",
        nombre: "Premium",
        subtitulo: "Más secciones para productos con más explicación.",
        tags: ["Oferta", "Comparación", "Reviews"],
        activa: true,
        tipo: "premium"
      },
      {
        id: "pagepilot",
        nombre: "PagePilot",
        subtitulo: "Galería editorial, prueba social, beneficios y preguntas frecuentes.",
        tags: ["Editorial", "Galería", "Reviews"],
        activa: true,
        tipo: "premium"
      },
      {
        id: "pagepilot-blue",
        nombre: "PagePilot Blue",
        subtitulo: "Producto editorial azul, prueba social, comparación y CTA fijo.",
        tags: ["Editorial", "Comparación", "Azul"],
        activa: true,
        tipo: "premium"
      }
    ];

    vista.innerHTML = `
      <div class="plantillas ${plantillas.length === 1 ? "plantillas--single" : ""}">
        <div class="plantillas__shell">
          <div class="plantillas__top">
            <s-button id="tpl-volver">Atrás</s-button>
            <div>
              <h1>Elegir plantilla</h1>
            </div>
            <s-button variant="primary" id="tpl-generar" disabled>Generar página</s-button>
          </div>

          <div class="plantillas__notice" id="tpl-notice">
            <span>${ico("info")}</span>
            <p>Seleccioná una plantilla para continuar.</p>
          </div>

          <div class="plantillas__grid" id="plantillas-grid">
            ${plantillas.map((tpl) => `
              <button
                type="button"
                class="plantilla-card ${estado.modeloPagina === tpl.id ? "is-sel" : ""} ${tpl.activa ? "" : "is-reservada"}"
                ${tpl.activa ? `data-modelo="${esc(tpl.id)}"` : `data-template-slot="${esc(tpl.id)}" disabled`}
                aria-pressed="${estado.modeloPagina === tpl.id ? "true" : "false"}"
              >
                <span class="plantilla-card__head">
                  <b>${esc(tpl.nombre)}</b>
                </span>
                ${previewPlantilla(tpl.tipo, tpl.id, tpl.imagen)}
                <span class="plantilla-card__foot">
                  <span>${esc(tpl.subtitulo)}</span>
                  <span class="tpl-tags">${tpl.tags.map((tag) => `<i>${esc(tag)}</i>`).join("")}</span>
                </span>
              </button>
            `).join("")}
          </div>
        </div>
      </div>`;

    const refrescarCta = () => {
      const btn = $("tpl-generar");
      const listo = !!estado.modeloPagina;
      const notice = $("tpl-notice");
      if (btn) {
        const seleccionada = plantillas.find((tpl) => tpl.id === estado.modeloPagina);
        btn.textContent = listo ? `Generar página con ${seleccionada?.nombre || "plantilla"}` : "Seleccionar plantilla";
        btn.toggleAttribute("disabled", !listo);
      }
      if (notice) notice.hidden = listo;
    };
    $("tpl-volver").onclick = () => ir("informacion");
    $("tpl-generar").onclick = () => {
      if (!estado.modeloPagina) return;
      generar();
    };
    const grid = $("plantillas-grid");
    if (grid) grid.onclick = (e) => {
      const b = e.target.closest("[data-modelo]");
      if (!b) return;
      estado.modeloPagina = b.dataset.modelo;
      grid.querySelectorAll(".plantilla-card").forEach((card) => {
        const sel = card === b;
        card.classList.toggle("is-sel", sel);
        card.setAttribute("aria-pressed", sel ? "true" : "false");
      });
      refrescarCta();
    };
    refrescarCta();
  }

  // ---------- generando ----------

  const GENERACION_PENDIENTE = `tiq_generacion_pendiente:${(
    new URLSearchParams(location.search).get("shop") || "local"
  ).toLowerCase()}`;

  function leerGeneracionPendiente() {
    try { return JSON.parse(localStorage.getItem(GENERACION_PENDIENTE) || "null"); } catch { return null; }
  }

  function guardarGeneracionPendiente(value) {
    localStorage.setItem(GENERACION_PENDIENTE, JSON.stringify(value));
  }

  function limpiarGeneracionPendiente() {
    localStorage.removeItem(GENERACION_PENDIENTE);
  }

  async function aceptarGeneracionPendiente(pending) {
    if (!pending.jobId) {
      const { job } = await api("/paginas", { method: "POST", body: pending.body });
      pending.jobId = job.id;
      guardarGeneracionPendiente(pending);
    }
    return pending;
  }

  async function completarGeneracionPendiente(pending) {
    await aceptarGeneracionPendiente(pending);
    const completed = await esperarJob(pending.jobId, { timeoutMs: 6 * 60 * 1000 });
    const pageId = completed.result?.pageId || String(pending.body.producto_id).split("/").pop();
    estado.pagina = await api(`/paginas/${pageId}`);
    if (pending.tema && pending.tema !== "auto" && estado.pagina?.data) {
      (estado.pagina.data.global ||= {}).tema = pending.tema;
      estado.pagina = await api(`/paginas/${estado.pagina.id}`, {
        method: "PUT",
        body: { data: estado.pagina.data }
      });
    }
    limpiarGeneracionPendiente();
    return estado.pagina;
  }

  async function generar() {
    const angulo = ($("angulo")?.value || estado.anguloFinal || "").trim();
    const idioma = $("idioma")?.value || estado.idiomaPagina || "es";
    estado.anguloFinal = angulo;
    estado.idiomaPagina = idioma;
    estado.error = null;

    const body = {
      producto_id: estado.producto.id,
      idioma,
      angulo,
      estilo: estado.modeloPagina || "clasico"
    };
    const tema = estado.temaElegido || "auto";
    const fingerprint = JSON.stringify({ ...body, tema });
    let pending = leerGeneracionPendiente();
    if (!pending || pending.fingerprint !== fingerprint) {
      pending = { requestId: crypto.randomUUID(), fingerprint, body: { ...body }, tema };
      pending.body.request_id = pending.requestId;
      guardarGeneracionPendiente(pending);
    }

    let reloj;

    try {
      // Mostrar progreso solo despues de que la cola acepte el trabajo. Con
      // admission control pausado, el merchant ve el error real de inmediato.
      await aceptarGeneracionPendiente(pending);
      ir("generando");
      const t0 = Date.now();
      reloj = setInterval(() => {
        const r = $("reloj");
        if (r) r.textContent = ((Date.now() - t0) / 1000).toFixed(0) + "s";
      }, 100);
      estado.pagina = await completarGeneracionPendiente(pending);
      clearInterval(reloj);
      ir("preview");
    } catch (e) {
      clearInterval(reloj);
      if (e.terminal || e.actualizar || e.status === 404) limpiarGeneracionPendiente();
      estado.error = e.message;
      ir("plantillas");
      requestAnimationFrame(() => {
        vista.insertAdjacentHTML(
          "afterbegin",
          e.actualizar
            ? `<div class="error">${ico("x","ico--banner")} ${esc(estado.error)}
                 <button class="btn btn--acento" id="btn-plan" style="margin-left:12px">Pasar a Pro</button>
               </div>`
            : `<div class="error">${ico("x","ico--banner")} ${esc(estado.error)}</div>`
        );
        const b = $("btn-plan");
        if (b) b.onclick = irASuscripcion;
      });
    }
  }

  function pantallaGenerando() {
    const PASOS = [
      "Leyendo las fotos del producto",
      "Investigando el mercado con IA",
      "Escribiendo el copy de venta",
      "Armando el diseño de la página",
      "Finalizando tu página"
    ];
    vista.innerHTML = `
      <div class="generando">
        <div class="giro"></div>
        <h2>Creando tu página de producto…</h2>
        <div class="gen-pct" id="gen-pct">0% completado</div>
        <div class="gen-bar"><div id="gen-bar"></div></div>
        <ul class="gen-pasos" id="gen-pasos">
          ${PASOS.map((p) => `<li><span class="gen-ic"></span>${p}</li>`).join("")}
        </ul>
        <div class="gen-nota">
          <span class="gen-nota__dot"></span>
          <div><b>Un momento — puede tardar unos minutos.</b><span>La IA lee tus fotos, investiga el mercado y escribe el copy. Dejá esta pantalla abierta; abrimos el editor apenas esté lista.</span></div>
        </div>
      </div>`;

    // Progreso cosmético (como Atlas): avanza por tiempo estimado y termina de
    // verdad cuando generar() navega a "preview". Se auto-limpia al cambiar de
    // pantalla (los ids dejan de existir / estado.pantalla cambia).
    const t0 = Date.now();
    const EST = 34000;
    const lis = [...document.querySelectorAll("#gen-pasos li")];
    clearInterval(pantallaGenerando._t);
    pantallaGenerando._t = setInterval(() => {
      const bar = $("gen-bar");
      if (!bar || estado.pantalla !== "generando") { clearInterval(pantallaGenerando._t); return; }
      const e = Date.now() - t0;
      const p = Math.min(94, Math.round((e / EST) * 100));
      bar.style.width = p + "%";
      $("gen-pct").textContent = p + "% completado";
      const idx = Math.min(lis.length - 1, Math.floor(e / (EST / lis.length)));
      lis.forEach((li, i) => {
        li.classList.toggle("is-done", i < idx);
        li.classList.toggle("is-now", i === idx);
      });
    }, 200);
  }

  let recuperandoGeneracion = false;
  async function recuperarGeneracionPendiente() {
    const pending = leerGeneracionPendiente();
    if (!pending || recuperandoGeneracion) return false;
    recuperandoGeneracion = true;
    try {
      await aceptarGeneracionPendiente(pending);
      ir("generando");
      await completarGeneracionPendiente(pending);
      ir("preview");
    } catch (error) {
      if (error.terminal || error.actualizar || error.status === 404) limpiarGeneracionPendiente();
      estado.error = error.message;
      ir("inicio");
      requestAnimationFrame(() =>
        vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} ${esc(error.message)}</div>`)
      );
    } finally {
      recuperandoGeneracion = false;
    }
    return true;
  }

  // ---------- abrir una página ya generada (sin gastar generación) ----------

  async function abrirExistente() {
    const id = estado.producto.id.split("/").pop();
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Abriendo la página…</h2></div>`;
    try {
      estado.pagina = await api(`/paginas/${id}`);
      ir("preview");
    } catch (e) {
      ir("informacion");
      requestAnimationFrame(() =>
        vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} ${esc(e.message)}</div>`)
      );
    }
  }

  // ---------- 3. preview + editor ----------

  // El editor no es WYSIWYG: es un formulario al lado del preview. Cada campo
  // apunta a una ruta del JSON ("facetas.hero.titulo"); al tipear se actualiza
  // el dato y el iframe se repinta. Guardar = PUT /api/paginas/:id.

  let sucio = false; // hay cambios sin guardar
  let cambiosSinPublicar = false; // se editó una página YA publicada (no está viva hasta re-publicar)
  let timerPreview = null;

  const leer = (obj, ruta) => ruta.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

  function fijar(obj, ruta, valor) {
    const partes = ruta.split(".");
    let o = obj;
    for (let i = 0; i < partes.length - 1; i++) o = o[partes[i]];
    o[partes[partes.length - 1]] = valor;
  }

  // Campo de texto (o textarea si lleva filas). data-nulo: vacío se guarda
  // como null — así un autor borrado vuelve a ser tarjeta guía.
  const EDICION_TEXTO_IA_DISPONIBLE = false;
  function campo(ruta, etiqueta, filas, nulo) {
    const v = leer(estado.pagina.data, ruta) ?? "";
    const atributos = `data-ruta="${ruta}"${nulo ? ` data-nulo="1"` : ""}`;
    const campoHTML = filas
      ? `<s-text-area label="${esc(etiqueta)}" rows="${filas}" ${atributos} value="${esc(v)}"></s-text-area>`
      : `<s-text-field label="${esc(etiqueta)}" ${atributos} value="${esc(v)}"></s-text-field>`;
    const admiteIA = Boolean(filas) || /título|texto|nombre|beneficio|titular|subtítulo|contenido|llamada|botón|caption/i.test(etiqueta);
    return `<div class="sp-field">${campoHTML}${EDICION_TEXTO_IA_DISPONIBLE && admiteIA ? `<button type="button" class="sp-ai-trigger" data-ai-text="${esc(ruta)}">${ico("chispa")} Editar con IA</button>` : ""}</div>`;
  }

  function campoNumero(ruta, etiqueta) {
    const v = leer(estado.pagina.data, ruta) ?? 0;
    return `<s-text-field label="${esc(etiqueta)}" type="number" min="0" data-ruta="${ruta}" data-tipo="numero" value="${esc(v)}"></s-text-field>`;
  }

  const selectorEstrellas = (ruta, v) =>
    `<s-select data-ruta="${ruta}" data-tipo="numero" value="${v}">${[0, 5, 4, 3, 2, 1]
      .map((n) => `<s-option value="${n}">${n === 0 ? "Sin calificación" : `${"★".repeat(n)}${"☆".repeat(5 - n)}`}</s-option>`)
      .join("")}</s-select>`;

  // ---- edición sobre el preview, estilo PagePilot ----
  //
  // Nada de formulario lateral: al pasar el mouse por un bloque de la página
  // aparece un botón "✎ Editar" flotando sobre él; al tocarlo se abre un
  // modal con SOLO los campos de ese bloque (o la galería de imágenes).
  // Los cambios pegan en vivo por postMessage; Guardar hace el PUT.

  // Tile "＋ Subir": mete una foto de la compu al producto (media de Shopify)
  // y la deja elegida en el selector desde el que se subió.
  const tileSubir = (destino, ruta) => `
    <label class="galeria-picker__img galeria-picker__subir" title="Subir una imagen desde tu computadora">
      <span class="galeria-picker__subir-mas">${ico("mas")}</span>
      <span class="galeria-picker__subir-txt">Subir</span>
      <input type="file" accept="image/*" hidden data-subir="${destino}" data-ruta-subir="${ruta}">
    </label>`;

  // Selector de imágenes múltiple y ordenado (galería del hero): clic para
  // sacar/agregar; el número es la posición, la 1 es la principal.
  function selectorImagenes(ruta) {
    const urls = estado.pagina.urls || {};
    const pool = (estado.pagina.data.pool_imagenes || []).map((p) => p.media_id);
    const elegidas = leer(estado.pagina.data, ruta) || [];
    return (
      `<div class="galeria-picker">` +
      pool
        .map((id) => {
          const pos = elegidas.indexOf(id);
          return `<button type="button" class="galeria-picker__img ${pos > -1 ? "elegida" : ""}"
            data-img-multi="${ruta}" data-id="${esc(id)}">
            ${urls[id] ? `<img src="${esc(urls[id])}" alt="">` : ico("imagen", "ico--ph")}
            ${pos > -1 ? `<span class="galeria-picker__orden">${pos + 1}</span>` : ""}
          </button>`;
        })
        .join("") +
      tileSubir("multi", ruta) +
      `</div>
      <div class="ayuda">Hacé clic para agregar o sacar. El número es el orden; la 1 es la imagen principal. El botón de subir agrega una foto nueva desde tu computadora.</div>`
    );
  }

  // Selector de UNA imagen (dupla, stats, íconos, foto de reseña).
  // `nulo` agrega la opción "Sin foto" (guarda null).
  function selectorImagenUno(ruta, etiqueta, nulo) {
    const urls = estado.pagina.urls || {};
    const pool = (estado.pagina.data.pool_imagenes || []).map((p) => p.media_id);
    const actual = leer(estado.pagina.data, ruta);
    return (
      (etiqueta ? `<div class="campo campo--editor"><label>${etiqueta}</label></div>` : "") +
      `<div class="galeria-picker galeria-picker--chica">` +
      (nulo
        ? `<button type="button" class="galeria-picker__img galeria-picker__quitar ${actual ? "" : "elegida"}"
             data-img-quitar="${ruta}" aria-label="Quitar foto">${ico("x")}<span>Sin foto</span></button>`
        : "") +
      pool
        .map(
          (id) => `<button type="button" class="galeria-picker__img ${id === actual ? "elegida" : ""}"
            data-img-uno="${ruta}" data-id="${esc(id)}">
            ${urls[id] ? `<img src="${esc(urls[id])}" alt="">` : ico("imagen", "ico--ph")}
          </button>`
        )
        .join("") +
      tileSubir("uno", ruta) +
      `</div>`
    );
  }

  // Lee el archivo, lo manda al server (que lo sube a Shopify como media del
  // producto) y lo deja elegido donde corresponda.
  async function subirImagenNueva(archivo, destino, ruta, inp) {
    const tile = inp.closest("label");
    tile.classList.add("galeria-picker__subir--ocupado");
    tile.querySelector(".galeria-picker__subir-txt").textContent = "Subiendo…";
    try {
      const base64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1]);
        fr.onerror = () => rej(new Error("No se pudo leer el archivo"));
        fr.readAsDataURL(archivo);
      });
      const r = await api(`/paginas/${estado.pagina.id}/imagenes`, {
        method: "POST",
        body: { nombre: archivo.name, mime: archivo.type, base64 }
      });
      estado.pagina.data.pool_imagenes = estado.pagina.data.pool_imagenes || [];
      if (!estado.pagina.data.pool_imagenes.some((p) => p.media_id === r.media_id)) {
        estado.pagina.data.pool_imagenes.push({ media_id: r.media_id, tipo: "producto_limpio" });
      }
      estado.pagina.urls = { ...(estado.pagina.urls || {}), [r.media_id]: r.url };
      if (destino === "multi") {
        const arr = leer(estado.pagina.data, ruta) || [];
        if (!arr.includes(r.media_id)) arr.push(r.media_id);
      } else {
        fijar(estado.pagina.data, ruta, r.media_id);
      }
      marcarSucio();
      repintarPreview();
      refrescarModal();
    } catch (e) {
      tile.classList.remove("galeria-picker__subir--ocupado");
      tile.querySelector(".galeria-picker__subir-txt").textContent = "Subir";
      const cuerpo = document.getElementById("editor-modal-cuerpo");
      cuerpo?.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} No se pudo subir la imagen: ${esc(e.message)}</div>`);
    }
  }

  // Cada bloque editable de la página: título del modal + sus campos.
  // Presets de un toque del botón de compra: setean forma/borde/mayúsculas/ícono
  // juntos. El chip refleja su propia forma (mini del botón). Combinan los looks
  // que pidió el usuario (amarillo = píldora+borde, azul = píldora, verde = bloque).
  const PRESETS_BOTON = [
    ["clasico", "Clásico", { boton_estilo: "redondeado", boton_borde: false, boton_mayus: false, boton_icono: true }],
    ["pildora", "Píldora", { boton_estilo: "pildora", boton_borde: false, boton_mayus: true, boton_icono: true }],
    ["pildoraBorde", "Píldora + borde", { boton_estilo: "pildora", boton_borde: true, boton_mayus: true, boton_icono: true }],
    ["bloque", "Bloque", { boton_estilo: "recto", boton_borde: false, boton_mayus: false, boton_icono: true }],
    ["minimal", "Minimal", { boton_estilo: "redondeado", boton_borde: false, boton_mayus: false, boton_icono: false }]
  ];

  function seccionesPagina() {
    const f = estado.pagina.data.facetas;

    const tarjetasMuro = f.resenas.items
      .map(
        (r, i) => `
        <fieldset class="resena-edit ${r.autor ? "" : "resena-edit--guia"}">
          <legend>Tarjeta ${i + 1}${r.autor ? "" : " · guía"}</legend>
          <div class="fila-doble">
            <input type="text" placeholder="Nombre del cliente" data-nulo="1"
                   data-ruta="facetas.resenas.items.${i}.autor" value="${esc(r.autor ?? "")}">
            ${selectorEstrellas(`facetas.resenas.items.${i}.estrellas`, r.estrellas ?? 0)}
          </div>
          <textarea rows="2" placeholder="Texto de la reseña"
                    data-ruta="facetas.resenas.items.${i}.texto">${esc(r.texto ?? "")}</textarea>
          <details class="resena-edit__foto">
            <summary>${ico("imagen")} Foto del cliente${r.imagen ? " · elegida" : ""}</summary>
            ${selectorImagenUno(`facetas.resenas.items.${i}.imagen`, "", true)}
          </details>
        </fieldset>`
      )
      .join("");

    return {
      galeria: { titulo: "Editar galería de imágenes", html: () => selectorImagenes("facetas.hero.galeria") },
      encabezado: {
        titulo: "Encabezado",
        html: () => {
          const nichoActual = leer(estado.pagina.data, "global.nicho") || "general";
          const NICHOS = [
            ["general", "General"], ["belleza", "Belleza / cosmética"], ["salud", "Salud / bienestar"],
            ["hogar", "Hogar / cocina"], ["mascotas", "Mascotas"], ["tech", "Tecnología"],
            ["fitness", "Fitness / deporte"], ["bebes", "Bebés / niños"], ["moda", "Moda / joyas / perfume"]
          ];
          // Piloto de conversión al panel .pe-prop (estilo harness/PagePilot):
          // grupos + controles nativos. Los binding van por data-ruta (no por
          // clase), así que el markup nuevo se guarda igual que el viejo.
          const _v = (r, d = "") => esc(leer(estado.pagina.data, r) ?? d);
          const _pt = leer(estado.pagina.data, "facetas.hero.puntaje") ?? 4.9;
          const filaStack = (label, inputHTML) =>
            `<div class="pe-prop__fila pe-prop__fila--stack"><label class="pe-prop__label">${label}</label><div class="pe-prop__control">${inputHTML}</div></div>`;
          const filaSwitch = (label, ruta, on) =>
            `<div class="pe-prop__fila"><label class="pe-prop__label">${label}</label><div class="pe-prop__control"><input type="checkbox" class="pe-switch-input" data-ruta="${ruta}" data-tipo="bool"${on ? " checked" : ""}></div></div>`;
          const _chev = `<svg class="pe-select__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
          const _forma = leer(estado.pagina.data, "global.boton_estilo") || "redondeado";
          const _formaOpts = [["redondeado", "Redondeado"], ["pildora", "Píldora"], ["recto", "Recto"]]
            .map(([k, t]) => `<option value="${k}"${_forma === k ? " selected" : ""}>${t}</option>`).join("");
          const _gB = { boton_estilo: _forma, boton_borde: !!leer(estado.pagina.data, "global.boton_borde"), boton_mayus: !!leer(estado.pagina.data, "global.boton_mayus"), boton_icono: leer(estado.pagina.data, "global.boton_icono") !== false };
          const _presetAct = (PRESETS_BOTON.find(([, , v]) => v.boton_estilo === _gB.boton_estilo && v.boton_borde === _gB.boton_borde && v.boton_mayus === _gB.boton_mayus && v.boton_icono === _gB.boton_icono) || [])[0];
          const _presetRow = `<div class="pe-preset-row">${PRESETS_BOTON.map(([k, t]) => `<button type="button" class="pe-preset pe-preset--${k}${_presetAct === k ? " is-on" : ""}" data-boton-preset="${k}">${esc(t)}</button>`).join("")}</div>`;
          return (
            `<section class="pe-prop__grupo"><h3 class="pe-prop__subheader">Contenido</h3>` +
              filaStack("Barra de urgencia (arriba de todo)", `<input class="pe-input" type="text" data-ruta="facetas.hero.urgencia" value="${_v("facetas.hero.urgencia")}">`) +
              filaStack("Título", `<input class="pe-input" type="text" data-ruta="facetas.hero.titulo" value="${_v("facetas.hero.titulo")}">`) +
              filaStack("Texto del botón de compra", `<input class="pe-input" type="text" data-ruta="global.cta" value="${_v("global.cta")}">`) +
            `</section>` +
            `<section class="pe-prop__grupo"><h3 class="pe-prop__subheader">Reseñas y puntaje</h3>` +
              `<div class="pe-prop__fila"><label class="pe-prop__label">Cantidad de reseñas</label><div class="pe-prop__control"><span class="pe-num__box"><input class="pe-num__input" style="width:56px" type="number" min="0" data-ruta="facetas.hero.resenas_count" data-tipo="numero" value="${_v("facetas.hero.resenas_count", 0)}"></span></div></div>` +
              filaStack("Puntaje (de 5, ej. 4.9)",
                `<div class="pe-num"><input class="pe-num__range" type="range" min="0" max="5" step="0.1" data-ruta="facetas.hero.puntaje" data-tipo="numero" value="${esc(_pt)}"><span class="pe-num__box"><input class="pe-num__input" type="number" min="0" max="5" step="0.1" data-ruta="facetas.hero.puntaje" data-tipo="numero" value="${esc(_pt)}"></span></div>`) +
            `</section>` +
            `<section class="pe-prop__grupo"><h3 class="pe-prop__subheader">Estilo</h3>` +
              filaStack("Color de la página", swatchesTema(leer(estado.pagina.data, "global.tema"))) +
              filaStack("Rubro (define el color si elegís “Automático”)",
                `<div class="pe-select pe-select--full"><s-select data-ruta="global.nicho" value="${esc(nichoActual)}" labelAccessibilityVisibility="exclusive" label="Rubro">${NICHOS.map(([k, t]) => `<s-option value="${k}">${t}</s-option>`).join("")}</s-select></div>`) +
            `</section>` +
            `<section class="pe-prop__grupo"><h3 class="pe-prop__subheader">Botón de compra</h3>` +
              _presetRow +
              `<div class="pe-prop__fila"><label class="pe-prop__label">Forma</label><div class="pe-prop__control"><div class="pe-select"><select data-ruta="global.boton_estilo">${_formaOpts}</select>${_chev}</div></div></div>` +
              filaSwitch("Borde", "global.boton_borde", !!leer(estado.pagina.data, "global.boton_borde")) +
              filaSwitch("Mayúsculas", "global.boton_mayus", !!leer(estado.pagina.data, "global.boton_mayus")) +
              filaSwitch("Ícono de carrito", "global.boton_icono", leer(estado.pagina.data, "global.boton_icono") !== false) +
            `</section>`
          );
        }
      },
      bullets: {
        titulo: "Beneficios del producto",
        html: () => {
          return (
            f.hero.bullets
              .map(
                (b, i) => `
              <fieldset class="resena-edit">
                <legend>Beneficio ${i + 1}</legend>
                <div class="fila-triple" style="grid-template-columns:56px 1fr">
                  <input type="text" data-ruta="facetas.hero.bullets.${i}.emoji" value="${esc(b.emoji ?? "")}" placeholder="💧" title="Emoji" maxlength="4">
                  <input type="text" data-ruta="facetas.hero.bullets.${i}.fuerte" value="${esc(b.fuerte ?? "")}" placeholder="Arranque (en negrita)">
                </div>
                <div class="fila-triple" style="grid-template-columns:1fr;margin-bottom:0">
                  <input type="text" data-ruta="facetas.hero.bullets.${i}.resto" value="${esc(b.resto ?? "")}" placeholder="Resto de la frase">
                </div>
              </fieldset>`
              )
              .join("")
          );
        }
      },
      destacada: {
        titulo: "Reseña destacada",
        html: () =>
          campo("facetas.hero.resena_destacada.autor", "Nombre", 0, true) +
          campo("facetas.hero.resena_destacada.texto", "Texto", 3, true) +
          `<div class="campo campo--editor"><label>Estrellas</label>${selectorEstrellas(
            "facetas.hero.resena_destacada.estrellas",
            f.hero.resena_destacada.estrellas ?? 0
          )}</div>`
      },
      acordeones: {
        titulo: "Envío y devoluciones",
        html: () =>
          (f.hero.acordeones ?? [])
            .map(
              (_, i) =>
                campo(`facetas.hero.acordeones.${i}.titulo`, `Acordeón ${i + 1} · título`) +
                campo(`facetas.hero.acordeones.${i}.contenido`, `Acordeón ${i + 1} · contenido`, 2)
            )
            .join("")
      },
      clientes: {
        titulo: "Muro de clientes (gifs/videos)",
        html: () => {
          // Aseguramos la estructura en el estado para poder agregar/quitar.
          if (!f.clientes) f.clientes = { titulo: "", items: [] };
          if (!Array.isArray(f.clientes.items)) f.clientes.items = [];
          const items = f.clientes.items;
          return (
            `<div class="editor__ayuda">Admite GIF, MP4 y enlaces de video.</div>` +
            campo("facetas.clientes.titulo", "Título de la sección") +
            (items.length
              ? items
                  .map(
                    (it, i) => `
              <fieldset class="resena-edit clip-drop">
                <legend>Clip ${i + 1}${manijasMuro(i, items.length)}</legend>
                ${campo(`facetas.clientes.items.${i}.url`, "Enlace del gif o video")}
                <label class="btn btn--fantasma btn--chico sec-subir-video" style="cursor:pointer">${ico("subir")} Subir o arrastrar video/gif
                  <input type="file" accept="image/*,video/*" hidden data-video-el="muro:${i}">
                </label>
                <div class="clip-drop__hint">o arrastrá el archivo hasta acá</div>
                <div class="clip-estado">${estadoClip(it && it.url)}</div>
              </fieldset>`
                  )
                  .join("")
              : "") +
            `<button class="btn btn--fantasma" type="button" data-muro-add="1">${ico("mas")} Agregar clip</button>`
          );
        }
      },
      iconos: {
        titulo: "Beneficios (íconos)",
        html: () =>
          campo("facetas.iconos.titular", "Titular") +
          campo("facetas.iconos.subtitulo", "Subtítulo") +
          f.iconos.items
            .map(
              (_, i) => `
              <div class="fila-triple">
                <input type="text" data-ruta="facetas.iconos.items.${i}.emoji" value="${esc(f.iconos.items[i].emoji)}" title="Emoji">
                <input type="text" data-ruta="facetas.iconos.items.${i}.titulo" value="${esc(f.iconos.items[i].titulo)}" placeholder="Título">
              </div>
              <div class="campo campo--editor">
                <textarea rows="2" data-ruta="facetas.iconos.items.${i}.frase" placeholder="Frase">${esc(f.iconos.items[i].frase)}</textarea>
              </div>`
            )
            .join("") +
          selectorImagenUno("facetas.iconos.imagen_central", "Imagen central")
      },
      stats: {
        titulo: "Estadísticas",
        html: () =>
          campo("facetas.stats.titular", "Titular") +
          f.stats.items
            .map((x, i) => campo(`facetas.stats.items.${i}.frase`, `${x.pct}% — frase (sin números)`, 2))
            .join("") +
          selectorImagenUno("facetas.stats.imagen", "Imagen del bloque")
      },
      tabla: {
        titulo: "Comparacion",
        html: () =>
          campo("facetas.tabla.titular", "Titular") +
          campo("facetas.tabla.parrafo", "Texto introductorio", 2) +
          campo("facetas.tabla.col_otros", "Nombre de la columna alternativa") +
          (f.tabla?.filas || [])
            .map((_, i) => campo(`facetas.tabla.filas.${i}`, `Fila ${i + 1}`))
            .join("")
      },
      garantia: {
        titulo: "Garantia",
        html: () =>
          campo("facetas.garantia.titular", "Titular") +
          campo("facetas.garantia.parrafo", "Texto", 3) +
          selectorImagenUno("facetas.garantia.imagen", "Imagen")
      },
      faq: {
        titulo: "Preguntas frecuentes",
        html: () =>
          campo("facetas.faq.titular", "Titular") +
          f.faq.items
            .map(
              (_, i) =>
                `<div class="sp-item-card"><div class="sp-item-card__head"><strong>Pregunta ${i + 1}</strong><span>FAQ</span></div>` +
                campo(`facetas.faq.items.${i}.pregunta`, `Pregunta ${i + 1}`) +
                campo(`facetas.faq.items.${i}.respuesta`, `Respuesta ${i + 1}`, 2) +
                `</div>`
            )
            .join("")
      },
      resenas: {
        titulo: "Muro de reseñas",
        html: () =>
          campo("facetas.resenas.titular", "Titular") +
          campo("facetas.resenas.subtitulo", "Subtítulo") +
          `
          <div class="cargador">
            <label>Cargar reseñas reales en lote</label>
            <textarea id="lote" rows="6" placeholder="María G.
Me llegó en 3 días y funciona tal cual el video."></textarea>
            <button class="btn btn--fantasma" id="btn-lote" type="button">${ico("importar")} Volcar al muro</button>
            <div class="ayuda">Una reseña por bloque, separadas por una línea en blanco: la primera línea es el nombre y el resto el texto. Van reemplazando las tarjetas guía desde la primera.</div>
          </div>` +
          tarjetasMuro
      },
      pagepilot_blue: {
        titulo: "Plantilla PagePilot Blue",
        html: () => {
          const pb = f.pagepilot_blue || (f.pagepilot_blue = {});
          const social = pb.social || (pb.social = {});
          const how = pb.como_funciona || (pb.como_funciona = {});
          const feature = pb.feature || (pb.feature = {});
          const panel = pb.panel || (pb.panel = {});
          const stats = pb.blue_stats || (pb.blue_stats = {});
          const comparison = pb.comparison || (pb.comparison = {});
          const faq = pb.faq || (pb.faq = {});
          const reviews = pb.reviews || (pb.reviews = {});
          const accordions = Array.isArray(pb.acordeones) ? pb.acordeones : (pb.acordeones = Array.from({ length: 3 }, (_, i) => ({ titulo: ["Descripción", "Cómo usar", "Envíos y devoluciones"][i], contenido: "Contenido editable de esta sección." })));
          const items = Array.isArray(feature.items) ? feature.items : (feature.items = Array.from({ length: 5 }, () => ({ titulo: "", frase: "" })));
          const statItems = Array.isArray(stats.items) ? stats.items : (stats.items = Array.from({ length: 4 }, () => ({ pct: "", frase: "" })));
          const comparisonRows = Array.isArray(comparison.filas) ? comparison.filas : (comparison.filas = Array.from({ length: 6 }, () => ""));
          const faqItems = Array.isArray(faq.items) ? faq.items : (faq.items = Array.from({ length: 5 }, () => ({ pregunta: "", respuesta: "" })));
          const reviewItems = Array.isArray(reviews.items) ? reviews.items : (reviews.items = Array.from({ length: 4 }, () => ({ autor: "", estrellas: null, texto: "", imagen: null })));
          const ticker = Array.isArray(pb.ticker) ? pb.ticker : (pb.ticker = Array.from({ length: 5 }, () => ({ texto: "", icono: "check" })));
          const socialImgs = Array.isArray(social.imagenes) ? social.imagenes : (social.imagenes = [null, null, null]);
          const pagos = Array.isArray(pb.pagos) ? pb.pagos : (pb.pagos = ["amex", "apple", "visa", "mastercard", "paypal", "gpay", "shop"]);
          const pagoNombres = { amex: "American Express", apple: "Apple Pay", visa: "Visa", mastercard: "Mastercard", paypal: "PayPal", gpay: "Google Pay", shop: "Shop Pay" };
          const val = (ruta, fallback = "") => esc(leer(estado.pagina.data, ruta) ?? fallback);
          const input = (ruta, label, fallback = "") => `<div class="campo campo--editor"><label>${label}</label><input type="text" data-ruta="${ruta}" value="${val(ruta, fallback)}"></div>`;
          return `<div class="editor__ayuda">Esta composición mantiene todas las secciones de la preview. Los textos, imágenes y medios de pago son editables y los placeholders se reemplazan sin tocar el tema de Shopify.</div>` +
            input("facetas.pagepilot_blue.badge", "Badge superior", "#1 EL MÁS VENDIDO DE 2026") +
            `<h3 class="pe-prop__subheader">Ticker</h3>` + ticker.slice(0, 5).map((_, i) => input(`facetas.pagepilot_blue.ticker.${i}.texto`, `Mensaje ${i + 1}`, ["Aplicación sencilla", "Calidad diaria", "Resultados rápidos", "Naturalidad total", "Mirada realzada"][i])).join("") +
            `<h3 class="pe-prop__subheader">Prueba social</h3>` + input("facetas.pagepilot_blue.social.titular", "Titular", "Miles confían. Mujeres reales eligen calidad.") + input("facetas.pagepilot_blue.social.enfasis", "Texto en cursiva", "Mujeres reales") + input("facetas.pagepilot_blue.social.subtitulo", "Subtítulo", "Descubrí una experiencia pensada para hacer más simple tu rutina.") + input("facetas.pagepilot_blue.social.cta", "Texto del botón", "Obtené el tuyo ahora") + socialImgs.slice(0, 3).map((_, i) => input(`facetas.pagepilot_blue.social.imagenes.${i}`, `Imagen UGC ${i + 1}`, "tiq-placeholder-ugc-" + (i + 1) + ".svg")).join("") +
            `<h3 class="pe-prop__subheader">Cómo funciona</h3>` + input("facetas.pagepilot_blue.como_funciona.titular", "Titular", "¿Cómo funciona este producto?") + [0, 1, 2].map((i) => input(`facetas.pagepilot_blue.como_funciona.parrafos.${i}`, `Párrafo ${i + 1}`, "Texto editable de la sección.")).join("") + input("facetas.pagepilot_blue.como_funciona.imagen", "Imagen", "tiq-placeholder-detail.svg") +
            `<h3 class="pe-prop__subheader">Acordeones del hero</h3>` + accordions.slice(0, 3).map((_, i) => input(`facetas.pagepilot_blue.acordeones.${i}.titulo`, `Título ${i + 1}`, ["Descripción", "Cómo usar", "Envíos y devoluciones"][i]) + input(`facetas.pagepilot_blue.acordeones.${i}.contenido`, `Contenido ${i + 1}`, "Contenido editable de esta sección.")).join("") +
            `<h3 class="pe-prop__subheader">5 beneficios</h3>` + input("facetas.pagepilot_blue.feature.titular", "Titular", "5 beneficios diarios del producto") + input("facetas.pagepilot_blue.feature.subtitulo", "Subtítulo", "Potenciá tu rutina para disfrutar un resultado que se nota.") + items.slice(0, 5).map((_, i) => input(`facetas.pagepilot_blue.feature.items.${i}.titulo`, `Beneficio ${i + 1}`, "Beneficio diario") + input(`facetas.pagepilot_blue.feature.items.${i}.frase`, `Descripción ${i + 1}`, "Pensado para acompañarte con comodidad.")).join("") + input("facetas.pagepilot_blue.feature.imagen", "Imagen del bloque", "tiq-placeholder-detail.svg") +
            `<h3 class="pe-prop__subheader">Estadísticas del producto</h3>` + input("facetas.pagepilot_blue.blue_stats.titular", "Titular", "Estadísticas del producto") + input("facetas.pagepilot_blue.blue_stats.subtitulo", "Subtítulo", "Agregá una fuente válida antes de publicar estadísticas.") + statItems.slice(0, 4).map((_, i) => input(`facetas.pagepilot_blue.blue_stats.items.${i}.pct`, `Porcentaje ${i + 1}`, "") + input(`facetas.pagepilot_blue.blue_stats.items.${i}.frase`, `Frase ${i + 1}`, "")).join("") +
            `<h3 class="pe-prop__subheader">Comparación</h3>` + input("facetas.pagepilot_blue.comparison.titular", "Titular", "Comparalo vos misma") + input("facetas.pagepilot_blue.comparison.parrafo", "Texto", "Mirá por qué esta propuesta se destaca frente a las alternativas.") + input("facetas.pagepilot_blue.comparison.cta", "Texto del botón", "Obtené el tuyo ahora") + input("facetas.pagepilot_blue.comparison.otros", "Columna alternativa", "Otros") + comparisonRows.slice(0, 6).map((_, i) => input(`facetas.pagepilot_blue.comparison.filas.${i}`, `Fila ${i + 1}`, ["Mayor definición", "Aplicación fluida", "Resultado natural", "Sin grumos", "Secado rápido", "Resistencia diaria"][i])).join("") +
            `<h3 class="pe-prop__subheader">Reseñas</h3>` + input("facetas.pagepilot_blue.reviews.badge", "Badge de reseñas", "Reseñas") + input("facetas.pagepilot_blue.reviews.titular", "Titular", "Experiencias de clientes") + input("facetas.pagepilot_blue.reviews.subtitulo", "Subtítulo", "Importá reseñas reales antes de activar esta sección.") + reviewItems.slice(0, 4).map((_, i) => input(`facetas.pagepilot_blue.reviews.items.${i}.autor`, `Nombre ${i + 1}`, "") + input(`facetas.pagepilot_blue.reviews.items.${i}.texto`, `Texto ${i + 1}`, "") + input(`facetas.pagepilot_blue.reviews.items.${i}.imagen`, `Foto ${i + 1}`, "")).join("") +
            `<h3 class="pe-prop__subheader">Preguntas frecuentes</h3>` + input("facetas.pagepilot_blue.faq.titular", "Titular", "Preguntas frecuentes") + input("facetas.pagepilot_blue.faq.subtitulo", "Subtítulo", "Todo lo que necesitás saber antes de comprarlo.") + faqItems.slice(0, 5).map((_, i) => input(`facetas.pagepilot_blue.faq.items.${i}.pregunta`, `Pregunta ${i + 1}`, ["¿De qué material está hecho?", "¿Cómo se usa?", "¿Cómo se limpia o mantiene?", "¿Qué colores tiene disponibles?", "¿Qué pasa si no estoy conforme?"][i]) + input(`facetas.pagepilot_blue.faq.items.${i}.respuesta`, `Respuesta ${i + 1}`, "Consultá la ficha del producto y la política de devolución.")).join("") +
            `<h3 class="pe-prop__subheader">Recomendados</h3><div class="editor__ayuda">Se cargan automáticamente desde las recomendaciones reales del catálogo de Shopify. No se guardan precios ni descuentos de ejemplo.</div>` +
            `<h3 class="pe-prop__subheader">Panel azul y pagos</h3>` + input("facetas.pagepilot_blue.panel.titular", "Titular del panel", "Una mejora simple para cada día") + input("facetas.pagepilot_blue.panel.subtitulo", "Texto del panel", "Sumá una solución pensada para acompañarte con comodidad.") + input("facetas.pagepilot_blue.panel.imagen", "Imagen del panel", "tiq-placeholder-detail.svg") + `<div class="campo campo--editor"><label>Medios de pago activos</label><div class="fila-triple">${Object.entries(pagoNombres).map(([id, nombre]) => `<label><input type="checkbox" data-ppb-payment="${id}"${pagos.includes(id) ? " checked" : ""}> ${nombre}</label>`).join("")}</div></div>`;
        }
      }
    };
  }

  // ---- el modal de edición ----

  let modalSec = null; // sección abierta

  function cerrarModalEdicion() {
    const m = document.getElementById("editor-modal");
    if (m?._onKey) document.removeEventListener("keydown", m._onKey);
    m?.remove();
    // Devolver el foco a donde estaba antes de abrir (a11y).
    if (m?._focoPrevio && document.contains(m._focoPrevio)) { try { m._focoPrevio.focus(); } catch {} }
    modalSec = null;
    modalDef = null;
  }

  let modalDef = null; // def activa del modal (bloque fijo o section)

  // GOTCHA Polaris: <s-select> NO toma el atributo `value` al montar → se fija la
  // propiedad post-render leyendo del modelo por data-ruta. Idempotente: sincroniza
  // TODOS los s-select[data-ruta] del documento (cubre modal + panel de sección).
  function sincSelectsPag() {
    if (!estado.pagina?.data) return;
    document.querySelectorAll("s-select[data-ruta]").forEach((sel) => {
      const v = leer(estado.pagina.data, sel.dataset.ruta);
      if (v != null && v !== "") sel.value = String(v);
    });
  }

  function refrescarModal() {
    const cuerpo = document.getElementById("editor-modal-cuerpo");
    if (cuerpo && modalDef) cuerpo.innerHTML = modalDef.html();
    // Las subidas de imagen/video reutilizan estos helpers; si lo abierto es el
    // panel lateral de una sección v2, refrescalo también.
    refrescarPanelSeccion();
    sincSelectsPag();
  }

  // ---- editor de una section incrustada ----

  const ANCLAS_UBICACION = [
    ["top", "Al principio de la página"],
    ["hero", "Después del encabezado"],
    ["clientes", "Después del muro de clientes"],
    ["faq", "Después de las preguntas"],
    ["iconos", "Después de los beneficios"],
    ["stats", "Después de las estadísticas"],
    ["tabla", "Después de la comparación"],
    ["resenas", "Después de las reseñas"],
    ["garantia", "Después de la garantía"],
    ["recomendados", "Al final de la página"]
  ];

  function defSeccion(secId) {
    const secs = estado.pagina.data.secciones || [];
    const i = secs.findIndex((s) => s.id === secId);
    if (i < 0) return null;
    const s = secs[i];
    return {
      titulo: s.tipo === "videos" ? "Videos de producto" : s.tipo === "videoslider" ? "Video slider" : "Carrusel de imágenes",
      html: () => htmlSeccion(secs[i], i)
    };
  }

  function htmlSeccion(s, i) {
    const base = `secciones.${i}`;
    const ubicacion = `
      <s-select label="Ubicación en la página" data-ruta="${base}.ancla" value="${esc(s.ancla || "top")}">
        ${ANCLAS_UBICACION.map(([v, t]) => `<s-option value="${v}">${t}</s-option>`).join("")}
      </s-select>`;
    const tituloCampo = (s.tipo === "videos" || s.tipo === "videoslider") ? campo(`${base}.titulo`, "Título de la sección") : "";
    const cabecera = tituloCampo + ubicacion;

    let items = "";
    if (s.tipo === "videoslider") {
      items = (s.items || [])
        .map(
          (it, j) => `
          <fieldset class="sec-item">
            <legend>Video ${j + 1}${manijasItem(i, j, s.items.length)}</legend>
            ${campo(`${base}.items.${j}.url`, "Enlace del video (YouTube, Vimeo o MP4)")}
            <label class="btn btn--fantasma btn--chico sec-subir-video" style="cursor:pointer">${ico("subir")} Subir video de tu computadora
              <input type="file" accept="video/*" hidden data-video-el="${i}:${j}">
            </label>
            ${it.url && /^https?:\/\/cdn\.shopify/.test(it.url) ? `<div class="ayuda" style="margin-top:6px">${ico("check")} Video subido</div>` : ""}
            ${campo(`${base}.items.${j}.titulo`, "Nombre / título (ej. Jess B.)", 0, true)}
            <div class="campo campo--editor"><label>Estrellas</label>${selectorEstrellas(`${base}.items.${j}.estrellas`, it.estrellas ?? 0)}</div>
            <details class="resena-edit__foto">
              <summary>${ico("imagen")} Miniatura del video (opcional)${it.poster ? " · elegida" : ""}</summary>
              ${selectorImagenUno(`${base}.items.${j}.poster`, "", true)}
            </details>
          </fieldset>`
        )
        .join("");
      items += `<button class="btn btn--fantasma" type="button" data-sec-add="${i}:videoslider">${ico("mas")} Agregar video</button>`;
    } else if (s.tipo === "videos") {
      items = (s.items || [])
        .map(
          (it, j) => `
          <fieldset class="sec-item">
            <legend>Video ${j + 1}${manijasItem(i, j, s.items.length)}</legend>
            ${campo(`${base}.items.${j}.url`, "Enlace del video (YouTube, Vimeo o MP4)")}
            <label class="btn btn--fantasma btn--chico sec-subir-video" style="cursor:pointer">${ico("subir")} Subir video de tu computadora
              <input type="file" accept="video/*" hidden data-video-el="${i}:${j}">
            </label>
            ${it.url && /^https?:\/\/cdn\.shopify/.test(it.url) ? `<div class="ayuda" style="margin-top:6px">${ico("check")} Video subido</div>` : ""}
            <details class="resena-edit__foto">
              <summary>${ico("imagen")} Miniatura (opcional)${it.poster ? " · elegida" : ""}</summary>
              ${selectorImagenUno(`${base}.items.${j}.poster`, "", true)}
            </details>
          </fieldset>`
        )
        .join("");
      items += `<button class="btn btn--fantasma" type="button" data-sec-add="${i}:video">${ico("mas")} Agregar video</button>`;
    } else {
      items = (s.items || [])
        .map(
          (it, j) => `
          <fieldset class="sec-item">
            <legend>Imagen ${j + 1}${manijasItem(i, j, s.items.length)}</legend>
            ${selectorImagenUno(`${base}.items.${j}.media_id`, "Imagen", false)}
            ${campo(`${base}.items.${j}.caption`, "Texto sobre la imagen (opcional)", 0, true)}
            ${campo(`${base}.items.${j}.link`, "Enlace al tocar (opcional)", 0, true)}
          </fieldset>`
        )
        .join("");
      items += `<button class="btn btn--fantasma" type="button" data-sec-add="${i}:imagen">${ico("mas")} Agregar imagen</button>`;
    }

    return (
      cabecera +
      `<div class="ui-separador"></div>` +
      items +
      `<div class="ui-separador"></div>
       <button class="btn btn--fantasma sec-borrar" type="button" data-sec-borrar="${s.id}">${ico("basura")} Eliminar esta sección</button>`
    );
  }

  // ↑↓ y ✕ de cada clip del muro de clientes
  const manijasMuro = (i, total) => `
    <span class="sec-item__manijas">
      <button type="button" data-muro-mov="${i}:-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">${ico("flechaArriba")}</button>
      <button type="button" data-muro-mov="${i}:1" ${i === total - 1 ? "disabled" : ""} aria-label="Bajar">${ico("flechaAbajo")}</button>
      <button type="button" data-muro-del="${i}" aria-label="Quitar">${ico("basura")}</button>
    </span>`;

  // ↑↓ y ✕ de cada item de una section
  const manijasItem = (i, j, total) => `
    <span class="sec-item__manijas">
      <button type="button" data-sec-mov="${i}:${j}:-1" ${j === 0 ? "disabled" : ""} aria-label="Subir">${ico("flechaArriba")}</button>
      <button type="button" data-sec-mov="${i}:${j}:1" ${j === total - 1 ? "disabled" : ""} aria-label="Bajar">${ico("flechaAbajo")}</button>
      <button type="button" data-sec-item-del="${i}:${j}" aria-label="Quitar">${ico("basura")}</button>
    </span>`;

  function accionSeccion(target) {
    // Muro de clientes: agregar / quitar / mover clips (cantidad libre).
    const f = estado.pagina.data.facetas;
    const muroAdd = target.closest("[data-muro-add]");
    if (muroAdd) {
      if (!f.clientes) f.clientes = { titulo: "", items: [] };
      (f.clientes.items ||= []).push({ url: "", poster: null });
      return true;
    }
    const muroDel = target.closest("[data-muro-del]");
    if (muroDel) {
      f.clientes?.items?.splice(Number(muroDel.dataset.muroDel), 1);
      return true;
    }
    const muroMov = target.closest("[data-muro-mov]");
    if (muroMov) {
      const [i, d] = muroMov.dataset.muroMov.split(":").map(Number);
      const arr = f.clientes?.items || [];
      const k = i + d;
      if (k >= 0 && k < arr.length) [arr[i], arr[k]] = [arr[k], arr[i]];
      return true;
    }

    const secs = estado.pagina.data.secciones;
    const add = target.closest("[data-sec-add]");
    if (add) {
      const [i, tipo] = add.dataset.secAdd.split(":");
      secs[+i].items.push(
        tipo === "video" ? { url: "", poster: null }
        : tipo === "videoslider" ? { url: "", poster: null, titulo: "", estrellas: null }
        : { media_id: null, caption: "", link: "" }
      );
      return true;
    }
    const del = target.closest("[data-sec-item-del]");
    if (del) {
      const [i, j] = del.dataset.secItemDel.split(":").map(Number);
      secs[i].items.splice(j, 1);
      return true;
    }
    const mov = target.closest("[data-sec-mov]");
    if (mov) {
      const [i, j, d] = mov.dataset.secMov.split(":").map(Number);
      const arr = secs[i].items;
      const k = j + d;
      if (k >= 0 && k < arr.length) [arr[j], arr[k]] = [arr[k], arr[j]];
      return true;
    }
    const borrar = target.closest("[data-sec-borrar]");
    if (borrar) {
      const idx = secs.findIndex((s) => s.id === borrar.dataset.secBorrar);
      if (idx > -1) secs.splice(idx, 1);
      if (panelEditorId) cerrarPanelSeccion();
      else cerrarModalEdicion();
      marcarSucio();
      repintarPreview();
      return "cerrado";
    }
    return false;
  }

  function toggleImagenGaleria(ruta, id) {
    const arr = leer(estado.pagina.data, ruta) || [];
    const i = arr.indexOf(id);
    if (i > -1) arr.splice(i, 1);
    else arr.push(id);
    marcarSucio();
    clearTimeout(timerPreview);
    timerPreview = setTimeout(repintarPreview, 150);
  }

  function abrirModalEdicion(id) {
    // Todas las piezas del editor usan ahora el inspector lateral. Se conserva
    // el modal debajo durante la migración para no perder sus helpers antiguos.
    return abrirPanelEditor(id);

    // Las secciones v2 (schema-driven, ej. Video slider) usan el PANEL LATERAL
    // estilo Section Store, no el modal. Las clásicas (videos/carrusel) siguen
    // con el modal viejo.
    if (id.startsWith("sec:")) {
      const s = (estado.pagina.data.secciones || []).find((x) => x.id === id.slice(4));
      if (s && catSeccion(s.tipo)?.schema) { cerrarModalEdicion(); return abrirPanelSeccion(s.id); }
    }
    cerrarModalEdicion();
    const def = id.startsWith("sec:") ? defSeccion(id.slice(4)) : seccionesPagina()[id];
    if (!def) return;
    modalSec = id;
    modalDef = def;

    // Panel .pe-prop (look harness): si el form ya trae sus grupos (Encabezado),
    // se usa tal cual; si no, se envuelve en un grupo con subheader corto para
    // que todas las secciones se vean consistentes y agrupadas como PagePilot.
    const _SUBH = { galeria: "Imágenes", bullets: "Beneficios", destacada: "Reseña destacada", acordeones: "Envío y devoluciones", clientes: "Clips (gifs/videos)", iconos: "Íconos", stats: "Estadísticas", faq: "Preguntas frecuentes", resenas: "Reseñas" };
    const _htmlSec = def.html();
    const _cuerpoSec = _htmlSec.includes("pe-prop__grupo")
      ? _htmlSec
      : `<section class="pe-prop__grupo">${_SUBH[id] ? `<h3 class="pe-prop__subheader">${_SUBH[id]}</h3>` : ""}${_htmlSec}</section>`;

    const m = document.createElement("div");
    m.className = "editor-modal";
    m.id = "editor-modal";
    m.innerHTML = `
      <div class="editor-modal__caja" role="dialog" aria-modal="true" aria-labelledby="editor-modal-titulo">
        <div class="editor-modal__cab">
          <span id="editor-modal-titulo">${def.titulo}</span>
          <button class="editor-modal__x" type="button" aria-label="Cerrar">${ico("x")}</button>
        </div>
        <div class="editor-modal__cuerpo" id="editor-modal-cuerpo">${_cuerpoSec}</div>
        <div class="editor-modal__pie">
          <button class="btn btn--acento" id="editor-modal-guardar" type="button">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    sincSelectsPag(); // fija el .value de los s-select del modal (gotcha Polaris)

    // A11y: Esc cierra, foco al primer control, y se devuelve el foco al cerrar.
    m._focoPrevio = document.activeElement;
    m._onKey = (e) => { if (e.key === "Escape") cerrarModalEdicion(); };
    document.addEventListener("keydown", m._onKey);
    const primero = m.querySelector(".editor-modal__cuerpo input, .editor-modal__cuerpo select, .editor-modal__cuerpo textarea, .editor-modal__cuerpo button");
    (primero || m.querySelector(".editor-modal__x"))?.focus();

    m.addEventListener("input", (e) => {
      if (e.target.dataset.ruta) {
        actualizarDato(e.target);
        // Espeja controles hermanos con la misma ruta (ej. slider ↔ input del puntaje).
        m.querySelectorAll(`[data-ruta="${e.target.dataset.ruta}"]`).forEach((o) => {
          if (o !== e.target && o.value !== e.target.value) o.value = e.target.value;
        });
      }
      // Feedback en vivo del clip del muro (sin re-render, no pierde foco).
      if (/^facetas\.clientes\.items\.\d+\.url$/.test(e.target.dataset.ruta || "")) {
        const st = e.target.closest(".clip-drop")?.querySelector(".clip-estado");
        if (st) st.innerHTML = estadoClip(e.target.value);
      }
    });
    m.addEventListener("click", async (e) => {
      if (e.target === m || e.target.closest(".editor-modal__x")) return cerrarModalEdicion();
      if (e.target.id === "editor-modal-guardar") {
        await guardarCambios();
        cerrarModalEdicion();
        return;
      }
      if (e.target.id === "btn-lote") return cargarLote();
      const ppbPago = e.target.closest("[data-ppb-payment]");
      if (ppbPago) {
        const ruta = "facetas.pagepilot_blue.pagos";
        const pagos = leer(estado.pagina.data, ruta) || [];
        const idPago = ppbPago.dataset.ppbPayment;
        fijar(estado.pagina.data, ruta, ppbPago.checked ? [...new Set([...pagos, idPago])] : pagos.filter((id) => id !== idPago));
        marcarSucio();
        repintarPreview();
        return;
      }
      // preset de un toque del botón de compra: setea forma/borde/mayús/ícono juntos
      const bp = e.target.closest("[data-boton-preset]");
      if (bp) {
        const p = (PRESETS_BOTON.find(([k]) => k === bp.dataset.botonPreset) || [])[2];
        if (p) { Object.entries(p).forEach(([k, v]) => fijar(estado.pagina.data, "global." + k, v)); marcarSucio(); repintarPreview(); refrescarModal(); }
        return;
      }
      // elegir variante de color (swatch)
      const sw = e.target.closest("[data-tema-pick]");
      if (sw) {
        const v = sw.dataset.temaPick;
        fijar(estado.pagina.data, "global.tema", v === "auto" ? null : v);
        marcarSucio();
        repintarPreview();
        refrescarModal();
        return;
      }
      // acciones de section (agregar/quitar/mover items, borrar section)
      const accion = accionSeccion(e.target);
      if (accion === "cerrado") return;
      if (accion) {
        marcarSucio();
        repintarPreview();
        refrescarModal();
        return;
      }
      const multi = e.target.closest("[data-img-multi]");
      if (multi) {
        toggleImagenGaleria(multi.dataset.imgMulti, multi.dataset.id);
        refrescarModal();
        return;
      }
      const uno = e.target.closest("[data-img-uno]");
      if (uno) {
        fijar(estado.pagina.data, uno.dataset.imgUno, uno.dataset.id);
        marcarSucio();
        repintarPreview();
        refrescarModal();
        return;
      }
      const quitar = e.target.closest("[data-img-quitar]");
      if (quitar) {
        fijar(estado.pagina.data, quitar.dataset.imgQuitar, null);
        marcarSucio();
        repintarPreview();
        refrescarModal();
      }
    });
    m.addEventListener("change", (e) => {
      if (e.target.dataset.subir && e.target.files?.length) {
        subirImagenNueva(e.target.files[0], e.target.dataset.subir, e.target.dataset.rutaSubir, e.target);
      }
      if (e.target.dataset.videoEl && e.target.files?.length) {
        subirVideoNuevo(e.target.files[0], e.target.dataset.videoEl, e.target);
      }
    });

    // Arrastrar y soltar un video/gif/imagen sobre un clip del muro.
    m.addEventListener("dragover", (e) => {
      const dz = e.target.closest(".clip-drop");
      if (!dz) return;
      e.preventDefault();
      dz.classList.add("clip-drop--activo");
    });
    m.addEventListener("dragleave", (e) => {
      const dz = e.target.closest(".clip-drop");
      if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove("clip-drop--activo");
    });
    m.addEventListener("drop", (e) => {
      const dz = e.target.closest(".clip-drop");
      if (!dz) return;
      e.preventDefault();
      dz.classList.remove("clip-drop--activo");
      const archivo = e.dataTransfer?.files?.[0];
      if (!archivo) return;
      const inp = dz.querySelector("input[data-video-el]");
      if (!inp) return;
      if (!/^(video|image)\//.test(archivo.type)) {
        document.getElementById("editor-modal-cuerpo")?.insertAdjacentHTML(
          "afterbegin",
          `<div class="error">${ico("x","ico--banner")} Solo se pueden soltar videos, imágenes o GIFs.</div>`
        );
        return;
      }
      subirVideoNuevo(archivo, inp.dataset.videoEl, inp);
    });
  }

  // Sube un video directo a Shopify (browser → bucket) y pone su URL en el item.
  // ref = "muro:i" (muro de clientes) o "i:j" (item de una section).
  async function subirVideoNuevo(archivo, ref, inp) {
    const partes = ref.split(":");
    const rutaDestino =
      partes[0] === "muro"
        ? `facetas.clientes.items.${Number(partes[1])}.url`
        : `secciones.${Number(partes[0])}.items.${Number(partes[1])}.url`;
    const label = inp.closest("label");
    const textoOrig = label.firstChild.textContent;
    label.firstChild.textContent = "Subiendo… 0%";
    label.style.pointerEvents = "none";
    try {
      const pid = estado.pagina.id;
      // 1) destino temporal
      const destino = await api(`/paginas/${pid}/archivo-inicio`, {
        method: "POST",
        body: { nombre: archivo.name, mime: archivo.type, size: archivo.size }
      });
      // 2) subir los bytes directo al bucket con progreso
      const fd = new FormData();
      for (const p of destino.parameters) fd.append(p.name, p.value);
      fd.append("file", archivo);
      await new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", destino.url);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) label.firstChild.textContent = `Subiendo… ${Math.round((ev.loaded / ev.total) * 100)}%`;
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? res() : rej(new Error("El bucket rechazó la subida (" + xhr.status + ").")));
        xhr.onerror = () => rej(new Error("Error de red subiendo el video."));
        xhr.send(fd);
      });
      label.firstChild.textContent = "Procesando…";
      // 3) finalizar → URL del CDN
      const { url } = await api(`/paginas/${pid}/archivo-fin`, {
        method: "POST",
        body: { resourceUrl: destino.resourceUrl, mime: archivo.type }
      });
      fijar(estado.pagina.data, rutaDestino, url);
      marcarSucio();
      repintarPreview();
      refrescarModal();
    } catch (e) {
      label.firstChild.textContent = textoOrig;
      label.style.pointerEvents = "";
      document.getElementById("editor-modal-cuerpo")?.insertAdjacentHTML(
        "afterbegin",
        `<div class="error">${ico("x","ico--banner")} No se pudo subir el video: ${esc(e.message)}</div>`
      );
    }
  }

  // ---- el botón "✎ Editar" flotante adentro del iframe ----

  // A qué modal lleva cada bloque de la página. El orden importa: gana el
  // primer selector que matchee con closest().
  const ZONAS_EDICION = [
    { sel: ".tiq-ppb__social, .tiq-ppb__text-image, .tiq-ppb__feature, .tiq-ppb__reviews, .tiq-ppb__stats-section, .tiq-ppb__comparison, .tiq-ppb__cta-panel, .tiq-ppb__faq, .tiq-ppb__recommendations", id: "pagepilot_blue" },
    { sel: ".hero__galeria, .pp-gallery-col", id: "galeria" },
    { sel: ".hero__bullets, .pp-benefits", id: "bullets" },
    { sel: ".hero__resenas, .hero__titulo, .hero__subtitulo, .hero__precios, .hero__cantidad, .pp-rating, #pp-product-title, .pp-lead, .pp-price", id: "encabezado" },
    { sel: ".acordeon, .pp-accordions", id: "acordeones" },
    { sel: ".resena-destacada, .pp-review", id: "destacada" },
    { sel: ".iconos, .pp-editorial-list", id: "iconos" },
    { sel: ".stats, .pp-stats", id: "stats" },
    { sel: ".faq, .pp-faq", id: "faq" },
    { sel: ".pp-comparison", id: "tabla" },
    { sel: ".pp-guarantee", id: "garantia" },
    { sel: ".resenas, .pp-reviews", id: "resenas" },
    { sel: ".muro", id: "clientes" }
  ];

  // Bloques fijos que SÍ se pueden eliminar de la página (los opcionales). El
  // hero (galería/bullets/encabezado/acordeones/reseña destacada) NO: es el
  // corazón comprable. Estos ids coinciden con los del render (fijos[]).
  const ZONAS_BORRABLES = new Set(["clientes", "faq", "iconos", "stats", "resenas"]);

  function montarEdicionEnIframe(marco) {
    let doc;
    try {
      doc = marco.contentWindow.document;
    } catch {
      return;
    }
    if (doc.getElementById("tiq-edit-btn")) return; // ya montado

    const st = doc.createElement("style");
    st.textContent = `
      #tiq-edit-bar { position: absolute; z-index: 99999; display: none; gap: 6px; align-items: center;
        font: 600 13px/1 Inter, -apple-system, sans-serif; }
      #tiq-edit-bar .tiq-nom { background: #005bd3; color: #fff; border-radius: 8px; padding: 6px 11px;
        box-shadow: 0 4px 14px rgba(0,0,0,.16); white-space: nowrap; letter-spacing: -.1px; }
      #tiq-edit-bar button { display: flex; align-items: center; gap: 6px;
        background: #fff; border: 1px solid #d9d9de; border-radius: 9px; box-shadow: 0 4px 14px rgba(0,0,0,.16);
        padding: 8px 12px; color: #1a1a1a; cursor: pointer; font: inherit; }
      #tiq-edit-bar button:hover { background: #f6f6f7; }
      #tiq-edit-bar .tiq-del { color: #dc2626; }
      #tiq-edit-bar .tiq-del:hover { background: #fdeaea; }
      #tiq-edit-bar .ico { width: 15px; height: 15px; flex-shrink: 0; }
      .tiq-zona-hover { outline: 2px solid #005bd3; outline-offset: 3px; border-radius: 6px; }`;
    doc.head.appendChild(st);

    const bar = doc.createElement("div");
    bar.id = "tiq-edit-bar";
    bar.innerHTML = `<span class="tiq-nom"></span><button class="tiq-editar" type="button">${ico("lapiz")} Editar</button><button class="tiq-del" type="button" title="Eliminar sección" aria-label="Eliminar sección" style="display:none">${ico("basura")}</button>`;
    const barNom = bar.querySelector(".tiq-nom");
    doc.body.appendChild(bar);
    const btn = bar; // el contenedor hace de "botón" posicionable
    const btnEditar = bar.querySelector(".tiq-editar");
    const btnDel = bar.querySelector(".tiq-del");

    let zonaEl = null;

    const limpiar = () => {
      btn.style.display = "none";
      if (zonaEl) zonaEl.classList.remove("tiq-zona-hover");
      zonaEl = null;
    };

    // Nombre legible de la zona (para el chip) + sync con la fila del árbol.
    const NOMBRE_ZONA = { pagepilot_blue: "PagePilot Blue", encabezado: "Encabezado", galeria: "Galería", bullets: "Beneficios", destacada: "Reseña destacada", acordeones: "Envío y devoluciones", iconos: "Íconos", stats: "Estadísticas", tabla: "Comparación", garantia: "Garantía", faq: "Preguntas frecuentes", resenas: "Reseñas", clientes: "Muro de clientes" };
    const nombreZona = (zid) => {
      if (zid.startsWith("sec:")) { const s = (estado.pagina.data.secciones || []).find((x) => x.id === zid.slice(4)); return s ? (catSeccion(s.tipo)?.nombre || "Sección") : "Sección"; }
      return NOMBRE_ZONA[zid] || zid;
    };
    const marcarArbol = (zid) => {
      vista.querySelectorAll(".pe-tree__row.is-sel").forEach((r) => r.classList.remove("is-sel"));
      const row = vista.querySelector(`.pe-tree__row[data-tree="${zid}"]`);
      if (row) row.classList.add("is-sel");
    };

    doc.addEventListener("mouseover", (e) => {
      if (e.target === btn || btn.contains(e.target)) return; // no soltar el botón

      let hit = null;
      // Las sections incrustadas ganan: su editor es propio.
      const sec = e.target.closest?.("[data-seccion]");
      if (sec) {
        hit = { el: sec, id: "sec:" + sec.dataset.seccion };
      } else {
        for (const z of ZONAS_EDICION) {
          const el = e.target.closest?.(z.sel);
          if (el) {
            hit = { el, id: z.id };
            break;
          }
        }
      }
      if (!hit) return limpiar();
      if (hit.el === zonaEl) return;

      if (zonaEl) zonaEl.classList.remove("tiq-zona-hover");
      zonaEl = hit.el;
      zonaEl.classList.add("tiq-zona-hover");

      const r = zonaEl.getBoundingClientRect();
      const scrollY = doc.defaultView.scrollY;
      btn.dataset.sec = hit.id;
      barNom.textContent = nombreZona(hit.id); // chip con el nombre de la sección
      marcarArbol(hit.id);                       // resalta la fila en el árbol
      // Se puede borrar: las sections incrustadas (sec:) y los bloques fijos
      // "opcionales" (no el hero, que es el corazón de la página).
      btnDel.style.display = (hit.id.startsWith("sec:") || ZONAS_BORRABLES.has(hit.id)) ? "flex" : "none";
      btn.style.display = "flex";
      btn.style.top = `${scrollY + r.top + 12}px`;
      btn.style.left = `${Math.max(10, Math.min(r.right - 150, doc.documentElement.clientWidth - 160))}px`;
    });

    btnEditar.addEventListener("click", () => abrirModalEdicion(btn.dataset.sec));
    btnDel.addEventListener("click", () => {
      const id = btn.dataset.sec;
      if (!confirm("¿Eliminar esta sección de la página?")) return;
      if (id.startsWith("sec:")) {
        // Section incrustada: se saca del array (se pierde su contenido).
        const secs = estado.pagina.data.secciones;
        const idx = secs.findIndex((s) => s.id === id.slice(4));
        if (idx > -1) secs.splice(idx, 1);
      } else if (ZONAS_BORRABLES.has(id)) {
        // Bloque fijo: se oculta (no se destruye el contenido; el render lo
        // saltea). Reversible cuando armemos el panel para volver a sumarlo.
        const d = estado.pagina.data;
        d.ocultas = Array.isArray(d.ocultas) ? d.ocultas : [];
        if (!d.ocultas.includes(id)) d.ocultas.push(id);
      } else {
        return;
      }
      limpiar();
      marcarSucio();
      repintarPreview();
    });

    // Clics dentro del preview: lápices de la plantilla + espacios de imagen.
    doc.addEventListener("click", (e) => {
      if (e.target.closest(".resenas__editar")) return abrirModalEdicion("resenas");
      if (e.target.closest(".resena-destacada__editar")) return abrirModalEdicion("destacada");
      // clic en cualquier card del muro de clientes → abre su editor
      if (e.target.closest(".muro-card")) return abrirModalEdicion("clientes");
      // clic directo en un espacio de imagen → selector de archivos
      const slot = e.target.closest("[data-imgclick]");
      if (slot) return void elegirImagenSlot(slot.dataset.imgclick, slot);
      // clic en un espacio de video → modal de esa section
      const vslot = e.target.closest("[data-vslot]");
      if (vslot) return void abrirModalEdicion("sec:" + vslot.dataset.vslot.split(":")[0]);
    });
  }

  // Traduce el marcador del slot a la ruta del dato en estado.pagina.data.
  function rutaDeSlot(clave) {
    if (clave.startsWith("res:")) return `facetas.resenas.items.${clave.slice(4)}.imagen`;
    if (clave.startsWith("sec:")) {
      const [, secId, j] = clave.split(":");
      const idx = (estado.pagina.data.secciones || []).findIndex((s) => s.id === secId);
      return idx > -1 ? `secciones.${idx}.items.${j}.media_id` : null;
    }
    return null;
  }

  // Clic en un espacio de imagen del preview → file picker → sube → incrusta.
  function elegirImagenSlot(clave, slotEl) {
    const ruta = rutaDeSlot(clave);
    if (!ruta) return;
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const archivo = inp.files?.[0];
      if (!archivo) return;
      try {
        slotEl.classList.add("tiq-subiendo");
        const base64 = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(",")[1]);
          fr.onerror = () => rej(new Error("No se pudo leer el archivo"));
          fr.readAsDataURL(archivo);
        });
        const r = await api(`/paginas/${estado.pagina.id}/imagenes`, {
          method: "POST",
          body: { nombre: archivo.name, mime: archivo.type, base64 }
        });
        estado.pagina.data.pool_imagenes = estado.pagina.data.pool_imagenes || [];
        if (!estado.pagina.data.pool_imagenes.some((p) => p.media_id === r.media_id)) {
          estado.pagina.data.pool_imagenes.push({ media_id: r.media_id, tipo: "producto_limpio" });
        }
        estado.pagina.urls = { ...(estado.pagina.urls || {}), [r.media_id]: r.url };
        fijar(estado.pagina.data, ruta, r.media_id);
        marcarSucio();
        repintarPreview();
      } catch (e) {
        vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} No se pudo subir la imagen: ${esc(e.message)}</div>`);
      }
    };
    inp.click();
  }

  // ---- arrastrar sections del panel al preview ----
  //
  // El iframe es same-origin: durante el drag pongo un overlay que captura el
  // puntero y calculo, contra los bloques fijos (data-fijo), el hueco donde
  // caería la section. Un indicador dentro del iframe marca la posición.

  const NOMBRE_BLOQUE = {
    top: "el principio", hero: "el encabezado", clientes: "el muro de clientes",
    iconos: "los beneficios", stats: "las estadísticas",
    faq: "las preguntas", tabla: "la comparación", resenas: "las reseñas", garantia: "la garantía", recomendados: "los recomendados"
  };

  function montarDragSections(marco) {
    const panel = $("panel-sections");
    if (!panel) return;
    panel.querySelectorAll(".section-card").forEach((card) => {
      card.addEventListener("pointerdown", (e) => iniciarDragSection(e, card, marco));
    });
  }

  function iniciarDragSection(ev, card, marco) {
    if (ev.target.closest("[data-ins-sec]")) return; // el botón "+" inserta, no arrastra
    ev.preventDefault();
    const tipo = card.dataset.nueva;
    let doc;
    try { doc = marco.contentWindow.document; } catch { return; }

    // fantasma que sigue el cursor
    const ghost = card.cloneNode(true);
    ghost.className = "section-card section-card--ghost";
    document.body.appendChild(ghost);
    card.classList.add("section-card--arrastrando");

    // indicador de inserción, dentro del iframe
    const linea = doc.createElement("div");
    linea.className = "tiq-drop-line";
    linea.style.cssText =
      "position:absolute;left:0;right:0;height:3px;background:#005bd3;z-index:100000;display:none;box-shadow:0 0 0 4px rgba(0,91,211,.15);border-radius:2px;pointer-events:none";
    doc.body.appendChild(linea);

    let ancla = null; // dónde caería

    const mover = (x, y) => {
      ghost.style.left = x + 12 + "px";
      ghost.style.top = y + 12 + "px";
      const r = marco.getBoundingClientRect();
      const dentro = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      if (!dentro) {
        linea.style.display = "none";
        ancla = null;
        return;
      }
      // Y del cursor en el viewport del iframe → contra el centro de cada fijo
      const yIframe = y - r.top;
      const fijos = [...doc.querySelectorAll("[data-fijo]")];
      let nuevoAncla = "top";
      let posY = 0;
      for (const b of fijos) {
        const br = b.getBoundingClientRect();
        if (yIframe > br.top + br.height / 2) {
          nuevoAncla = b.dataset.bloque;
          posY = br.bottom + doc.defaultView.scrollY;
        } else break;
      }
      if (nuevoAncla === "top") {
        const primero = fijos[0]?.getBoundingClientRect();
        posY = (primero ? primero.top : 0) + doc.defaultView.scrollY;
      }
      ancla = nuevoAncla;
      linea.style.top = posY - 1 + "px";
      linea.style.display = "block";
    };

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:99997;cursor:grabbing";
    document.body.appendChild(overlay);

    mover(ev.clientX, ev.clientY);
    const onMove = (e) => mover(e.clientX, e.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      overlay.remove();
      ghost.remove();
      linea.remove();
      card.classList.remove("section-card--arrastrando");
      if (ancla) soltarSection(tipo, ancla);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function soltarSection(tipo, ancla) {
    // Nace con la plantilla de espacios ya puesta (como el andamio de reseñas):
    // se ven los slots y se llenan haciendo clic sobre cada uno.
    const id = "s" + Date.now();
    const nueva =
      tipo === "videos"
        ? { id, tipo: "videos", ancla, items: [{ url: "", poster: null }, { url: "", poster: null }, { url: "", poster: null }] }
        : tipo === "videoslider"
        ? { id, tipo: "videoslider", ancla,
            items: [{ url: "", poster: null, titulo: "", estrellas: null }, { url: "", poster: null, titulo: "", estrellas: null }, { url: "", poster: null, titulo: "", estrellas: null }],
            settings: {} }
        : { id, tipo: "carrusel", ancla, items: [{ media_id: null, caption: "", link: "" }, { media_id: null, caption: "", link: "" }, { media_id: null, caption: "", link: "" }, { media_id: null, caption: "", link: "" }] };
    estado.pagina.data.secciones.push(nueva);
    marcarSucio();
    repintarPreview();
  }

  // ---- reacción a cada tecla ----

  function actualizarDato(el) {
    let v = el.value;
    if (el.dataset.tipo === "numero") v = Number(v) || 0;
    if (el.dataset.tipo === "bool") v = el.checked;
    if (el.dataset.nulo === "1" && typeof v === "string" && v.trim() === "") v = null;
    fijar(estado.pagina.data, el.dataset.ruta, v);

    if (el.dataset.ruta === "facetas.hero.titulo") {
      const t = vista.querySelector(".preview-barra__titulo");
      if (t) t.textContent = v ?? "";
    }
    marcarSucio();
    clearTimeout(timerPreview);
    timerPreview = setTimeout(repintarPreview, 250);
  }

  function repintarPreview() {
    const marco = $("marco");
    if (marco?.contentWindow)
      marco.contentWindow.postMessage(
        { tiendaiq: true, data: estado.pagina.data, urls: estado.pagina.urls },
        "*"
      );
  }

  function marcarSucio() {
    sucio = true;
    const b = $("guardar");
    if (b) {
      b.removeAttribute("disabled");
      b.textContent = "Guardar cambios";
      b.setAttribute("variant", "primary");
    }
    // Editar una página YA publicada = deja de estar al día con la tienda.
    // El estado se comunica por el pill, no por un banner-sermón.
    if (estado.pagina?.estado === "publicada") {
      cambiosSinPublicar = true;
      actualizarPill();
    }
  }

  // Refleja el estado actual en el pill de la barra (Borrador / Publicada /
  // Cambios sin publicar) sin re-renderizar toda la pantalla.
  function actualizarPill() {
    const chip = $("barra-estado")?.querySelector("s-badge");
    if (!chip) return;
    const publicada = estado.pagina?.estado === "publicada";
    const est = !publicada
      ? { c: "borrador", t: "Borrador" }
      : cambiosSinPublicar
        ? { c: "pend", t: "Cambios sin publicar" }
        : { c: "publicada", t: "Publicada" };
    chip.setAttribute("tone", TONO_ESTADO[est.c] || "neutral");
    chip.textContent = est.t;
  }

  function cargarLote() {
    const caja = $("lote");
    const crudo = (caja?.value ?? "").trim();
    if (!crudo) return;

    const items = estado.pagina.data.facetas.resenas.items;
    const bloques = crudo.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    bloques.forEach((b, i) => {
      const lineas = b.split("\n").map((l) => l.trim()).filter(Boolean);
      // Con una sola línea no hay nombre: queda solo el texto y la tarjeta
      // avisa "guía" hasta que le pongan autor.
      const autor = lineas.length > 1 ? lineas[0] : null;
      const texto = (lineas.length > 1 ? lineas.slice(1) : lineas).join(" ");
      const item = { autor, estrellas: null, imagen: null, texto };
      if (i < items.length) items[i] = item;
      else items.push(item);
    });

    marcarSucio();
    refrescarModal();
    repintarPreview();
  }

  async function guardarCambios() {
    const b = $("guardar");
    if (b) {
      b.setAttribute("disabled", "");
      b.textContent = "Guardando…";
    }
    try {
      estado.pagina = await api(`/paginas/${estado.pagina.id}`, {
        method: "PUT",
        body: { data: estado.pagina.data }
      });
      sucio = false;
      // El botón vuelve a su acción ("Guardar cambios"), deshabilitado porque
      // ya no hay nada pendiente. El feedback de guardado va por toast, no por
      // un botón que muestra un adjetivo.
      if (b) {
        b.setAttribute("disabled", "");
        b.textContent = "Guardar cambios";
        b.setAttribute("variant", "secondary");
      }
      toast("Cambios guardados");
      return true;
    } catch (e) {
      if (b) {
        b.removeAttribute("disabled");
        b.textContent = "Guardar cambios";
      }
      vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} No se pudo guardar: ${esc(e.message)}</div>`);
      return false;
    }
  }

  // ============================================================
  // SISTEMA DE SECCIONES (v2, estilo Section Store) — schema-driven.
  // Cada sección se define por un ESQUEMA (grupos → controles). El MISMO
  // esquema alimenta el panel lateral de edición Y el mapeo a variables CSS
  // del render (extensions/.../tiendaiq.js). Los defaults de acá DEBEN
  // espejar DEF_VS en tiendaiq.js — son dos bundles distintos, se sincronizan
  // a mano (mismo set de claves).
  // ============================================================

  // Defaults canónicos del Video slider (mirror de DEF_VS en tiendaiq.js).
  const DEF_VS = {
    // Slider
    cols: 5, colsMobile: 1.5, rotate: 0,
    // Slide
    aspecto: "portrait", aspectoMobile: "portrait",
    radio: 16, bordeSlide: 0, overlay: 0.2, sombra: false,
    // Content
    hPos: "center", hPosMobile: "center", vPos: "bottom", vPosMobile: "bottom",
    // Title
    fuenteCustom: false, tituloSize: 16, tituloSizeMobile: 16, lineHeight: 130,
    // Stars
    ocultarEstrellas: false, iconoEstrella: null,
    estrellasSize: 16, estrellasSizeMobile: 16, estrellasMargen: 16, estrellasMargenMobile: 16,
    // Controls (pausa / sonido)
    usarPausa: true, usarSonido: true, ctrlSize: 40, ctrlSizeMobile: 40, ctrlBorde: 0,
    // Arrows (flechas)
    flechas: true, flechasMobile: false, flechaSize: 48, flechaIco: 8,
    flechaRadio: 100, flechaBorde: 0, flechaHover: "color",
    // Slide colors
    colTitulo: "#ffffff", colEstrellas: "#ffffff", colBorde: "#121212",
    colSombra: "#121212", colOverlay: "#121212",
    // Controls colors
    colCtrlIco: "#ffffff", colCtrlIcoHover: "#ffffff",
    colCtrlBg: "#ffffff", colCtrlBgHover: "#ffffff",
    colCtrlBorde: "#ffffff", colCtrlBordeHover: "#ffffff",
    // Arrow colors
    colFlechaIcono: "#121212", colFlechaIconoHover: "#ffffff",
    colFlechaFondo: "#ffffff", colFlechaFondoHover: "#121212",
    colFlechaBorde: "#121212", colFlechaBordeHover: "#121212",
    // Section colors
    fondoEstilo: "solid", fondo: "#ffffff", fondo2: "#f4f4f7", colBordeSec: "#121212",
    // Section margin / padding
    margenTop: 0, margenBottom: 0,
    padTop: 36, padBottom: 36, padSides: 0, padSidesMobile: 0,
    // Section settings
    ancho: "page", bordeSec: 0, lazy: true, cssCustom: ""
  };

  // Opciones reutilizadas por los segmented controls.
  const OP_HPOS = [["left", "Izq."], ["center", "Centro"], ["right", "Der."]];
  const OP_VPOS = [["top", "Arriba"], ["bottom", "Abajo"]];
  const OP_ASPECTO = [["portrait", "Vertical"], ["square", "Cuadrado"], ["landscape", "Horizontal"]];

  // Esquema del Video slider: grupos (acordeones) → controles. Cada control:
  //   { k: clave en settings, t: tipo, lab: etiqueta, ...opts }
  //   t: slider {min,max,step,u} · segment {op} · select {op} · toggle · color · image
  const SCHEMA_VS = [
    { id: "slider", tit: "Slider", ctrls: [
      { k: "cols", t: "slider", lab: "Slides por vista", min: 1, max: 6, step: 1 },
      { k: "colsMobile", t: "slider", lab: "Slides por vista — móvil", min: 1, max: 4, step: 0.5 },
      { k: "rotate", t: "slider", lab: "Rotar", min: -15, max: 15, step: 1, u: "°" }
    ]},
    { id: "slide", tit: "Slide", ctrls: [
      { k: "aspecto", t: "segment", lab: "Proporción", op: OP_ASPECTO },
      { k: "aspectoMobile", t: "segment", lab: "Proporción — móvil", op: OP_ASPECTO },
      { k: "radio", t: "slider", lab: "Redondez", min: 0, max: 40, step: 1, u: "px" },
      { k: "bordeSlide", t: "slider", lab: "Grosor del borde", min: 0, max: 10, step: 1, u: "px" },
      { k: "overlay", t: "slider", lab: "Sombreado (overlay)", min: 0, max: 1, step: 0.05 },
      { k: "sombra", t: "toggle", lab: "Usar sombra" }
    ]},
    { id: "content", tit: "Contenido", ctrls: [
      { k: "hPos", t: "segment", lab: "Posición horizontal", op: OP_HPOS },
      { k: "hPosMobile", t: "segment", lab: "Posición horizontal — móvil", op: OP_HPOS },
      { k: "vPos", t: "segment", lab: "Posición vertical", op: OP_VPOS },
      { k: "vPosMobile", t: "segment", lab: "Posición vertical — móvil", op: OP_VPOS }
    ]},
    { id: "title", tit: "Título", ctrls: [
      { k: "fuenteCustom", t: "toggle", lab: "Usar fuente propia" },
      { k: "tituloSize", t: "slider", lab: "Tamaño de fuente", min: 10, max: 40, step: 1, u: "px" },
      { k: "tituloSizeMobile", t: "slider", lab: "Tamaño de fuente — móvil", min: 10, max: 40, step: 1, u: "px" },
      { k: "lineHeight", t: "slider", lab: "Altura de línea", min: 90, max: 200, step: 5, u: "%" }
    ]},
    { id: "stars", tit: "Estrellas", ctrls: [
      { k: "ocultarEstrellas", t: "toggle", lab: "Ocultar estrellas" },
      { k: "iconoEstrella", t: "image", lab: "Ícono (reemplaza la estrella)" },
      { k: "estrellasSize", t: "slider", lab: "Tamaño", min: 8, max: 32, step: 1, u: "px" },
      { k: "estrellasSizeMobile", t: "slider", lab: "Tamaño — móvil", min: 8, max: 32, step: 1, u: "px" },
      { k: "estrellasMargen", t: "slider", lab: "Margen superior", min: 0, max: 40, step: 1, u: "px" },
      { k: "estrellasMargenMobile", t: "slider", lab: "Margen superior — móvil", min: 0, max: 40, step: 1, u: "px" }
    ]},
    { id: "controls", tit: "Controles", ctrls: [
      { k: "usarPausa", t: "toggle", lab: "Botón de pausa/play" },
      { k: "usarSonido", t: "toggle", lab: "Botón de sonido on/off" },
      { k: "ctrlSize", t: "slider", lab: "Tamaño", min: 24, max: 72, step: 1, u: "px" },
      { k: "ctrlSizeMobile", t: "slider", lab: "Tamaño — móvil", min: 24, max: 72, step: 1, u: "px" },
      { k: "ctrlBorde", t: "slider", lab: "Grosor del borde", min: 0, max: 8, step: 1, u: "px" }
    ]},
    { id: "arrows", tit: "Flechas", ctrls: [
      { k: "flechas", t: "toggle", lab: "Mostrar en escritorio" },
      { k: "flechasMobile", t: "toggle", lab: "Mostrar en móvil" },
      { k: "flechaSize", t: "slider", lab: "Tamaño", min: 28, max: 72, step: 1, u: "px" },
      { k: "flechaIco", t: "slider", lab: "Tamaño del ícono", min: 4, max: 20, step: 1, u: "px" },
      { k: "flechaRadio", t: "slider", lab: "Redondez", min: 0, max: 100, step: 1, u: "px" },
      { k: "flechaBorde", t: "slider", lab: "Grosor del borde", min: 0, max: 8, step: 1, u: "px" },
      { k: "flechaHover", t: "select", lab: "Efecto al pasar", op: [["color", "Cambiar color"], ["none", "Ninguno"]] }
    ]},
    { id: "colSlide", tit: "Colores del slide", ctrls: [
      { k: "colTitulo", t: "color", lab: "Título" },
      { k: "colEstrellas", t: "color", lab: "Estrellas" },
      { k: "colBorde", t: "color", lab: "Borde" },
      { k: "colSombra", t: "color", lab: "Sombra" },
      { k: "colOverlay", t: "color", lab: "Overlay" }
    ]},
    { id: "colCtrl", tit: "Colores de los controles", ctrls: [
      { k: "colCtrlIco", t: "color", lab: "Ícono" },
      { k: "colCtrlIcoHover", t: "color", lab: "Ícono (hover)" },
      { k: "colCtrlBg", t: "color", lab: "Fondo" },
      { k: "colCtrlBgHover", t: "color", lab: "Fondo (hover)" },
      { k: "colCtrlBorde", t: "color", lab: "Borde" },
      { k: "colCtrlBordeHover", t: "color", lab: "Borde (hover)" }
    ]},
    { id: "colArrow", tit: "Colores de las flechas", ctrls: [
      { k: "colFlechaIcono", t: "color", lab: "Ícono" },
      { k: "colFlechaIconoHover", t: "color", lab: "Ícono (hover)" },
      { k: "colFlechaFondo", t: "color", lab: "Fondo" },
      { k: "colFlechaFondoHover", t: "color", lab: "Fondo (hover)" },
      { k: "colFlechaBorde", t: "color", lab: "Borde" },
      { k: "colFlechaBordeHover", t: "color", lab: "Borde (hover)" }
    ]},
    { id: "colSec", tit: "Colores de la sección", ctrls: [
      { k: "fondoEstilo", t: "segment", lab: "Estilo de fondo", op: [["solid", "Sólido"], ["gradient", "Degradado"]] },
      { k: "fondo", t: "color", lab: "Fondo" },
      { k: "fondo2", t: "color", lab: "Fondo 2 (degradado)", dep: ["fondoEstilo", "gradient"] },
      { k: "colBordeSec", t: "color", lab: "Borde" }
    ]},
    { id: "margin", tit: "Margen de la sección (afuera)", ctrls: [
      { k: "margenTop", t: "slider", lab: "Arriba", min: 0, max: 120, step: 1, u: "px" },
      { k: "margenBottom", t: "slider", lab: "Abajo", min: 0, max: 120, step: 1, u: "px" }
    ]},
    { id: "padding", tit: "Padding de la sección (adentro)", ctrls: [
      { k: "padTop", t: "slider", lab: "Arriba", min: 0, max: 120, step: 1, u: "px" },
      { k: "padBottom", t: "slider", lab: "Abajo", min: 0, max: 120, step: 1, u: "px" },
      { k: "padSides", t: "slider", lab: "Lados", min: 0, max: 10, step: 0.5, u: "rem" },
      { k: "padSidesMobile", t: "slider", lab: "Lados — móvil", min: 0, max: 10, step: 0.5, u: "rem" }
    ]},
    { id: "settings", tit: "Ajustes de la sección", ctrls: [
      { k: "ancho", t: "segment", lab: "Ancho", op: [["page", "Página"], ["full", "Completo"], ["custom", "Custom"]] },
      { k: "bordeSec", t: "slider", lab: "Grosor del borde", min: 0, max: 8, step: 1, u: "px" },
      { k: "lazy", t: "toggle", lab: "Carga diferida (lazy)" }
    ]}
  ];

  // Thumbnail mock del Video slider (3 cards verticales, la central destacada),
  // reutilizado en la galería, el chip de la columna y el mini de la card.
  const THUMB_VS = `<span class="tiq-thumb tiq-thumb--vs">
      <span class="tiq-thumb__card"></span>
      <span class="tiq-thumb__card tiq-thumb__card--hi"></span>
      <span class="tiq-thumb__card"></span>
    </span>`;

  // Catálogo de secciones disponibles (lo que muestra la galería estilo Section
  // Store). Cada una: tipo, nombre, categorías, thumbnail y (si es v2) esquema.
  const CATALOGO_SECCIONES = [
    // El Video slider vive DENTRO de la landing (data.secciones + render por
    // tiendaiq.js), no como section del tema (compliance App Store). Se agrega
    // desde acá y se edita con el panel lateral schema-driven.
    {
      tipo: "videoslider",
      nombre: "Video slider",
      desc: "Carrusel de videos verticales con reseña (título + estrellas)",
      cats: ["popular", "video", "testimonial"],
      thumb: THUMB_VS,
      schema: SCHEMA_VS,
      defaults: DEF_VS
    },
    {
      tipo: "videos",
      nombre: "Videos de producto",
      desc: "Carrusel de videos (YouTube, Vimeo o MP4)",
      cats: ["video"],
      thumb: `<span class="tiq-thumb tiq-thumb--videos"><span></span><span></span><span></span></span>`
    },
    {
      tipo: "carrusel",
      nombre: "Carrusel de imágenes",
      desc: "Galería deslizable de fotos",
      cats: ["images"],
      thumb: `<span class="tiq-thumb tiq-thumb--imgs"><span></span><span></span><span></span><span></span></span>`
    }
  ];

  // Categorías de la galería (íconos estilo Section Store).
  const CATS_SECCIONES = [
    ["popular", "Populares"],
    ["video", "Video"],
    ["testimonial", "Testimonios"],
    ["images", "Imágenes"],
    ["todas", "Todas"]
  ];

  const catSeccion = (tipo) => CATALOGO_SECCIONES.find((c) => c.tipo === tipo);
  // settings efectivos de una sección videoslider = defaults ← settings guardados.
  const settingsVS = (s) => ({ ...DEF_VS, ...(s.settings || {}) });

  function guardarChips() {
    try { localStorage.setItem("tiq_sec_chips", JSON.stringify(estado.seccionesElegidas)); } catch {}
  }

  // Chips de la columna "Secciones": las que el merchant mandó desde la galería.
  // Cada chip es arrastrable a la página (reusa el drag: data-nueva=tipo) y
  // también se inserta con un clic en "+".
  function chipsSeccionesHTML() {
    const elegidas = estado.seccionesElegidas || [];
    if (!elegidas.length) {
      return `<div class="sec-chips__vacio">${ico("cursor")}<p>Todavía no sumaste secciones. Tocá <strong>Ver todas las secciones disponibles</strong> y elegí las que quieras.</p></div>`;
    }
    return elegidas
      .map((tipo) => {
        const c = catSeccion(tipo);
        if (!c) return "";
        return `<div class="section-card" data-nueva="${c.tipo}" title="Arrastrar a la página o tocar + para insertar">
          <span class="section-card__mini">${c.thumb}</span>
          <div class="section-card__txt">
            <div class="section-card__nombre">${esc(c.nombre)}</div>
            <div class="section-card__desc">${esc(c.desc)}</div>
          </div>
          <button class="section-card__ins" type="button" data-ins-sec="${c.tipo}" title="Insertar en la página" aria-label="Insertar">${ico("mas")}</button>
          <span class="section-card__grip">${ico("grip")}</span>
        </div>`;
      })
      .join("");
  }

  function refrescarChips(marco) {
    const cont = $("sec-chips");
    if (cont) cont.innerHTML = chipsSeccionesHTML();
    if (marco) montarDragSections(marco);
  }

  // ---- Galería de secciones (modal estilo Section Store) ----
  const IC_BUSCAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
  const IC_CAT = {
    popular: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.5 5.3 5.8.6-4.4 3.9 1.3 5.7L12 21.3 6.8 24.4l1.3-5.7L3.7 8.9l5.8-.6z"/></svg>`,
    video: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z" fill="#fff"/></svg>`,
    testimonial: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8 8 0 01-11.5 7.2L3 20l1.3-6.5A8 8 0 1121 11.5z"/></svg>`,
    images: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>`,
    todas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`
  };

  function seccionesFiltradas() {
    const cat = estado.galeriaCat;
    const q = (estado.galeriaQ || "").trim().toLowerCase();
    return CATALOGO_SECCIONES.filter((c) => {
      const okCat = cat === "todas" || c.cats.includes(cat);
      const okQ = !q || c.nombre.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q);
      return okCat && okQ;
    });
  }

  function galeriaGridHTML() {
    const items = seccionesFiltradas();
    if (!items.length) return `<div class="galsec__vacio">No hay secciones que coincidan con la búsqueda.</div>`;
    return items
      .map((c) => {
        const puesta = (estado.seccionesElegidas || []).includes(c.tipo);
        return `<article class="galsec-card">
          <div class="galsec-card__prev">${c.thumb}</div>
          <div class="galsec-card__pie">
            <div class="galsec-card__info">
              <div class="galsec-card__nombre">${esc(c.nombre)}</div>
              <div class="galsec-card__badge">Incluida</div>
            </div>
            <button class="btn ${puesta ? "btn--fantasma" : "btn--acento"} btn--chico galsec-card__add" type="button" data-gal-add="${c.tipo}"${puesta ? " disabled" : ""}>${puesta ? ico("check") + " Agregada" : ico("mas") + " Agregar"}</button>
          </div>
        </article>`;
      })
      .join("");
  }

  function abrirGaleriaSecciones(marco) {
    cerrarGaleriaSecciones();
    const m = document.createElement("div");
    m.className = "galsec";
    m.id = "galsec";
    m.innerHTML = `
      <div class="galsec__caja" role="dialog" aria-modal="true" aria-labelledby="galsec-titulo">
        <div class="galsec__cab">
          <div class="galsec__marca" id="galsec-titulo">${ico("chispa")} Secciones</div>
          <div class="galsec__buscar">${IC_BUSCAR}<input type="text" id="galsec-q" placeholder="Buscar secciones" value="${esc(estado.galeriaQ || "")}"></div>
          <button class="galsec__x" type="button" aria-label="Cerrar">${ico("x")}</button>
        </div>
        <div class="galsec__tabs" id="galsec-tabs">
          ${CATS_SECCIONES.map(([id, lab]) => `<button class="galsec__tab ${estado.galeriaCat === id ? "is-sel" : ""}" type="button" data-gal-cat="${id}"><span class="galsec__tab-ic">${IC_CAT[id] || ""}</span><span>${lab}</span></button>`).join("")}
        </div>
        <div class="galsec__grid" id="galsec-grid">${galeriaGridHTML()}</div>
      </div>`;
    document.body.appendChild(m);

    const cerrarSiFuera = (e) => { if (e.target === m || e.target.closest(".galsec__x")) cerrarGaleriaSecciones(); };
    m.addEventListener("click", (e) => {
      cerrarSiFuera(e);
      const tab = e.target.closest("[data-gal-cat]");
      if (tab) {
        estado.galeriaCat = tab.dataset.galCat;
        m.querySelectorAll(".galsec__tab").forEach((t) => t.classList.toggle("is-sel", t === tab));
        $("galsec-grid").innerHTML = galeriaGridHTML();
        return;
      }
      const add = e.target.closest("[data-gal-add]");
      if (add) {
        const tipo = add.dataset.galAdd;
        if (!(estado.seccionesElegidas || []).includes(tipo)) {
          estado.seccionesElegidas.push(tipo);
          guardarChips();
          refrescarChips(marco);
        }
        $("galsec-grid").innerHTML = galeriaGridHTML();
        toast("Sección agregada a la columna");
      }
    });
    const q = $("galsec-q");
    if (q) q.addEventListener("input", () => {
      estado.galeriaQ = q.value;
      $("galsec-grid").innerHTML = galeriaGridHTML();
    });
    document.addEventListener("keydown", galeriaEsc);
  }

  function galeriaEsc(e) { if (e.key === "Escape") cerrarGaleriaSecciones(); }
  function cerrarGaleriaSecciones() {
    document.getElementById("galsec")?.remove();
    document.removeEventListener("keydown", galeriaEsc);
  }

  // ============================================================
  // PANEL LATERAL DE EDICIÓN (estilo Section Store) — schema-driven.
  // Se abre a la derecha cuando se edita una sección v2 (Video slider). Renderiza
  // el contenido (bloques de video) + los grupos del esquema como acordeones con
  // controles ricos (slider con unidad, segmented, color+hex, toggle, select,
  // imagen). Cada cambio escribe en s.settings y repinta en vivo.
  // ============================================================
  let panelSecId = null;      // id de la sección abierta en el panel
  let panelEditorId = null;   // id del bloque abierto, también para facetas clásicas
  const panelOpen = { slider: true }; // acordeones abiertos (primer grupo abierto)

  const secActual = () => (estado.pagina.data.secciones || []).find((s) => s.id === panelSecId);
  const idxSec = (id) => (estado.pagina.data.secciones || []).findIndex((s) => s.id === id);
  const vsGet = (s, k) => { const v = (s.settings || {})[k]; return v === undefined ? DEF_VS[k] : v; };

  // --- Controles del panel (widgets) ---
  const KID = (k) => "vk-" + k;

  function ctrlSlider(s, c) {
    const v = vsGet(s, c.k);
    return `<div class="sp-row sp-row--slider">
      <label class="sp-lab" for="${KID(c.k)}">${esc(c.lab)}</label>
      <div class="sp-slider">
        <input type="range" id="${KID(c.k)}" min="${c.min}" max="${c.max}" step="${c.step}" value="${esc(v)}" data-vk="${c.k}" data-vt="numero">
        <span class="sp-num"><output data-vout="${c.k}">${esc(v)}</output><i>${c.u || ""}</i></span>
      </div>
    </div>`;
  }
  function ctrlSegment(s, c) {
    const v = String(vsGet(s, c.k));
    return `<div class="sp-row sp-row--seg">
      <label class="sp-lab">${esc(c.lab)}</label>
      <div class="sp-seg" role="group">
        ${c.op.map(([val, lab]) => `<button type="button" class="sp-seg__b ${String(val) === v ? "is-sel" : ""}" data-vseg="${c.k}" data-vval="${esc(val)}">${esc(lab)}</button>`).join("")}
      </div>
    </div>`;
  }
  function ctrlSelect(s, c) {
    const v = String(vsGet(s, c.k));
    return `<div class="sp-row sp-row--sel">
      <label class="sp-lab" for="${KID(c.k)}">${esc(c.lab)}</label>
      <select id="${KID(c.k)}" class="sp-select" data-vk="${c.k}">
        ${c.op.map(([val, lab]) => `<option value="${esc(val)}"${String(val) === v ? " selected" : ""}>${esc(lab)}</option>`).join("")}
      </select>
    </div>`;
  }
  function ctrlToggle(s, c) {
    const on = !!vsGet(s, c.k);
    return `<div class="sp-row sp-row--tog">
      <label class="sp-lab">${esc(c.lab)}</label>
      <button type="button" class="sp-tog ${on ? "is-on" : ""}" data-vtog="${c.k}" role="switch" aria-checked="${on}"><span class="sp-tog__k"></span></button>
    </div>`;
  }
  function ctrlColor(s, c) {
    const v = String(vsGet(s, c.k) || "#000000");
    return `<div class="sp-row sp-row--color">
      <label class="sp-lab">${esc(c.lab)}</label>
      <div class="sp-color">
        <label class="sp-color__sw" style="background:${esc(v)}"><input type="color" value="${esc(v)}" data-vk="${c.k}"></label>
        <input type="text" class="sp-color__hex" value="${esc(v)}" data-vk="${c.k}" data-vhex spellcheck="false" maxlength="9">
      </div>
    </div>`;
  }
  function ctrlImage(s, c) {
    const ruta = `secciones.${idxSec(s.id)}.settings.${c.k}`;
    return `<div class="sp-row sp-row--img">
      <label class="sp-lab">${esc(c.lab)}</label>
      ${selectorImagenUno(ruta, "", true)}
    </div>`;
  }
  function ctrlPanel(s, c) {
    if (c.dep) { const [dk, dv] = c.dep; if (String(vsGet(s, dk)) !== String(dv)) return ""; }
    if (c.t === "slider") return ctrlSlider(s, c);
    if (c.t === "segment") return ctrlSegment(s, c);
    if (c.t === "select") return ctrlSelect(s, c);
    if (c.t === "toggle") return ctrlToggle(s, c);
    if (c.t === "color") return ctrlColor(s, c);
    if (c.t === "image") return ctrlImage(s, c);
    return "";
  }

  function secAcordeon(id, tit, cuerpo) {
    const ab = !!panelOpen[id];
    return `<div class="sp-acc ${ab ? "is-open" : ""}">
      <button type="button" class="sp-acc__head" data-vacc="${id}"><span>${esc(tit)}</span><span class="sp-acc__chev">${ico("chevron")}</span></button>
      ${ab ? `<div class="sp-acc__body">${cuerpo}</div>` : ""}
    </div>`;
  }

  // Bloques de video (contenido) — mismo lenguaje que el modal clásico, con url,
  // subida, título, estrellas y miniatura; agregar/reordenar/eliminar.
  function bloquesVSHTML(s) {
    const i = idxSec(s.id);
    const base = `secciones.${i}`;
    const items = (s.items || [])
      .map((it, j) => `
        <div class="sp-blk">
          <div class="sp-blk__cab"><span class="sp-blk__tit">${ico("video")} Video ${j + 1}</span><span class="sp-blk__man">${manijasItem(i, j, s.items.length)}</span></div>
          ${campo(`${base}.items.${j}.url`, "Enlace (YouTube, Vimeo o MP4)")}
          <label class="btn btn--fantasma btn--chico sp-blk__subir" style="cursor:pointer">${ico("subir")} Subir video
            <input type="file" accept="video/*" hidden data-video-el="${i}:${j}">
          </label>
          ${it.url && /^https?:\/\/cdn\.shopify/.test(it.url) ? `<div class="ayuda" style="margin-top:6px">${ico("check")} Video subido</div>` : ""}
          ${campo(`${base}.items.${j}.titulo`, "Nombre / título (ej. Jess B.)", 0, true)}
          <div class="campo campo--editor"><label>Estrellas</label>${selectorEstrellas(`${base}.items.${j}.estrellas`, it.estrellas ?? 0)}</div>
          <details class="resena-edit__foto"><summary>${ico("imagen")} Miniatura (opcional)${it.poster ? " · elegida" : ""}</summary>${selectorImagenUno(`${base}.items.${j}.poster`, "", true)}</details>
        </div>`)
      .join("");
    return items + `<button class="btn btn--fantasma sp-blk__add" type="button" data-sec-add="${i}:videoslider">${ico("mas")} Agregar video</button>`;
  }

  function panelSeccionHTML(s) {
    const i = idxSec(s.id);
    const cabecera = `
      ${campo(`secciones.${i}.titulo`, "Título de la sección", 0, true)}
      <s-select label="Ubicación en la página" data-ruta="secciones.${i}.ancla" value="${esc(s.ancla || "top")}">
        ${ANCLAS_UBICACION.map(([v, t]) => `<s-option value="${v}">${t}</s-option>`).join("")}
      </s-select>`;
    const grupos = SCHEMA_VS.map((g) => secAcordeon(g.id, g.tit, g.ctrls.map((c) => ctrlPanel(s, c)).join(""))).join("");
    const cssCustom = `<div class="sp-acc ${panelOpen.css ? "is-open" : ""}">
        <button type="button" class="sp-acc__head" data-vacc="css"><span>CSS personalizado</span><span class="sp-acc__chev">${ico("chevron")}</span></button>
        ${panelOpen.css ? `<div class="sp-acc__body"><textarea class="sp-css" data-vk="cssCustom" spellcheck="false" placeholder="[data-seccion] .tiq-vs__slide { … }">${esc(vsGet(s, "cssCustom") || "")}</textarea></div>` : ""}
      </div>`;
    return `
      <div class="sp-sub">Contenido</div>
      <div class="sp-content">${cabecera}${bloquesVSHTML(s)}</div>
      <div class="sp-sub">Ajustes</div>
      ${grupos}
      ${cssCustom}
      `;
  }

  function panelEditorHTML(id) {
    if (id.startsWith("sec:")) {
      const s = (estado.pagina.data.secciones || []).find((x) => x.id === id.slice(4));
      if (!s) return "";
      if (catSeccion(s.tipo)?.schema) return panelSeccionHTML(s);
      const def = defSeccion(s.id);
      return def ? `<div class="sp-sub">Contenido</div><div class="sp-content">${def.html()}</div>` : "";
    }
    const def = seccionesPagina()[id];
    if (!def) return "";
    return `<div class="sp-sub">Contenido</div><div class="sp-content">
      ${def.html()}
    </div>`;
  }

  function panelTitulo(id) {
    if (id.startsWith("sec:")) {
      const s = (estado.pagina.data.secciones || []).find((x) => x.id === id.slice(4));
      return catSeccion(s?.tipo)?.nombre || "Sección";
    }
    return seccionesPagina()[id]?.titulo || "Sección";
  }

  function panelEsV2(id) { return id.startsWith("sec:"); }

  function refrescarPanelSeccion() {
    const body = document.getElementById("sp-body");
    if (panelEditorId && body) { body.innerHTML = panelEditorHTML(panelEditorId); sincSelectsPag(); }
  }

  function setVS(s, k, val) {
    s.settings = s.settings || {};
    s.settings[k] = val;
    marcarSucio();
    clearTimeout(timerPreview);
    timerPreview = setTimeout(repintarPreview, 120);
  }

  function cerrarAiText() { document.getElementById("sp-ai-popover")?.remove(); }

  function abrirAiText(ruta) {
    const p = document.getElementById("sec-panel");
    if (!p) return;
    cerrarAiText();
    p.insertAdjacentHTML("beforeend", `
      <div class="sp-ai-popover" id="sp-ai-popover" role="dialog" aria-label="Editar texto con IA">
        <div class="sp-ai-popover__head">${ico("chispa")}<strong>Editar texto con IA</strong><button type="button" class="sp-ai-popover__close" data-ai-cancel aria-label="Cerrar">${ico("x")}</button></div>
        <div class="sp-ai-popover__label">Modo</div>
        <div class="sp-ai-modes" role="group" aria-label="Modo de edición">
          <button type="button" class="sp-ai-mode is-selected" data-ai-mode="rewrite">Reescribir</button>
          <button type="button" class="sp-ai-mode" data-ai-mode="shorter">Más corto</button>
          <button type="button" class="sp-ai-mode" data-ai-mode="longer">Más largo</button>
        </div>
        <label class="sp-ai-popover__label" for="sp-ai-instructions">Indicaciones opcionales</label>
        <textarea id="sp-ai-instructions" class="sp-ai-popover__textarea" rows="3" placeholder="Ej.: enfocá el texto en madres primerizas..."></textarea>
        <div class="sp-ai-popover__actions"><button type="button" class="sp-ai-cancel" data-ai-cancel>Cancelar</button><s-button variant="primary" id="sp-ai-send">Aplicar</s-button></div>
      </div>`);
    const send = p.querySelector("#sp-ai-send");
    if (send) send.dataset.aiRuta = ruta;
    p.querySelector("#sp-ai-instructions")?.focus();
  }

  function contextoAi(ruta) {
    const data = estado.pagina.data || {};
    const fuente = data.fuente || {};
    const faq = ruta.match(/^facetas\.faq\.items\.(\d+)\.(pregunta|respuesta)$/);
    const base = {
      producto: fuente.titulo_crudo || data.facetas?.hero?.titulo || "Producto de la tienda",
      descripcion_base: String(fuente.descripcion_cruda || "").slice(0, 4500),
      seccion: panelTitulo(panelEditorId || ""),
      campo: ruta.split(".").pop(),
      plantilla: data.global?.plantilla_id || data.global?.estilo || "clasico",
      version_plantilla: data.global?.plantilla_version || 1,
      intencion: data.global?.plantilla_id === "premium"
        ? "Mantener una lectura editorial, sobria y orientada a confianza."
        : "Mantener una lectura clara, directa y facil de escanear."
    };
    if (faq) {
      const item = data.facetas?.faq?.items?.[Number(faq[1])] || {};
      return {
        ...base,
        tipo: faq[2] === "respuesta" ? "respuesta a una pregunta" : "pregunta frecuente",
        pregunta_asociada: item.pregunta || "",
        respuesta_asociada: item.respuesta || "",
        regla: faq[2] === "respuesta"
          ? "Respondé la pregunta asociada. No devuelvas la pregunta, no la reformules y no la uses como respuesta."
          : "Escribí una pregunta clara que una persona real haría antes de comprar."
      };
    }
    return base;
  }

  function salidaAiValida(ruta, texto) {
    const faq = ruta.match(/^facetas\.faq\.items\.(\d+)\.respuesta$/);
    if (!faq) return true;
    const pregunta = leer(estado.pagina.data, `facetas.faq.items.${faq[1]}.pregunta`) || "";
    const normalizar = (s) => String(s).toLowerCase().replace(/[\u00bf?!.:,;\s]+/g, " ").trim();
    return normalizar(texto) !== normalizar(pregunta);
  }

  function claveEdicionAi(ruta) {
    const shop = (new URLSearchParams(location.search).get("shop") || "local").toLowerCase();
    return `tiq_edicion_ai:${shop}:${estado.pagina?.id || "sin-pagina"}:${ruta}`;
  }

  function leerEdicionAiPendiente(ruta) {
    try {
      const pending = JSON.parse(localStorage.getItem(claveEdicionAi(ruta)) || "null");
      return pending?.requestId ? pending : null;
    } catch {
      return null;
    }
  }

  function guardarEdicionAiPendiente(ruta, pending) {
    localStorage.setItem(claveEdicionAi(ruta), JSON.stringify(pending));
  }

  function limpiarEdicionAiPendiente(ruta) {
    localStorage.removeItem(claveEdicionAi(ruta));
  }

  async function enviarAiText(ruta) {
    const p = document.getElementById("sec-panel");
    const send = p?.querySelector("#sp-ai-send");
    if (!p || !send) return;
    const mode = p.querySelector(".sp-ai-mode.is-selected")?.dataset.aiMode || "rewrite";
    const instrucciones = p.querySelector("#sp-ai-instructions")?.value || "";
    const original = String(leer(estado.pagina.data, ruta) ?? "");
    const textoOriginal = send.textContent;
    send.setAttribute("disabled", "");
    send.textContent = "Procesando…";
    try {
      let pending = leerEdicionAiPendiente(ruta);
      if (!pending) {
        pending = { requestId: crypto.randomUUID() };
        guardarEdicionAiPendiente(ruta, pending);
      }
      if (!pending.jobId) {
        const { job } = await api("/texto/editar", {
          method: "POST",
          body: {
            texto: original,
            instrucciones,
            modo: mode,
            idioma: estado.idiomaPagina || estado.pagina.data.global?.idioma || "es",
            contexto: JSON.stringify(contextoAi(ruta)),
            request_id: pending.requestId
          }
        });
        pending.jobId = job.id;
        guardarEdicionAiPendiente(ruta, pending);
      }
      const completed = await esperarJob(pending.jobId, { timeoutMs: 3 * 60 * 1000 });
      const texto = completed.result?.texto;
      if (!texto) throw Object.assign(new Error("La edición terminó sin texto."), { terminal: true });
      // El job ya terminó: cualquier validación local posterior debe permitir
      // una intención nueva, nunca reabrir indefinidamente el mismo resultado.
      limpiarEdicionAiPendiente(ruta);
      if (!salidaAiValida(ruta, texto)) {
        throw new Error("La IA devolvió la pregunta en lugar de responderla. No se aplicó el cambio.");
      }
      fijar(estado.pagina.data, ruta, texto);
      marcarSucio();
      repintarPreview();
      cerrarAiText();
      refrescarPanelSeccion();
      toast("Texto actualizado");
    } catch (e) {
      if (e?.terminal === true || e?.status === 404 || e?.status === 409) {
        limpiarEdicionAiPendiente(ruta);
      }
      send.removeAttribute("disabled");
      send.textContent = textoOriginal || "Aplicar";
      p.insertAdjacentHTML("afterbegin", `<div class="sp-ai-error">${ico("x")} ${esc(e.message)}</div>`);
    }
  }

  function abrirPanelSeccion(secId) { abrirPanelEditor(`sec:${secId}`); }

  function abrirPanelEditor(editorId) {
    cerrarPanelSeccion();
    panelEditorId = editorId;
    panelSecId = editorId.startsWith("sec:") ? editorId.slice(4) : null;
    const s = secActual();
    const def = editorId.startsWith("sec:") ? null : seccionesPagina()[editorId];
    if (!s && !def) { panelSecId = null; panelEditorId = null; return; }
    document.body.classList.add("sec-panel-abierto");
    const p = document.createElement("aside");
    p.className = "sec-panel";
    p.id = "sec-panel";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-labelledby", "sec-panel-tit");
    p.innerHTML = `
      <div class="sec-panel__cab">
        <div class="sec-panel__heading"><span class="sec-panel__eyebrow">Editor de página</span><span class="sec-panel__tit" id="sec-panel-tit">${esc(panelTitulo(editorId))}</span></div>
        <button class="sec-panel__x" type="button" aria-label="Cerrar">${ico("x")}</button>
      </div>
      <div class="sec-panel__body" id="sp-body">${panelEditorHTML(panelEditorId)}</div>
      ${editorId.startsWith("sec:") ? `<div class="sec-panel__footer"><s-button variant="tertiary" tone="critical" class="sp-del" data-panel-del="${esc(s.id)}">${ico("basura")} Eliminar sección</s-button></div>` : ""}`;
    document.body.appendChild(p);
    // A11y: Esc cierra el panel.
    p._onKey = (e) => { if (e.key === "Escape") cerrarPanelSeccion(); };
    document.addEventListener("keydown", p._onKey);

    p.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.vk !== undefined) {
        const s2 = secActual(); if (!s2) return;
        const k = t.dataset.vk;
        if (t.dataset.vt === "numero") {
          setVS(s2, k, Number(t.value));
          const out = p.querySelector(`[data-vout="${k}"]`); if (out) out.textContent = t.value;
        } else if (t.type === "color") {
          setVS(s2, k, t.value);
          const sw = t.closest(".sp-color__sw"); if (sw) sw.style.background = t.value;
          const hex = t.closest(".sp-color")?.querySelector("[data-vhex]"); if (hex) hex.value = t.value;
        } else if (t.dataset.vhex !== undefined) {
          const val = t.value.trim();
          if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(val)) {
            setVS(s2, k, val);
            const sw = t.closest(".sp-color")?.querySelector(".sp-color__sw");
            if (sw) { sw.style.background = val; sw.querySelector("input").value = val.slice(0, 7); }
          }
        } else {
          setVS(s2, k, t.value);
        }
        return;
      }
      // Campos de bloque (url/título/estrellas/ancla): rutas absolutas del data.
      if (t.dataset.ruta) actualizarDato(t);
    });

    p.addEventListener("click", (e) => {
      const t = e.target;
      const ppbPago = t.closest("[data-ppb-payment]");
      if (ppbPago) {
        const ruta = "facetas.pagepilot_blue.pagos";
        const pagos = leer(estado.pagina.data, ruta) || [];
        const idPago = ppbPago.dataset.ppbPayment;
        fijar(estado.pagina.data, ruta, ppbPago.checked ? [...new Set([...pagos, idPago])] : pagos.filter((id) => id !== idPago));
        marcarSucio();
        repintarPreview();
        return;
      }
      if (t === p.querySelector(".sec-panel__x") || t.closest(".sec-panel__x")) return cerrarPanelSeccion();
      const aiTrigger = t.closest("[data-ai-text]");
      if (aiTrigger) { abrirAiText(aiTrigger.dataset.aiText); return; }
      if (t.closest("[data-ai-cancel]")) { cerrarAiText(); return; }
      const aiMode = t.closest("[data-ai-mode]");
      if (aiMode) {
        p.querySelectorAll("[data-ai-mode]").forEach((b) => b.classList.toggle("is-selected", b === aiMode));
        return;
      }
      if (t.id === "sp-ai-send") { enviarAiText(t.dataset.aiRuta); return; }
      const acc = t.closest("[data-vacc]");
      if (acc) { const id = acc.dataset.vacc; panelOpen[id] = !panelOpen[id]; refrescarPanelSeccion(); return; }
      const seg = t.closest("[data-vseg]");
      if (seg) {
        const s2 = secActual(); if (!s2) return;
        const k = seg.dataset.vseg;
        setVS(s2, k, seg.dataset.vval);
        seg.parentElement.querySelectorAll(".sp-seg__b").forEach((b) => b.classList.toggle("is-sel", b === seg));
        if (k === "fondoEstilo") refrescarPanelSeccion(); // muestra/oculta "Fondo 2"
        return;
      }
      const tog = t.closest("[data-vtog]");
      if (tog) {
        const s2 = secActual(); if (!s2) return;
        const k = tog.dataset.vtog;
        const nv = !vsGet(s2, k);
        setVS(s2, k, nv);
        tog.classList.toggle("is-on", nv); tog.setAttribute("aria-checked", nv);
        return;
      }
      const del = t.closest("[data-panel-del]");
      if (del) {
        if (!confirm("¿Eliminar esta sección de la página?")) return;
        const secs = estado.pagina.data.secciones;
        const idx = secs.findIndex((x) => x.id === del.dataset.panelDel);
        if (idx > -1) secs.splice(idx, 1);
        cerrarPanelSeccion();
        marcarSucio();
        repintarPreview();
        return;
      }
      // Acciones de bloque (agregar/quitar/mover video) + selector de imagen.
      const acc2 = accionSeccion(t);
      if (acc2 && acc2 !== "cerrado") { marcarSucio(); repintarPreview(); refrescarPanelSeccion(); return; }
      const uno = t.closest("[data-img-uno]");
      if (uno) { fijar(estado.pagina.data, uno.dataset.imgUno, uno.dataset.id); marcarSucio(); repintarPreview(); refrescarPanelSeccion(); return; }
      const quitar = t.closest("[data-img-quitar]");
      if (quitar) { fijar(estado.pagina.data, quitar.dataset.imgQuitar, null); marcarSucio(); repintarPreview(); refrescarPanelSeccion(); return; }
    });

    p.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.subir && t.files?.length) subirImagenNueva(t.files[0], t.dataset.subir, t.dataset.rutaSubir, t);
      if (t.dataset.videoEl && t.files?.length) subirVideoNuevo(t.files[0], t.dataset.videoEl, t);
    });
  }

  function cerrarPanelSeccion() {
    cerrarAiText();
    const p = document.getElementById("sec-panel");
    if (p?._onKey) document.removeEventListener("keydown", p._onKey);
    p?.remove();
    document.body.classList.remove("sec-panel-abierto");
    panelSecId = null;
    panelEditorId = null;
  }

  // Árbol de bloques del editor (panel izquierdo estilo PagePilot). Lista las
  // secciones editables (clásicas de seccionesPagina + las v2 dinámicas); cada
  // fila abre el editor de esa sección (Etapa A: reusa abrirModalEdicion).
  function arbolPaginaHTML() {
    const I = {
      encabezado: '<svg viewBox="0 0 24 24"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
      galeria: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><polyline points="21 15 16 10 5 21"/></svg>',
      beneficios: '<svg viewBox="0 0 24 24"><polyline points="3 6 4.4 7.4 6.8 5"/><line x1="10" y1="6" x2="21" y2="6"/><polyline points="3 12 4.4 13.4 6.8 11"/><line x1="10" y1="12" x2="21" y2="12"/><polyline points="3 18 4.4 19.4 6.8 17"/><line x1="10" y1="18" x2="21" y2="18"/></svg>',
      estrella: '<svg viewBox="0 0 24 24"><polygon points="12 3 14.6 8.3 20.5 9.2 16.2 13.3 17.2 19.1 12 16.4 6.8 19.1 7.8 13.3 3.5 9.2 9.4 8.3 12 3"/></svg>',
      video: '<svg viewBox="0 0 24 24"><rect x="7" y="6" width="10" height="12" rx="1.5"/><path d="M4 8.5v7"/><path d="M20 8.5v7"/></svg>',
      lista: '<svg viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="4" y1="18" x2="14" y2="18"/></svg>',
      grupo: '<svg viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
      chev: '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>',
      drag: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></svg>'
    };
    const row = (id, label, ico) =>
      `<div class="pe-tree__row" tabindex="0" data-tree="${esc(id)}"><span class="pe-tree__lead pe-tree__drag">${I.drag}</span><span class="pe-tree__ico">${ico}</span><span class="pe-tree__label">${esc(label)}</span></div>`;
    const grupo = (nombre, filas, meta) =>
      `<section class="pe-tree__group"><div class="pe-tree__row pe-tree__row--group" tabindex="0"><span class="pe-tree__lead pe-tree__chevron">${I.chev}</span><span class="pe-tree__ico pe-tree__ico--group">${I.grupo}</span><span class="pe-tree__label">${esc(nombre)}</span>${meta ? `<span class="pe-tree__group-meta">${esc(meta)}</span>` : ""}</div><div class="pe-tree__children">${filas}</div></section>`;
    const info = row("encabezado", "Encabezado", I.encabezado) + row("galeria", "Galería de producto", I.galeria) +
      row("bullets", "Beneficios", I.beneficios) + row("destacada", "Reseña destacada", I.estrella) +
      row("resenas", "Reseñas", I.estrella);
    const v2 = (estado.pagina.data.secciones || []).map((s) => row("sec:" + s.id, catSeccion(s.tipo)?.nombre || "Sección", I.lista)).join("");
    const extraOriginal = row("pagepilot_blue", "PagePilot Blue", I.grupo) + row("clientes", "Muro de clientes", I.video) + row("acordeones", "Envío y devoluciones", I.lista) +
      row("faq", "Preguntas frecuentes", I.lista) + row("iconos", "Garantías / íconos", I.beneficios) +
      row("stats", "Estadísticas", I.lista) + v2;
    const extra = row("tabla", "Comparación", I.lista) + row("garantia", "Garantía", I.lista) + extraOriginal;
    return `<nav class="pe-tree" aria-label="Bloques de la página">
      <div class="pe-tree__head"><span class="pe-tree__head-title">Página de producto</span><span class="pe-tree__head-sub">Estructura y contenido</span></div>
      <div class="pe-tree__body">${grupo("Información del producto", info, "5 bloques")}${grupo("Secciones extra", extra, `${(estado.pagina.data.secciones || []).length + 6} bloques`)}</div>
    </nav>`;
  }

  function pantallaPreview() {
    const pg = estado.pagina;
    cargarWidget("/editor-pagepilot.css", "css"); // estilos del editor 3 paneles
    sucio = false;
    if (!Array.isArray(pg.data.secciones)) pg.data.secciones = [];
    // Bullets viejos (string plano) → objeto {emoji, fuerte, resto} editable.
    // El render en la tienda tolera ambas formas; esto es solo para el editor.
    const hb = pg.data.facetas?.hero?.bullets;
    if (Array.isArray(hb)) {
      pg.data.facetas.hero.bullets = hb.map((b) =>
        typeof b === "string" ? { icono: "check", fuerte: "", resto: b } : b
      );
    }
    const publicada = pg.estado === "publicada";
    cambiosSinPublicar = !!pg.cambios_sin_publicar;
    pintarPasos(); // tras publicar se entra acá sin ir(): refresca el stepper (lo oculta).
    // Estado que refleja el pill de la barra (una sola señal persistente).
    const est = pg.estado === "publicando"
      ? { c: "publicando", t: "Publicando" }
      : pg.estado === "necesita_atencion"
        ? { c: "necesita_atencion", t: "Necesita atención" }
        : !publicada
          ? { c: "borrador", t: "Borrador" }
      : cambiosSinPublicar
        ? { c: "pend", t: "Cambios sin publicar" }
        : { c: "publicada", t: "Publicada" };
    const volverTxt = estado.volverA === "paginas" ? "Volver a mis páginas" : "Volver a los productos";
    const st = pg.paginaEstado; // "app_block" | "legacy" | "inactiva" | null
    const mostrarSetup = publicada && st !== "app_block" && pg.setupPaginaUrl;

    vista.innerHTML = `
      <div class="preview-barra" id="barra-accion">
        <button class="volver-flecha" id="volver" title="${volverTxt}" aria-label="${volverTxt}"></button>
        <div class="preview-barra__info">
          <div class="preview-barra__titulo">${esc(pg.data.facetas.hero.titulo)}</div>
          <div class="preview-barra__sub">${esc(pg.data.facetas.hero.subtitulo)}</div>
        </div>
        <div class="preview-barra__estado" id="barra-estado">
          <s-badge tone="${TONO_ESTADO[est.c] || "neutral"}">${est.t}</s-badge>
          ${publicada && pg.url_publica
            ? `<s-link href="${esc(pg.url_publica)}" target="_blank">Ver en la tienda</s-link>`
            : ""}
        </div>
        <div class="preview-barra__acciones">
          <s-button variant="secondary" id="guardar" disabled>Guardar cambios</s-button>
          <s-button variant="secondary" id="regenerar">Regenerar</s-button>
          ${publicada ? `<s-button variant="tertiary" id="despublicar">Volver a la página nativa</s-button>` : ""}
          <s-button variant="${publicada ? "secondary" : "primary"}" id="publicar">${publicada ? "Volver a publicar" : "Publicar página"}</s-button>
        </div>
      </div>

      ${
        mostrarSetup
          ? `<s-banner tone="warning" heading="${
                st === "legacy" ? "Tenés una plantilla vieja pegada a tu tema"
                : st === "inactiva" ? "Tu landing todavía no se ve en la tienda"
                : "Activá la plantilla en tu tema — una sola vez"
             }">
               ${
                 st === "legacy"
                   ? `<s-paragraph>La está pintando una versión anterior que quedó escrita en tu tema. Borrá del tema la plantilla <s-text type="strong">product.tiendaiq.liquid</s-text> y los assets <s-text type="strong">tiendaiq.js</s-text>/<s-text type="strong">tiendaiq.css</s-text>, y dejá la plantilla <s-text type="strong">tiendaiq</s-text> con el bloque <s-text type="strong">TiendaIQ Página</s-text>.</s-paragraph>`
                   : `<s-paragraph>${st === "inactiva" ? "Se publicó, pero tu tema muestra el producto nativo." : "Tu tema necesita el bloque de TiendaIQ."} Creá una vez la plantilla <s-text type="strong">tiendaiq</s-text> (basada en <s-text type="strong">product</s-text>), dejá solo el bloque <s-text type="strong">Apps → TiendaIQ Página</s-text> y guardá.</s-paragraph>`
               }
               <s-link href="${esc(pg.setupPaginaUrl)}" target="_blank">Abrir editor de temas</s-link>
               <s-button id="setup-verificar">Verificar de nuevo</s-button>
             </s-banner>`
          : ""
      }

      <div class="pe-editor">
        ${arbolPaginaHTML()}
        <div class="pe-editor__centro">
          <div class="marco marco--full">
            <iframe id="marco" src="/preview/index.html?app=1&t=${Date.now()}"></iframe>
          </div>
        </div>
      </div>`;

    // El iframe no lee ningún archivo global: recibe LOS DATOS DE ESTA página
    // por mensaje. Dos merchants generando a la vez no se pisan. El botón
    // "✎ Editar" flotante y los lápices se montan una vez por carga.
    const marco = $("marco");
    marco.onload = () => {
      repintarPreview();
      montarEdicionEnIframe(marco);
    };

    // Árbol de bloques (Etapa A): click en una fila abre el editor de esa sección;
    // el chevron colapsa el grupo. Reusa la edición existente (abrirModalEdicion).
    vista.querySelectorAll(".pe-tree__row[data-tree]").forEach((el) => {
      el.onclick = () => {
        vista.querySelectorAll(".pe-tree__row.is-sel").forEach((r) => r.classList.remove("is-sel"));
        el.classList.add("is-sel");
        abrirModalEdicion(el.dataset.tree);
      };
    });
    vista.querySelectorAll(".pe-tree__row--group .pe-tree__chevron").forEach((ch) => {
      ch.onclick = (e) => { e.stopPropagation(); ch.closest(".pe-tree__group").classList.toggle("is-collapsed"); };
    });

    $("volver").onclick = () => {
      if (sucio && !confirm("Hay cambios sin guardar. ¿Salir igual?")) return;
      if (estado.volverA === "paginas") ir("paginas");
      else cargarLista();
    };
    $("regenerar").onclick = () => {
      if (sucio && !confirm("Regenerar descarta los cambios sin guardar. ¿Seguir?")) return;
      ir("informacion");
    };
    $("guardar").onclick = guardarCambios;
    $("publicar").onclick = publicar;
    const bDespub = $("despublicar");
    if (bDespub) bDespub.onclick = despublicar;
    // Re-verifica en vivo si la landing ya se ve (fresh=1 saltea el cache) y
    // repinta la pantalla con el estado nuevo — sin recargar toda la app.
    const sv = $("setup-verificar");
    if (sv) sv.onclick = async () => {
      sv.setAttribute("disabled", "");
      sv.textContent = "Verificando…";
      try { estado.pagina.paginaEstado = (await api("/pagina-estado?fresh=1")).estado; } catch {}
      pantallaPreview();
    };
  }

  async function publicar() {
    // Publicar con cambios sin guardar los guardaría a medias: primero el PUT.
    if (sucio && !(await guardarCambios())) return;

    const b = $("publicar");
    b.setAttribute("disabled", "");
    b.textContent = "Publicando…";
    try {
      const { job: queuedJob } = await api(`/paginas/${estado.pagina.id}/publicar`, { method: "POST" });
      await esperarJob(queuedJob.id, {
        onUpdate(job) {
          if (!b) return;
          b.textContent = job.status === "running"
            ? `Publicando… intento ${job.attempts}`
            : "Publicación en cola…";
        }
      });
      estado.pagina = await api(`/paginas/${estado.pagina.id}`);
      try {
        const live = await api("/pagina-estado?fresh=1");
        estado.pagina.paginaEstado = live.estado;
        estado.pagina.setupPaginaUrl = live.setupUrl;
      } catch {}
      cambiosSinPublicar = false; // recién publicada: lo que se ve es lo que hay
      pantallaPreview();
      // Éxito = señal efímera, no banner permanente. El estado vive en el pill.
      toast((estado.pagina.paginaEstado === "legacy" || estado.pagina.paginaEstado === "inactiva")
        ? "Publicada. Falta activar/limpiar la plantilla en tu tema (ver abajo)."
        : "¡Publicada! Ya está en tu tienda.");
    } catch (e) {
      try {
        estado.pagina = await api(`/paginas/${estado.pagina.id}`);
        pantallaPreview();
      } catch {
        b.removeAttribute("disabled");
        b.textContent = "Publicar página";
      }
      vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} ${esc(e.message)}</div>`);
    }
  }

  // Vuelve el producto a su página NATIVA (saca el templateSuffix en el server).
  // Reversible: el metafield queda, re-publicar la reusa sin regenerar. Sirve si
  // publicaste al producto equivocado o querés volver atrás.
  async function despublicar() {
    if (!confirm("El producto vuelve a su página nativa de Shopify. La página queda guardada como borrador y podés re-publicarla cuando quieras. ¿Seguir?")) return;
    const b = $("despublicar");
    if (b) { b.setAttribute("disabled", ""); b.textContent = "Volviendo…"; }
    try {
      estado.pagina = await api(`/paginas/${estado.pagina.id}/despublicar`, { method: "POST" });
      cambiosSinPublicar = false;
      pantallaPreview();
      toast("Volviste a la página nativa. La página quedó como borrador.");
    } catch (e) {
      if (b) { b.removeAttribute("disabled"); b.textContent = "Volver a la página nativa"; }
      vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} ${esc(e.message)}</div>`);
    }
  }

  // ============================================================
  // BUNDLES — paquetes / descuentos por volumen.
  // Dashboard (métricas + lista) → editor de 2 pestañas (Ofertas / Diseño)
  // con preview en vivo. El preview usa el MISMO css que se inyecta en la
  // tienda (/widgets/tiendaiq-bundle.css), así que es fiel al storefront.
  // ============================================================

  const PRECIO_DEMO = 24990; // centavos, solo para el preview del admin
  // Respeta avanzado.sin_decimales del bundle en edición (paridad con el widget).
  const fmtBdl = (c) => {
    const sinDec = !!(bundleActual()?.diseno?.avanzado?.sin_decimales);
    const n = Math.round(c) / 100;
    return "$ " + n.toLocaleString("es-AR", sinDec ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Vuelca un producto elegido en un ítem de regalo: nombre, imagen, precio y,
  // si el producto tiene variantes reales (Color, Talle…), la lista para que el
  // cliente elija. Con una sola variante ("Default") no hay elección.
  function asignarRegalo(it, p) {
    it.id = p.id;
    it.nombre = p.titulo;
    it.imagen = p.imagen || null;
    if (p.precio != null) it.precio = p.precio;
    // Shopify usa la opción sintética "Title" → "Default Title" para productos
    // sin variantes reales: eso no es una elección.
    const opt = (p.opciones || [])[0];
    const real = opt && opt.nombre && opt.nombre !== "Title" && (opt.valores || []).length > 1;
    const vars = (p.variantes || []).filter((v) => v && v.titulo && v.titulo !== "Default Title");
    if (real && vars.length > 1) {
      it.opcionNombre = opt.nombre;
      it.variantes = vars.map((v) => ({ id: v.id, titulo: v.titulo, imagen: v.imagen || p.imagen || null }));
      it.varSel = it.variantes.map((v) => v.id); // por defecto: se ofrecen todas
    } else {
      delete it.opcionNombre;
      delete it.variantes;
      delete it.varSel;
    }
  }

  // Fila de un regalo en el preview (imagen, nombre, selector de variante si el
  // cliente puede elegir, pastilla GRATIS y precio original tachado). El mismo
  // marcado se replica en el widget del storefront (tiendaiq-bundle.js).
  function filaRegaloBdl(it) {
    const cant = it.cantidad || 1;
    const ic = it.imagen
      ? `<span class="tiq-bdl__gift-ic tiq-bdl__gift-ic--img"><img src="${esc(it.imagen)}" alt=""></span>`
      : `<span class="tiq-bdl__gift-ic">🎁</span>`;
    const vars = (it.variantes || []).filter((v) => !it.varSel || it.varSel.includes(v.id));
    let sel = "";
    if (vars.length > 1) sel = `<select class="tiq-bdl__gift-var" aria-label="${esc(it.opcionNombre || "Opción")}">${vars.map((v) => `<option>${esc(v.titulo)}</option>`).join("")}</select>`;
    else if (vars.length === 1) sel = `<span class="tiq-bdl__gift-varone">${esc(vars[0].titulo)}</span>`;
    const pill = `<span class="tiq-bdl__gift-free"${it.colorGratis ? ` style="background:${esc(it.colorGratis)}"` : ""}>${esc(it.textoGratis || "GRATIS")}</span>`;
    const cents = it.precio != null ? Math.round(parseFloat(it.precio) * 100) * cant : 0;
    const old = it.mostrarPrecio !== false && cents > 0 ? `<s class="tiq-bdl__gift-old">${fmtBdl(cents)}</s>` : "";
    return `<div class="tiq-bdl__gift">${ic}<span class="tiq-bdl__gift-main"><span class="tiq-bdl__gift-name">${cant}x ${esc(it.nombre || "Regalo")}</span>${sel}</span><span class="tiq-bdl__gift-right">${pill}${old}</span></div>`;
  }

  function cerrarMenuTipo() {
    const m = document.getElementById("bdl-tipomenu");
    if (m) m.remove();
  }

  // Presets de color de la pestaña Diseño (nombre → paleta).
  const PRESETS_BDL = {
    negro:   { borde: "#111111", badge: "#111111", etq: "#e11d48", texto: "#111111", bot: "#111111" },
    rosa:    { borde: "#db2777", badge: "#db2777", etq: "#db2777", texto: "#111111", bot: "#db2777" },
    azul:    { borde: "#2563eb", badge: "#2563eb", etq: "#2563eb", texto: "#111111", bot: "#2563eb" },
    verde:   { borde: "#059669", badge: "#059669", etq: "#059669", texto: "#111111", bot: "#059669" },
    violeta: { borde: "#7c3aed", badge: "#7c3aed", etq: "#7c3aed", texto: "#111111", bot: "#7c3aed" },
    naranja: { borde: "#ea580c", badge: "#ea580c", etq: "#ea580c", texto: "#111111", bot: "#ea580c" }
  };
  const NOMBRE_PRESET = { negro: "Negro", rosa: "Rosa", azul: "Azul", verde: "Verde", violeta: "Violeta", naranja: "Naranja" };
  // Plantillas de insignia (forma). El texto lo pone el merchant; la forma es global.
  const FORMAS_BADGE = [["soft", "Suave"], ["pill", "Píldora"], ["rect", "Recto"], ["ribbon", "Cinta"], ["tag", "Etiqueta"]];
  const formaBadgeBdl = (d) => (FORMAS_BADGE.some(([k]) => k === (d || {}).badge_forma) ? d.badge_forma : "soft");

  // Contraste WCAG: evita que el merchant guarde una insignia ilegible.
  function luminanciaHex(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrasteWCAG(a, b) {
    const l1 = luminanciaHex(a), l2 = luminanciaHex(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  // --- Historial de diseño (undo/redo general, no solo paletas) ---
  const clonD = (x) => JSON.parse(JSON.stringify(x || {}));
  let histTimer = null;
  function histDe(b) {
    let h = estado.bundles.hist;
    if (!h || h.bundle !== b) h = estado.bundles.hist = { bundle: b, stack: [clonD(b.diseno)], idx: 0 };
    return h;
  }
  function actualizarBotonesHist(b) {
    const h = histDe(b);
    const u = document.getElementById("bdl-undo"), r = document.getElementById("bdl-redo");
    if (u) u.disabled = h.idx <= 0;
    if (r) r.disabled = h.idx >= h.stack.length - 1;
  }
  function commitHist(b) {
    const h = histDe(b);
    const snap = clonD(b.diseno);
    if (JSON.stringify(snap) === JSON.stringify(h.stack[h.idx])) return; // sin cambios reales
    h.stack = h.stack.slice(0, h.idx + 1); // corta cualquier "rehacer" pendiente
    h.stack.push(snap);
    if (h.stack.length > 30) h.stack.shift(); else h.idx = h.stack.length - 1;
    h.idx = h.stack.length - 1;
    actualizarBotonesHist(b);
  }
  function pushHist(b) { clearTimeout(histTimer); histTimer = setTimeout(() => commitHist(b), 350); }
  function restaurarHist(b, dir) {
    clearTimeout(histTimer);
    const h = histDe(b), ni = h.idx + dir;
    if (ni < 0 || ni >= h.stack.length) return;
    h.idx = ni;
    b.diseno = clonD(h.stack[ni]);
    marcarSucioBundles(); pintarPreviewBundle(); pintarEditorBundle();
  }

  // Refresca en vivo el aviso de contraste de la insignia (sin re-render total).
  function refrescarAvisoContraste(b) {
    const el = document.getElementById("bdl-aviso-contraste");
    if (!el) return;
    const c = contrasteWCAG(leer(b, "diseno.color_badge") || "#111111", leer(b, "diseno.color_badge_texto") || "#ffffff");
    if (c < 4.5) {
      el.className = "perso-aviso";
      el.innerHTML = `${ico("aviso")} El texto de la insignia se lee mal (contraste ${c.toFixed(1)}:1). <button type="button" class="bdl-fixc" data-fix-contraste>Arreglar</button>`;
    } else {
      el.className = "perso-aviso perso-aviso--ok";
      el.innerHTML = "";
    }
  }

  // Bundle nuevo (espeja bundleDefault del server; el server lo completa igual).
  function nuevoBundleLocal(tipo = "volumen") {
    return {
      id: "b_" + Math.random().toString(36).slice(2, 9),
      nombre: tipo === "bxgy" ? "Comprá X y obtené Y" : "Descuento por volumen",
      tipo,
      activo: true,
      activador: { tipo: "todos", ids: [] },
      // Los niveles vienen con una FOTO DE EJEMPLO por nivel (como Pumper) para
      // que el bundle se vea armado de una. El merchant las reemplaza con las
      // suyas desde "Subir Imagen" en cada nivel. Placeholders en /app/img.
      ofertas: [
        { cantidad: 1, descuento: 0,  titulo: "Comprá 1", subtitulo: "Precio normal", etiqueta: "",        badge: "",            popular: false, predeterminada: false, addons: { imagen: { on: true, url: "/img/bundle-ejemplo-1.svg", tamano: "mediano", radio: 12 } } },
        { cantidad: 2, descuento: 10, titulo: "Comprá 2", subtitulo: "",              etiqueta: "10% OFF", badge: "Más elegido", popular: true,  predeterminada: true,  addons: { imagen: { on: true, url: "/img/bundle-ejemplo-2.svg", tamano: "mediano", radio: 12 } } },
        { cantidad: 3, descuento: 15, titulo: "Comprá 3", subtitulo: "",              etiqueta: "15% OFF", badge: "Mejor valor", popular: false, predeterminada: false, addons: { imagen: { on: true, url: "/img/bundle-ejemplo-3.svg", tamano: "mediano", radio: 12 } } }
      ],
      bxgy: { compra_cantidad: 2, regalo_cantidad: 1, regalo_descuento: 100 },
      diseno: {
        preset: "negro", titulo: "Elegí tu paquete y ahorrá", subtitulo: "Cuantas más unidades, mejor el precio",
        mostrar_encabezado: true, color_borde: "#111111", color_badge: "#111111", color_badge_texto: "#ffffff",
        color_etiqueta: "#e11d48", color_texto: "#111111", radio: 12, mostrar_ahorro: true,
        boton: { texto: "Agregar al carrito — {total}", color_fondo: "#111111", color_texto: "#ffffff", radio: 8, tamano: 16 }
      },
      discount_ids: []
    };
  }

  // BOGO "Comprá y llevá gratis" pre-armado como Pumper: mismo editor de
  // NIVELES (backend por volumen, ya probado) con títulos BOGO y el % que
  // equivale a "llevás N gratis" (comprá 2 llevás 1 = 3 uds, pagás 2 = 33%;
  // comprá 3 llevás 2 = 5 uds, pagás 3 = 40%). Fotos de ejemplo por nivel.
  function nuevoBundleBogo() {
    const b = nuevoBundleLocal("volumen");
    b.nombre = "Comprá y llevá gratis";
    b.diseno.titulo = "Comprá y llevá gratis";
    b.diseno.subtitulo = "Cuanto más llevás, más regalás";
    b.ofertas = [
      { cantidad: 1, descuento: 0,  titulo: "Comprá 1",                 subtitulo: "Precio normal", etiqueta: "",        badge: "",            popular: false, predeterminada: false, addons: { imagen: { on: true, url: "/img/bundle-ejemplo-1.svg", tamano: "mediano", radio: 12 } } },
      { cantidad: 3, descuento: 33, titulo: "Comprá 2, llevás 1 gratis", subtitulo: "",              etiqueta: "33% OFF", badge: "Más elegido", popular: true,  predeterminada: true,  addons: { imagen: { on: true, url: "/img/bundle-ejemplo-2.svg", tamano: "mediano", radio: 12 } } },
      { cantidad: 5, descuento: 40, titulo: "Comprá 3, llevás 2 gratis", subtitulo: "",              etiqueta: "40% OFF", badge: "Mejor valor", popular: false, predeterminada: false, addons: { imagen: { on: true, url: "/img/bundle-ejemplo-3.svg", tamano: "mediano", radio: 12 } } }
    ];
    return b;
  }

  // "Regalos gratis" (Unlock Free Gifts de Pumper) pre-armado: niveles por
  // volumen donde el nivel popular DESBLOQUEA un regalo (addon regalo → fila con
  // "GRATIS" + precio tachado). Fotos de ejemplo + regalo de ejemplo. El merchant
  // reemplaza el producto de regalo y las fotos.
  function nuevoBundleRegalo() {
    const b = nuevoBundleLocal("volumen");
    b.nombre = "Regalos gratis";
    b.diseno.titulo = "Desbloqueá tu regalo";
    b.diseno.subtitulo = "Comprá 2 y llevate un regalo gratis";
    b.ofertas = [
      { cantidad: 1, descuento: 0,  titulo: "Comprá 1", subtitulo: "Precio normal", etiqueta: "",        badge: "",            popular: false, predeterminada: false, addons: { imagen: { on: true, url: "/img/bundle-ejemplo-1.svg", tamano: "mediano", radio: 12 } } },
      { cantidad: 2, descuento: 20, titulo: "Comprá 2", subtitulo: "",              etiqueta: "20% OFF", badge: "Más elegido", popular: true,  predeterminada: true,
        addons: {
          imagen: { on: true, url: "/img/bundle-ejemplo-2.svg", tamano: "mediano", radio: 12 },
          regalo: { on: true, items: [{ nombre: "Regalo de ejemplo", imagen: "/img/bundle-regalo.svg", cantidad: 1, textoGratis: "GRATIS", mostrarPrecio: true, precio: 20 }] }
        } }
    ];
    return b;
  }

  // "Bundle y Ahorrá" (Combo): PAQUETE de varios productos distintos con un
  // descuento sobre el set. Estructura propia (b.combo.productos), editor propio
  // (pintarEditorCombo) y branch propio en el widget. NO usa niveles (b.ofertas
  // queda [] para que nada que itere ofertas rompa). Etapa 1 = editor + preview;
  // el carrito "agregar todo" + el descuento real van en Etapa 2.
  function nuevoBundleCombo() {
    const b = nuevoBundleLocal("volumen");
    b.tipo = "combo";
    b.nombre = "Bundle y Ahorrá";
    b.ofertas = [];
    b.diseno.titulo = "Comprá el combo y ahorrá";
    b.diseno.subtitulo = "";
    b.diseno.etiqueta = "Combo";
    b.diseno.pie = "Comprar todo en:";
    b.combo = {
      productos: [
        { id: "", nombre: "Producto de ejemplo 1", imagen: "/img/bundle-ejemplo-1.svg", precio: 10 },
        { id: "", nombre: "Producto de ejemplo 2", imagen: "/img/bundle-ejemplo-3.svg", precio: 20 }
      ],
      descuento: { tipo: "porcentaje", valor: 10 }
    };
    return b;
  }

  // Editor del combo (paridad con "Crear Oferta de Paquete" de Pumper). Mismo
  // chrome monocromo que el editor de niveles; reusa el aside de preview y el
  // binding delegado de bindEditorBundle para los campos data-b.
  function pintarEditorCombo(b) {
    b.combo = b.combo || { productos: [], descuento: { tipo: "porcentaje", valor: 10 } };
    b.diseno = b.diseno || {};
    b.diseno.boton = b.diseno.boton || { texto: "Agregar al carrito", color_fondo: "#111111", color_texto: "#ffffff", radio: 8 };
    const prods = b.combo.productos || [];
    const TIPOS_DESC = [["porcentaje", "% Descuento"], ["fijo", "Monto fijo"], ["ninguno", "Sin descuento"]];
    const filas = prods.length
      ? prods.map((p, i) => `
        <div class="be-cmb__prod">
          <span class="be-cmb__foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="">` : ico("bolsa", "ico--ph")}</span>
          <span class="be-cmb__nombre">${esc(p.nombre || "Producto")}</span>
          <span class="be-cmb__precio">${p.precio != null && p.precio !== "" ? "$" + esc(p.precio) : ""}</span>
          <button type="button" class="be-cmb__quitar" data-cmb-quitar="${i}" aria-label="Quitar producto">${ico("x")}</button>
        </div>`).join("")
      : `<div class="be-cmb__vacio">Todavía no agregaste productos al paquete.</div>`;

    vista.innerHTML = `
      <div class="be-top">
        <button class="volver-flecha" id="bdl-volver"></button>
        <h1>Crear oferta de paquete</h1>
        <div class="be-top__act">
          <s-button variant="secondary" id="bdl-borrador">Guardar como borrador</s-button>
          <s-button variant="primary" id="bdl-guardar">Publicar</s-button>
        </div>
      </div>
      <div class="be-layout">
        <div class="be-left" id="be-left">
          <div class="be-guinda be-guinda--top"><div class="be-guinda__t">General</div><div class="be-guinda__s">Elegí los productos que se venden juntos en el paquete.</div></div>
          <section class="be-sec be-sec--plain">
            <div class="be-block">
              ${campoBdl("nombre", "Nombre de la oferta")}
              ${campoBdl("diseno.titulo", "Título del paquete")}
            </div>
            <div class="be-block">
              <div class="be-block__t">Productos del paquete</div>
              <div class="be-cmb__prods">${filas}</div>
              <button class="be-add" type="button" data-cmb-add>${ico("mas")} Agregar productos</button>
            </div>
          </section>
          <div class="be-guinda"><div class="be-guinda__t">Descuento</div><div class="be-guinda__s">Se aplica al total del paquete.</div></div>
          <section class="be-sec be-sec--plain">
            <div class="be-block">
              <div class="be-grid2">
                <div class="campo campo--editor"><label>Tipo de descuento</label><s-select data-b="combo.descuento.tipo">${TIPOS_DESC.map(([v, t]) => `<s-option value="${v}">${t}</s-option>`).join("")}</s-select></div>
                <div class="campo campo--editor"><label>Valor del descuento</label><s-text-field type="number" min="0" data-b="combo.descuento.valor" data-tipo="numero" value="${esc(b.combo.descuento?.valor ?? 0)}"></s-text-field></div>
              </div>
            </div>
          </section>
          <div class="be-guinda"><div class="be-guinda__t">Personalización</div><div class="be-guinda__s">Etiqueta, pie y botón del paquete.</div></div>
          <section class="be-sec be-sec--plain">
            <div class="be-block">
              ${campoBdl("diseno.etiqueta", "Etiqueta destacada")}
              ${campoBdl("diseno.pie", "Texto del pie de página")}
              ${campoBdl("diseno.boton.texto", "Botón (llamada a la acción)")}
            </div>
          </section>
        </div>
        ${previewAsideBundle()}
      </div>`;

    $("bdl-volver").onclick = () => salirBundles();
    $("bdl-guardar").onclick = async () => { b.activo = true; await guardarBundles(); };
    $("bdl-borrador").onclick = async () => { b.activo = false; await guardarBundles(); };

    // Agregar / quitar productos del paquete.
    const add = vista.querySelector("[data-cmb-add]");
    if (add) add.onclick = () => abrirPickerTodos((p) => {
      b.combo.productos = b.combo.productos || [];
      b.combo.productos.push({ id: p.id, nombre: p.titulo, imagen: p.imagen || "", precio: p.precio != null ? p.precio : 10 });
      marcarSucioBundles(); pintarEditorCombo(b);
    });
    vista.querySelectorAll("[data-cmb-quitar]").forEach((btn) => btn.onclick = () => {
      b.combo.productos.splice(+btn.dataset.cmbQuitar, 1); marcarSucioBundles(); pintarEditorCombo(b);
    });

    bindEditorBundle(b, estado.bundles); // binding delegado de los campos data-b
    pintarPreviewBundle();

    vista.querySelectorAll("s-select[data-b]").forEach((sel) => { const v = leer(b, sel.dataset.b); if (v != null && v !== "") sel.value = String(v); });

    const selProd = $("bdl-preview-prod");
    if (selProd) selProd.onchange = (e) => { estado.bundles.previewProd = e.target.value || null; pintarEditorCombo(b); };
    vista.querySelectorAll("[data-pv]").forEach((btn) => {
      btn.onclick = () => {
        const mob = btn.dataset.pv === "mobile";
        estado.bundles.previewMobile = mob;
        const marco = vista.querySelector(".bdl-preview__marco");
        if (marco) { marco.classList.toggle("is-mobile", mob); marco.classList.toggle("is-desktop", !mob); }
        vista.querySelectorAll("[data-pv]").forEach((x) => x.classList.toggle("is-sel", x === btn));
      };
    });
  }

  // Toast reutilizable: feedback de acciones, con "Deshacer" opcional.
  function toast(msg, opts = {}) {
    // App Bridge nativo cuando estamos embebidos (look "Built for Shopify").
    // Los toasts con "Deshacer" siguen usando el nuestro (el toast de App
    // Bridge no lleva acción de undo); fuera del admin, también el nuestro.
    if (!opts.undo && window.shopify?.toast?.show) {
      try {
        window.shopify.toast.show(msg, { duration: 3000, isError: !!opts.error });
        return () => {};
      } catch {}
    }
    let cont = document.getElementById("tiq-toasts");
    if (!cont) { cont = document.createElement("div"); cont.id = "tiq-toasts"; document.body.appendChild(cont); }
    const t = document.createElement("div");
    t.className = "tiq-toast";
    t.setAttribute("role", "status");
    t.innerHTML = `<span>${esc(msg)}</span>` + (opts.undo ? `<button class="tiq-toast__undo">Deshacer</button>` : "");
    cont.appendChild(t);
    requestAnimationFrame(() => t.classList.add("is-in"));
    let cerrado = false;
    const cerrar = () => { if (cerrado) return; cerrado = true; t.classList.remove("is-in"); setTimeout(() => t.remove(), 220); };
    if (opts.undo) t.querySelector(".tiq-toast__undo").onclick = () => { cerrar(); opts.undo(); };
    setTimeout(cerrar, opts.undo ? 6000 : 3000);
    return cerrar;
  }

  // Carga diferida de assets del preview de Bundles: en vez de bajarlos en toda
  // la app, se inyectan solo al entrar a la pantalla que los usa. Idempotente.
  const _widgetsCargados = new Set();
  function cargarWidget(href, tipo) {
    if (_widgetsCargados.has(href)) return Promise.resolve();
    _widgetsCargados.add(href);
    return new Promise((ok) => {
      const el = tipo === "css"
        ? Object.assign(document.createElement("link"), { rel: "stylesheet", href })
        : Object.assign(document.createElement("script"), { src: href, defer: true });
      el.onload = () => ok();
      el.onerror = () => ok(); // no bloquear el preview si un asset falla
      document.head.appendChild(el);
    });
  }

  async function pantallaBundles() {
    // El preview de bundles usa el MISMO css que ve el cliente.
    await cargarWidget("/widgets/tiendaiq-bundle.css", "css");
    if (!estado.bundles) {
      try {
        vista.innerHTML = `<div class="cargando">Comprobando la sincronización de bundles…</div>`;
        const config = await resolverBundlesPendientes() || await api("/bundles");
        estado.bundles = { config, vista: "lista", editIdx: null, tab: "ofertas", sucio: false, previewProd: null, metricas: null };
      } catch (e) {
        vista.innerHTML = `<div class="error">${ico("x","ico--banner")} No se pudo leer los bundles: ${esc(e.message)}</div>`;
        return;
      }
    }
    if (estado.bundles.vista === "editor") pintarEditorBundle();
    else if (estado.bundles.vista === "temas") pantallaBundleTemas();
    else pintarDashboardBundles();
  }

  function bundleActual() {
    return estado.bundles.config.lista[estado.bundles.editIdx];
  }

  // ---------- dashboard ----------

  function tarjetaMetrica(titulo, valor, ayuda) {
    return `<div class="bdl-metrica">
      <div class="bdl-metrica__t">${esc(titulo)} <span class="bdl-metrica__i" title="${esc(ayuda || "")}">${ico("info")}</span></div>
      <div class="bdl-metrica__v">${esc(valor)}</div>
    </div>`;
  }

  // Métricas de uso de las reglas nativas de Shopify. No consultan pedidos ni
  // datos de compradores. El contador de Shopify se actualiza de forma asíncrona.
  function bloqueMetricas() {
    const m = estado.bundles.metricas;
    const tile = (t, v) => `<s-box padding="large-100" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="small-500"><s-text color="subdued">${esc(t)}</s-text><s-heading>${v}</s-heading></s-stack>
    </s-box>`;
    const grilla = (cells) => `<s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">${cells}</s-grid>`;
    if (estado.bundles.metricasError) {
      return `<s-banner tone="warning"><s-paragraph>No pudimos leer el uso de los descuentos. La configuración y el checkout siguen funcionando.</s-paragraph></s-banner>`;
    }
    if (!m) {
      return grilla(
        tile("Bundles activos", "—") + tile("Reglas en Shopify", "—") + tile("Usos registrados", "—")
      );
    }
    return grilla(
      tile("Bundles activos", String(m.ofertasActivas)) +
      tile("Reglas en Shopify", String(m.reglas)) +
      tile("Usos registrados", Number(m.usos).toLocaleString("es-AR"))
    ) + `<s-text color="subdued">Shopify actualiza los usos de forma asíncrona.${m.faltantes ? ` ${m.faltantes} regla(s) guardada(s) ya no aparecen en Shopify.` : ""}</s-text>`;
  }

  // ---------- galería "Elegí el tema" (nueva, estilo Pumper) ----------
  // Paleta de acentos para los swatches (recolorea las previews en vivo).
  const BT_COLORES = ["#1a1a1a", "#16a34a", "#0d9488", "#0ea5e9", "#2563eb", "#4f46e5", "#7c3aed", "#db2777", "#e11d48", "#ea580c", "#92400e", "#b45309"];

  // Crea un bundle del tipo elegido y salta al editor.
  function crearDesdeTema(tipo) {
    const nb = tipo === "bxgy" ? nuevoBundleBogo() : tipo === "gift" ? nuevoBundleRegalo() : tipo === "combo" ? nuevoBundleCombo() : nuevoBundleLocal(tipo);
    // El color elegido en la galería pasa a ser el acento del bundle.
    const ac = estado.bundles.temaColor;
    if (ac) { nb.diseno.color_borde = ac; nb.diseno.color_badge = ac; nb.diseno.color_etiqueta = ac; nb.diseno.boton.color_fondo = ac; }
    estado.bundles.config.lista.push(nb);
    estado.bundles.editIdx = estado.bundles.config.lista.length - 1;
    estado.bundles.vista = "editor";
    estado.bundles.tab = "ofertas";
    estado.bundles.sucio = true;
    pintarEditorBundle();
  }

  function pantallaBundleTemas() {
    const ac = estado.bundles.temaColor || "#db2777";
    const PH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>`;
    const GIFT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M3 13h18M12 9v12M12 9C10 9 8 8 8 6.2 8 5 9 4.5 10 5c1.3.7 2 4 2 4zM12 9c2 0 4-1 4-2.8 0-1.2-1-1.7-2-1.2-1.3.7-2 4-2 4z"/></svg>`;

    // --- Card 1: Buy More Save More (volumen) ---
    const rowVol = (n, pill, price, old, sel, bv) => `
      <div class="bt-row ${sel ? "is-sel" : ""}">
        ${bv ? `<span class="bt-bv">Mejor valor</span>` : ""}
        <span class="bt-radio"></span>
        <span class="bt-row__main"><b>Comprá ${n}</b> ${pill ? `<span class="bt-pill">${pill}</span>` : `<span class="bt-std">Precio normal</span>`}</span>
        <span class="bt-price">${price}${old ? ` <s>${old}</s>` : ""}</span>
      </div>`;
    const cardVolumen = `
      ${rowVol(1, "", "$10.00", "", true, false)}
      ${rowVol(2, "20% OFF", "$16.00", "$20.00", false, false)}
      ${rowVol(3, "30% OFF", "$21.00", "$30.00", false, false)}
      ${rowVol(4, "40% OFF", "$24.00", "$40.00", false, true)}`;

    // --- Card 2: BOGO Offers (bxgy) ---
    const rowBogo = (tit, sub, price, old, sel) => `
      <div class="bt-row bt-row--thumb ${sel ? "is-sel" : ""}">
        <span class="bt-thumb">${PH}</span>
        <span class="bt-row__main"><b>${tit}</b><span class="bt-sub">${sub}</span></span>
        <span class="bt-price">${price}${old ? ` <s>${old}</s>` : ""}</span>
      </div>`;
    const cardBogo = `
      ${rowBogo("Comprá 1", "Precio normal", "$10.00", "", true)}
      ${rowBogo("Comprá 2, 1 gratis", "33% OFF", "$20.00", "$30.00", false)}
      ${rowBogo("Comprá 3, 2 gratis", "40% OFF", "$30.00", "$50.00", false)}`;

    // --- Card 3: Unlock Free Gifts ---
    const cardGift = `
      <div class="bt-row is-sel">
        <span class="bt-radio"></span>
        <span class="bt-row__main"><b>Individual</b> <span class="bt-std">Precio normal</span>
          <span class="bt-size">Talle <select disabled><option>S</option></select></span></span>
        <span class="bt-price">$10.00</span>
      </div>
      <div class="bt-row">
        <span class="bt-bv bt-bv--pop">Más elegido</span>
        <span class="bt-radio"></span>
        <span class="bt-row__main"><b>Dúo</b> <span class="bt-sub">Ahorrás $4.00</span></span>
        <span class="bt-price">$16.00 <s>$20.00</s></span>
      </div>
      <div class="bt-row bt-gift"><span class="bt-gift__ico">${GIFT}</span><span class="bt-row__main"><b>+1 REGALO GRATIS</b></span><span class="bt-price"><s>$100.00</s></span></div>`;

    // --- Card 4: Bundle & Save (combo) ---
    const cardCombo = `
      <div class="bt-combo">
        <div class="bt-combo__row"><span class="bt-combo__it">${PH}</span><span class="bt-combo__plus">+</span><span class="bt-combo__it">${PH}</span></div>
        <div class="bt-combo__row"><span class="bt-combo__it">${PH}</span></div>
      </div>`;

    const card = (tit, prev, btnTxt, tipo, activo) => `
      <div class="bt-card">
        <div class="bt-card__tit">${tit}</div>
        <div class="bt-card__prev">${prev}</div>
        <div class="bt-card__accion">${
          activo
            ? `<s-button variant="primary" data-tema="${tipo}">${btnTxt}</s-button>`
            : `<s-button disabled>Próximamente</s-button>`
        }</div>
      </div>`;

    vista.innerHTML = `
      <div class="bt" style="--bt-ac:${ac}">
        <div class="bt-cab">
          <button class="volver-flecha" id="bt-volver"></button>
          <div><h1>Elegí el tema de bundle ganador</h1><p>Personalización completa justo después</p></div>
          <div class="bt-sws">${BT_COLORES.map((c) => `<button class="bt-sw ${c === ac ? "is-sel" : ""}" data-color="${c}" style="--sw:${c}" aria-label="Color ${c}"></button>`).join("")}</div>
        </div>
        <div class="bt-grid">
          ${card("Comprá más, ahorrá más", cardVolumen, "Personalizar ahora", "volumen", true)}
          ${card("Comprá y llevá gratis", cardBogo, "Personalizar ahora", "bxgy", true)}
          ${card("Regalos gratis", cardGift, "Personalizar ahora", "gift", false)}
          ${card("Bundle y Ahorrá", cardCombo, "Crear un paquete", "combo", false)}
        </div>
      </div>`;

    $("bt-volver").onclick = () => { estado.bundles.vista = "lista"; pintarDashboardBundles(); };
    vista.querySelectorAll(".bt-sw").forEach((b) => (b.onclick = () => { estado.bundles.temaColor = b.dataset.color; pantallaBundleTemas(); }));
    vista.querySelectorAll("s-button[data-tema]").forEach((b) => (b.onclick = () => crearDesdeTema(b.dataset.tema)));
  }

  function pintarDashboardBundles() {
    const lista = estado.bundles.config.lista || [];
    const inst = estado.bundles.config.instalado;
    const sync = estado.bundles.config.sync || null;

    const filtro = estado.bundles.filtro || "todas";
    const sel = estado.bundles.sel || (estado.bundles.sel = []); // ids seleccionados (bulk)
    // Íconos mono (no emoji: los emojis delatan MVP en el admin de Shopify).
    const ICO_BOX = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8.5v9L12 22l-9-4.5v-9L12 4l9 4.5z"/><path d="M3 8.5l9 4.5 9-4.5"/><path d="M12 13v9"/></svg>`;
    const ICO_GIFT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8.5" width="18" height="4" rx="1"/><path d="M4.5 12.5V20h15v-7.5"/><path d="M12 8.5V20"/><path d="M12 8.5C11 6 9.5 4.5 8 4.5a2 2 0 0 0 0 4z"/><path d="M12 8.5c1-2.5 2.5-4 4-4a2 2 0 0 1 0 4z"/></svg>`;

    const nAct = lista.filter((b) => b.activo !== false).length;
    const nPaus = lista.length - nAct;
    const visibles = lista
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => (filtro === "activas" ? b.activo !== false : filtro === "pausadas" ? b.activo === false : true));

    // Usos por bundle, sumados desde las reglas que realmente creó la app.
    const met = estado.bundles.metricas;
    const fmtUsos = (id) => {
      if (!met) return `<span class="bdl-sk bdl-sk--s"></span>`;
      const usos = met.porBundle?.[id]?.usos || 0;
      return `<span class="bdl-fila2__ingr-v" title="Contador asíncrono de Shopify">${Number(usos).toLocaleString("es-AR")}</span>`;
    };
    const filaHTML = ({ b, i }) => {
      const alcance =
        b.activador?.tipo === "todos" ? "Todos los productos"
        : b.activador?.tipo === "coleccion" ? `${b.activador.ids?.length || 0} colección(es)`
        : `${b.activador?.ids?.length || 0} producto(s)`;
      const resumen =
        b.tipo === "bxgy"
          ? `Comprá ${b.bxgy?.compra_cantidad || 2}, llevás ${b.bxgy?.regalo_cantidad || 1}`
          : `${(b.ofertas || []).filter((o) => Number(o.descuento) > 0).length} peldaño(s) con descuento`;
      const on = b.activo !== false;
      return `<div class="bdl-fila2 ${sel.includes(b.id) ? "is-sel-row" : ""}" data-abrir="${i}" role="button" tabindex="0" aria-label="Editar ${esc(b.nombre)}">
        <label class="bdl-check"><input type="checkbox" data-sel="${esc(b.id)}" ${sel.includes(b.id) ? "checked" : ""} aria-label="Seleccionar ${esc(b.nombre)}"></label>
        <div class="bdl-fila2__ico">${b.tipo === "bxgy" ? ICO_GIFT : ICO_BOX}</div>
        <div class="bdl-fila2__main">
          <div class="bdl-fila2__nombre">${esc(b.nombre)}</div>
          <div class="bdl-fila2__sub">${b.tipo === "bxgy" ? "Comprá X y obtené Y" : "Descuento por volumen"} · ${esc(resumen)}</div>
        </div>
        <div class="bdl-fila2__alcance">${esc(alcance)}</div>
        <div class="bdl-fila2__ingr">${fmtUsos(b.id)}</div>
        <div class="bdl-fila2__estado">
          <button class="be-toggle ${on ? "is-on" : ""}" data-toggle-activo="${i}" role="switch" aria-checked="${on}" title="${on ? "Activo — clic para pausar" : "Pausado — clic para activar"}"><span></span></button>
        </div>
        <div class="bdl-fila2__acc"><button class="bdl-acc-btn" data-acc="${i}" aria-label="Más acciones">${ico("kebab")}</button></div>
      </div>`;
    };

    const tabsHTML = `<div class="ui-tabs bdl-filtros">
      <button class="ui-tab ${filtro === "todas" ? "ui-tab--activa" : ""}" data-filtro="todas">Todas <span class="bdl-filtros__n">${lista.length}</span></button>
      <button class="ui-tab ${filtro === "activas" ? "ui-tab--activa" : ""}" data-filtro="activas">Activas <span class="bdl-filtros__n">${nAct}</span></button>
      <button class="ui-tab ${filtro === "pausadas" ? "ui-tab--activa" : ""}" data-filtro="pausadas">Pausadas <span class="bdl-filtros__n">${nPaus}</span></button>
    </div>`;

    const cuerpoTabla = visibles.length
      ? `<div class="tarjeta bdl-tabla2">
          <div class="bdl-tabla2__cab"><span class="bdl-check"><input type="checkbox" data-selall ${visibles.length && visibles.every(({ b }) => sel.includes(b.id)) ? "checked" : ""} aria-label="Seleccionar todo"></span><span></span><span>Bundle</span><span>Alcance</span><span>Usos</span><span>Estado</span><span></span></div>
          ${visibles.map(filaHTML).join("")}
        </div>`
      : `<div class="tarjeta bdl-vacio"><div class="bdl-vacio__s">No hay bundles ${filtro === "activas" ? "activos" : "pausados"}.</div></div>`;

    // Barra de acciones en lote (aparece al seleccionar filas).
    const bulkBar = sel.length
      ? `<div class="bdl-bulk">
          <span class="bdl-bulk__n">${sel.length} seleccionado${sel.length === 1 ? "" : "s"}</span>
          <button class="btn btn--fantasma btn--chico" data-bulk="activar">Activar</button>
          <button class="btn btn--fantasma btn--chico" data-bulk="pausar">Pausar</button>
          <button class="btn btn--fantasma btn--chico bdl-bulk__del" data-bulk="eliminar">Eliminar</button>
          <button class="bdl-bulk__x" data-bulk="limpiar" aria-label="Deseleccionar">${ico("x")}</button>
        </div>`
      : "";

    // Estado del widget: la app YA NO inyecta código en el tema (compliance App
    // Store). El merchant activa el "app embed" una sola vez en el editor de temas;
    // la config viaja en vivo. Por eso siempre mostramos el paso de activación.
    const widgetEstado = lista.length
      ? `<s-banner tone="info">
           <s-paragraph>Para que los bundles aparezcan en tu tienda, activá el widget en tu tema una sola vez.</s-paragraph>
           <s-button id="bdl-instalar">Activá el widget</s-button>
         </s-banner>`
      : "";

    const syncEstado = sync?.status === "manual_review"
      ? `<s-banner tone="critical">
           <s-heading>Sincronización detenida</s-heading>
           <s-paragraph>Shopify no confirmó el resultado. Tu tienda conserva la última versión verificada. No vuelvas a guardar hasta que soporte reconcilie los descuentos.</s-paragraph>
         </s-banner>`
      : sync?.status === "failed"
        ? `<s-banner tone="warning">
             <s-heading>Los últimos cambios no se aplicaron</s-heading>
             <s-paragraph>La tienda conserva la versión anterior. Revisá la configuración y volvé a guardar.</s-paragraph>
           </s-banner>`
        : sync?.status === "running"
          ? `<s-banner tone="info"><s-paragraph>Los cambios se están sincronizando con Shopify.</s-paragraph></s-banner>`
          : "";

    const pasoOnb = (hecho, texto, accion) =>
      `<div class="bdl-paso ${hecho ? "is-ok" : ""}"><span class="bdl-paso__c">${hecho ? ico("check") : ""}</span><span class="bdl-paso__t">${texto}</span><span class="bdl-paso__a">${hecho ? "Listo" : accion}</span></div>`;
    const nHechos = inst ? 1 : 0;
    const onboarding = `
      <div class="bdl-onb-wrap">
        <div class="tarjeta bdl-onboard">
          <div class="bdl-onboard__cab"><strong>Primeros pasos</strong><span class="panel__sub">${nHechos} de 3 completado${nHechos === 1 ? "" : "s"}</span></div>
          <div class="bdl-onboard__bar"><i style="width:${Math.round((nHechos / 3) * 100)}%"></i></div>
          ${pasoOnb(!!inst, "Activá el widget en tu tema", `<s-button id="bdl-instalar">Activá el widget</s-button>`)}
          ${pasoOnb(false, "Creá tu primer bundle", `<s-button class="bdl-onb-crear">Crear</s-button>`)}
          ${pasoOnb(false, "Previsualizá en tu tienda", `<span class="panel__sub">tras crear</span>`)}
        </div>
        <div class="bdl-hero">
          <div class="bdl-hero__intro">
            <div class="bdl-hero__ico">${ICO_BOX}</div>
            <div class="bdl-hero__t">Creá tu primer bundle</div>
            <p class="bdl-hero__s">Subí el ticket promedio ofreciendo descuentos por volumen (comprá más, pagá menos) o regalos con "comprá X y obtené Y".</p>
            <ul class="bdl-hero__ben">
              <li>${ico("check")} Descuentos automáticos, sin códigos</li>
              <li>${ico("check")} Se activan solo con el widget en tu tema</li>
              <li>${ico("check")} Listo en un par de minutos</li>
            </ul>
          </div>
          <div class="bdl-hero__opciones">
            <button class="bdl-plant" data-plant="volumen">${ICO_BOX}<strong>Descuento por volumen</strong><span>Comprá más, pagá menos con precios escalonados</span></button>
            <button class="bdl-plant" data-plant="bxgy">${ICO_GIFT}<strong>Comprá X y obtené Y</strong><span>Llevá una cantidad gratis o con descuento</span></button>
          </div>
        </div>
      </div>`;

    vista.innerHTML = `
      <style>
        /* Más ancho (pedido del usuario, como en Inspírate): sube el tope de
           #vista SOLO en esta pantalla (default global 1240 en app.css). Se
           revierte al navegar porque el <style> vive en el innerHTML. */
        #vista{max-width:1600px}
        /* Onboarding en columna centrada y con más presencia. Valores literales:
           robustos aunque los tokens no crucen algún shadow boundary. */
        .bdl-onb-wrap{max-width:1320px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
        /* Marco negro (negro de la app, no #000 puro) en las dos cards
           contenedoras: la de "Primeros pasos" y la del hero. */
        .bdl-onboard{border:1.5px solid #202223}
        .bdl-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:36px;align-items:center;padding:40px;border-radius:16px;background:#fff;border:1.5px solid #202223}
        .bdl-hero__ico{width:66px;height:66px;border-radius:16px;background:#eef0f2;display:flex;align-items:center;justify-content:center;margin-bottom:18px}
        .bdl-hero__ico svg{width:32px;height:32px;color:#202223}
        .bdl-hero__t{font-size:24px;font-weight:800;letter-spacing:-.4px;color:#202223;line-height:1.15}
        .bdl-hero__s{font-size:15px;color:#6d7175;margin:10px 0 20px;max-width:460px;line-height:1.5}
        .bdl-hero__ben{list-style:none;display:flex;flex-direction:column;gap:11px;padding:0;margin:0}
        .bdl-hero__ben li{display:flex;align-items:center;gap:10px;font-size:14px;color:#303030;font-weight:600}
        .bdl-hero__ben li svg{width:19px;height:19px;color:#2f9e58;flex:none}
        .bdl-hero__opciones{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .bdl-hero .bdl-plant{padding:24px;border-radius:14px;border:1px solid #e6e6ea;background:#fff;gap:6px;max-width:none}
        .bdl-hero .bdl-plant svg{width:32px;height:32px;margin-bottom:10px;color:#202223}
        .bdl-hero .bdl-plant strong{font-size:16px;color:#202223}
        .bdl-hero .bdl-plant span{font-size:13px;color:#6d7175;line-height:1.4}
        .bdl-hero .bdl-plant:hover{border-color:#c9ccd0;background:#fafbfb;box-shadow:0 4px 14px rgba(0,0,0,.06)}
        @media(max-width:900px){
          .bdl-hero{grid-template-columns:1fr;padding:28px 22px;gap:24px}
          .bdl-hero__opciones{grid-template-columns:1fr}
        }
      </style>
      <s-page heading="Bundles, upsells y regalos" inlineSize="large">
        <s-button slot="primary-action" variant="primary" id="bdl-nuevo">Crear bundle</s-button>
        ${syncEstado}
        ${widgetEstado}
        ${lista.length ? bloqueMetricas() + tabsHTML + bulkBar + cuerpoTabla : onboarding}
      </s-page>`;

    const crearTipo = (tipo) => {
      estado.bundles.config.lista.push(nuevoBundleLocal(tipo));
      estado.bundles.editIdx = estado.bundles.config.lista.length - 1;
      estado.bundles.vista = "editor";
      estado.bundles.tab = "ofertas";
      estado.bundles.sucio = true;
      pintarEditorBundle();
    };
    const abrirMenuTipo = (btn) => {
      cerrarMenuTipo();
      const m = document.createElement("div");
      m.className = "bdl-tipomenu";
      m.id = "bdl-tipomenu";
      m.innerHTML = `
        <button data-tipo="volumen"><strong>Descuento por volumen</strong><span>Comprá más, pagá menos con precios escalonados</span></button>
        <button data-tipo="bxgy"><strong>Comprá X y obtené Y</strong><span>Comprá una cantidad y llevá otra gratis o con descuento</span></button>`;
      document.body.appendChild(m);
      const r = btn.getBoundingClientRect();
      m.style.top = r.bottom + window.scrollY + 6 + "px";
      m.style.left = Math.max(12, r.left + window.scrollX) + "px";
      m.querySelectorAll("[data-tipo]").forEach((b) => (b.onclick = () => { cerrarMenuTipo(); crearTipo(b.dataset.tipo); }));
      setTimeout(() => document.addEventListener("click", cerrarMenuTipo, { once: true }), 0);
    };
    const abrirGaleria = () => { estado.bundles.vista = "temas"; pantallaBundleTemas(); };
    if ($("bdl-nuevo")) $("bdl-nuevo").onclick = abrirGaleria;
    if ($("bdl-vacio-crear")) $("bdl-vacio-crear").onclick = abrirGaleria;
    void abrirMenuTipo; void crearTipo; // (reemplazados por la galería)
    if ($("bdl-instalar")) $("bdl-instalar").onclick = instalarBundlesTema;

    // Onboarding (primer uso): crear / plantillas.
    vista.querySelectorAll(".bdl-onb-crear").forEach((el) => (el.onclick = abrirGaleria));
    vista.querySelectorAll("[data-plant]").forEach((el) => (el.onclick = () => crearDesdeTema(el.dataset.plant)));

    // Filtros de estado (client-side). Cambiar de filtro limpia la selección.
    vista.querySelectorAll("[data-filtro]").forEach((el) => (el.onclick = () => { estado.bundles.filtro = el.dataset.filtro; estado.bundles.sel = []; pintarDashboardBundles(); }));

    // Selección (bulk): checkbox por fila + "seleccionar todo".
    vista.querySelectorAll("[data-sel]").forEach((el) => (el.onchange = () => {
      const s = estado.bundles.sel, k = s.indexOf(el.dataset.sel);
      if (el.checked && k < 0) s.push(el.dataset.sel); else if (!el.checked && k >= 0) s.splice(k, 1);
      pintarDashboardBundles();
    }));
    const selAll = vista.querySelector("[data-selall]");
    if (selAll) selAll.onchange = () => {
      const f = estado.bundles.filtro;
      const ids = (estado.bundles.config.lista || [])
        .filter((b) => (f === "activas" ? b.activo !== false : f === "pausadas" ? b.activo === false : true))
        .map((b) => b.id);
      estado.bundles.sel = selAll.checked ? ids.slice() : [];
      pintarDashboardBundles();
    };
    vista.querySelectorAll("[data-bulk]").forEach((el) => (el.onclick = async () => {
      const acc = el.dataset.bulk;
      if (acc === "limpiar") { estado.bundles.sel = []; return pintarDashboardBundles(); }
      const ids = estado.bundles.sel.slice();
      if (!ids.length) return;
      if (acc === "eliminar") {
        if (!confirm(`¿Eliminar ${ids.length} bundle(s)? Se borran también sus descuentos en Shopify.`)) return;
        estado.bundles.config.lista = estado.bundles.config.lista.filter((b) => !ids.includes(b.id));
      } else {
        const activo = acc === "activar";
        estado.bundles.config.lista.forEach((b) => { if (ids.includes(b.id)) b.activo = activo; });
      }
      estado.bundles.sel = [];
      await guardarBundles();
      pintarDashboardBundles();
      toast(acc === "eliminar" ? `${ids.length} bundle(s) eliminado(s)` : acc === "activar" ? `${ids.length} activado(s)` : `${ids.length} pausado(s)`);
    }));

    // Abrir el editor al click/Enter en la fila (menos si se tocó el toggle o ⋯).
    vista.querySelectorAll("[data-abrir]").forEach((el) => {
      const abrir = () => { estado.bundles.editIdx = Number(el.dataset.abrir); estado.bundles.vista = "editor"; estado.bundles.tab = "ofertas"; pintarEditorBundle(); };
      const enControl = (e) => e.target.closest("[data-toggle-activo]") || e.target.closest("[data-acc]") || e.target.closest(".bdl-check");
      el.onclick = (e) => { if (!enControl(e)) abrir(); };
      el.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && !enControl(e)) { e.preventDefault(); abrir(); } };
    });

    // Toggle activo/pausado por fila (guarda y re-sincroniza descuentos en Shopify).
    vista.querySelectorAll("[data-toggle-activo]").forEach((el) => {
      el.onclick = async (e) => {
        e.stopPropagation();
        const bb = estado.bundles.config.lista[Number(el.dataset.toggleActivo)];
        bb.activo = bb.activo === false;
        el.classList.toggle("is-on", bb.activo !== false); // feedback inmediato
        await guardarBundles();
        pintarDashboardBundles();
        toast(bb.activo !== false ? "Bundle activado" : "Bundle pausado");
      };
    });

    // Menú de acciones ⋯ (Editar / Duplicar / Eliminar).
    const cerrarAccMenu = () => { const m = document.getElementById("bdl-accmenu"); if (m) m.remove(); };
    vista.querySelectorAll("[data-acc]").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        cerrarAccMenu();
        const i = Number(el.dataset.acc);
        const m = document.createElement("div");
        m.className = "bdl-tipomenu bdl-accmenu";
        m.id = "bdl-accmenu";
        m.innerHTML = `
          <button data-a="editar"><strong>Editar</strong></button>
          <button data-a="duplicar"><strong>Duplicar</strong></button>
          <button data-a="eliminar" class="bdl-accmenu__del"><strong>Eliminar</strong></button>`;
        document.body.appendChild(m);
        const r = el.getBoundingClientRect();
        m.style.top = r.bottom + window.scrollY + 6 + "px";
        m.style.left = Math.max(12, r.right + window.scrollX - 170) + "px";
        m.querySelector('[data-a="editar"]').onclick = () => { cerrarAccMenu(); estado.bundles.editIdx = i; estado.bundles.vista = "editor"; estado.bundles.tab = "ofertas"; pintarEditorBundle(); };
        m.querySelector('[data-a="duplicar"]').onclick = async () => {
          cerrarAccMenu();
          const orig = estado.bundles.config.lista[i];
          const copia = JSON.parse(JSON.stringify(orig));
          copia.id = "b_" + Date.now().toString(36);
          copia.nombre = (orig.nombre || "Bundle") + " (copia)";
          estado.bundles.config.lista.splice(i + 1, 0, copia);
          await guardarBundles();
          pintarDashboardBundles();
          toast("Bundle duplicado");
        };
        m.querySelector('[data-a="eliminar"]').onclick = async () => {
          cerrarAccMenu();
          if (!confirm("¿Eliminar este bundle? Se borran también sus descuentos en Shopify.")) return;
          const [borrado] = estado.bundles.config.lista.splice(i, 1);
          await guardarBundles();
          pintarDashboardBundles();
          toast("Bundle eliminado", { undo: async () => { estado.bundles.config.lista.splice(i, 0, borrado); await guardarBundles(); pintarDashboardBundles(); toast("Bundle restaurado"); } });
        };
        setTimeout(() => document.addEventListener("click", cerrarAccMenu, { once: true }), 0);
      };
    });

    // Métricas de uso: se piden una vez y se repintan al llegar.
    if (!estado.bundles.metricas && !estado.bundles.metricasError) {
      api("/bundles/metricas")
        .then((m) => {
          estado.bundles.metricas = m;
          if (estado.bundles.vista === "lista") pintarDashboardBundles();
        })
        .catch(() => {
          estado.bundles.metricasError = true;
          if (estado.bundles.vista === "lista") pintarDashboardBundles();
        });
    }
  }

  // ---------- editor ----------

  // Íconos de ojo (mostrar/ocultar campo) para el editor de niveles.
  const BE_OJO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const BE_OJO_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18M10.6 10.7a3 3 0 004.2 4.2M9.9 5.2A9.5 9.5 0 0112 5c7 0 10.5 7 10.5 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 001.5 12S5 19 12 19c3 0 5.2-1.3 6.8-2.7"/></svg>`;

  // Duplicar: copy duotono (cuadro relleno suave + borde) con un "+" — sólido y
  // con peso, no un outline finito. Estrella: rellena con puntas redondeadas.
  const BE_DUP = `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="3.2" fill="currentColor" fill-opacity=".15"/><rect x="8" y="8" width="12" height="12" rx="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M15.5 4.5H6.6A2.1 2.1 0 0 0 4.5 6.6v8.9" stroke="currentColor" stroke-width="1.7"/><path d="M11.6 14h4.8M14 11.6v4.8" stroke="currentColor" stroke-width="1.7"/></svg>`;
  const BE_STAR = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.48 3.6a.6.6 0 0 1 1.04 0l2.24 4.54 5.01.73a.6.6 0 0 1 .33 1.02l-3.62 3.53.85 4.99a.6.6 0 0 1-.87.63L12 16.7l-4.5 2.37a.6.6 0 0 1-.87-.63l.85-4.99-3.62-3.53a.6.6 0 0 1 .33-1.02l5.01-.73z"/></svg>`;
  const BE_CHEV = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
  const BE_IMG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>`;
  const BE_GIFT2 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M3 13h18M12 9v12M12 9C10 9 8 8 8 6.2 8 5 9 4.5 10 5c1.5.8 2 4 2 4zM12 9c2 0 4-1 4-2.8 0-1.2-1-1.7-2-1.2-1.5.8-2 4-2 4z"/></svg>`;
  const BE_TRUCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6h13v9H1zM14 9h4l3 3v3h-7z"/><circle cx="5.5" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>`;

  // Fila con etiqueta + toggle (reemplaza a los checkboxes). attr = el data-* que
  // el bind usa para prender/apagar (data-toggle-b en el bundle, data-lv-bool en la oferta).
  const beToggleRow = (label, attr, on, help) =>
    `<div class="be-tgl-row"><span>${label}${help ? ` <span class="be-help" data-tip="${esc(help)}" tabindex="0" aria-label="${esc(help)}">?</span>` : ""}</span>
      <button type="button" class="be-toggle ${on ? "is-on" : ""}" role="switch" aria-checked="${!!on}" aria-label="${esc(String(label).replace(/<[^>]*>/g, ""))}" ${attr}><span></span></button></div>`;

  // ---------- EDITOR estilo Pumper (Tema 1: Descuento por Cantidad) ----------
  function pintarEditorBundle() {
    const b = bundleActual();
    if (!b) { estado.bundles.vista = "lista"; return pintarDashboardBundles(); }
    if (b.tipo === "combo") return pintarEditorCombo(b); // combo = editor propio (paquete de varios productos)
    const s = estado.bundles;
    if (s.setupOpen === undefined) s.setupOpen = false;
    if (s.nivelOpen === undefined) s.nivelOpen = null;
    // Semillas de campos nuevos (sin tocar el default del server).
    if (!b.opciones) b.opciones = { variantes: false, volumen: true };
    // Configuración avanzada (toggles del panel Pumper). Todos OFF por defecto;
    // los textos (pie/agotado) arrancan vacíos. fijar no crea rutas → sembrar.
    if (!b.diseno) b.diseno = {};
    if (!b.diseno.avanzado) b.diseno.avanzado = {};
    // Combinación de descuentos (se consume en bundles.js/combinaDe al crear el
    // descuento). Default Pumper: Pedido/Envío ON, Producto OFF.
    if (!b.combina) b.combina = { producto: false, pedido: true, envio: true };
    // Suscripción (F1: editor + preview). Real solo si el producto tiene selling
    // plans de una app de terceros (F2+). Off por defecto.
    if (!b.diseno.sub) b.diseno.sub = {
      on: false, estilo: "clasico", encabezado: "Purchase Options",
      titulo_once: "One-Time Purchase", color_once: "#111111", sub_once: "Pagás una vez",
      titulo_sub: "Subscribe & Save", color_sub: "#111111", sub_sub: "Cancelás cuando quieras",
      detalles: "Facturación y descuento flexibles", mostrar_label_desc: true, ocultar_terceros: false, ver: {}
    };
    if (b.diseno.sub && !b.diseno.sub.ver) b.diseno.sub.ver = {};
    // Segmentar por mercado: mostrar el bundle solo en ciertos países (mercados).
    // Se gatea por el país del comprador (localization.country) en el widget.
    if (!b.mercados) b.mercados = { on: false, modo: "todos", ids: [] };
    // Bundles muy viejos podían no tener `diseno`: sin esto, escribir
    // "diseno.geometry.radius" desde el slider tira TypeError (fijar no crea rutas).
    if (!b.diseno) b.diseno = {};
    // Geometría (Paso 2): radius unificado desde el legacy `radio`; breathing
    // arranca en 10 (≈ densidad actual, así el look no cambia en bundles viejos).
    if (b.diseno && !b.diseno.geometry) b.diseno.geometry = { radius: b.diseno.radio ?? 12, breathing: 10 };
    // Ancho de borde editable (Fase 2). Seed = 2px (≈ el 1.5 actual, imperceptible)
    // para que el slider arranque en un valor real y no en 0.
    if (b.diseno.geometry && b.diseno.geometry.borderWidth == null) b.diseno.geometry.borderWidth = 2;
    // Layout (Paso 4): plantilla vertical por defecto = comportamiento actual.
    if (b.diseno && !b.diseno.layout) b.diseno.layout = { template: "vertical" };
    // Tipografía (Paso 6): fuente heredada, pesos = los actuales (700/700).
    if (b.diseno && !b.diseno.type) b.diseno.type = { font: "heredar", titleWeight: 700, priceWeight: 700 };
    // Estilo por elemento (editor "Estilo del texto"): sub-objetos vacíos para que
    // fijar() pueda escribir type.el.<k>.<prop>. Todo opcional → look intacto.
    if (b.diseno.type && !b.diseno.type.el) b.diseno.type.el = { enc: {}, titulo: {}, precio: {}, etq: {}, badge: {}, oos: {} };
    (b.ofertas || []).forEach((o) => {
      if (o.activo === undefined) o.activo = true;
      if (!o.ver) o.ver = {};
      if (!o.addons) o.addons = {};
      // Migración: modelo viejo de regalo (un solo producto) → items[].
      const rg = o.addons.regalo;
      if (rg && rg.nombre && !rg.items) rg.items = [{ id: rg.id, nombre: rg.nombre, imagen: rg.imagen, cantidad: 1, textoGratis: "GRATIS", mostrarPrecio: true }];
    });

    vista.innerHTML = `
      <div class="be-top">
        <button class="volver-flecha" id="bdl-volver"></button>
        <h1>Crear un descuento por cantidad</h1>
        <div class="be-top__act">
          <s-button variant="secondary" id="bdl-borrador">Guardar como borrador</s-button>
          <s-button variant="primary" id="bdl-guardar">Publicar</s-button>
        </div>
      </div>
      <div class="be-layout">
        <div class="be-left" id="be-left">
          <div class="be-guinda be-guinda--top">
            <div class="be-guinda__t">Configuración de la oferta</div>
            <div class="be-guinda__s">Elegí el producto y definí los niveles de descuento.</div>
          </div>
          ${bdlSeccionSetup(b, s)}
          ${bdlSeccionNiveles(b, s)}
          <div class="be-guinda">
            <div class="be-guinda__t">Personalización</div>
            <div class="be-guinda__s">Ajustá colores, encabezado y botón sin salir de acá.</div>
          </div>
          ${bdlSeccionesExtra(b, s)}
        </div>
        ${previewAsideBundle()}
      </div>`;

    $("bdl-volver").onclick = () => salirBundles();
    $("bdl-guardar").onclick = async () => { b.activo = true; await guardarBundles(); };
    $("bdl-borrador").onclick = async () => { b.activo = false; await guardarBundles(); };
    const selProd = $("bdl-preview-prod");
    if (selProd) selProd.onchange = (e) => { estado.bundles.previewProd = e.target.value || null; pintarEditorBundle(); };

    // Toggle Escritorio/Móvil: se cablea ACÁ (directo), no por el listener
    // delegado de bindEditorBundle — ese cuelga de #be-left y estos botones
    // viven en el aside (hermano), así que nunca recibía el click (bug).
    vista.querySelectorAll("[data-pv]").forEach((btn) => {
      btn.onclick = () => {
        const mob = btn.dataset.pv === "mobile";
        estado.bundles.previewMobile = mob;
        const marco = vista.querySelector(".bdl-preview__marco");
        if (marco) { marco.classList.toggle("is-mobile", mob); marco.classList.toggle("is-desktop", !mob); }
        vista.querySelectorAll("[data-pv]").forEach((x) => x.classList.toggle("is-sel", x === btn));
      };
    });

    bindEditorBundle(b, s);
    pintarPreviewBundle();

    // GOTCHA Polaris: <s-select> NO toma el atributo `value` al montar (la
    // propiedad queda en la 1ª opción). Se fija por PROPIEDAD post-render,
    // releyendo del modelo por data-b, para que muestre la opción guardada.
    vista.querySelectorAll("s-select[data-b]").forEach((sel) => {
      const val = leer(b, sel.dataset.b);
      if (val != null && val !== "") sel.value = String(val);
    });

    if (!(estado.productos || []).length) {
      api("/productos").then((prods) => { estado.productos = prods; if (estado.bundles.vista === "editor") pintarEditorBundle(); }).catch(() => {});
    }
  }

  // Sección colapsable "Select Product & Basic Setup".
  function bdlSeccionSetup(b, s) {
    const a = b.activador || { tipo: "todos", ids: [] };
    const verEnc = leer(b, "diseno.mostrar_encabezado") !== false;
    const cuerpo = !s.setupOpen ? "" : `
      <div class="be-sec__body">
        <div class="be-block">
          ${campoBdl("nombre", "Nombre de la oferta")}
          <div class="be-field-row">
            <div style="flex:1">${campoBdl("diseno.titulo", "Texto de encabezado")}</div>
            <button class="be-eye ${verEnc ? "" : "is-off"}" data-toggle-b="diseno.mostrar_encabezado" title="Mostrar/ocultar">${verEnc ? BE_OJO : BE_OJO_OFF}</button>
          </div>
        </div>
        <div class="be-block">
          <div class="be-block__t">Aplicar oferta en</div>
          <label class="be-radio"><input type="radio" name="be-act" data-act="todos" ${a.tipo === "todos" ? "checked" : ""}> Todos los productos</label>
          <label class="be-radio"><input type="radio" name="be-act" data-act="productos" ${a.tipo === "productos" ? "checked" : ""}> Producto(s) específico(s) seleccionado(s)</label>
          <label class="be-radio"><input type="radio" name="be-act" data-act="coleccion" ${a.tipo === "coleccion" ? "checked" : ""}> Productos en colecciones seleccionadas</label>
          ${a.tipo === "productos" ? selectorProductos(a.ids || []) : ""}
          ${a.tipo === "coleccion" ? `<div class="panel__sub" style="margin-top:8px">La selección de colecciones llega pronto.</div>` : ""}
        </div>
        <div class="be-block">
          <div class="be-block__t">Configuración básica</div>
          ${beToggleRow("Permitir a los clientes elegir diferentes variantes para cada artículo", `data-toggle-b="opciones.variantes"`, !!leer(b, "opciones.variantes"))}
          ${beToggleRow("Descuento por volumen (extender el descuento máximo a todas las cantidades)", `data-toggle-b="opciones.volumen"`, leer(b, "opciones.volumen") !== false)}
        </div>
      </div>`;
    return `<section class="be-sec">
      <button class="be-sec__head" data-sec="setup"><span>Producto y configuración básica</span><span class="be-chev ${s.setupOpen ? "is-open" : ""}">${ico("chevron")}</span></button>
      ${cuerpo}
    </section>`;
  }

  // Sección "Editar Ofertas de Nivel": tarjetas colapsables por nivel.
  function bdlSeccionNiveles(b, s) {
    const cards = (b.ofertas || []).map((o, i) => bdlNivelCard(o, i, b, s)).join("");
    return `<section class="be-sec be-sec--plain">
      <div class="be-sec__title">Editar ofertas de nivel</div>
      <div class="be-lvs">${cards}</div>
      <button class="be-add" data-add-nivel>${ico("mas")} Agregar nivel</button>
    </section>`;
  }

  function bdlNivelCard(o, i, b, s) {
    const open = s.nivelOpen === i;
    const activo = o.activo !== false;
    const tipo = o.tipo_desc || (Number(o.descuento) > 0 ? "porcentaje" : "ninguno");
    const head = `
      <div class="be-lv__head">
        <span class="be-lv__drag" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>
        <button class="be-toggle ${activo ? "is-on" : ""}" data-lv-toggle="${i}" title="Prender/apagar nivel"><span></span></button>
        <span class="be-lv__name"><span class="be-lv__n">Nivel ${i + 1}:</span> <b>${esc(o.titulo || "Comprá " + (Number(o.cantidad) || 1))}</b>${o.predeterminada ? '<span class="be-lv__chip">' + ico("estrella") + ' Por defecto</span>' : ""}</span>
        <button class="be-lv__icn" data-lv-dup="${i}" data-tip="Duplicar este nivel" aria-label="Duplicar nivel ${i + 1}">${BE_DUP}</button>
        <button class="be-lv__star ${o.predeterminada ? "is-star" : ""}" data-lv-star="${i}" data-tip="Oferta predeterminada: es la que los clientes ven pre-seleccionada al entrar a la página." aria-label="Marcar como oferta predeterminada" aria-pressed="${o.predeterminada ? "true" : "false"}">${BE_STAR}</button>
        <button class="be-lv__chev ${open ? "is-open" : ""}" data-lv-open="${i}" title="Abrir/cerrar">${BE_CHEV}</button>
      </div>`;
    if (!open) return `<div class="be-lv${o.predeterminada ? " is-def" : ""}">${head}</div>`;

    const TIPOS = [["porcentaje", "% Descuento"], ["ninguno", "Ninguno"]];
    const tabs = TIPOS.map(([k, t]) => `<button class="be-dt ${tipo === k ? "is-sel" : ""}" data-lv-tipo="${i}:${k}">${t}</button>`).join("");

    const campoOjo = (ruta, label, verKey) => {
      const on = !verKey || o.ver[verKey] !== false;
      const eye = verKey ? `<button class="be-eye ${on ? "" : "is-off"}" data-lv-ver="${i}:${verKey}" title="Mostrar/ocultar">${on ? BE_OJO : BE_OJO_OFF}</button>` : "";
      return `<div class="be-field-row"><div class="campo campo--editor" style="flex:1"><label>${label}</label>
        <input type="text" data-b="${ruta}" value="${esc(leer(b, ruta) ?? "")}" ${on ? "" : "disabled"}></div>${eye}</div>`;
    };

    const cant = campoBdl(`ofertas.${i}.cantidad`, "Cantidad total", "numero", 'min="1"');
    const redondeo = `<div class="be-tgl-row"><span>Redondeo de precios <span class="be-help" title="Redondea el precio final (ej. terminar en .99)">?</span></span>
      <select data-b="ofertas.${i}.redondeo_val" ${o.redondeo ? "" : "disabled"}>
        ${[".99", ".95", ".00"].map((v) => `<option ${o.redondeo_val === v ? "selected" : ""}>${v}</option>`).join("")}
      </select>
      <button type="button" class="be-toggle ${o.redondeo ? "is-on" : ""}" data-lv-bool="${i}:redondeo"><span></span></button></div>`;

    let campos;
    if (tipo === "fijo") {
      campos = `<div class="be-grid2">
          <div class="campo campo--editor"><label>Descuento fijo</label><input type="text" data-b="ofertas.${i}.monto_fijo" value="${esc(o.monto_fijo ?? "")}" placeholder="ARS 10"></div>${cant}</div>
        ${beToggleRow("Descuento fijo por unidad", `data-lv-bool="${i}:fijo_unidad"`, !!o.fijo_unidad)}${redondeo}`;
    } else if (tipo === "especifico") {
      campos = `<div class="be-warn">${ico("aviso")} Este tipo de descuento solo puede usarse con un producto seleccionado.</div>
        <div class="be-grid2">
          <div class="campo campo--editor"><label>Introducir precio objetivo (total)</label><input type="text" data-b="ofertas.${i}.precio_objetivo" value="${esc(o.precio_objetivo ?? "")}" placeholder="ARS 10"></div>${cant}</div>${redondeo}`;
    } else if (tipo === "bogo") {
      const c = Math.max(1, Number(o.bogo_compra) || 1), g = Math.max(1, Number(o.bogo_obten) || 1);
      campos = `<div class="be-bogo">
          <div class="campo campo--editor"><label>Compra X</label><input type="number" data-b="ofertas.${i}.bogo_compra" data-tipo="numero" min="1" value="${c}"></div>
          <span class="be-bogo__op">+</span>
          <div class="campo campo--editor"><label>Obtén Y gratis</label><input type="number" data-b="ofertas.${i}.bogo_obten" data-tipo="numero" min="1" value="${g}"></div>
          <span class="be-bogo__op">=</span>
          <div class="campo campo--editor"><label>Cantidad total</label><input type="number" value="${c + g}" disabled></div></div>`;
    } else if (tipo === "ninguno") {
      campos = `<div class="be-grid2">
          <div class="campo campo--editor"><label>Descuento</label><input type="number" value="${esc(o.descuento ?? 0)}" disabled></div>${cant}</div>`;
    } else {
      campos = `<div class="be-grid2">
          <div class="campo campo--editor"><label>Descuento en %</label><input type="number" data-b="ofertas.${i}.descuento" data-tipo="numero" min="0" max="100" value="${esc(o.descuento ?? 0)}"></div>${cant}</div>`;
    }

    const body = `
      <div class="be-lv__body">
        <div class="be-block">
          <div class="be-block__t">Seleccionar tipo de descuento</div>
          <div class="be-dts">${tabs}</div>
          ${campos}
        </div>
        <div class="be-block">
          ${campoOjo(`ofertas.${i}.titulo`, "Título (ej. Buy 2)")}
          ${campoOjo(`ofertas.${i}.etiqueta`, "Etiqueta (ej. 20% OFF / Precio normal)", "etiqueta")}
          ${campoOjo(`ofertas.${i}.subtitulo`, "Subtítulo (ej. Ahorrás $4.00)", "subtitulo")}
          ${campoOjo(`ofertas.${i}.badge`, "Insignia (ej. Más elegido / Mejor valor)", "badge")}
        </div>
        <div class="be-block">${beToggleRow("Marcar como agotado", `data-lv-bool="${i}:agotado"`, !!o.agotado, "Muestra el nivel como sin stock")}</div>
        ${(() => {
          const ad = o.addons || {};
          const btn = (key, ic, label) => `<button type="button" class="be-addon ${ad[key]?.on ? "is-on" : ""}" data-addon-toggle="${i}:${key}">${ic}<span>${label}</span></button>`;
          const cfgImagen = ad.imagen?.on ? `<div class="be-addon-cfg">
              <div class="be-addon-cfg__t">${ico("imagen")} Agregar imagen<button class="be-addon-cfg__x" data-addon-toggle="${i}:imagen">Eliminar</button></div>
              ${ad.imagen.url
                ? `<div class="be-gift-sel"><span class="be-gift-sel__img"><img src="${esc(ad.imagen.url)}" alt=""></span><span class="be-gift-sel__n">${ico("check")} Imagen cargada</span><label class="be-gift-sel__ch" style="cursor:pointer">Cambiar<input type="file" accept="image/*" hidden data-addon-img="${i}"></label></div>`
                : `<label class="be-img-btn">${ico("subir")} Seleccionar imagen de tu computadora<input type="file" accept="image/*" hidden data-addon-img="${i}"></label>`}</div>` : "";
          const g = { on: false, items: [] };
          const gifts = g.items || [];
          const sel = Math.min(g.sel || 0, Math.max(0, gifts.length - 1));
          const editorRegalo = (it, gi) => `
            <div class="be-gift__body">
              <div class="be-gift__thumb">${it.imagen ? `<img src="${esc(it.imagen)}" alt="">` : `<span class="be-gift__ph">${ico("regalo")}</span>`}<button class="be-gift__cambiar" data-gift-pick="${i}:${gi}">Cambiar regalo</button></div>
              <div class="be-gift__fields">
                <div class="be-gift__row2">
                  <div class="campo campo--editor"><label>Nombre del regalo y colores</label>
                    <div class="be-gift__inline"><input type="text" data-b="ofertas.${i}.addons.regalo.items.${gi}.nombre" value="${esc(it.nombre || "")}" placeholder="Nombre del regalo"><input type="color" class="be-sw2" data-b="ofertas.${i}.addons.regalo.items.${gi}.colorNombre" value="${esc(it.colorNombre || "#f8d7e5")}"></div></div>
                  <div class="campo campo--editor be-gift__cant"><label>Cantidad</label><input type="number" min="1" data-b="ofertas.${i}.addons.regalo.items.${gi}.cantidad" data-tipo="numero" value="${esc(it.cantidad || 1)}"></div>
                </div>
                <div class="campo campo--editor"><label>Etiqueta "gratis"</label>
                  <div class="be-gift__inline"><input type="text" data-b="ofertas.${i}.addons.regalo.items.${gi}.textoGratis" value="${esc(it.textoGratis || "GRATIS")}"><input type="color" class="be-sw2" data-b="ofertas.${i}.addons.regalo.items.${gi}.colorGratis" value="${esc(it.colorGratis || "#a90c4e")}"></div></div>
                <span class="be-gift__pill" style="background:${esc(it.colorGratis || "#a90c4e")}">${esc(it.textoGratis || "GRATIS")}</span>
                ${beToggleRow("Mostrar precio original", `data-gift-bool="${i}:${gi}:mostrarPrecio"`, it.mostrarPrecio !== false)}
                ${(it.variantes && it.variantes.length) ? `<div class="be-gift__vars">
                  <label>${esc(it.opcionNombre || "Colores")} que puede elegir el cliente <span class="be-gift__varn">${(it.varSel || []).length}/${it.variantes.length}</span></label>
                  <div class="be-gift__chips">${it.variantes.map((v, vi) => `<button type="button" class="be-gift__chip ${(it.varSel || []).includes(v.id) ? "is-on" : ""}" data-gift-var="${i}:${gi}:${vi}">${esc(v.titulo)}</button>`).join("")}</div>
                  <div class="be-gift__varhint">${(it.varSel || []).length > 1 ? "El cliente elige en un desplegable en la tienda." : "Se entrega ese color fijo, sin desplegable."}</div>
                </div>` : ""}
              </div>
            </div>`;
          const cfgRegalo = g.on ? `<div class="be-addon-cfg">
              <div class="be-addon-cfg__t"><span>${ico("regalo")} Regalo gratis</span>${gifts.length ? `<a class="be-gift__more" data-gift-add="${i}">Agregar más regalo</a>` : ""}</div>
              ${gifts.length
                ? `<div class="be-gift__tabs">${gifts.map((_, gi) => `<span class="be-gift__tab ${gi === sel ? "is-sel" : ""}" data-gift-tab="${i}:${gi}">Regalo ${gi + 1}<button data-gift-del="${i}:${gi}" title="Quitar">${ico("x")}</button></span>`).join("")}</div>${editorRegalo(gifts[sel], sel)}`
                : `<button class="be-gift-btn" data-addon-gift="${i}">${ico("mas")} Seleccionar producto de regalo</button>`}</div>` : "";
          const cfgEnvio = "";
          return `<div class="be-addons">
            <div class="be-addons__t">${ico("mas")} Add-Ons</div>
            <div class="be-addons__row">
              ${btn("imagen", BE_IMG, "+ Imagen")}
            </div>
            ${cfgImagen}${cfgRegalo}${cfgEnvio}
          </div>`;
        })()}
        <button class="be-del" data-lv-del="${i}">${ico("basura")} Eliminar nivel ${i + 1}</button>
      </div>`;
    return `<div class="be-lv is-open${o.predeterminada ? " is-def" : ""}">${head}${body}</div>`;
  }

  // Íconos de las secciones extra (estilo Polaris: 20px, stroke fino).
  const IC_PALETA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.3"/><circle cx="17" cy="10.5" r="1.3"/><circle cx="8.5" cy="7.5" r="1.3"/><circle cx="6.5" cy="12.5" r="1.3"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.4-4.5-8-10-8z"/></svg>`;
  const IC_ENGRANAJE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  const IC_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;
  const IC_ESQUINA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12V8a4 4 0 0 1 4-4h4"/><path d="M20 12v4a4 4 0 0 1-4 4h-4"/></svg>`;
  const IC_AIRE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7 4 12l4 5M16 7l4 5-4 5"/></svg>`;
  const IC_CAJA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8M7.5 5.25l9 5"/></svg>`;
  const IC_GLOBO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.6 4 5.9 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-5.9-4-9.5s1.4-6.9 4-9.5z"/></svg>`;
  // Países ofrecidos para "Segmentar por mercado" (código ISO → nombre). El widget
  // gatea por localization.country.iso_code del comprador.
  const PAISES_BDL = [
    ["AR", "Argentina"], ["BO", "Bolivia"], ["BR", "Brasil"], ["CL", "Chile"], ["CO", "Colombia"], ["CR", "Costa Rica"], ["CU", "Cuba"], ["DO", "República Dominicana"], ["EC", "Ecuador"], ["SV", "El Salvador"], ["GT", "Guatemala"], ["HN", "Honduras"], ["MX", "México"], ["NI", "Nicaragua"], ["PA", "Panamá"], ["PY", "Paraguay"], ["PE", "Perú"], ["PR", "Puerto Rico"], ["UY", "Uruguay"], ["VE", "Venezuela"],
    ["US", "Estados Unidos"], ["CA", "Canadá"], ["ES", "España"], ["PT", "Portugal"], ["FR", "Francia"], ["IT", "Italia"], ["DE", "Alemania"], ["GB", "Reino Unido"], ["IE", "Irlanda"], ["NL", "Países Bajos"], ["BE", "Bélgica"], ["CH", "Suiza"], ["AT", "Austria"], ["SE", "Suecia"], ["NO", "Noruega"], ["DK", "Dinamarca"], ["FI", "Finlandia"], ["PL", "Polonia"],
    ["AU", "Australia"], ["NZ", "Nueva Zelanda"], ["JP", "Japón"], ["CN", "China"], ["IN", "India"], ["ZA", "Sudáfrica"], ["AE", "Emiratos Árabes Unidos"]
  ];
  const NOMBRE_PAIS = (code) => (PAISES_BDL.find((p) => p[0] === code) || [code, code])[1];

  // Slider de geometría (Redondeo / Aire) — control continuo con valor a la
  // derecha, estilo Pumper. Escribe una ruta numérica del modelo (data-b).
  function sliderBdl(ruta, icono, etiqueta, min, max) {
    const v = leer(bundleActual(), ruta) ?? min;
    return `<div class="bdl-slider">
      <span class="bdl-slider__ico">${icono}</span>
      <label class="bdl-slider__lab" for="sl-${ruta.replace(/\W/g, "-")}">${esc(etiqueta)}</label>
      <input type="range" id="sl-${ruta.replace(/\W/g, "-")}" min="${min}" max="${max}" step="1" data-b="${ruta}" data-tipo="numero" data-slider value="${esc(v)}">
      <output class="bdl-slider__val">${esc(v)} / ${max}</output>
    </div>`;
  }

  // Select atado a una ruta del modelo. opciones = [[valor, etiqueta], ...].
  function selectBdl(ruta, etiqueta, opciones, tipo) {
    const v = leer(bundleActual(), ruta);
    const opts = opciones.map(([val, lab]) => `<s-option value="${esc(val)}">${esc(lab)}</s-option>`).join("");
    return `<s-select label="${esc(etiqueta)}" data-b="${ruta}" value="${esc(v ?? "")}"${tipo ? ` data-tipo="${tipo}"` : ""}>${opts}</s-select>`;
  }

  // Mapa "Personalizar": refleja el color tocado en la mini-tarjeta del editor
  // sin re-renderizar (targeted update, como el valor del slider).
  function actualizarMiniPerso(token, v) {
    const card = document.querySelector("[data-mid-card]");
    if (!card) return;
    const el = (k) => card.querySelector(`[data-mid-el="${k}"]`);
    if (token === "color_borde") { card.style.borderColor = v; const d = el("dot"); if (d) d.style.borderColor = v; }
    else if (token === "color_fondo") { card.style.background = v; }
    else if (token === "color_badge") { const b = el("badge"); if (b) b.style.background = v; }
    else if (token === "color_badge_texto") { const b = el("badge"); if (b) b.style.color = v; }
    else if (token === "color_etiqueta") { const e = el("etq"); if (e) { e.style.color = v; e.style.borderColor = v; } }
    else if (token === "color_texto") { const t = el("title"); if (t) t.style.color = v; }
  }

  // Un acordeón de la columna izquierda (mismo componente que "Select Product").
  function bdlAcordeon(id, icono, titulo, cuerpo, abierto) {
    return `<div class="be-sec">
      <button class="be-sec__head" data-sec="${id}"><span class="be-sec__lead"><span class="be-sec__ico">${icono}</span><span>${esc(titulo)}</span></span><span class="be-chev ${abierto ? "is-open" : ""}">${ico("chevron")}</span></button>
      ${abierto ? `<div class="be-sec__body">${cuerpo}</div>` : ""}
    </div>`;
  }

  // Las secciones "guinda del pastel": diseño/avanzado/visual como acordeones en
  // la MISMA columna (estilo Pumper), reusando los controles de panelDiseno.
  function bdlSeccionesExtra(b, s) {
    s.secOpen = s.secOpen || {};
    s.subOpen = s.subOpen || {}; // sub-acordeones anidados (ej. "combinar")
    const d = b.diseno || {};
    // Swatch = mini-preview real de la paleta (no texto): 3 barras apiladas, la
    // primera con el borde/acento del preset (como una tarjeta seleccionada).
    const swatch = (k) => {
      const p = PRESETS_BDL[k];
      return `<button type="button" class="bdl-pal ${d.preset === k ? "is-sel" : ""}" data-preset="${k}" title="${esc(NOMBRE_PRESET[k])}" aria-label="Paleta ${esc(NOMBRE_PRESET[k])}">
        <span class="bdl-pal__mini">
          <span class="bdl-pal__bar bdl-pal__bar--sel" style="border-color:${p.borde}"><i style="background:${p.bot}"></i></span>
          <span class="bdl-pal__bar"></span>
          <span class="bdl-pal__bar"></span>
        </span></button>`;
    };
    const presets = Object.keys(PRESETS_BDL).map(swatch).join("");
    const tpl = (d.layout && d.layout.template) || "vertical";
    const tplCard = (id, nombre, mods) => `<button type="button" class="bdl-tpl ${tpl === id ? "is-sel" : ""}" data-tpl="${id}" aria-label="Plantilla ${nombre}">
        <span class="bdl-tpl__mini bdl-tpl__mini--${mods}"><i></i><i></i><i></i></span>
        <span class="bdl-tpl__name">${nombre}${tpl === id ? " " + ico("check") : ""}</span></button>`;
    // --- Editor "Estilo del texto" (lista por elemento, estilo Pumper). Fase 1:
    //     encabezado / título de nivel / precio. Cada fila: ejemplo en vivo →
    //     flecha → botón "Aa" que abre un popover (Fuente/Peso/Tamaño/Color). ---
    const FAM_TX = [["heredar", "Del tema"], ["sans", "Sans"], ["serif", "Serif"], ["redondeada", "Redondeada"], ["mono", "Mono"]];
    const PESOS_TX = [[400, "Normal"], [500, "Medio"], [600, "Semibold"], [700, "Bold"], [800, "Extra"]];
    const SIZE_DEF_TX = { enc: 16, titulo: 15, precio: 17, etq: 11, badge: 9, oos: 12 };
    const elGet = (k) => leer(b, `diseno.type.el.${k}`) || {};
    const optsTx = (val, list) => list.map(([v, l]) => `<option value="${v}"${String(val ?? "") === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("");
    const elExStyle = (k) => {
      const el = elGet(k); let s = "";
      if (el.font && el.font !== "heredar") s += `font-family:${FONTS_BDL[el.font] || "inherit"};`;
      if (el.size) s += `font-size:${el.size}px;`;
      if (el.weight) s += `font-weight:${el.weight};`;
      if (el.color) s += `color:${el.color};`;
      return s;
    };
    // colorRoute = ruta del color de TEXTO (para enc/titulo/precio va a type.el.<k>.color;
    // para etq/badge/oos reusa las rutas de color que ya existen).
    const aaPopover = (k, colorRoute, colorDef) => {
      const el = elGet(k);
      return `<div class="be-aapop" data-aapop="${k}" hidden>
        <div class="be-aapop__row"><label>Fuente</label>
          <select data-b="diseno.type.el.${k}.font">${optsTx(el.font || "heredar", FAM_TX)}</select></div>
        <div class="be-aapop__grid">
          <label>Peso<select data-b="diseno.type.el.${k}.weight" data-tipo="numero">${optsTx(el.weight || 700, PESOS_TX)}</select></label>
          <label>Tamaño<span class="be-aapop__step">
            <button type="button" data-aastep="${k}:-1" aria-label="Reducir">${ico("menos")}</button>
            <output data-aaout="${k}">${el.size || SIZE_DEF_TX[k]}</output>
            <button type="button" data-aastep="${k}:1" aria-label="Aumentar">${ico("mas")}</button>
            <input type="hidden" data-b="diseno.type.el.${k}.size" data-tipo="numero" data-aasize="${k}" value="${esc(el.size ?? "")}">
          </span></label>
        </div>
        <div class="be-aapop__row"><label>Color de texto</label>
          <label class="be-txel__sw be-txel__sw--pop"><input type="color" data-b="${colorRoute}" value="${esc(leer(b, colorRoute) || colorDef)}"></label></div>
      </div>`;
    };
    // bg = { route, def } (swatch de fondo, para etiqueta/insignia) o null.
    // extra = estilo inline extra del ejemplo (color/fondo/borde de rutas propias).
    const txEl = (k, cls, texto, colorRoute, colorDef, bg, extra) => `<div class="be-txel" data-txel="${k}">
      <div class="be-txel__ex"><span class="${cls}" style="${elExStyle(k)}${extra || ""}">${esc(texto)}</span></div>
      <svg class="be-txel__arrow" viewBox="0 0 24 12" aria-hidden="true"><path d="M1 6h20m0 0-5-4m5 4-5 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="be-txel__ctrls">
        ${bg ? `<label class="be-txel__sw" title="Color de fondo"><input type="color" data-b="${bg.route}" value="${esc(leer(b, bg.route) || bg.def)}"></label>` : ""}
        <button type="button" class="be-txel__aa" data-aa="${k}" aria-haspopup="true" aria-expanded="false" title="Tipografía">Aa</button>
        ${aaPopover(k, colorRoute, colorDef)}
      </div></div>`;
    const cL = (t, d) => esc(leer(b, "diseno." + t) || d); // color de una ruta (para el ejemplo)
    const estiloTexto = `
      <div class="bdl-subsec">Estilo del texto</div>
      <div class="be-txlist">
        ${txEl("enc", "tiq-bdl__h1", "Elegí tu paquete", "diseno.type.el.enc.color", "#2a2a2a")}
        ${txEl("titulo", "tiq-bdl__titulo", "Comprá 2", "diseno.type.el.titulo.color", "#111111")}
        ${txEl("precio", "tiq-bdl__precio-now", "$ 29,90", "diseno.type.el.precio.color", "#111111")}
        ${txEl("etq", "tiq-bdl__etq", "10% OFF", "diseno.color_etiqueta", "#e11d48",
            { route: "diseno.color_etiqueta_fondo", def: "#ffffff" },
            `color:${cL("color_etiqueta", "#e11d48")};background:${cL("color_etiqueta_fondo", "#ffffff")};border:1px solid ${cL("color_etiqueta", "#e11d48")};`)}
        ${txEl("badge", "tiq-bdl__badge tiq-bdl__badge--soft", "Más elegido", "diseno.color_badge_texto", "#ffffff",
            { route: "diseno.color_badge", def: "#111111" },
            `color:${cL("color_badge_texto", "#ffffff")};background:${cL("color_badge", "#111111")};`)}
        ${txEl("oos", "tiq-bdl__sub", "¡Los artículos resaltados están agotados!", "diseno.color_oos", "#dc2626", null,
            `color:${cL("color_oos", "#dc2626")};`)}
      </div>`;

    const colorYEstilo = `
      <div class="bdl-hist">
        <button type="button" id="bdl-undo" class="bdl-histbtn" data-hist="-1" title="Deshacer" aria-label="Deshacer" ${histDe(b).idx <= 0 ? "disabled" : ""}>${ico("deshacer")}</button>
        <button type="button" id="bdl-redo" class="bdl-histbtn" data-hist="1" title="Rehacer" aria-label="Rehacer" ${histDe(b).idx >= histDe(b).stack.length - 1 ? "disabled" : ""}>${ico("rehacer")}</button>
      </div>
      <div class="bdl-subsec">Diseño de plantilla</div>
      <div class="bdl-tpls">${tplCard("vertical", "Vertical", "v")}${tplCard("horizontal", "Horizontal", "h")}</div>
      <div class="bdl-subsec">Diseño</div>
      ${sliderBdl("diseno.geometry.radius", IC_ESQUINA, "Redondeo de esquinas", 0, 50)}
      ${sliderBdl("diseno.geometry.breathing", IC_AIRE, "Espacio de aire", 4, 24)}
      ${sliderBdl("diseno.geometry.borderWidth", IC_ESQUINA, "Ancho del borde", 0, 5)}
      <div class="bdl-subsec">Paletas de colores</div>
      <div class="bdl-presets">${presets}</div>
      <div class="bdl-subsec">Forma de la insignia</div>
      <div class="bdl-badgeformas">
        ${FORMAS_BADGE.map(([k, nombre]) => `<button type="button" class="bdl-bform ${(leer(b, "diseno.badge_forma") || "soft") === k ? "is-sel" : ""}" data-badgeforma="${k}" aria-label="Insignia ${nombre}"><span class="bdl-bform__prev"><span class="tiq-bdl__badge tiq-bdl__badge--${k}">Top</span></span><span class="bdl-bform__n">${nombre}</span></button>`).join("")}
      </div>
      <div class="bdl-subsec">Colores de la tarjeta</div>
      ${(() => {
        const dc = (t, def) => esc(leer(b, "diseno." + t) || def);
        const sw = (token, etiqueta, def) => `<label class="perso-sw"><input type="color" data-b="diseno.${token}" data-mid="${token}" value="${dc(token, def)}"><span class="perso-sw__lab">${etiqueta}</span><span class="perso-sw__line"></span></label>`;
        return `<div class="perso">
          <div class="perso-col perso-col--l">
            ${sw("color_borde", "Borde", "#111111")}
          </div>
          <div class="perso-mid" data-mid-card style="border-color:${dc("color_borde", "#111")};background:${dc("color_fondo", "#ffffff")}">
            <span class="perso-mid__badge" data-mid-el="badge" style="background:${dc("color_badge", "#111")};color:${dc("color_badge_texto", "#fff")}">Más elegido</span>
            <span class="perso-mid__dot" data-mid-el="dot" style="border-color:${dc("color_borde", "#111")}"></span>
            <span class="perso-mid__title" data-mid-el="title" style="color:${dc("color_texto", "#111")}">Comprá 2</span>
            <span class="perso-mid__etq" data-mid-el="etq" style="color:${dc("color_etiqueta", "#e11d48")};border-color:${dc("color_etiqueta", "#e11d48")}">10% OFF</span>
          </div>
          <div class="perso-col perso-col--r">
            ${sw("color_fondo", "Fondo", "#f6f6f7")}
          </div>
        </div>
        ${(() => {
          const c = contrasteWCAG(leer(b, "diseno.color_badge") || "#111111", leer(b, "diseno.color_badge_texto") || "#ffffff");
          return c < 4.5
            ? `<div class="perso-aviso" id="bdl-aviso-contraste">${ico("aviso")} El texto de la insignia se lee mal (contraste ${c.toFixed(1)}:1). <button type="button" class="bdl-fixc" data-fix-contraste>Arreglar</button></div>`
            : `<div class="perso-aviso perso-aviso--ok" id="bdl-aviso-contraste"></div>`;
        })()}`;
      })()}`;
    // Textos + Tipografía: viven en "Color y estilo" (antes estaban en "avanzada",
    // pero son presentación, no comportamiento).
    const textosYTipo = `
      <div class="bdl-subsec">Textos</div>
      ${campoBdl("diseno.mostrar_encabezado", "Mostrar encabezado", "bool")}
      ${campoBdl("diseno.titulo", "Título del paquete")}
      ${campoBdl("diseno.subtitulo", "Subtítulo del paquete")}
      <div class="bdl-subsec">Tipografía</div>
      ${selectBdl("diseno.type.font", "Fuente", [["heredar", "Del tema"], ["sans", "Sans"], ["serif", "Serif"], ["redondeada", "Redondeada"], ["mono", "Mono"]])}
      <div class="bdl-grid2">
        ${selectBdl("diseno.type.titleWeight", "Peso del título", [[400, "Normal"], [500, "Medio"], [600, "Semibold"], [700, "Bold"], [800, "Extra bold"]], "numero")}
        ${selectBdl("diseno.type.priceWeight", "Peso del precio", [[400, "Normal"], [500, "Medio"], [600, "Semibold"], [700, "Bold"], [800, "Extra bold"]], "numero")}
      </div>`;

    // Panel "Configuración avanzada" — paridad Pumper. Fase 1: solo toggles REALES
    // (nada trucho). Los que necesitan mapa de variantes/cliente llegan en Fase 2.
    const avz = leer(b, "diseno.avanzado") || {};
    const combOpen = !!(s.subOpen && s.subOpen.combinar);
    const tgl = (label, ruta, on, help) => beToggleRow(label, `data-toggle-b="${ruta}"`, on, help);
    const reveal = (on, ruta, ph) => `<div class="be-adv__reveal ${on ? "is-shown" : ""}">${campoBdl(ruta, ph)}</div>`;
    const avanzada = `
      <div class="be-adv">
        <div class="bdl-subsec">Pricing</div>
        <div class="be-adv__group">
          ${tgl("Mostrar precio por unidad", "diseno.avanzado.precio_por_unidad", !!avz.precio_por_unidad, "Muestra el precio por unidad (ej. $17,96 c/u) debajo del precio de cada nivel.")}
          ${tgl("Mostrar precio sin valor decimal", "diseno.avanzado.sin_decimales", !!avz.sin_decimales, "Redondea a números enteros (ej. $18 en vez de $17,96). Ideal para monedas sin centavos.")}
          ${tgl("Coincidir precio del widget", "diseno.avanzado.precio_en_vivo", leer(b, "diseno.avanzado.precio_en_vivo") !== false, "El precio del widget sigue a la variante que el cliente elige en la página (en vivo).")}
          ${tgl("Usar precio de comparación del producto", "diseno.avanzado.usar_compare_at", leer(b, "diseno.avanzado.usar_compare_at") !== false, "Usa el precio de comparación (tachado) real del producto en oferta como precio anterior.")}
          ${tgl("Mostrar “Ahorrás $X”", "diseno.mostrar_ahorro", leer(b, "diseno.mostrar_ahorro") !== false, "Muestra cuánto ahorra el cliente en cada nivel con descuento.")}
        </div>
        <div class="bdl-subsec">Otros</div>
        <div class="be-adv__group">
          ${tgl("Mostrar widget debajo del botón agregar al carrito", "diseno.avanzado.debajo_boton", !!avz.debajo_boton, "Ubica el widget justo debajo del botón de compra en vez de arriba.")}
          ${tgl("Agregar texto de pie de página", "diseno.avanzado.pie_on", !!avz.pie_on, "Muestra un texto libre al pie del widget (ej. “Envío gratis en 24–48 h”).")}
          ${reveal(!!avz.pie_on, "diseno.avanzado.pie_texto", "Texto de pie de página")}
          ${tgl("Usar texto personalizado para Fuera de Stock", "diseno.avanzado.oos_on", !!avz.oos_on, "Cambia el texto “Agotado” de los niveles marcados sin stock.")}
          ${reveal(!!avz.oos_on, "diseno.avanzado.oos_texto", "Texto para niveles agotados")}
          ${tgl("Excluir clientes B2B", "diseno.avanzado.excluir_b2b", !!avz.excluir_b2b, "No muestra el widget de bundle a clientes mayoristas (B2B) logueados.")}
        </div>
        <div class="be-subacc ${combOpen ? "is-open" : ""}">
          <button type="button" class="be-subacc__head" data-subsec="combinar">
            <span>Habilitar Combinación de Descuentos <span class="be-help" data-tip="Con qué otros descuentos de Shopify puede combinarse este bundle. Se aplica al guardar." tabindex="0" aria-label="Con qué otros descuentos de Shopify puede combinarse este bundle. Se aplica al guardar.">?</span></span>
            <span class="be-chev ${combOpen ? "is-open" : ""}">${BE_CHEV}</span>
          </button>
          ${combOpen ? `<div class="be-subacc__body">
            <p class="be-subacc__note">Define con qué descuentos de Shopify se combina este bundle. Los cambios se aplican al guardar.</p>
            <div class="be-adv__group">
              ${tgl("Descuentos de Producto", "combina.producto", !!leer(b, "combina.producto"), "Permite apilar con otros descuentos de producto.")}
              ${tgl("Descuentos de Pedido", "combina.pedido", leer(b, "combina.pedido") !== false, "Permite apilar con descuentos de pedido (ej. cupones de carrito).")}
              ${tgl("Descuentos de Envío", "combina.envio", leer(b, "combina.envio") !== false, "Permite apilar con descuentos de envío.")}
            </div>
          </div>` : ""}
        </div>
      </div>`;

    // Sección "Suscripción" (F1: editor + preview). Real solo con selling plans de
    // una app de terceros (F2+). Reusa be-field-row/be-eye (input+ojo) + swatch.
    const subOn = !!leer(b, "diseno.sub.on");
    const sVer = (k) => leer(b, "diseno.sub.ver." + k) !== false;
    const campoOjoS = (ruta, label, verKey, ph) => {
      const on = sVer(verKey);
      return `<div class="be-field-row"><div class="campo campo--editor" style="flex:1">${label ? `<label>${esc(label)}</label>` : ""}
        <input type="text" data-b="${ruta}" value="${esc(leer(b, ruta) ?? "")}" placeholder="${esc(ph)}" ${on ? "" : "disabled"}></div>
        <button type="button" class="be-eye ${on ? "" : "is-off"}" data-toggle-b="diseno.sub.ver.${verKey}" title="Mostrar/ocultar en la tienda" aria-label="Mostrar u ocultar">${on ? BE_OJO : BE_OJO_OFF}</button></div>`;
    };
    const campoSwS = (ruta, label, colorRuta, ph, colorDef) => `<div class="be-field-row"><div class="campo campo--editor" style="flex:1"><label>${esc(label)}</label>
        <input type="text" data-b="${ruta}" value="${esc(leer(b, ruta) ?? "")}" placeholder="${esc(ph)}"></div>
        <input type="color" class="be-field-sw__col" data-b="${colorRuta}" value="${esc(leer(b, colorRuta) || colorDef)}" title="Color del texto" aria-label="Color de ${esc(label)}"></div>`;
    const suscripcion = `
      <div class="be-sub ${subOn ? "" : "is-off"}">
        <div class="be-sub-master">
          <span class="be-sub-master__t">Activar suscripción</span>
          <button type="button" class="be-toggle ${subOn ? "is-on" : ""}" data-toggle-b="diseno.sub.on" role="switch" aria-checked="${subOn}"><span></span></button>
        </div>
        <div class="be-sub__cuerpo">
          <div class="be-aviso be-aviso--info">
            <span class="be-aviso__ico" aria-hidden="true">ℹ</span>
            <p class="be-aviso__txt">La opción de suscripción solo aparece en tu tienda si el producto tiene una <b>app de suscripción de terceros</b> configurada (Recharge, Appstle, Shopify Subscriptions, etc.). Acá configurás cómo se ve.</p>
          </div>
          ${selectBdl("diseno.sub.estilo", "Estilo del widget", [["clasico", "Clásico"]])}
          <div class="bdl-subsec">Encabezado de opciones de compra <span class="be-help" data-tip="El título que agrupa las opciones de compra en la tienda (ej. «¿Cómo querés comprar?»)." tabindex="0" aria-label="Encabezado de opciones de compra">?</span></div>
          ${campoOjoS("diseno.sub.encabezado", "", "encabezado", "Purchase Options")}
          <div class="bdl-grid2">
            ${campoSwS("diseno.sub.titulo_once", "Título de compra única", "diseno.sub.color_once", "One-Time Purchase", "#111111")}
            ${campoOjoS("diseno.sub.sub_once", "Subtítulo de compra única", "sub_once", "Pagás una vez")}
          </div>
          <div class="bdl-grid2">
            ${campoSwS("diseno.sub.titulo_sub", "Título de la suscripción", "diseno.sub.color_sub", "Subscribe & Save", "#111111")}
            ${campoOjoS("diseno.sub.sub_sub", "Subtítulo de la suscripción", "sub_sub", "Cancelás cuando quieras")}
          </div>
          ${campoOjoS("diseno.sub.detalles", "Detalles de la suscripción", "detalles", "Facturación y descuento flexibles")}
          <div class="be-adv__group">
            ${tgl("Mostrar etiqueta de descuento de la suscripción", "diseno.sub.mostrar_label_desc", !!leer(b, "diseno.sub.mostrar_label_desc"), "Muestra el % de ahorro junto a la opción de suscripción.")}
            ${tgl("Ocultar el widget de suscripción de terceros", "diseno.sub.ocultar_terceros", !!leer(b, "diseno.sub.ocultar_terceros"), "Oculta el selector de suscripción que pinta el tema o la app de terceros, para no duplicar.")}
          </div>
        </div>
      </div>`;

    // Sección "Segmentar por mercado": muestra el bundle solo en ciertos países.
    const mkt = leer(b, "mercados") || {};
    const mktOn = !!mkt.on;
    const modoMkt = mkt.modo || "todos";
    const idsMkt = mkt.ids || [];
    const chipsMkt = idsMkt.map((code) => `<span class="be-mkt-chip">${esc(NOMBRE_PAIS(code))} <button type="button" data-mercado-del="${code}" aria-label="Quitar ${esc(NOMBRE_PAIS(code))}">${ico("x")}</button></span>`).join("");
    const optsMkt = PAISES_BDL.filter(([code]) => idsMkt.indexOf(code) === -1).map(([code, nombre]) => `<button type="button" class="be-mkt-opt" data-mercado-add="${code}">${esc(nombre)}</button>`).join("");
    const msgMkt = modoMkt === "todos"
      ? `<div class="be-aviso be-aviso--info"><span class="be-aviso__ico" aria-hidden="true">ℹ</span><p class="be-aviso__txt">Esta oferta será visible y aplicable en todos los mercados.</p></div>`
      : `<div class="be-aviso be-aviso--ok"><span class="be-aviso__ico" aria-hidden="true">${ico("check")}</span><p class="be-aviso__txt">${idsMkt.length ? `Esta oferta solo se mostrará en ${idsMkt.length} mercado${idsMkt.length > 1 ? "s" : ""} seleccionado${idsMkt.length > 1 ? "s" : ""}.` : "Elegí al menos un mercado (o dejala en todos)."}</p></div>`;
    const segmentar = `
      <div class="be-sub ${mktOn ? "" : "is-off"}">
        <div class="be-sub-master">
          <span class="be-sub-master__t">Activar segmentación</span>
          <button type="button" class="be-toggle ${mktOn ? "is-on" : ""}" data-toggle-b="mercados.on" role="switch" aria-checked="${mktOn}"><span></span></button>
        </div>
        <div class="be-sub__cuerpo">
          <label class="be-mkt-radio" data-mercado-modo="todos"><input type="radio" ${modoMkt === "todos" ? "checked" : ""} tabindex="-1"> Todos los mercados</label>
          <label class="be-mkt-radio" data-mercado-modo="especificos"><input type="radio" ${modoMkt === "especificos" ? "checked" : ""} tabindex="-1"> Mercados específicos</label>
          ${modoMkt === "especificos" ? `
            <div class="be-mkt-picker">
              <input type="text" class="be-mkt-search" data-mercado-search placeholder="Buscar mercados">
              <div class="be-mkt-drop">${optsMkt || '<div class="be-mkt-empty">No hay más mercados</div>'}</div>
            </div>
            ${chipsMkt ? `<div class="be-mkt-chips">${chipsMkt}</div>` : ""}
          ` : ""}
          ${msgMkt}
        </div>
      </div>`;

    return `<div class="be-secs-extra">
      ${bdlAcordeon("color", IC_PALETA, "Color y estilo", colorYEstilo + estiloTexto + textosYTipo, !!s.secOpen.color)}
      ${bdlAcordeon("avanzada", IC_ENGRANAJE, "Configuración avanzada", avanzada, !!s.secOpen.avanzada)}
      ${bdlAcordeon("sub", IC_CAJA, "Suscripción", suscripcion, !!s.secOpen.sub)}
      ${bdlAcordeon("mercados", IC_GLOBO, "Segmentar por mercado", segmentar, !!s.secOpen.mercados)}
    </div>`;
  }

  function bindEditorBundle(b, s) {
    const root = $("be-left");
    if (!root) return;

    // Cerrar los popovers "Aa" al clickear afuera. Document persiste entre
    // renders → se registra una sola vez (be-left se recrea, esto no).
    if (!window.__bdlAaOutside) {
      window.__bdlAaOutside = true;
      document.addEventListener("mousedown", (e) => {
        if (e.target.closest && e.target.closest(".be-txel__ctrls")) return;
        document.querySelectorAll(".be-aapop").forEach((p) => (p.hidden = true));
        document.querySelectorAll(".be-txel__aa").forEach((x) => x.setAttribute("aria-expanded", "false"));
      });
    }

    root.addEventListener("input", (e) => {
      // Buscador de mercados: filtra el dropdown en vivo, sin re-render (mantiene foco).
      if (e.target.dataset.mercadoSearch !== undefined) {
        const q = e.target.value.toLowerCase();
        root.querySelectorAll(".be-mkt-opt").forEach((o) => { o.style.display = o.textContent.toLowerCase().indexOf(q) === -1 ? "none" : ""; });
        return;
      }
      const ruta = e.target.dataset.b;
      if (!ruta) return;
      let v = (e.target.type === "checkbox" || e.target.tagName === "S-CHECKBOX") ? e.target.checked : e.target.value;
      if (e.target.dataset.tipo === "numero") v = Number(v) || 0;
      fijar(b, ruta, v);
      // Editar un color a mano rompe el vínculo con el preset: deja de marcarlo
      // como "Rosa" y pasa a "personalizado" (el swatch se des-resalta al re-render).
      if (/^diseno\.color_(borde|fondo|badge|badge_texto|etiqueta|texto)$|^diseno\.boton\.color/.test(ruta) && b.diseno && b.diseno.preset) {
        b.diseno.palette = { active: b.diseno.preset, source: "custom" };
        b.diseno.preset = null;
      }
      // Slider de geometría: reflejar el valor a la derecha en vivo (sin re-render).
      if (e.target.dataset.slider !== undefined) {
        const out = e.target.parentElement.querySelector(".bdl-slider__val");
        if (out) out.textContent = v + " / " + e.target.max;
      }
      // Mapa "Personalizar": actualizar la mini-tarjeta central en vivo.
      if (e.target.dataset.mid) actualizarMiniPerso(e.target.dataset.mid, v);
      // "Estilo del texto": reflejar el cambio en el ejemplo en vivo de la lista
      // (sin re-render, para no cerrar el popover).
      const mEl = ruta.match(/^diseno\.type\.el\.([a-z]+)\.(font|size|weight|color)$/);
      if (mEl) {
        const ex = root.querySelector(`[data-txel="${mEl[1]}"] .be-txel__ex > *`);
        if (ex) {
          if (mEl[2] === "font") ex.style.fontFamily = v && v !== "heredar" ? (FONTS_BDL[v] || "inherit") : "";
          else if (mEl[2] === "size") ex.style.fontSize = v ? v + "px" : "";
          else if (mEl[2] === "weight") ex.style.fontWeight = v || "";
          else if (mEl[2] === "color") ex.style.color = v || "";
        }
      }
      // etiqueta/insignia/agotado: sus colores/fondo van a rutas propias → reflejar
      // el ejemplo en vivo de la lista (el regex de arriba solo cubre type.el.*).
      const EXCOL = {
        "diseno.color_etiqueta": ["etq", (ex) => { ex.style.color = v; ex.style.borderColor = v; }],
        "diseno.color_etiqueta_fondo": ["etq", (ex) => { ex.style.background = v; }],
        "diseno.color_badge_texto": ["badge", (ex) => { ex.style.color = v; }],
        "diseno.color_badge": ["badge", (ex) => { ex.style.background = v; }],
        "diseno.color_oos": ["oos", (ex) => { ex.style.color = v; }]
      };
      if (EXCOL[ruta]) {
        const ex = root.querySelector(`[data-txel="${EXCOL[ruta][0]}"] .be-txel__ex > *`);
        if (ex) EXCOL[ruta][1](ex);
      }
      // Aviso de contraste de la insignia, en vivo.
      if (/^diseno\.color_badge/.test(ruta)) refrescarAvisoContraste(b);
      // Historial (undo/redo): registrar cambios de diseño, con debounce.
      if (/^diseno\./.test(ruta)) pushHist(b);
      marcarSucioBundles();
      pintarPreviewBundle();
      // BOGO: la "cantidad total" es X+Y (campo calculado) → re-render.
      if (/bogo_(compra|obten)$/.test(ruta)) pintarEditorBundle();
    });

    root.addEventListener("change", (e) => {
      const act = e.target.dataset.act;
      if (act) { b.activador = b.activador || { tipo: "todos", ids: [] }; b.activador.tipo = act; b.activador.ids = b.activador.ids || []; marcarSucioBundles(); return pintarEditorBundle(); }
      if (e.target.dataset.prod !== undefined) {
        const gid = e.target.dataset.prod;
        b.activador.ids = b.activador.ids || [];
        if (e.target.checked) { if (!b.activador.ids.includes(gid)) b.activador.ids.push(gid); }
        else b.activador.ids = b.activador.ids.filter((x) => x !== gid);
        marcarSucioBundles(); pintarPreviewBundle();
      }
      // Add-on Imagen: subir archivo desde la compu (no un link).
      if (e.target.dataset.addonImg !== undefined && e.target.files?.length) {
        subirImagenBundle(e.target.files[0], b.ofertas[+e.target.dataset.addonImg]);
      }
    });

    root.addEventListener("click", (e) => {
      const t = e.target;
      // "Estilo del texto": abrir/cerrar el popover del Aa (sin re-render, para no
      // perder el estado). Al abrir uno, cierra los demás.
      const aaBtn = t.closest("[data-aa]"); if (aaBtn) {
        const k = aaBtn.dataset.aa;
        const pop = root.querySelector(`[data-aapop="${k}"]`);
        const abrir = pop && pop.hidden;
        root.querySelectorAll(".be-aapop").forEach((p) => (p.hidden = true));
        root.querySelectorAll(".be-txel__aa").forEach((x) => x.setAttribute("aria-expanded", "false"));
        if (pop && abrir) { pop.hidden = false; aaBtn.setAttribute("aria-expanded", "true"); }
        return;
      }
      // Stepper de tamaño: actualiza el input oculto + el output y dispara el
      // camino normal de input (fijar + preview), sin re-render del editor.
      const aaStep = t.closest("[data-aastep]"); if (aaStep) {
        const [k, dir] = aaStep.dataset.aastep.split(":");
        const inp = root.querySelector(`[data-aasize="${k}"]`);
        const out = root.querySelector(`[data-aaout="${k}"]`);
        if (inp) {
          const DEF = { enc: 16, titulo: 15, precio: 17, etq: 11, badge: 9, oos: 12 };
          const cur = Number(inp.value) || DEF[k] || 14;
          const next = Math.max(8, Math.min(48, cur + Number(dir)));
          inp.value = next;
          if (out) out.textContent = next;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      // Segmentar por mercado: modo (radio), agregar/quitar país.
      const mm = t.closest("[data-mercado-modo]"); if (mm) { fijar(b, "mercados.modo", mm.dataset.mercadoModo); marcarSucioBundles(); return pintarEditorBundle(); }
      const ma = t.closest("[data-mercado-add]"); if (ma) { const ids = leer(b, "mercados.ids") || []; if (ids.indexOf(ma.dataset.mercadoAdd) === -1) ids.push(ma.dataset.mercadoAdd); fijar(b, "mercados.ids", ids); marcarSucioBundles(); return pintarEditorBundle(); }
      const md = t.closest("[data-mercado-del]"); if (md) { const ids = (leer(b, "mercados.ids") || []).filter((x) => x !== md.dataset.mercadoDel); fijar(b, "mercados.ids", ids); marcarSucioBundles(); return pintarEditorBundle(); }
      const sec = t.closest("[data-sec]"); if (sec) { const k = sec.dataset.sec; if (k === "setup") s.setupOpen = !s.setupOpen; else { s.secOpen = s.secOpen || {}; s.secOpen[k] = !s.secOpen[k]; } return pintarEditorBundle(); }
      const ssec = t.closest("[data-subsec]"); if (ssec) { s.subOpen = s.subOpen || {}; const k = ssec.dataset.subsec; s.subOpen[k] = !s.subOpen[k]; return pintarEditorBundle(); }
      const tplBtn = t.closest("[data-tpl]"); if (tplBtn) { b.diseno = b.diseno || {}; b.diseno.layout = b.diseno.layout || {}; b.diseno.layout.template = tplBtn.dataset.tpl; marcarSucioBundles(); commitHist(b); pintarPreviewBundle(); return pintarEditorBundle(); }
      const hb = t.closest("[data-hist]"); if (hb) { restaurarHist(b, +hb.dataset.hist); return; }
      const bfm = t.closest("[data-badgeforma]"); if (bfm) { b.diseno = b.diseno || {}; b.diseno.badge_forma = bfm.dataset.badgeforma; marcarSucioBundles(); commitHist(b); pintarPreviewBundle(); return pintarEditorBundle(); }
      const pr = t.closest("[data-preset]"); if (pr) { const p = PRESETS_BDL[pr.dataset.preset]; b.diseno = b.diseno || {}; b.diseno.boton = b.diseno.boton || {}; b.diseno.preset = pr.dataset.preset; b.diseno.palette = { active: pr.dataset.preset, source: "preset" }; b.diseno.color_borde = p.borde; b.diseno.color_badge = p.badge; b.diseno.color_badge_texto = "#ffffff"; b.diseno.color_etiqueta = p.etq; b.diseno.color_texto = p.texto; b.diseno.boton.color_fondo = p.bot; marcarSucioBundles(); commitHist(b); pintarPreviewBundle(); return pintarEditorBundle(); }
      const pv = t.closest("[data-pv]"); if (pv) { estado.bundles.previewMobile = pv.dataset.pv === "mobile"; const marco = document.querySelector(".bdl-preview__marco"); if (marco) marco.classList.toggle("is-mobile", estado.bundles.previewMobile); document.querySelectorAll("[data-pv]").forEach((x) => x.classList.toggle("is-sel", x === pv)); return; }
      const fx = t.closest("[data-fix-contraste]"); if (fx) { const bg = leer(b, "diseno.color_badge") || "#111111"; const mejor = contrasteWCAG(bg, "#ffffff") >= contrasteWCAG(bg, "#111111") ? "#ffffff" : "#111111"; b.diseno = b.diseno || {}; b.diseno.color_badge_texto = mejor; marcarSucioBundles(); commitHist(b); pintarPreviewBundle(); return pintarEditorBundle(); }
      const op = t.closest("[data-lv-open]"); if (op) { const i = +op.dataset.lvOpen; s.nivelOpen = s.nivelOpen === i ? null : i; return pintarEditorBundle(); }
      const tg = t.closest("[data-lv-toggle]"); if (tg) { const o = b.ofertas[+tg.dataset.lvToggle]; o.activo = o.activo === false; marcarSucioBundles(); return pintarEditorBundle(); }
      // Estrella = oferta PREDETERMINADA (la pre-seleccionada al entrar). Exclusiva:
      // siempre hay exactamente una, así que setea esta y apaga el resto.
      const st = t.closest("[data-lv-star]"); if (st) { const idx = +st.dataset.lvStar; b.ofertas.forEach((x, k) => { x.predeterminada = k === idx; }); marcarSucioBundles(); pintarPreviewBundle(); return pintarEditorBundle(); }
      const dup = t.closest("[data-lv-dup]"); if (dup) { const i = +dup.dataset.lvDup; const copia = JSON.parse(JSON.stringify(b.ofertas[i])); copia.predeterminada = false; /* la default sigue siendo la original */ b.ofertas.splice(i + 1, 0, copia); s.nivelOpen = i + 1; marcarSucioBundles(); return pintarEditorBundle(); }
      const del = t.closest("[data-lv-del]"); if (del) { b.ofertas.splice(+del.dataset.lvDel, 1); if (!b.ofertas.length) b.ofertas.push({ cantidad: 1, descuento: 0, titulo: "Comprá 1", ver: {}, activo: true }); s.nivelOpen = null; marcarSucioBundles(); return pintarEditorBundle(); }
      const tp = t.closest("[data-lv-tipo]"); if (tp) { const [i, k] = tp.dataset.lvTipo.split(":"); const o = b.ofertas[+i]; o.tipo_desc = k; if (k === "ninguno") o.descuento = 0; marcarSucioBundles(); return pintarEditorBundle(); }
      const ver = t.closest("[data-lv-ver]"); if (ver) { const [i, key] = ver.dataset.lvVer.split(":"); const o = b.ofertas[+i]; o.ver = o.ver || {}; o.ver[key] = o.ver[key] === false ? true : false; marcarSucioBundles(); return pintarEditorBundle(); }
      const tb = t.closest("[data-toggle-b]"); if (tb) { const ruta = tb.dataset.toggleB; fijar(b, ruta, !leer(b, ruta)); marcarSucioBundles(); return pintarEditorBundle(); }
      const lb = t.closest("[data-lv-bool]"); if (lb) { const [i, f] = lb.dataset.lvBool.split(":"); const o = b.ofertas[+i]; o[f] = !o[f]; marcarSucioBundles(); pintarPreviewBundle(); return pintarEditorBundle(); }
      const at = t.closest("[data-addon-toggle]"); if (at) { const [i, key] = at.dataset.addonToggle.split(":"); const o = b.ofertas[+i]; o.addons = o.addons || {}; o.addons[key] = o.addons[key] || {}; o.addons[key].on = !o.addons[key].on; marcarSucioBundles(); pintarPreviewBundle(); return pintarEditorBundle(); }
      const ag = t.closest("[data-addon-gift]"); if (ag) { const i = +ag.dataset.addonGift; abrirPickerTodos((p) => { const o = b.ofertas[i]; o.addons = o.addons || {}; const rg = (o.addons.regalo = o.addons.regalo || { on: true, items: [] }); rg.on = true; rg.items = rg.items || []; const it = { cantidad: 1, textoGratis: "GRATIS", mostrarPrecio: true }; asignarRegalo(it, p); rg.items.push(it); rg.sel = rg.items.length - 1; marcarSucioBundles(); pintarPreviewBundle(); pintarEditorBundle(); }); return; }
      const gdel = t.closest("[data-gift-del]"); if (gdel) { const [i, gi] = gdel.dataset.giftDel.split(":").map(Number); const rg = b.ofertas[i].addons.regalo; rg.items.splice(gi, 1); if (!rg.items.length) rg.on = false; rg.sel = 0; marcarSucioBundles(); pintarPreviewBundle(); return pintarEditorBundle(); }
      const gtab = t.closest("[data-gift-tab]"); if (gtab) { const [i, gi] = gtab.dataset.giftTab.split(":").map(Number); b.ofertas[i].addons.regalo.sel = gi; return pintarEditorBundle(); }
      const gadd = t.closest("[data-gift-add]"); if (gadd) { const i = +gadd.dataset.giftAdd; const rg = b.ofertas[i].addons.regalo; rg.items = rg.items || []; rg.items.push({ nombre: "", cantidad: 1, textoGratis: "GRATIS", mostrarPrecio: true }); rg.sel = rg.items.length - 1; marcarSucioBundles(); return pintarEditorBundle(); }
      const gpick = t.closest("[data-gift-pick]"); if (gpick) { const [i, gi] = gpick.dataset.giftPick.split(":").map(Number); abrirPickerTodos((p) => { const it = b.ofertas[i].addons.regalo.items[gi]; asignarRegalo(it, p); marcarSucioBundles(); pintarPreviewBundle(); pintarEditorBundle(); }); return; }
      const gbool = t.closest("[data-gift-bool]"); if (gbool) { const [i, gi, f] = gbool.dataset.giftBool.split(":"); const it = b.ofertas[+i].addons.regalo.items[+gi]; it[f] = it[f] === false ? true : it[f] === undefined ? false : !it[f]; marcarSucioBundles(); pintarPreviewBundle(); return pintarEditorBundle(); }
      const gvar = t.closest("[data-gift-var]"); if (gvar) { const [i, gi, vi] = gvar.dataset.giftVar.split(":").map(Number); const it = b.ofertas[i].addons.regalo.items[gi]; const vid = it.variantes[vi].id; it.varSel = it.varSel || []; const k = it.varSel.indexOf(vid); if (k >= 0) { if (it.varSel.length > 1) it.varSel.splice(k, 1); } else it.varSel.push(vid); marcarSucioBundles(); pintarPreviewBundle(); return pintarEditorBundle(); }
      const add = t.closest("[data-add-nivel]"); if (add) { const n = b.ofertas.length + 1; b.ofertas.push({ cantidad: n, descuento: 0, titulo: "Comprá " + n, subtitulo: "", etiqueta: "", badge: "", popular: false, activo: true, ver: {} }); s.nivelOpen = b.ofertas.length - 1; marcarSucioBundles(); return pintarEditorBundle(); }
    });

    if (b.activador?.tipo === "productos" && !(estado.productos || []).length) {
      api("/productos").then((prods) => { estado.productos = prods; if (estado.bundles.vista === "editor") pintarEditorBundle(); }).catch(() => {});
    }
  }

  // Activador compartido por los dos tipos de bundle.
  function bloqueActivador(b) {
    const a = b.activador || { tipo: "todos", ids: [] };
    return `
      <s-select label="Se aplica a" data-b="activador.tipo" value="${esc(a.tipo || "todos")}">
        <s-option value="todos">Todos los productos</s-option>
        <s-option value="productos">Productos específicos</s-option>
      </s-select>
      ${a.tipo === "productos" ? selectorProductos(a.ids || []) : ""}`;
  }

  // --- pestaña Ofertas ---
  function panelOfertas(b) {
    if (b.tipo === "bxgy") return panelBxgy(b);
    const ofertas = (b.ofertas || [])
      .map((o, i) => `
        <div class="bdl-oferta" data-oi="${i}">
          <div class="bdl-oferta__cab">
            <strong>Oferta ${i + 1}</strong>
            ${b.ofertas.length > 1 ? `<button class="bdl-oferta__del" data-oferta-del="${i}" title="Quitar" aria-label="Quitar">${ico("basura")}</button>` : ""}
          </div>
          <div class="bdl-grid2">
            ${campoBdl(`ofertas.${i}.cantidad`, "Cantidad", "numero", 'min="1"')}
            ${campoBdl(`ofertas.${i}.descuento`, "Descuento %", "numero", 'min="0" max="100"')}
          </div>
          ${campoBdl(`ofertas.${i}.titulo`, "Título")}
          <div class="bdl-grid2">
            ${campoBdl(`ofertas.${i}.subtitulo`, "Subtítulo")}
            ${campoBdl(`ofertas.${i}.etiqueta`, "Etiqueta (ej. 10% OFF)")}
          </div>
          ${campoBdl(`ofertas.${i}.badge`, "Insignia (ej. Más elegido)")}
          <div class="bdl-checks">
            ${campoBdl(`ofertas.${i}.popular`, "Destacar (borde marcado)", "bool")}
            <label class="ui-check"><input type="radio" name="bdl-pred" data-pred="${i}" ${o.predeterminada ? "checked" : ""}> Seleccionada por defecto</label>
          </div>
        </div>`)
      .join("");

    return `
      <div class="tarjeta__titulo">Ofertas</div>
      <div class="panel__sub">Creá los peldaños de precio. El más conveniente se aplica solo en el checkout.</div>

      ${campoBdl("nombre", "Nombre del bundle")}
      ${bloqueActivador(b)}

      <div class="bdl-ofertas">${ofertas}</div>
      ${b.ofertas.length < 3 ? `<button class="btn btn--fantasma btn--chico" id="bdl-add-oferta">${ico("mas")} Agregar oferta</button>` : `<div class="panel__sub">Máximo 3 ofertas.</div>`}`;
  }

  // --- pestaña Ofertas para BXGY ---
  function panelBxgy(b) {
    const x = b.bxgy || {};
    const gratis = Number(x.regalo_descuento) >= 100;
    return `
      <div class="tarjeta__titulo">Comprá X y obtené Y</div>
      <div class="panel__sub">Definí cuánto tiene que comprar el cliente y qué se lleva. El descuento se aplica solo en el checkout.</div>

      ${campoBdl("nombre", "Nombre del bundle")}
      ${bloqueActivador(b)}

      <div class="bdl-seccion">La promo</div>
      <div class="bdl-grid2">
        ${campoBdl("bxgy.compra_cantidad", "Comprá esta cantidad", "numero", 'min="1"')}
        ${campoBdl("bxgy.regalo_cantidad", "Y llevás esta cantidad", "numero", 'min="1"')}
      </div>
      ${campoBdl("bxgy.regalo_descuento", "Descuento sobre lo que se lleva (%)", "numero", 'min="1" max="100"')}
      <div class="bdl-nota">${gratis ? "Con 100% el producto de regalo sale <strong>gratis</strong>." : "Con menos de 100% el producto extra sale con ese descuento."} Ej: comprá ${Number(x.compra_cantidad) || 2}, llevás ${Number(x.regalo_cantidad) || 1} ${gratis ? "gratis" : "al " + (Number(x.regalo_descuento) || 100) + "% off"}.</div>`;
  }

  function selectorProductos(ids) {
    const prods = estado.productos || [];
    if (!prods.length) {
      return `<div class="bdl-prodsel bdl-prodsel--cargando" id="bdl-prodsel">Cargando productos de tu tienda…</div>`;
    }
    const sel = new Set(ids.map((g) => String(g)));
    const items = prods
      .map(
        (p) => `<label class="bdl-prod">
          <input type="checkbox" data-prod="${esc(p.id)}" ${sel.has(String(p.id)) ? "checked" : ""}>
          <span class="bdl-prod__foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : ico("imagen", "ico--ph")}</span>
          <span class="bdl-prod__t">${esc(p.titulo)}</span>
        </label>`
      )
      .join("");
    return `<div class="bdl-prodsel" id="bdl-prodsel">${items}</div>`;
  }

  // --- pestaña Diseño ---
  // (panelDiseno eliminado: era la versión vieja del editor de diseño, ya
  //  reemplazada por bdlSeccionesExtra → acordeón "Color y estilo".)

  // Campo genérico atado a una ruta del bundle actual: data-b.
  function campoBdl(ruta, etiqueta, tipo = "text", extra = "") {
    const v = leer(bundleActual(), ruta);
    if (tipo === "color") {
      return `<div class="campo campo--editor bdl-color"><label>${etiqueta}</label>
        <span class="ui-color__fila"><input type="color" data-b="${ruta}" value="${esc(v || "#000000")}">
        <code>${esc(v || "#000000")}</code></span></div>`;
    }
    if (tipo === "bool") {
      return `<s-checkbox label="${esc(etiqueta)}" data-b="${ruta}" data-tipo="bool" ${v ? "checked" : ""}></s-checkbox>`;
    }
    if (tipo === "numero") {
      return `<s-text-field label="${esc(etiqueta)}" type="number" data-b="${ruta}" data-tipo="numero" value="${esc(v ?? 0)}" ${extra}></s-text-field>`;
    }
    return `<s-text-field label="${esc(etiqueta)}" data-b="${ruta}" value="${esc(v ?? "")}"></s-text-field>`;
  }

  function bindPanelBundle() {
    const b = bundleActual();
    const panel = $("bdl-panel");

    panel.addEventListener("input", (e) => {
      const ruta = e.target.dataset.b;
      if (!ruta) return;
      let v = (e.target.type === "checkbox" || e.target.tagName === "S-CHECKBOX") ? e.target.checked : e.target.value;
      if (e.target.dataset.tipo === "numero") v = Number(v) || 0;
      fijar(b, ruta, v);
      if (e.target.type === "color") e.target.parentElement.querySelector("code").textContent = v;
      // El tipo de activador cambia el sub-panel: repintar.
      if (ruta === "activador.tipo") { b.activador.ids = b.activador.ids || []; marcarSucioBundles(); return pintarEditorBundle(); }
      marcarSucioBundles();
      pintarPreviewBundle();
    });

    // radio "predeterminada": exclusivo entre ofertas
    panel.addEventListener("change", (e) => {
      if (e.target.dataset.pred !== undefined) {
        b.ofertas.forEach((o, i) => (o.predeterminada = i === Number(e.target.dataset.pred)));
        marcarSucioBundles();
        pintarPreviewBundle();
      }
      if (e.target.dataset.prod !== undefined) {
        const gid = e.target.dataset.prod;
        b.activador.ids = b.activador.ids || [];
        if (e.target.checked) { if (!b.activador.ids.includes(gid)) b.activador.ids.push(gid); }
        else b.activador.ids = b.activador.ids.filter((x) => x !== gid);
        marcarSucioBundles();
      }
    });

    // agregar / quitar oferta
    panel.addEventListener("click", (e) => {
      if (e.target.id === "bdl-add-oferta") {
        const n = b.ofertas.length + 1;
        b.ofertas.push({ cantidad: n, descuento: 0, titulo: "Comprá " + n, subtitulo: "", etiqueta: "", badge: "", popular: false, predeterminada: false });
        marcarSucioBundles();
        pintarEditorBundle();
      }
      const del = e.target.dataset.ofertaDel;
      if (del !== undefined) {
        b.ofertas.splice(Number(del), 1);
        if (!b.ofertas.some((o) => o.predeterminada)) b.ofertas[0].predeterminada = true;
        marcarSucioBundles();
        pintarEditorBundle();
      }
    });

    // presets
    panel.querySelectorAll("[data-preset]").forEach((el) => {
      el.onclick = () => {
        const p = PRESETS_BDL[el.dataset.preset];
        b.diseno.preset = el.dataset.preset;
        b.diseno.color_borde = p.borde;
        b.diseno.color_badge = p.badge;
        b.diseno.color_etiqueta = p.etq;
        b.diseno.color_texto = p.texto;
        b.diseno.boton.color_fondo = p.bot;
        marcarSucioBundles();
        pintarEditorBundle();
      };
    });

    // si el activador es "productos" y no cargamos productos aún, traerlos
    if (b.activador?.tipo === "productos" && !(estado.productos || []).length) {
      api("/productos").then((prods) => {
        estado.productos = prods;
        if (estado.bundles.vista === "editor" && estado.bundles.tab === "ofertas") pintarEditorBundle();
      }).catch(() => {});
    }
  }

  // Producto elegido para el preview (o null = producto de ejemplo).
  function productoPreview() {
    const id = estado.bundles.previewProd;
    return id ? (estado.productos || []).find((p) => p.id === id) || null : null;
  }
  function precioPreviewCents() {
    const p = productoPreview();
    const cents = p && p.precio != null ? Math.round(parseFloat(p.precio) * 100) : 0;
    return cents > 0 ? cents : PRECIO_DEMO;
  }

  // Columna derecha del editor: selector de producto real + tarjeta + widget.
  function previewAsideBundle() {
    const prods = estado.productos || [];
    const sel = productoPreview();
    const opciones =
      `<option value="">Producto de ejemplo</option>` +
      prods.map((p) => `<option value="${esc(p.id)}" ${estado.bundles.previewProd === p.id ? "selected" : ""}>${esc(p.titulo)}</option>`).join("");
    const nombre = sel ? sel.titulo : "Producto de ejemplo";
    const foto = sel && sel.imagen ? `<img src="${esc(sel.imagen)}" alt="">` : ico("bolsa", "ico--ph");
    const mobile = !!estado.bundles.previewMobile;
    return `<aside class="tarjeta bdl-preview-card">
      <div class="tarjeta__titulo">Vista previa en vivo</div>
      <div class="panel__sub">Elegí un producto de tu tienda para verlo real</div>
      ${
        prods.length
          ? `<div class="campo campo--editor"><label>Producto de prueba</label><select id="bdl-preview-prod">${opciones}</select></div>`
          : ""
      }
      <div class="bdl-pvtoggle" role="group" aria-label="Ancho de la vista previa">
        <button type="button" class="bdl-pvbtn ${mobile ? "" : "is-sel"}" data-pv="desktop">Escritorio</button>
        <button type="button" class="bdl-pvbtn ${mobile ? "is-sel" : ""}" data-pv="mobile">Móvil</button>
      </div>
      <div class="bdl-preview__marco ${mobile ? "is-mobile" : "is-desktop"}">
        <div id="bdl-preview"></div>
      </div>
    </aside>`;
  }

  // --- preview: mismo markup que el widget del storefront ---
  function pintarPreviewBundle() {
    const cont = $("bdl-preview");
    if (!cont) return;
    cont.innerHTML = previewBundleHTML(bundleActual(), precioPreviewCents());
    cont.querySelectorAll(".tiq-bdl__card").forEach((el) => {
      el.onclick = () => {
        cont.querySelectorAll(".tiq-bdl__card").forEach((c) => c.classList.remove("is-sel"));
        el.classList.add("is-sel");
        el.querySelector(".tiq-bdl__radio");
      };
    });
  }

  // Precio de un nivel según su tipo de descuento (para el preview).
  function totalOfertaBdl(o, PU) {
    const tipo = o.tipo_desc || (Number(o.descuento) > 0 ? "porcentaje" : "ninguno");
    if (tipo === "bogo") { const c = Math.max(1, Number(o.bogo_compra) || 1), g = Math.max(1, Number(o.bogo_obten) || 1); return { cant: c + g, bruto: PU * (c + g), total: PU * c }; }
    const cant = Math.max(1, Number(o.cantidad) || 1);
    const bruto = PU * cant;
    if (tipo === "fijo") { const m = (parseFloat(o.monto_fijo) || 0) * 100; return { cant, bruto, total: Math.max(0, bruto - (o.fijo_unidad ? m * cant : m)) }; }
    if (tipo === "especifico") { const tt = (parseFloat(o.precio_objetivo) || 0) * 100; return { cant, bruto, total: tt > 0 ? tt : bruto }; }
    if (tipo === "ninguno") return { cant, bruto, total: bruto };
    const desc = Number(o.descuento) || 0; return { cant, bruto, total: Math.round(bruto * (1 - desc / 100)) };
  }

  // Add-Ons de un nivel reflejados en el preview (regalo, envío, imagen).
  // Thumbnail de imagen del nivel (integrado a la tarjeta) — paridad con el widget.
  // Opciones de compra (One-Time / Subscribe) — se muestran si sub.on. En el
  // preview del admin es maqueta (siempre que on); en la tienda el widget las
  // gatea además por selling plans reales (F3). ver.<k> !== false = visible.
  function buyoptsHTML(d) {
    const su = d.sub;
    if (!su || !su.on) return "";
    const ver = su.ver || {};
    const head = ver.encabezado !== false && su.encabezado ? `<div class="tiq-bdl__buyhead">${esc(su.encabezado)}</div>` : "";
    const opt = (sel, titulo, color, sub, verKey, pill) => `<label class="tiq-bdl__buyopt${sel ? " is-sel" : ""}">
      <span class="tiq-bdl__radio"></span>
      <span class="tiq-bdl__buyopt-main">
        <span class="tiq-bdl__buyopt-t"${color ? ` style="color:${esc(color)}"` : ""}>${esc(titulo)}${pill ? ` <span class="tiq-bdl__etq">${esc(pill)}</span>` : ""}</span>
        ${ver[verKey] !== false && sub ? `<span class="tiq-bdl__buyopt-s">${esc(sub)}</span>` : ""}
      </span></label>`;
    return `<div class="tiq-bdl__buyopts">${head}
      ${opt(true, su.titulo_once || "One-Time Purchase", su.color_once, su.sub_once, "sub_once", "")}
      ${opt(false, su.titulo_sub || "Subscribe & Save", su.color_sub, su.sub_sub, "sub_sub", su.mostrar_label_desc ? "-10%" : "")}
    </div>`;
  }

  function thumbBdlHTML(o) {
    const im = (o.addons || {}).imagen;
    return im?.on && im.url ? `<span class="tiq-bdl__thumb"><img src="${esc(im.url)}" alt="" loading="lazy"></span>` : "";
  }
  function addonsPreviewBdl(o) {
    const ad = o.addons || {};
    let h = "";
    if (ad.regalo?.on) {
      const items = ad.regalo.items || (ad.regalo.nombre ? [{ nombre: ad.regalo.nombre, cantidad: 1 }] : []);
      items.forEach((it) => { h += filaRegaloBdl(it); });
    }
    if (ad.envio?.on) h += `<div class="tiq-bdl__ship">🚚 + ${esc(ad.envio.texto || "FREE SHIPPING")}</div>`;
    return h ? `<div class="tiq-bdl__addons">${h}</div>` : "";
  }

  // Serializador único: modelo de diseño (b.diseno) → string de variables CSS
  // que consume el widget. Única fuente de verdad model→vars (spec §5.1). El
  // storefront (tiendaiq-bundle.js) replica este MISMO contrato → paridad
  // admin↔tienda. Función pura: sin DOM, testeable, base del editor "Color y
  // estilo". PASO 1 de la reconstrucción (docs/editor-color-estilo-spec.md §6).
  // Familias de fuente ofrecidas (clave → stack CSS). "heredar" = la del tema.
  const FONTS_BDL = {
    heredar: "inherit",
    sans: "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    serif: "Georgia,'Times New Roman',serif",
    redondeada: "'Nunito','Quicksand','Varela Round',system-ui,sans-serif",
    mono: "'SF Mono',ui-monospace,'Courier New',monospace"
  };

  function disenoAVars(d) {
    d = d || {};
    const bot = d.boton || {};
    const g = d.geometry || {};
    const ty = d.type || {};
    // geometry.radius unifica el redondeo de la tarjeta (fallback al legacy
    // `radio`). geometry.breathing → --tiq-gap (densidad/aire entre tarjetas);
    // si no está seteado NO se emite → el widget usa su fallback → look intacto.
    const radio = g.radius ?? d.radio ?? 12;
    const gap = g.breathing;
    return (
      `--tiq-borde:${d.color_borde || "#111"};--tiq-badge:${d.color_badge || "#111"};--tiq-badge-txt:${d.color_badge_texto || "#fff"};` +
      `--tiq-etq:${d.color_etiqueta || "#e11d48"};--tiq-txt:${d.color_texto || "#111"};--tiq-radio:${radio}px;` +
      (gap != null ? `--tiq-gap:${gap}px;` : "") +
      // Fondo de la tarjeta (no-seleccionada). Solo si el merchant lo eligió; si no,
      // el widget usa su gris neutro por defecto (look intacto en bundles viejos).
      (d.color_fondo ? `--tiq-card-bg:${d.color_fondo};` : "") +
      // Tipografía (Paso 6): fuente solo si no es "heredar"; pesos por rol.
      (ty.font && ty.font !== "heredar" ? `--tiq-font:${FONTS_BDL[ty.font] || "inherit"};` : "") +
      (ty.titleWeight ? `--tiq-title-w:${ty.titleWeight};` : "") +
      (ty.priceWeight ? `--tiq-price-w:${ty.priceWeight};` : "") +
      // Estilo por elemento (editor "Estilo del texto"): cada prop solo si está
      // seteada → el widget cae al literal actual (look intacto). Fase 1: enc/titulo/precio.
      vElAVars("h1", (ty.el || {}).enc) +
      vElAVars("titulo", (ty.el || {}).titulo) +
      vElAVars("precio", (ty.el || {}).precio) +
      vElAVars("etq", (ty.el || {}).etq) +
      vElAVars("badge", (ty.el || {}).badge) +
      vElAVars("oos", (ty.el || {}).oos) +
      // Fondo de la etiqueta, color del mensaje de agotado, ancho de borde.
      (d.color_etiqueta_fondo ? `--tiq-etq-bg:${d.color_etiqueta_fondo};` : "") +
      (d.color_oos ? `--tiq-agotado-color:${d.color_oos};` : "") +
      (g.borderWidth != null ? `--tiq-bd-w:${g.borderWidth}px;` : "") +
      `--tiq-bot-fondo:${bot.color_fondo || "#111"};--tiq-bot-txt:${bot.color_texto || "#fff"};--tiq-bot-radio:${bot.radio ?? 8}px;--tiq-bot-tam:${bot.tamano ?? 16}px`
    );
  }

  // model type.el.<k> → CSS vars --tiq-<name>-font/-size/-w/-color. Solo emite las
  // props seteadas. Compartido conceptualmente con el gemelo del widget.
  function vElAVars(name, o) {
    o = o || {};
    return (
      (o.font && o.font !== "heredar" ? `--tiq-${name}-font:${FONTS_BDL[o.font] || "inherit"};` : "") +
      (o.size ? `--tiq-${name}-size:${o.size}px;` : "") +
      (o.weight ? `--tiq-${name}-w:${o.weight};` : "") +
      (o.color ? `--tiq-${name}-color:${o.color};` : "")
    );
  }

  function previewBundleHTML(b, PU = PRECIO_DEMO) {
    const d = b.diseno || {};
    const bot = d.boton || {};
    const vars = disenoAVars(d);

    // Combo: productos apilados con "+" y "Comprar todo en: $total". Botón propio
    // (el combo agrega varios productos → no depende del botón de la página).
    if (b.tipo === "combo") {
      const cprods = (b.combo && b.combo.productos) || [];
      const bruto = cprods.reduce((s, p) => s + Math.round((parseFloat(p.precio) || 0) * 100), 0);
      const dd = (b.combo && b.combo.descuento) || {};
      let total = bruto;
      if (dd.tipo === "porcentaje") total = Math.round(bruto * (1 - (Number(dd.valor) || 0) / 100));
      else if (dd.tipo === "fijo") total = Math.max(0, bruto - Math.round((Number(dd.valor) || 0) * 100));
      const items = cprods.length
        ? cprods.map((p, i) => `
          <div class="tiq-bdl__citem">
            <span class="tiq-bdl__cfoto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : ""}</span>
            <span class="tiq-bdl__cmain"><span class="tiq-bdl__cname">${esc(p.nombre || "Producto")}</span></span>
            <span class="tiq-bdl__cprice">${fmtBdl(Math.round((parseFloat(p.precio) || 0) * 100))}</span>
          </div>${i < cprods.length - 1 ? `<div class="tiq-bdl__cplus">+</div>` : ""}`).join("")
        : `<div class="tiq-bdl__cempty">Agregá productos para ver la vista previa</div>`;
      return `<div class="tiq-bdl tiq-bdl--combo" style="${vars}">
        ${d.mostrar_encabezado !== false && d.titulo ? `<div class="tiq-bdl__head"><div class="tiq-bdl__h1">${esc(d.titulo)}</div></div>` : ""}
        <div class="tiq-bdl__cwrap">${items}</div>
        <div class="tiq-bdl__ctotal">
          ${d.etiqueta ? `<span class="tiq-bdl__cbadge">${esc(d.etiqueta)}</span>` : ""}
          <span class="tiq-bdl__cpie">${esc(d.pie || "Comprar todo en:")}</span>
          <span class="tiq-bdl__ctot">${fmtBdl(total)}</span>
        </div>
        <button class="tiq-bdl__cbtn" type="button" style="background:${esc(bot.color_fondo || "#111")};color:${esc(bot.color_texto || "#fff")};border-radius:${bot.radio != null ? bot.radio : 8}px">${esc((bot.texto || "Agregar al carrito").replace("{total}", fmtBdl(total)))}</button>
      </div>`;
    }

    let cards, totalSel;
    if (b.tipo === "bxgy") {
      const x = b.bxgy || {};
      const compra = Math.max(1, Number(x.compra_cantidad) || 1);
      const regalo = Math.max(1, Number(x.regalo_cantidad) || 1);
      const desc = Math.min(100, Math.max(1, Number(x.regalo_descuento) || 100));
      const bruto = PU * (compra + regalo);
      totalSel = Math.round(PU * compra + PU * regalo * (1 - desc / 100));
      const ahorro = bruto - totalSel;
      const gratis = desc >= 100;
      const titulo = `Comprá ${compra}, llevás ${regalo}${gratis ? " gratis" : " al " + desc + "% off"}`;
      const etq = gratis ? `${compra + regalo}x${compra}` : `${desc}% OFF`;
      cards = `<label class="tiq-bdl__card is-sel is-pop">
        <span class="tiq-bdl__badge tiq-bdl__badge--${formaBadgeBdl(d)}">${gratis ? "Regalo" : "Oferta"}</span>
        <span class="tiq-bdl__radio"></span>
        <span class="tiq-bdl__main">
          <span class="tiq-bdl__titulo">${esc(titulo)} <span class="tiq-bdl__etq">${esc(etq)}</span></span>
          ${d.mostrar_ahorro && ahorro > 0 ? `<span class="tiq-bdl__ahorro">Ahorrás ${fmtBdl(ahorro)}</span>` : ""}
        </span>
        <span class="tiq-bdl__precio">
          <span class="tiq-bdl__precio-now">${fmtBdl(totalSel)}</span>
          <span class="tiq-bdl__precio-old">${fmtBdl(bruto)}</span>
        </span>
      </label>`;
    } else {
      // Solo niveles prendidos (o.activo !== false).
      const activos = (b.ofertas || []).filter((o) => o.activo !== false);
      let predIdx = activos.findIndex((o) => o.predeterminada);
      if (predIdx < 0) predIdx = 0;
      const verF = (o, k) => !o.ver || o.ver[k] !== false;
      cards = activos
        .map((o, i) => {
          const { cant, bruto, total } = totalOfertaBdl(o, PU);
          const ahorro = bruto - total;
          const pct = bruto > 0 ? Math.round((ahorro / bruto) * 100) : 0;
          const puUnit = Math.round(total / cant);
          const etq = verF(o, "etiqueta") ? (o.etiqueta || (total < bruto ? pct + "% OFF" : "")) : "";
          const sub = verF(o, "subtitulo") ? o.subtitulo : "";
          const badge = verF(o, "badge") ? o.badge : "";
          return `<label class="tiq-bdl__card ${i === predIdx ? "is-sel" : ""} ${o.popular ? "is-pop" : ""} ${o.agotado ? "is-agotado" : ""}">
            ${badge ? `<span class="tiq-bdl__badge tiq-bdl__badge--${formaBadgeBdl(d)}">${esc(badge)}</span>` : ""}
            <span class="tiq-bdl__radio"></span>
            ${thumbBdlHTML(o)}
            <span class="tiq-bdl__main">
              <span class="tiq-bdl__titulo">${esc(o.titulo || cant + " unidades")}${etq ? ` <span class="tiq-bdl__etq">${esc(etq)}</span>` : ""}</span>
              ${o.agotado
                ? `<span class="tiq-bdl__sub">${esc(d.avanzado?.oos_on && d.avanzado?.oos_texto ? d.avanzado.oos_texto : "Agotado")}</span>`
                : sub
                  ? `<span class="tiq-bdl__sub">${esc(sub)}</span>`
                  : (d.mostrar_ahorro && ahorro > 0 ? `<span class="tiq-bdl__ahorro">Ahorrás ${fmtBdl(ahorro)}</span>` : "")}
            </span>
            <span class="tiq-bdl__precio">
              <span class="tiq-bdl__precio-now">${fmtBdl(total)}</span>
              ${total < bruto ? `<span class="tiq-bdl__precio-old">${fmtBdl(bruto)}</span>` : ""}
              ${d.avanzado?.precio_por_unidad && cant > 1 ? `<span class="tiq-bdl__unit">${fmtBdl(puUnit)} c/u</span>` : ""}
            </span>
            ${addonsPreviewBdl(o)}
          </label>`;
        })
        .join("");
    }

    return `<div class="tiq-bdl${d.layout?.template === "horizontal" ? " tiq-bdl--horizontal" : ""}" style="${vars}">
      ${d.mostrar_encabezado !== false ? `<div class="tiq-bdl__head">
        ${d.titulo ? `<div class="tiq-bdl__h1">${esc(d.titulo)}</div>` : ""}
        ${d.subtitulo ? `<div class="tiq-bdl__h2">${esc(d.subtitulo)}</div>` : ""}
      </div>` : ""}
      <div class="tiq-bdl__cards">${cards}</div>
      ${buyoptsHTML(d)}
      ${d.avanzado?.pie_on && d.avanzado?.pie_texto ? `<div class="tiq-bdl__foot">${esc(d.avanzado.pie_texto)}</div>` : ""}
      <div class="tiq-bdl__nota">El cliente agrega con el botón de tu página de producto ↓</div>
    </div>`;
  }

  // ---------- guardar / instalar / salir ----------
  // Save Bar contextual de App Bridge (barra nativa de "cambios sin guardar" en
  // el chrome del admin). Fuera del admin embebido (window.shopify ausente) es
  // un no-op silencioso: los botones inline siguen funcionando igual.
  const saveBar = {
    _wired: false,
    _ctx: null,
    _wire() {
      if (this._wired) return;
      this._wired = true;
      const save = $("tiq-sb-save");
      const disc = $("tiq-sb-discard");
      if (save) save.addEventListener("click", () => this._ctx?.onSave?.());
      if (disc) disc.addEventListener("click", () => this._ctx?.onDiscard?.());
    },
    show(ctx) {
      this._ctx = ctx;
      this._wire();
      try { window.shopify?.saveBar?.show("tiq-save-bar"); } catch {}
    },
    hide() {
      this._ctx = null;
      try { window.shopify?.saveBar?.hide("tiq-save-bar"); } catch {}
    },
    guardando(on) {
      const s = $("tiq-sb-save");
      if (s) { s.toggleAttribute("loading", on); }
    }
  };

  function marcarSucioBundles() {
    estado.bundles.sucio = true;
    const b = $("bdl-guardar");
    if (b) { b.removeAttribute("disabled"); b.textContent = "Guardar cambios"; b.setAttribute("variant", "primary"); }
    saveBar.show({ onSave: () => guardarBundles(), onDiscard: () => descartarBundles() });
  }

  const BUNDLES_PENDIENTE = `tiq_bundles_pendiente:${(
    new URLSearchParams(location.search).get("shop") || "local"
  ).toLowerCase()}`;

  function leerBundlesPendientes() {
    try {
      const pending = JSON.parse(localStorage.getItem(BUNDLES_PENDIENTE) || "null");
      return pending?.requestId ? pending : null;
    } catch {
      return null;
    }
  }

  function guardarBundlesPendientes(pending) {
    localStorage.setItem(BUNDLES_PENDIENTE, JSON.stringify(pending));
  }

  function limpiarBundlesPendientes() {
    localStorage.removeItem(BUNDLES_PENDIENTE);
  }

  async function resolverBundlesPendientes(pending = leerBundlesPendientes(), onUpdate = () => {}) {
    if (!pending) return null;
    try {
      if (!pending.jobId) {
        const { job } = await api("/bundles", {
          method: "PUT",
          body: {
            config: pending.config,
            request_id: pending.requestId,
            expected_version: pending.expectedVersion
          }
        });
        pending.jobId = job.id;
        guardarBundlesPendientes(pending);
      }
      const completed = await esperarJob(pending.jobId, { timeoutMs: 3 * 60 * 1000, onUpdate });
      const config = completed.result?.config || await api("/bundles");
      limpiarBundlesPendientes();
      return config;
    } catch (error) {
      // Los timeouts conservan toda la intención para reanudar exactamente el
      // mismo job. Solo descartamos el marcador ante un resultado definitivo o
      // cuando el servidor demuestra que esta intención no puede continuar.
      if (error.terminal || [404, 409, 423].includes(error.status)) {
        limpiarBundlesPendientes();
      }
      throw error;
    }
  }

  // Descartar: vuelve a la última versión guardada en el server y repinta.
  async function descartarBundles() {
    try {
      estado.bundles.config = await api("/bundles");
      estado.bundles.sucio = false;
      saveBar.hide();
      pintarEditorBundle();
    } catch (e) {
      vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} No se pudo descartar: ${esc(e.message)}</div>`);
    }
  }

  async function guardarBundles() {
    const b = $("bdl-guardar");
    if (b) { b.setAttribute("disabled", ""); b.textContent = "Guardando…"; }
    saveBar.guardando(true);
    try {
      let pending = leerBundlesPendientes();
      if (!pending) {
        pending = {
          requestId: crypto.randomUUID(),
          expectedVersion: Math.max(0, Number(estado.bundles.config.version) || 0),
          config: JSON.parse(JSON.stringify(estado.bundles.config))
        };
        // Se persiste antes del request: incluso una respuesta perdida puede
        // recuperarse sin repetir descuentos en Shopify.
        guardarBundlesPendientes(pending);
      }
      estado.bundles.config = await resolverBundlesPendientes(pending, (job) => {
        if (b) b.textContent = job.status === "running" ? "Sincronizando con Shopify…" : "En cola…";
      });
      estado.bundles.sucio = false;
      if (b) { b.removeAttribute("disabled"); b.textContent = "Guardado"; b.setAttribute("variant", "secondary"); }
      saveBar.guardando(false);
      saveBar.hide();
      return true;
    } catch (e) {
      if (b) { b.removeAttribute("disabled"); b.textContent = "Guardar cambios"; }
      saveBar.guardando(false);
      let sync = null;
      if (e.terminal || e.status === 409) {
        try {
          estado.bundles.config = await api("/bundles");
          sync = estado.bundles.config.sync || null;
        } catch {}
      }
      if (sync?.status === "manual_review") {
        estado.bundles.sucio = false;
        saveBar.hide();
        vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} Shopify no confirmó el resultado. La tienda conserva la última versión verificada. No vuelvas a guardar hasta que soporte reconcilie los descuentos.</div>`);
      } else if (e.status === 409 || (e.terminal && !sync)) {
        estado.bundles.sucio = false;
        saveBar.hide();
        vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} La configuración cambió en otra sesión. Cargamos la versión más reciente para evitar sobrescribirla.</div>`);
      } else {
        estado.bundles.sucio = true;
        vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} No se aplicaron los cambios: ${esc(sync?.error || e.message)}. La tienda conserva la versión anterior.</div>`);
      }
      return false;
    }
  }

  // Ya no inyecta código en el tema: marca "publicado" y abre el editor de temas
  // en la sección "App embeds" para que el merchant prenda el widget (una vez).
  async function instalarBundlesTema() {
    if ((estado.bundles.sucio || leerBundlesPendientes()) && !(await guardarBundles())) return;
    const b = $("bdl-instalar");
    if (b) { b.disabled = true; b.textContent = "Abriendo…"; }
    try {
      estado.bundles.config = await api("/bundles/instalar", { method: "POST" });
      if (estado.bundles.config.activarUrl) window.open(estado.bundles.config.activarUrl, "_blank", "noopener");
      pintarDashboardBundles();
    } catch (e) {
      if (b) { b.disabled = false; b.textContent = "Activá el widget"; }
      vista.insertAdjacentHTML("afterbegin", `<div class="error">${ico("x","ico--banner")} ${esc(e.message)}</div>`);
    }
  }

  function salirBundles() {
    if (estado.bundles?.sucio && !confirm("Hay cambios sin guardar. ¿Salir igual?")) return;
    estado.bundles.vista = "lista";
    estado.bundles.sucio = false;
    saveBar.hide();
    pintarDashboardBundles();
  }

  // ---------- inspírate de los mejores ----------
  //
  // Galería de videos de venta orgánica (TikToks) guardados en una carpeta del
  // server. El nombre del archivo trae las métricas (vistas.likes.comentarios),
  // que el server parsea y acá se ordenan de mayor a menor y viceversa.

  // Íconos de línea (estilo feather, grandes y claros) para las 3 métricas.
  // Trazo grueso (2.3) a propósito: el usuario rechazó las líneas/letras finas
  // por verse poco maduras. Íconos macizos, no de una línea delgada.
  const ICO_INSP = {
    vistas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
    likes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.3l-1.4-1.3C5.4 14.3 2.5 11.6 2.5 8.4 2.5 6 4.4 4 6.9 4c1.5 0 2.9.7 3.8 1.8l.3.4.3-.4A5 5 0 0 1 15.1 4c2.5 0 4.4 2 4.4 4.4 0 3.2-2.9 5.9-8.1 10.6z"/></svg>`,
    comentarios: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/></svg>`,
    abajo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>`,
    arriba: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`
  };

  // 2.400.000 → "2,4 M"; 46.100 → "46,1 K"; 224 → "224". Coma decimal (es).
  function fmtNum(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "").replace(".", ",") + " M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "").replace(".", ",") + " K";
    return String(n);
  }

  // Filtro reconstruido: 2 ejes separados (métrica × dirección), no un select
  // de 6 opciones planas. La métrica se elige con botones segmentados; la
  // dirección con un toggle. Estos mapas alimentan el subtítulo-lente en prosa.
  const METRICAS = [
    ["vistas", "Vistas", "vistas"],
    ["likes", "Likes", "likes"],
    ["comentarios", "Comentarios", "comentarios"]
  ];
  const DIR_PROSA = { desc: "de mayor a menor", asc: "de menor a mayor" };
  const DIR_ETQ = { desc: "Mayor a menor", asc: "Menor a mayor" };

  async function pantallaInspiracion() {
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Cargando inspiración…</h2></div>`;
    let videos = [];
    try {
      videos = await api("/inspiracion");
    } catch (e) {
      vista.innerHTML = `<div class="error">${ico("x", "ico--banner")} No se pudo leer la carpeta de videos: ${esc(e.message)}</div>`;
      return;
    }
    if (estado.pantalla !== "inspiracion") return; // navegó mientras cargaba
    estado.inspiracion = { videos, orden: estado.inspiracion?.orden || "vistas-desc" };
    pintarInspiracion();
  }

  function pintarInspiracion() {
    const { videos, orden } = estado.inspiracion;
    const [clave, dir] = orden.split("-");
    const lista = [...videos].sort((a, b) => (dir === "desc" ? b[clave] - a[clave] : a[clave] - b[clave]));

    // El orden es un lente: cambia qué métrica manda. La activa se resalta en
    // cada card (fuerte + ícono en color de acento); las otras dos, subdued.
    const STATS = [
      ["vistas", "Vistas", ICO_INSP.vistas],
      ["likes", "Likes", ICO_INSP.likes],
      ["comentarios", "Comentarios", ICO_INSP.comentarios]
    ];
    // Superlativo del destacado según el lente activo (honesto en asc: es el #1
    // de ESE orden, aunque sea el de menor rendimiento).
    const SUPERLATIVO = {
      "vistas-desc": "El más visto", "vistas-asc": "El menos visto",
      "likes-desc": "El más gustado", "likes-asc": "El menos gustado",
      "comentarios-desc": "El más comentado", "comentarios-asc": "El menos comentado"
    };
    const gana = dir === "desc"; // solo coronamos en "Más …" (top real)
    const claveLabel = METRICAS.find(([k]) => k === clave)[1]; // "Vistas"
    const claveProsa = METRICAS.find(([k]) => k === clave)[2]; // "vistas"

    const vid = (v) =>
      `<video src="${esc(v.url)}${v.poster ? "" : "#t=0.1"}"${v.poster ? ` poster="${esc(v.poster)}"` : ""} preload="${v.poster ? "none" : "metadata"}" muted playsinline loop></video>`;
    const fila = (v, cls = "") =>
      `<div class="insp-stats${cls}">${STATS.map(([k, etq, svg]) => {
        const on = k === clave;
        return `<span class="insp-stat${on ? " insp-stat--on" : ""}" title="${etq}">${svg}<s-text type="strong"${on ? "" : ' color="subdued"'}>${fmtNum(v[k])}</s-text></span>`;
      }).join("")}</div>`;

    const top = lista[0];
    const resto = lista.slice(1);

    const hero = top
      ? `<div class="insp-hero${gana ? " is-win" : ""}">
           <div class="insp-thumb insp-hero__media" data-src="${esc(top.url)}">
             <span class="insp-rank insp-rank--hero${gana ? " insp-rank--win" : ""}">#1</span>
             ${vid(top)}
             <span class="insp-play">${ICO_INSP.play}</span>
           </div>
           <div class="insp-hero__panel">
             <s-stack direction="block" gap="base">
               <div><s-badge tone="${gana ? "success" : "neutral"}">${SUPERLATIVO[orden]}</s-badge></div>
               <s-box padding="large-100" borderRadius="base" background="subdued">
                 <s-stack direction="block" gap="small-500">
                   <s-text color="subdued">${claveLabel}</s-text>
                   <s-heading>${fmtNum(top[clave])}</s-heading>
                 </s-stack>
               </s-box>
               ${fila(top, " insp-stats--hero")}
             </s-stack>
           </div>
         </div>`
      : "";

    const cards = resto
      .map(
        (v, i) => `
        <div class="insp-card">
          <div class="insp-thumb" data-src="${esc(v.url)}">
            <span class="insp-rank">#${i + 2}</span>
            ${vid(v)}
            <span class="insp-play">${ICO_INSP.play}</span>
          </div>
          ${fila(v)}
        </div>`
      )
      .join("");

    const cuerpo = lista.length
      ? `<div class="insp-wrap" style="--insp-on:${gana ? "#45c26a" : "#202223"}">
           ${hero}
           ${resto.length ? `<div class="insp-grid">${cards}</div>` : ""}
         </div>`
      : `<div class="vacio-panel">
           <div class="vacio-panel__ico">${ico("estrella")}</div>
           <div class="vacio-panel__tit">Todavía no hay videos</div>
           <p>Guardá tus TikToks en la carpeta de inspiración con el nombre en formato <strong>vistas . likes . comentarios</strong> (ej. <strong>2400000 . 28300 . 224.mp4</strong>) y aparecerán acá ordenados por rendimiento.</p>
         </div>`;

    // Subtítulo-lente (signature): prosa viva que se reescribe con el estado
    // activo del filtro. Sin conteo (el usuario lo pidió). EXCEPCIÓN a la regla
    // "solo tipografía nativa": s-heading/s-text de Polaris quedan clavados en
    // 13px (verificado: ni nivel ni size los agranda) y el usuario rechazó ese
    // tamaño por "fino y chico/ilegible" → se estila a escala de heading real
    // (17px/700) con .insp-lente.
    const subtitulo = lista.length
      ? `Videos de venta orgánica, rankeados por ${claveProsa}, ${DIR_PROSA[dir]}.`
      : "";

    // Filtro reconstruido: eje MÉTRICA = botones segmentados (activo sólido);
    // eje DIRECCIÓN = un toggle con flecha SVG + texto. Ancho al contenido.
    const seg = METRICAS
      .map(([k, etq]) => `<s-button variant="${k === clave ? "primary" : "secondary"}" data-metrica="${k}">${etq}</s-button>`)
      .join("");
    const filtro = lista.length
      ? `<div class="insp-filtro">
           <div class="insp-filtro__eje">
             <s-text color="subdued" class="insp-filtro__etq">Ordenar por</s-text>
             <div class="insp-seg">${seg}</div>
           </div>
           <s-button variant="secondary" id="insp-dir" class="insp-dir" data-dir="${dir}"><span class="insp-dir__ico">${dir === "desc" ? ICO_INSP.abajo : ICO_INSP.arriba}</span>${DIR_ETQ[dir]}</s-button>
         </div>`
      : "";

    vista.innerHTML = `
      <style>
        /* Gotcha del proyecto: las variables :root (--suave, --negro, --borde…)
           NO cruzan el shadow boundary de s-section/s-stack — dentro de este
           subtree hay que usar los valores literales de los tokens. --insp-on
           sí funciona porque se define inline en .insp-wrap (ya dentro).
           Estética: macizo, no fino — superficies rellenas en vez de hairlines,
           tipografía y rank contundentes (feedback del usuario: sin líneas/
           letras finas). */
        /* Esta sección usa casi todo el ancho (pedido del usuario). Sube el tope
           de #vista SOLO mientras esta pantalla está montada (se revierte al
           navegar, porque el <style> vive en el innerHTML de la pantalla). El
           default global es 1240px en app.css. */
        #vista{max-width:1600px}
        .insp-wrap{display:flex;flex-direction:column;gap:28px}
        /* Subtítulo-lente: Polaris no da headings >13px, y el usuario pidió algo
           legible y con peso. Escala de heading real, color literal (los tokens
           :root no cruzan el shadow boundary de s-section). */
        .insp-lente{font-size:17px;font-weight:700;color:#202223;letter-spacing:-.2px;line-height:1.35;margin:0}
        /* Filtro: 2 ejes separados, ancho al contenido (NUNCA full-width). */
        .insp-filtro{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
        .insp-filtro__eje{display:flex;align-items:center;gap:8px;min-width:0}
        .insp-filtro__etq{flex:none}
        .insp-seg{display:flex;gap:6px;flex-wrap:wrap}
        .insp-dir{display:inline-flex}
        .insp-dir svg{width:17px;height:17px}
        .insp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:22px}
        .insp-card{display:flex;flex-direction:column;gap:11px;min-width:0}
        .insp-thumb{position:relative;aspect-ratio:9/16;background:#0b0b0b;border-radius:16px;overflow:hidden;cursor:pointer}
        .insp-thumb video{width:100%;height:100%;object-fit:cover;display:block;background:#0b0b0b}
        .insp-thumb::after{content:"";position:absolute;inset:auto 0 0 0;height:42%;background:linear-gradient(180deg,transparent,rgba(0,0,0,.55));pointer-events:none}
        .insp-thumb:focus-visible{outline:3px solid #005bd3;outline-offset:2px}
        /* Afordancia de "tocá para ver con sonido". Se oculta en hover (desktop),
           cuando ya corre el preview mudo; en touch (sin hover) queda visible. */
        .insp-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2;width:56px;height:56px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,.5);color:#fff;pointer-events:none;transition:opacity .15s ease}
        .insp-play svg{width:26px;height:26px;margin-left:3px}
        .insp-thumb:hover .insp-play{opacity:0}
        @media(hover:none){.insp-thumb:hover .insp-play{opacity:1}}
        /* Lightbox: overlay a pantalla completa, video 9:16 con controles+sonido. */
        .insp-lb{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.85);padding:24px}
        .insp-lb__marco{position:relative;height:min(88vh,760px);aspect-ratio:9/16;max-width:94vw;background:#000;border-radius:16px;overflow:hidden;box-shadow:0 16px 60px rgba(0,0,0,.55)}
        .insp-lb__marco video{width:100%;height:100%;object-fit:contain;background:#000;display:block}
        .insp-lb__cerrar{position:absolute;top:12px;right:12px;z-index:2;width:42px;height:42px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;cursor:pointer}
        .insp-lb__cerrar:hover{background:rgba(0,0,0,.78)}
        .insp-lb__cerrar:focus-visible{outline:3px solid #fff;outline-offset:2px}
        .insp-lb__cerrar svg{width:22px;height:22px}
        /* Rank: chip macizo, peso 800, número tabular. Nada endeble. */
        .insp-rank{position:absolute;top:10px;left:10px;z-index:2;background:rgba(0,0,0,.78);color:#fff;font-size:13px;font-weight:800;line-height:1;letter-spacing:-.2px;font-variant-numeric:tabular-nums;padding:6px 10px;border-radius:10px}
        .insp-rank--hero{top:14px;left:14px;font-size:16px;padding:8px 13px}
        .insp-rank--win{background:#2f9e58}
        .insp-stats{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 1px}
        .insp-stat{display:inline-flex;align-items:center;gap:6px;color:#6d7175;font-variant-numeric:tabular-nums}
        .insp-stat--on{color:var(--insp-on)}
        .insp-stat svg{width:20px;height:20px;flex:none}
        /* Destacado: superficie RELLENA (no hairline). El verde de marca
           (crecimiento orgánico) solo corona un top real (desc). */
        .insp-hero{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:32px;align-items:center;padding:28px;border-radius:20px;background:#f1f2f4}
        .insp-hero.is-win{background:linear-gradient(135deg,#e3f6ea,#f1f8f3)}
        .insp-hero__media{max-width:300px;width:100%}
        .insp-hero__panel{min-width:0}
        .insp-stats--hero{justify-content:flex-start;gap:24px;padding:0}
        @media(max-width:640px){
          .insp-hero{grid-template-columns:1fr;gap:18px;padding:16px}
          .insp-hero__media{max-width:210px;margin:0 auto}
        }
      </style>
      <s-page heading="Inspírate de los mejores" inlineSize="large">
        <s-section>
          <s-stack direction="block" gap="large">
            ${subtitulo ? `<div class="insp-lente">${subtitulo}</div>` : ""}
            ${filtro}
            ${cuerpo}
          </s-stack>
        </s-section>
      </s-page>`;

    // Filtro: elegir métrica conserva la dirección; el toggle invierte la
    // dirección conservando la métrica. Ambos re-renderizan (re-corona + relente).
    const reordenar = (nuevo) => { estado.inspiracion.orden = nuevo; pintarInspiracion(); };
    vista.querySelectorAll("[data-metrica]").forEach((b) => {
      b.addEventListener("click", () => reordenar(`${b.dataset.metrica}-${dir}`));
    });
    const btnDir = $("insp-dir");
    if (btnDir) btnDir.addEventListener("click", () => reordenar(`${clave}-${dir === "desc" ? "asc" : "desc"}`));

    // Lightbox: clic/Enter en un thumb → abre el video en grande CON sonido.
    // (El preview del hover es mudo; acá se despliega con volumen y controles.)
    // El overlay se monta en <body> para escapar del recorte del s-page.
    const abrirVideo = (url, poster) => {
      if (!url) return;
      const lb = document.createElement("div");
      lb.className = "insp-lb";
      lb.setAttribute("role", "dialog");
      lb.setAttribute("aria-modal", "true");
      lb.setAttribute("aria-label", "Video de venta orgánica");
      lb.innerHTML = `
        <div class="insp-lb__marco">
          <button type="button" class="insp-lb__cerrar" aria-label="Cerrar">${ico("x")}</button>
          <video src="${esc(url)}"${poster ? ` poster="${esc(poster)}"` : ""} controls autoplay playsinline></video>
        </div>`;
      const prevOverflow = document.body.style.overflow;
      const cerrar = () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = prevOverflow;
        lb.remove();
      };
      const onKey = (e) => { if (e.key === "Escape") cerrar(); };
      lb.addEventListener("click", (e) => { if (e.target === lb) cerrar(); }); // fondo
      lb.querySelector(".insp-lb__cerrar").addEventListener("click", cerrar);
      document.addEventListener("keydown", onKey);
      document.body.style.overflow = "hidden";
      document.body.appendChild(lb);
      const video = lb.querySelector("video");
      video.muted = false;
      video.volume = 1;
      video.play().catch(() => {}); // gesto del usuario → permite sonido
      lb.querySelector(".insp-lb__cerrar").focus();
    };

    // Thumbnail sin negro: al cargar metadata se hace seek a un frame real.
    // Hover = preview mudo; salir = pausar. Reduced-motion: sin autoplay al hover.
    const menosMovimiento = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    vista.querySelectorAll(".insp-thumb").forEach((t) => {
      const v = t.querySelector("video");
      const alFrame = () => { try { if (v.currentTime < 0.1) v.currentTime = 0.1; } catch {} };
      v.addEventListener("loadeddata", alFrame, { once: true });
      // Ahora el thumb ES un control real (abre el video) → focusable + teclado.
      t.tabIndex = 0;
      t.setAttribute("role", "button");
      t.setAttribute("aria-label", "Reproducir video con sonido");
      const abrir = () => abrirVideo(t.dataset.src, v.getAttribute("poster"));
      t.addEventListener("click", abrir);
      t.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
      });
      if (menosMovimiento) return;
      t.addEventListener("mouseenter", () => { v.play().catch(() => {}); });
      t.addEventListener("mouseleave", () => { v.pause(); alFrame(); });
    });
  }

  // ---------- ruteo ----------

  const PANTALLAS = {
    inicio: pantallaInicio,
    paginas: pantallaPaginas,
    bundles: pantallaBundles,
    lista: pantallaLista,
    informacion: pantallaInformacion,
    plantillas: pantallaPlantillas,
    generando: pantallaGenerando,
    preview: pantallaPreview,
    inspiracion: pantallaInspiracion
  };

  // Título nativo del admin (App Bridge ui-title-bar). Fuera del admin embebido
  // es inofensivo: el elemento no muestra nada. El título in-page sigue estando
  // (y en las pantallas de nav se oculta por CSS cuando .embebida, para no
  // duplicarlo con el header nativo).
  const TITULO_PANTALLA = {
    inicio: "Inicio",
    paginas: "Páginas de producto",
    bundles: "Bundles, upsells y regalos",
    lista: "Elegí un producto",
    informacion: "Información del producto",
    plantillas: "Plantillas",
    generando: "Creando tu página",
    preview: "Editor de página",
    inspiracion: "Inspírate de los mejores"
  };
  const _tituloBar = document.getElementById("tiq-title-bar");
  function setTituloBar(pantalla) {
    if (_tituloBar) _tituloBar.setAttribute("title", TITULO_PANTALLA[pantalla] || "TiendaIQ");
  }

  // La URL del iframe refleja la pantalla. Sin esto, el menú del admin no
  // puede navegar: si la app queda siempre en "/", tocar "TiendaIQ" desde
  // el flujo es "navegar a donde ya estás" y Shopify no hace nada.
  function sincronizarURL(pantalla) {
    const ruta =
      pantalla === "paginas" ? "/paginas"
      : pantalla === "bundles" ? "/bundles"
      : pantalla === "inspiracion" ? "/inspiracion"
      : pantalla === "inicio" ? "/" : "/crear";
    if (location.pathname !== ruta) {
      history.pushState({ pantalla }, "", ruta + location.search);
    }
  }

  function ir(pantalla) {
    // Entrar a Bundles desde el menú/nav siempre lleva al dashboard (no deja
    // pegado el editor de un bundle que se estaba viendo antes).
    if (pantalla === "bundles" && estado.bundles) { estado.bundles.vista = "lista"; estado.bundles.editIdx = null; }
    estado.pantalla = pantalla;
    document.body.classList.toggle("tiq-v2-home-active", pantalla === "inicio");
    sincronizarURL(pantalla);
    setTituloBar(pantalla);
    pintarPasos();
    PANTALLAS[pantalla]();
    window.scrollTo(0, 0);
    // A11y SPA: al cambiar de pantalla el foco se lleva al <main> (landmark),
    // así el teclado y el lector de pantalla entran al contenido nuevo en vez
    // de quedar en el control anterior. tabindex=-1 = enfocable por script sin
    // meterlo en el orden de tabulación; el ring se apaga por CSS (#vista:focus).
    vista.setAttribute("tabindex", "-1");
    vista.focus({ preventScroll: true });
  }

  async function cargarLista() {
    estado.volverA = "lista";
    estado.pantalla = "lista";
    pintarPasos();
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Leyendo tu tienda…</h2></div>`;
    try {
      estado.productos = await api("/productos");
      ir("lista");
    } catch (e) {
      vista.innerHTML = `<div class="error">${ico("x","ico--banner")} No se pudo leer la tienda: ${esc(e.message)}</div>`;
    }
  }

  // La marca del header (solo fuera del admin) vuelve al inicio.
  const marca = document.querySelector(".barra__marca");
  if (marca) {
    marca.style.cursor = "pointer";
    marca.onclick = () => ir("inicio");
  }

  // Ruteo por URL: el menú lateral del admin navega por estas rutas.
  async function rutear() {
    if (await recuperarGeneracionPendiente()) return;
    const ruta = location.pathname.replace(/\/$/, "");
    if (ruta === "/paginas") ir("paginas");
    else if (ruta === "/bundles") ir("bundles");
    else if (ruta === "/inspiracion") ir("inspiracion");
    else if (ruta === "/crear") cargarLista();
    else ir("inicio");
  }
  window.addEventListener("popstate", rutear);
  rutear();
})();
