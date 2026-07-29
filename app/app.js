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
    cod: null, // { config, tab, sucio } de la pantalla COD
    bundles: null, // { config, vista, editIdx, tab, sucio } de la pantalla Bundles
    error: null
  };

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
      e.reinstalar = cuerpo.reinstalar;
      e.actualizar = cuerpo.actualizar || r.status === 402;
      throw e;
    }
    return cuerpo;
  }

  // Cupo agotado → llevar al merchant a confirmar la suscripción en Shopify.
  async function irASuscripcion() {
    const { url } = await api("/plan/suscribir", { method: "POST" });
    // La confirmación de Shopify no puede vivir en el iframe: ventana top.
    (window.top || window).location.href = url;
  }

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  // ---------- barra de pasos ----------

  function pintarPasos() {
    const cont = $("pasos");
    // El stepper es SOLO del flujo de creación. En el resto (inicio, tabla,
    // COD, bundles) no va: son paneles, no un asistente por pasos.
    if (!["lista", "informacion", "generando", "preview"].includes(estado.pantalla)) {
      cont.innerHTML = "";
      return;
    }
    const pasos = [
      { id: "lista", texto: "Elegir producto" },
      { id: "informacion", texto: "Información" },
      { id: "preview", texto: "Publicar" }
    ];
    const actual = estado.pantalla === "generando" ? "informacion" : estado.pantalla;
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
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Leyendo tu tienda…</h2></div>`;
    try {
      // COD y bundles son para los "primeros pasos": si fallan, la home igual
      // se dibuja (por eso el catch por separado, no dentro del Promise.all).
      const [plan, paginas, cod, bundles] = await Promise.all([
        api("/plan"),
        api("/paginas"),
        api("/cod").catch(() => null),
        api("/bundles").catch(() => null)
      ]);
      estado.plan = plan;
      estado.paginas = paginas;
      estado.inicioCod = cod;
      estado.inicioBundles = bundles;
    } catch (e) {
      vista.innerHTML = `<div class="error">✖ No se pudo leer la tienda: ${esc(e.message)}</div>`;
      return;
    }
    if (estado.pantalla !== "inicio") return; // navegó mientras cargaba

    const plan = estado.plan;
    const creadas = estado.paginas.length;
    const publicadas = estado.paginas.filter((p) => p.estado === "publicada").length;

    // Un paso está "hecho" cuando la feature quedó realmente andando en la
    // tienda: configurada Y activa/inyectada. Configurarla sin inyectarla no
    // le sirve de nada al merchant, así que no cuenta.
    const codListo = !!(estado.inicioCod?.activo && estado.inicioCod?.instalado);
    const bundlesListo = !!(
      estado.inicioBundles?.instalado && (estado.inicioBundles?.lista || []).some((b) => b.activo !== false)
    );

    const TOTAL_PASOS = 4;
    const hechos =
      (creadas > 0 ? 1 : 0) + (publicadas > 0 ? 1 : 0) + (codListo ? 1 : 0) + (bundlesListo ? 1 : 0);
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
      cod: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6.5" width="19" height="11" rx="2"/><circle cx="12" cy="12" r="2.4"/><path d="M6 10v4M18 10v4"/></svg>`,
      bundle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/></svg>`
    };

    // Check que se posa sobre el ícono cuando el paso ya está hecho: el estado
    // lo comunica el propio ícono, no solo el chip de abajo.
    const IC_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;

    const pasoCard = (icono, titulo, texto, hecho, cola, tinte) => `
      <article class="paso-card paso-card--${tinte} ${hecho ? "is-hecho" : ""}">
        <div class="paso-card__icono">${icono}${hecho ? `<span class="paso-card__check">${IC_CHECK}</span>` : ""}</div>
        <div class="paso-card__titulo">${titulo}</div>
        <p class="paso-card__texto">${texto}</p>
        <div class="paso-card__cola">${cola}</div>
      </article>`;

    // Tiles de métrica al estilo PagePilot: ícono + label arriba, valor
    // grande abajo alineado con el label.
    const ICONO_METRICA = {
      pagina: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8.5h6M9 12h6M9 15.5h4"/></svg>`,
      check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.4 2.4 4.6-5.4"/></svg>`,
      lapiz: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.7 3.8l3.5 3.5L7.5 20H4v-3.5z"/><path d="M14.5 6l3.5 3.5"/></svg>`,
      estrella: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.5 5.4 5.9.7-4.4 4 1.2 5.9L12 16.6l-5.2 2.9 1.2-5.9-4.4-4 5.9-.7z"/></svg>`
    };

    const metrica = (icono, nombre, valor, tinte) => `
      <div class="metrica ${tinte ? "metrica--" + tinte : ""}">
        <div class="metrica__fila">
          <span class="metrica__icono">${icono}</span>
          <span class="metrica__nombre">${nombre}</span>
        </div>
        <div class="metrica__valor">${valor}</div>
      </div>`;

    // Iconos de los botones de la cabecera (SVG de línea, no glyphs).
    const IC_PAGINAS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8.5h6M9 12h6M9 15.5h4"/></svg>`;

    // Últimas páginas publicadas: dato REAL de la DB. Solo se muestra la sección
    // si hay algo que mostrar — nada de listas vacías ni de embudos en cero.
    const publicadasLista = estado.paginas.filter((p) => p.estado === "publicada");

    vista.innerHTML = `
      <div class="inicio-cabecera">
        <div>
          <h1>Bienvenido a TiendaIQ</h1>
          <p class="inicio-cabecera__sub">Generá páginas de producto con IA, cobrá contra reembolso y armá descuentos por volumen — todo desde acá.</p>
        </div>
        <div class="inicio-cabecera__acciones">
          <button class="btn btn--fantasma" id="ir-paginas">${IC_PAGINAS} Ver mis páginas</button>
          <button class="btn btn--marca" id="ir-crear">${ICONO_PASO.chispa} Crear página con IA</button>
        </div>
      </div>

      ${
        sinCupo
          ? `<div class="banner-plan">
               <span class="banner-plan__icono">!</span>
               <span class="banner-plan__texto">Necesitás una <strong>suscripción activa</strong> para crear más páginas de producto.</span>
               <button class="btn btn--chico" id="ir-plan">Actualizar plan</button>
             </div>`
          : ""
      }

      <section class="tarjeta">
        <div class="panel__cabecera">
          <div>
            <div class="tarjeta__titulo">Primeros pasos</div>
            <div class="panel__sub">Completá estos pasos para empezar a vender con TiendaIQ</div>
          </div>
          <div class="progreso">
            <span>${hechos} de ${TOTAL_PASOS} completado${hechos === 1 ? "" : "s"}</span>
            <div class="progreso__barra"><div style="width:${(hechos / TOTAL_PASOS) * 100}%"></div></div>
          </div>
        </div>
        <div class="pasos-grilla">
          ${pasoCard(
            ICONO_PASO.chispa,
            "Crear página de producto",
            "Generá tu primera página de producto con IA.",
            creadas > 0,
            creadas
              ? `<span class="chip-estado chip-estado--ok">Completado</span>`
              : `<button class="btn btn--chico" id="paso-crear">Crear página</button>`,
            "violeta"
          )}
          ${pasoCard(
            ICONO_PASO.publicar,
            "Publicar en la tienda",
            "Publicá una página de producto en tu tienda.",
            publicadas > 0,
            publicadas
              ? `<span class="chip-estado chip-estado--ok">Completado</span>`
              : `<button class="btn btn--chico" id="paso-publicar">Publicar página</button>`,
            "verde"
          )}
          ${pasoCard(
            ICONO_PASO.cod,
            "Activar el pago contra reembolso",
            "Que tus clientes pidan y paguen al recibir.",
            codListo,
            codListo
              ? `<span class="chip-estado chip-estado--ok">Completado</span>`
              : `<button class="btn btn--chico" id="paso-cod">${estado.inicioCod?.instalado ? "Prender el formulario" : "Configurar COD"}</button>`,
            "naranja"
          )}
          ${pasoCard(
            ICONO_PASO.bundle,
            "Crear tu primer bundle",
            "Descuentos por volumen para subir el valor del pedido.",
            bundlesListo,
            bundlesListo
              ? `<span class="chip-estado chip-estado--ok">Completado</span>`
              : `<button class="btn btn--chico" id="paso-bundles">${(estado.inicioBundles?.lista || []).length ? "Inyectar en el tema" : "Crear bundle"}</button>`,
            "azul"
          )}
        </div>
      </section>

      <section class="tarjeta">
        <div class="tarjeta__titulo">Tus números</div>
        <div class="panel__sub">Sincronizado con tu tienda, en tiempo real</div>
        <div class="metricas">
          ${metrica(ICONO_METRICA.pagina, "Páginas creadas", creadas, "violeta")}
          ${metrica(ICONO_METRICA.check, "Publicadas", publicadas, "verde")}
          ${metrica(ICONO_METRICA.lapiz, "Borradores", creadas - publicadas)}
          ${metrica(ICONO_PASO.bundle, "Bundles activos", bundlesActivos)}
        </div>

        <div class="plan-medidor ${esPro ? "plan-medidor--pro" : ""} ${!esPro && plan.usadas >= plan.limite ? "is-lleno" : ""}">
          <div class="plan-medidor__info">
            <span class="plan-medidor__nombre">${esPro ? "Plan Pro" : "Plan gratis"}</span>
            <span class="plan-medidor__detalle">${
              esPro
                ? "Páginas de producto ilimitadas."
                : `Usaste <strong>${plan.usadas} de ${plan.limite}</strong> páginas este mes.`
            }</span>
          </div>
          <div class="plan-medidor__barra"><div style="width:${usoPct}%"></div></div>
          ${
            esPro
              ? `<span class="chip-estado chip-estado--ok">Activo</span>`
              : `<button class="btn btn--chico" id="plan-mejorar">Mejorar a Pro</button>`
          }
        </div>
      </section>

      <section class="tarjeta">
        <div class="tarjeta__titulo">Herramientas</div>
        <div class="tarjeta__titulo-sub panel__sub">Lo que TiendaIQ puede hacer por tu tienda.</div>
        <div class="herramientas">
          <div class="herramienta">
            <div class="herramienta__nombre">Páginas de producto con IA</div>
            <p>Elegí un producto y la IA arma la landing completa.</p>
            <button class="btn btn--chico" id="herr-crear">Crear página de producto</button>
            <div class="herramienta__preview herramienta__preview--img">
              <img src="/portadas/portada-paginas.png" alt="Vista previa: página de producto con IA" loading="lazy">
            </div>
          </div>
          <div class="herramienta">
            <div class="herramienta__nombre">Formulario contra reembolso (COD)</div>
            <p>Tus clientes piden y pagan al recibir: el formulario crea el pedido en Shopify.</p>
            <button class="btn btn--chico" id="herr-cod">Configurar COD</button>
            <div class="herramienta__preview herramienta__preview--img">
              <img src="/portadas/portada-cod.png" alt="Vista previa: formulario contra reembolso (COD)" loading="lazy">
            </div>
          </div>
          <div class="herramienta">
            <div class="herramienta__nombre">Bundles y descuentos</div>
            <p>Descuentos por volumen y "comprá X y obtené Y". El precio lo hace cumplir Shopify.</p>
            <button class="btn btn--chico" id="herr-bundles">Crear bundles</button>
            <div class="herramienta__preview herramienta__preview--bdl">
              <div class="tiq-bdl">
                <div class="tiq-bdl__cards">
                  <label class="tiq-bdl__card">
                    <span class="tiq-bdl__radio"></span>
                    <span class="tiq-bdl__main"><span class="tiq-bdl__titulo">Comprá 1</span></span>
                    <span class="tiq-bdl__precio"><span class="tiq-bdl__precio-now">$ 24,99</span></span>
                  </label>
                  <label class="tiq-bdl__card is-sel is-pop">
                    <span class="tiq-bdl__badge">Más elegido</span>
                    <span class="tiq-bdl__radio"></span>
                    <span class="tiq-bdl__main">
                      <span class="tiq-bdl__titulo">Comprá 2 <span class="tiq-bdl__etq">10% OFF</span></span>
                      <span class="tiq-bdl__ahorro">Ahorrás $ 5,00</span>
                    </span>
                    <span class="tiq-bdl__precio">
                      <span class="tiq-bdl__precio-now">$ 44,98</span>
                      <span class="tiq-bdl__precio-old">$ 49,98</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      ${
        publicadasLista.length
          ? `<section class="tarjeta">
               <div class="tarjeta__titulo">Últimas páginas publicadas</div>
               <div class="tarjeta__titulo-sub panel__sub">Están vivas en tu tienda ahora mismo.</div>
               <div class="pub-lista">
                 ${publicadasLista
                   .slice(0, 5)
                   .map(
                     (p) => `
                     <div class="pub-fila">
                       <div class="pub-fila__foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : "🖼"}</div>
                       <div class="pub-fila__titulo">${esc(p.titulo || "Sin título")}</div>
                       ${p.url_publica ? `<a class="pub-fila__link" href="${esc(p.url_publica)}" target="_blank" rel="noopener">Ver en la tienda ↗</a>` : ""}
                     </div>`
                   )
                   .join("")}
               </div>
             </section>`
          : ""
      }

      <div class="ayuda-strip">
        <span class="ayuda-strip__txt">¿Necesitás una mano? Escribinos a <a href="mailto:soporte@tiendaiq.com">soporte@tiendaiq.com</a></span>
        <a class="ayuda-strip__link" href="/terminos" target="_blank" rel="noopener">Términos y privacidad ↗</a>
      </div>`;

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
    // COD y bundles: tanto desde "Herramientas" como desde "Primeros pasos".
    ["herr-cod", "paso-cod"].forEach((id) => {
      const b = $(id);
      if (b) b.onclick = () => ir("cod");
    });
    ["herr-bundles", "paso-bundles"].forEach((id) => {
      const b = $(id);
      if (b) b.onclick = () => ir("bundles");
    });
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
      vista.innerHTML = `<div class="error">✖ No se pudieron leer las páginas: ${esc(e.message)}</div>`;
      return;
    }
    if (estado.pantalla !== "paginas") return;

    const paginas = [...estado.paginas].sort((a, b) =>
      (b.actualizado || "").localeCompare(a.actualizado || "")
    );

    const fila = (p) => `
      <div class="pagina-fila" data-id="${esc(p.id)}">
        <div class="pagina-fila__foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : "🖼"}</div>
        <div class="pagina-fila__info">
          <div class="pagina-fila__titulo">${esc(p.titulo || "Sin título")}</div>
          <div class="pagina-fila__fecha">${esc(fechaCorta(p.actualizado))}</div>
        </div>
        <span class="etiqueta etiqueta--${esc(p.estado)}">${esc(p.estado)}</span>
        ${
          p.url_publica
            ? `<a class="pagina-fila__link" href="${esc(p.url_publica)}" target="_blank">Ver en la tienda</a>`
            : `<span class="pagina-fila__link pagina-fila__link--vacio"></span>`
        }
        <button class="btn btn--fantasma btn--chico" data-editar="${esc(p.id)}">✎ Editar y publicar</button>
      </div>`;

    vista.innerHTML = `
      <div class="inicio-cabecera">
        <h1><button class="volver-flecha" id="volver-inicio">←</button> Páginas de producto</h1>
        <div class="inicio-cabecera__acciones">
          <button class="btn btn--marca" id="ir-crear">✦ Crear página de producto con IA</button>
        </div>
      </div>

      <div class="tarjeta">
        <div class="tarjeta__titulo">Páginas de producto</div>
        <div class="panel__sub">Administrá tus páginas de producto generadas por IA</div>
        ${
          paginas.length
            ? `<div class="pagina-tabla">
                 <div class="pagina-tabla__cabecera">
                   <span></span><span>Producto</span><span>Estado</span><span>Tienda</span><span></span>
                 </div>
                 ${paginas.map(fila).join("")}
               </div>`
            : `<div class="vacio">
                 Todavía no generaste ninguna página.<br><br>
                 <button class="btn" id="vacio-crear">✦ Crear página de producto con IA</button>
               </div>`
        }
      </div>`;

    $("volver-inicio").onclick = () => ir("inicio");
    const crear = $("ir-crear") || $("vacio-crear");
    if (crear) crear.onclick = () => cargarLista();
    const vacioCrear = $("vacio-crear");
    if (vacioCrear) vacioCrear.onclick = () => cargarLista();
    vista.querySelectorAll("[data-editar]").forEach((b) => {
      b.onclick = () => abrirDesdeTabla(b.dataset.editar);
    });
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
        vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ ${esc(e.message)}</div>`)
      );
    }
  }

  // ---------- 0c. formulario COD (pago contra reembolso) ----------
  //
  // Página especializada, estilo Releasit: el merchant configura el botón,
  // los campos, las tarifas y las ofertas; "Inyectar en el tema" sube el
  // script a su tienda. El preview usa EL MISMO js/css que la tienda
  // (window.TiendaIQCOD), así lo que se ve acá es lo que ve el cliente.

  const DEMO_COD_BASE = {
    titulo: "Producto de ejemplo",
    imagen: null,
    moneda: "USD",
    variantes: [{ id: 1, titulo: "Default", precio: 3999, disponible: true }]
  };

  // Producto del preview de COD: el elegido en el selector o el de ejemplo.
  // Se moldea a la forma que espera window.TiendaIQCOD.armarModal.
  function productoDemoCod() {
    const id = estado.cod?.previewProd;
    const p = id ? (estado.productos || []).find((x) => x.id === id) : null;
    if (!p) return DEMO_COD_BASE;
    const cents = p.precio != null ? Math.round(parseFloat(p.precio) * 100) : DEMO_COD_BASE.variantes[0].precio;
    return {
      titulo: p.titulo,
      imagen: p.imagen || null,
      moneda: "USD",
      variantes: [{ id: 1, titulo: "Default", precio: cents, disponible: true }]
    };
  }

  // Barra "Producto de prueba: [select]" — siempre visible en /cod para que
  // el preview (form inline y tarjeta) use un producto real de la tienda.
  function barraProductoPreviewCod() {
    const prods = estado.productos || [];
    if (!prods.length) return "";
    const opciones =
      `<option value="">Producto de ejemplo</option>` +
      prods.map((p) => `<option value="${esc(p.id)}" ${estado.cod.previewProd === p.id ? "selected" : ""}>${esc(p.titulo)}</option>`).join("");
    return `<div class="cod-prodbar"><label>Producto de prueba en la vista previa</label><select id="cod-preview-prod">${opciones}</select></div>`;
  }

  async function pantallaCod() {
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Leyendo la configuración…</h2></div>`;
    try {
      estado.cod = { config: await api("/cod"), tab: estado.cod?.tab || "vista", sucio: false, previewProd: estado.cod?.previewProd || null };
    } catch (e) {
      vista.innerHTML = `<div class="error">✖ No se pudo leer la configuración: ${esc(e.message)}</div>`;
      return;
    }
    if (estado.pantalla !== "cod") return;
    pintarCod();
  }

  const TABS_COD = [
    { id: "vista", texto: "Vista previa" },
    { id: "modo", texto: "Modo edición" },
    { id: "boton", texto: "Botón de compra" },
    { id: "campos", texto: "Campos del formulario" },
    { id: "estilo", texto: "Estilo" },
    { id: "tarifas", texto: "Tarifas de envío" },
    { id: "ofertas", texto: "Ofertas de cantidad" },
    { id: "textos", texto: "Textos" }
  ];

  // Campo genérico atado a una ruta de la config: data-cfg. Al tipear se
  // actualiza la config y el preview; Guardar hace el PUT.
  function campoCod(ruta, etiqueta, tipo = "text", extra = "") {
    const v = leer(estado.cod.config, ruta);
    if (tipo === "color")
      return `<div class="campo campo--editor cod-color"><label>${etiqueta}</label>
        <span class="cod-color__fila"><input type="color" data-cfg="${ruta}" value="${esc(v || "#000000")}">
        <code>${esc(v || "#000000")}</code></span></div>`;
    if (tipo === "check")
      return `<label class="cod-check"><input type="checkbox" data-cfg="${ruta}" data-tipo="bool" ${v ? "checked" : ""}> ${etiqueta}</label>`;
    if (tipo === "numero")
      return `<div class="campo campo--editor"><label>${etiqueta}</label>
        <input type="number" data-cfg="${ruta}" data-tipo="numero" value="${esc(v ?? 0)}" ${extra}></div>`;
    if (tipo === "select")
      return `<div class="campo campo--editor"><label>${etiqueta}</label><select data-cfg="${ruta}">${extra}</select></div>`;
    return `<div class="campo campo--editor"><label>${etiqueta}</label>
      <input type="text" data-cfg="${ruta}" value="${esc(v ?? "")}"></div>`;
  }

  function tabCod() {
    const c = estado.cod.config;
    const op = (val, texto, actual) => `<option value="${val}" ${actual === val ? "selected" : ""}>${texto}</option>`;

    if (estado.cod.tab === "vista")
      return `
        <div class="editor__nota">Así lo ve tu cliente. <strong>Hacé clic sobre los textos</strong> para editarlos acá mismo. Para agregar, mover o configurar piezas, usá <strong>Modo edición</strong>.</div>
        <div class="cod-vista-inline" id="cod-vista"></div>
        <div class="cod-separador"></div>
        <div class="fila-doble-cod">
          ${campoCod("textos.cta", "Botón de enviar — {total} se reemplaza por el total")}
          ${campoCod("textos.subtitulo", "Subtítulo del formulario")}
        </div>`;

    if (estado.cod.tab === "modo")
      return `
        <div class="cod-vista-barra">
          <div class="editor__nota" style="margin:0;flex:1">Hacé clic en cualquier pieza para seleccionarla: <strong>movela</strong> con ↑ ↓, configurala en el panel o eliminala. Los elementos nuevos se agregan al final.</div>
          <div class="cod-agregar">
            <button class="btn btn--chico" id="cod-agregar-btn" type="button">＋ Agregar elemento</button>
            <div class="cod-agregar__menu" id="cod-agregar-menu" hidden>
              <div class="cod-agregar__grupo">Texto</div>
              <button type="button" data-el="titulo"><strong>T</strong> Título o texto destacado</button>
              <button type="button" data-el="texto">¶ Párrafo de texto</button>
              <div class="cod-agregar__grupo">Imagen</div>
              <button type="button" data-el="imagen">🖼 Imagen o GIF</button>
              <div class="cod-agregar__grupo">Campos</div>
              <button type="button" data-el="campo">▭ Campo de texto</button>
              <button type="button" data-el="desplegable">▾ Campo desplegable</button>
              <button type="button" data-el="seleccion">◉ Selección única</button>
              <button type="button" data-el="casilla">☑ Casilla de selección</button>
              <button type="button" data-el="fecha">📅 Selector de fecha</button>
              <div class="cod-agregar__grupo">Botones</div>
              <button type="button" data-el="pago_shopify">💳 Botón de pago de Shopify</button>
              <button type="button" data-el="whatsapp">✆ Botón de WhatsApp</button>
              <button type="button" data-el="enlace">🔗 Botón con enlace</button>
              <div class="cod-agregar__grupo">Otros</div>
              <button type="button" data-el="cantidad">± Selector de cantidad</button>
              <button type="button" data-el="timer">⏰ Timer de urgencia</button>
            </div>
          </div>
        </div>
        <div class="cod-modo-layout">
          <div class="cod-vista-inline" id="cod-modo"></div>
          <aside class="cod-props" id="cod-props"></aside>
        </div>`;

    if (estado.cod.tab === "boton")
      return `
        ${campoCod("boton.texto", "Texto del botón")}
        ${campoCod("boton.subtitulo", "Subtítulo (opcional)")}
        <div class="fila-doble-cod">
          ${campoCod("boton.icono", "Ícono", "select",
            op("billete", "Billete", c.boton.icono) + op("carrito", "Carrito", c.boton.icono) +
            op("camion", "Camión", c.boton.icono) + op("casa", "Casa", c.boton.icono) + op("ninguno", "Sin ícono", c.boton.icono))}
          ${campoCod("boton.animacion", "Animación", "select",
            op("ninguna", "Ninguna", c.boton.animacion) + op("latido", "Latido", c.boton.animacion) + op("sacudida", "Sacudida", c.boton.animacion))}
        </div>
        <div class="fila-doble-cod">
          ${campoCod("boton.color_fondo", "Color de fondo", "color")}
          ${campoCod("boton.color_texto", "Color del texto", "color")}
        </div>
        <div class="fila-doble-cod">
          ${campoCod("boton.tamano", "Tamaño del texto (px)", "numero", 'min="12" max="26"')}
          ${campoCod("boton.radio", "Radio del borde (px)", "numero", 'min="0" max="40"')}
        </div>
        <div class="fila-doble-cod">
          ${campoCod("boton.borde_ancho", "Ancho del borde (px)", "numero", 'min="0" max="6"')}
          ${campoCod("boton.sombra", "Sombra (0 = sin sombra)", "numero", 'min="0" max="12"')}
        </div>
        ${campoCod("boton.borde_color", "Color del borde", "color")}
        ${campoCod("boton.sticky", "Botón adhesivo abajo en móviles", "check")}`;

    if (estado.cod.tab === "campos")
      return `
        <div class="editor__nota">Elegí qué datos pide el formulario. La etiqueta se puede reescribir (p. ej. "Cédula" o "Barrio").</div>
        ${c.campos
          .map(
            (x, i) => `
            <div class="cod-campo-fila">
              <input type="text" data-cfg="campos.${i}.etiqueta" value="${esc(x.etiqueta)}">
              <label><input type="checkbox" data-cfg="campos.${i}.visible" data-tipo="bool" ${x.visible !== false ? "checked" : ""}> Visible</label>
              <label><input type="checkbox" data-cfg="campos.${i}.obligatorio" data-tipo="bool" ${x.obligatorio ? "checked" : ""}> Obligatorio</label>
            </div>`
          )
          .join("")}
        <div class="cod-separador"></div>
        ${campoCod("extras.boletin", "Mostrar casilla de suscripción al boletín", "check")}
        ${campoCod("extras.terminos", "Exigir aceptar términos y condiciones", "check")}
        ${c.extras.terminos ? campoCod("extras.terminos_url", "URL de los términos y condiciones") : ""}`;

    if (estado.cod.tab === "estilo")
      return `
        <div class="editor__nota">El estilo del formulario que se abre al tocar el botón.</div>
        <div class="fila-doble-cod">
          ${campoCod("formulario.fondo", "Fondo del formulario", "color")}
          ${campoCod("formulario.texto", "Color del texto", "color")}
        </div>
        <div class="fila-doble-cod">
          ${campoCod("formulario.radio", "Radio del formulario (px)", "numero", 'min="0" max="30"')}
          ${campoCod("formulario.campo_radio", "Radio de los campos (px)", "numero", 'min="0" max="30"')}
        </div>
        <div class="fila-doble-cod">
          ${campoCod("formulario.campo_fondo", "Fondo de los campos", "color")}
          ${campoCod("formulario.campo_borde", "Borde de los campos", "color")}
        </div>
        <div class="fila-doble-cod">
          ${campoCod("formulario.borde_ancho", "Borde del formulario (px)", "numero", 'min="0" max="6"')}
          ${campoCod("formulario.borde_color", "Color del borde", "color")}
        </div>`;

    if (estado.cod.tab === "tarifas")
      return `
        <div class="editor__nota">Las opciones de envío que el cliente elige en el formulario. El precio se suma al total y queda en el pedido de Shopify.</div>
        ${c.tarifas
          .map(
            (t, i) => `
            <div class="cod-tarifa-fila">
              <input type="text" placeholder="Nombre (ej: Envío estándar)" data-cfg="tarifas.${i}.nombre" value="${esc(t.nombre)}">
              <input type="number" min="0" step="0.01" placeholder="Precio" data-cfg="tarifas.${i}.precio" data-tipo="numero" value="${esc(t.precio)}">
              <button class="btn btn--fantasma btn--chico" data-accion="tarifa-borrar" data-i="${i}" ${c.tarifas.length <= 1 ? "disabled" : ""}>✕</button>
            </div>`
          )
          .join("")}
        <button class="btn btn--fantasma btn--chico" data-accion="tarifa-agregar">＋ Añadir tarifa</button>
        <div class="ayuda" style="margin-top:8px">Precio 0 se muestra como "${esc(c.textos.gratis)}".</div>`;

    if (estado.cod.tab === "ofertas") {
      const precioDemo = productoDemoCod().variantes[0].precio; // solo para la vista de precios
      const filaTier = (t, i) => {
        const cant = Math.max(1, Number(t.cantidad) || 1);
        const desc = Number(t.descuento) || 0;
        const unit = Math.round(precioDemo * (1 - desc / 100));
        return `
          <div class="cod-tier-fila">
            <input type="number" min="1" max="10" data-cfg="ofertas.tiers.${i}.cantidad" data-tipo="numero" value="${esc(t.cantidad)}">
            <input type="number" min="0" max="90" data-cfg="ofertas.tiers.${i}.descuento" data-tipo="numero" value="${esc(t.descuento)}">
            <input type="text" placeholder="Ej: 2 unidades" data-cfg="ofertas.tiers.${i}.etiqueta" value="${esc(t.etiqueta)}">
            <label class="cod-tier-pop" title="Cinta 'Más popular' sobre la tarjeta">
              <input type="checkbox" data-cfg="ofertas.tiers.${i}.popular" data-tipo="bool" ${t.popular ? "checked" : ""}>
            </label>
            <span class="cod-tier-calc">${cant} × $${(unit / 100).toFixed(2)} = <strong>$${((unit * cant) / 100).toFixed(2)}</strong></span>
            <button class="btn btn--fantasma btn--chico" data-accion="tier-borrar" data-i="${i}" ${c.ofertas.tiers.length <= 1 ? "disabled" : ""}>✕</button>
          </div>`;
      };
      return `
        ${campoCod("ofertas.activo", "Activar ofertas de cantidad (reemplazan al selector de cantidad)", "check")}
        <div class="editor__nota">El cliente ve cada oferta como una tarjeta con el precio final, el precio tachado y cuánto ahorra. El descuento se aplica en el pedido real. Mirá el resultado en <strong>Vista previa</strong>.</div>
        <div class="cod-tier-cab"><span>Cantidad</span><span>Desc. %</span><span>Etiqueta</span><span>Popular</span><span>Precio (demo)</span><span></span></div>
        ${c.ofertas.tiers.map(filaTier).join("")}
        <button class="btn btn--fantasma btn--chico" data-accion="tier-agregar">＋ Añadir oferta</button>`;
    }

    // textos
    return `
      ${campoCod("textos.titulo", "Título del formulario")}
      ${campoCod("textos.subtitulo", "Subtítulo")}
      ${campoCod("textos.cta", "Botón de enviar — {total} se reemplaza por el total")}
      <div class="cod-separador"></div>
      ${campoCod("textos.exito_titulo", "Éxito · título")}
      ${campoCod("textos.exito_texto", "Éxito · mensaje")}
      ${campoCod("textos.exito_boton", "Éxito · botón")}
      <div class="cod-separador"></div>
      ${campoCod("textos.boletin", "Texto de la casilla del boletín")}
      ${campoCod("textos.gratis", "Cómo se muestra el envío gratis")}`;
  }

  function pintarCod() {
    const c = estado.cod.config;
    const inst = c.instalado;

    vista.innerHTML = `
      <div class="inicio-cabecera">
        <h1><button class="volver-flecha" id="volver-inicio">←</button> Formulario contra reembolso</h1>
        <div class="inicio-cabecera__acciones">
          <label class="cod-switch" title="Prende o apaga el formulario en tu tienda. Se guarda solo.">
            <input type="checkbox" id="cod-activo" ${c.activo ? "checked" : ""}>
            <span class="cod-switch__pista"></span>
            <span class="cod-switch__texto">${c.activo ? "Formulario activo" : "Formulario apagado"}</span>
          </label>
          <button class="btn ${estado.cod.sucio ? "btn--acento" : "btn--fantasma"}" id="cod-guardar" ${estado.cod.sucio ? "" : "disabled"}>${estado.cod.sucio ? "Guardar cambios" : "✓ Guardado"}</button>
        </div>
      </div>

      ${
        inst && !c.activo
          ? `<div class="cod-banner cod-banner--aviso">⚠ Está inyectado en <strong>${esc(inst.tema)}</strong> pero el formulario está <strong>apagado</strong>: el botón no aparece en tu tienda. Prendé el interruptor de arriba.
               <button class="btn btn--fantasma btn--chico" id="cod-instalar">↻ Volver a inyectar</button></div>`
          : inst
            ? `<div class="cod-banner cod-banner--ok">✓ Inyectado y activo en el tema <strong>${esc(inst.tema)}</strong> · ${esc(fechaCorta(inst.fecha))}
                 <button class="btn btn--fantasma btn--chico" id="cod-instalar">↻ Volver a inyectar</button></div>`
            : `<div class="cod-banner cod-banner--aviso">⚠ Todavía no está inyectado en tu tema: el botón no aparece en la tienda.
                 <button class="btn btn--chico" id="cod-instalar">▲ Inyectar en el tema</button></div>`
      }

      <div class="cod-tabs">
        ${TABS_COD.map(
          (t) => `<button class="cod-tab ${estado.cod.tab === t.id ? "cod-tab--activa" : ""}" data-tab="${t.id}">${t.texto}</button>`
        ).join("")}
      </div>

      ${barraProductoPreviewCod()}

      <div class="cod-layout ${estado.cod.tab === "vista" ? "cod-layout--vista" : ""}">
        <div class="tarjeta" id="cod-panel">${tabCod()}</div>
        ${
          estado.cod.tab === "vista"
            ? ""
            : `<aside class="tarjeta cod-preview">
                 <div class="tarjeta__titulo">Vista previa</div>
                 <div class="panel__sub">Así se ve en tu página de producto</div>
                 <div class="cod-preview__marco">
                   <div class="cod-preview__prod">
                     <div class="cod-preview__foto">${productoDemoCod().imagen ? `<img src="${esc(productoDemoCod().imagen)}" alt="">` : "🛍"}</div>
                     <div>
                       <div class="cod-preview__nombre">${esc(productoDemoCod().titulo)}</div>
                       <div class="cod-preview__precio">${fmtBdl(productoDemoCod().variantes[0].precio)}</div>
                     </div>
                   </div>
                   <div class="cod-preview__addto">Agregar al carrito</div>
                   <div id="cod-preview-boton"></div>
                 </div>
                 <button class="btn btn--acento" id="cod-ver-form" style="width:100%;margin-top:14px">Ver el formulario completo</button>
               </aside>`
        }
      </div>`;

    $("volver-inicio").onclick = () => salirCod("inicio");
    pintarBotonPreview();
    montarVistaCod();
    montarModoCod();

    // selector de producto real para el preview
    const selProdCod = $("cod-preview-prod");
    if (selProdCod) selProdCod.onchange = (e) => { estado.cod.previewProd = e.target.value || null; pintarCod(); };
    if (!(estado.productos || []).length) {
      api("/productos").then((prods) => {
        estado.productos = prods;
        if (estado.pantalla === "cod") pintarCod();
      }).catch(() => {});
    }

    // menú "＋ Agregar elemento" (pestaña Vista previa)
    const btnAgregar = $("cod-agregar-btn");
    if (btnAgregar) {
      btnAgregar.onclick = (e) => {
        e.stopPropagation();
        $("cod-agregar-menu").hidden = !$("cod-agregar-menu").hidden;
      };
      document.addEventListener("click", () => {
        const m = $("cod-agregar-menu");
        if (m) m.hidden = true;
      }, { once: true });
    }

    // --- tabs ---
    vista.querySelectorAll("[data-tab]").forEach((b) => {
      b.onclick = () => {
        estado.cod.tab = b.dataset.tab;
        pintarCod();
      };
    });

    // --- edición: un listener para todos los campos data-cfg ---
    const panel = $("cod-panel");
    panel.addEventListener("input", (e) => {
      const ruta = e.target.dataset.cfg;
      if (!ruta) return;
      let v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (e.target.dataset.tipo === "numero") v = Number(v) || 0;
      fijar(estado.cod.config, ruta, v);
      // el código junto al selector de color refleja el valor
      if (e.target.type === "color") e.target.parentElement.querySelector("code").textContent = v;
      marcarSucioCod();
      pintarBotonPreview();
      // en la vista previa, los textos de abajo se reflejan al instante
      const capaVista = $("cod-vista")?.querySelector("#tiq-cod-modal");
      if (capaVista) {
        if (ruta === "textos.cta") {
          const total = capaVista.querySelector('[data-zona="total"]')?.textContent || "";
          const cta = capaVista.querySelector('[data-zona="cta"]');
          if (cta) cta.textContent = String(v).replace("{total}", total);
        }
        if (ruta === "textos.subtitulo") {
          const sub = capaVista.querySelector(".tiq-cod-sub");
          if (sub) sub.textContent = v;
        }
      }
      // mostrar/ocultar la URL de términos exige repintar el tab
      if (ruta === "extras.terminos") pintarCod();
    });

    panel.addEventListener("click", (e) => {
      const cfg = estado.cod.config;

      // agregar elemento desde el menú de la vista previa
      const nuevoEl = e.target.closest("[data-el]");
      if (nuevoEl) {
        agregarElementoCod(nuevoEl.dataset.el);
        return;
      }
      // mover / borrar la pieza seleccionada (Modo edición)
      const mover = e.target.closest("[data-mover]");
      if (mover && !mover.disabled) {
        moverPiezaCod(Number(mover.dataset.mover));
        return;
      }
      if (e.target.closest("[data-borrar-el]")) {
        const i = cfg.elementos.findIndex((x) => "e:" + x.id === modoSel);
        if (i > -1) {
          cfg.elementos.splice(i, 1);
          cfg.orden = (cfg.orden || []).filter((k) => k !== modoSel);
          modoSel = null;
          marcarSucioCod();
          montarModoCod();
        }
        return;
      }

      const accion = e.target.dataset.accion;
      if (!accion) return;
      const i = Number(e.target.dataset.i);
      if (accion === "tarifa-agregar") cfg.tarifas.push({ id: "t" + Date.now(), nombre: "", precio: 0 });
      if (accion === "tarifa-borrar" && cfg.tarifas.length > 1) cfg.tarifas.splice(i, 1);
      if (accion === "tier-agregar" && cfg.ofertas.tiers.length < 5)
        cfg.ofertas.tiers.push({ cantidad: cfg.ofertas.tiers.length + 1, descuento: 0, etiqueta: "", popular: false });
      if (accion === "tier-borrar" && cfg.ofertas.tiers.length > 1) cfg.ofertas.tiers.splice(i, 1);
      marcarSucioCod();
      pintarCod();
    });

    // Al salir de un campo (change): el preview del modo edición y los
    // precios calculados de ofertas se refrescan sin robar el foco al tipear.
    panel.addEventListener("change", (e) => {
      if (e.target.dataset.imagenEl !== undefined && e.target.files?.length) {
        subirImagenElementoCod(e.target.files[0], Number(e.target.dataset.imagenEl));
        return;
      }
      // opciones de desplegable/selección: una por línea → array
      if (e.target.dataset.opciones !== undefined) {
        const i = Number(e.target.dataset.opciones);
        if (estado.cod.config.elementos?.[i]) {
          estado.cod.config.elementos[i].opciones = e.target.value
            .split("\n").map((x) => x.trim()).filter(Boolean);
          marcarSucioCod();
          montarModoCod();
        }
        return;
      }
      if (!e.target.dataset.cfg) return;
      if (estado.cod.tab === "modo") montarModoCod();
      if (estado.cod.tab === "ofertas" && e.target.type === "number") pintarCod();
    });

    // El interruptor maestro se guarda SOLO al tocarlo (y re-sube el snippet
    // si ya está inyectado). Así nunca queda inyectado-pero-apagado por
    // olvidarse de apretar Guardar.
    $("cod-activo").onchange = async (e) => {
      estado.cod.config.activo = e.target.checked;
      marcarSucioCod();
      await guardarCod();
      pintarCod();
    };

    $("cod-guardar").onclick = guardarCod;
    $("cod-instalar").onclick = instalarCodTema;
    const verForm = $("cod-ver-form");
    if (verForm)
      verForm.onclick = () => {
        const capa = window.TiendaIQCOD.armarModal(estado.cod.config, productoDemoCod(), { preview: true });
        document.body.appendChild(capa);
      };
  }

  // La vista previa editable: monta el formulario REAL (mismo script que la
  // tienda) adentro del panel y hace editables los textos con contenteditable.
  // Cada edición pega directo en la config; Guardar hace el PUT como siempre.
  function montarVistaCod() {
    const cont = $("cod-vista");
    if (!cont || !window.TiendaIQCOD) return;
    const c = estado.cod.config;

    cont.innerHTML = "";
    const capa = window.TiendaIQCOD.armarModal(c, productoDemoCod(), { preview: true });
    capa.querySelector(".tiq-cod-cerrar")?.remove();
    cont.appendChild(capa);

    const editable = (el, aplicar, obtener) => {
      if (!el) return;
      el.setAttribute("contenteditable", "plaintext-only");
      // Firefox no soporta plaintext-only: cae a true.
      if (!el.isContentEditable) el.setAttribute("contenteditable", "true");
      el.classList.add("cod-editable");
      el.addEventListener("input", () => {
        aplicar(el.textContent.replace(/\n/g, " ").trim());
        marcarSucioCod();
      });
      // Si lo dejan vacío, vuelve el valor guardado (nada queda sin texto).
      el.addEventListener("blur", () => {
        if (!el.textContent.trim()) el.textContent = obtener();
      });
    };

    editable(capa.querySelector(".tiq-cod-cab__titulo"), (v) => { if (v) c.textos.titulo = v; }, () => c.textos.titulo);
    editable(capa.querySelector(".tiq-cod-sub"), (v) => { if (v) c.textos.subtitulo = v; }, () => c.textos.subtitulo);

    // Etiquetas de los campos: se re-envuelven en un span editable para no
    // arrastrar el asterisco de obligatorio adentro de la edición.
    capa.querySelectorAll("[data-campo]").forEach((div) => {
      const campo = c.campos.find((x) => x.id === div.dataset.campo);
      const label = div.querySelector("label");
      if (!campo || !label) return;
      const obligatorio = !!label.querySelector(".tiq-req");
      label.innerHTML = `<span class="cod-etq">${esc(campo.etiqueta)}</span>${obligatorio ? ' <span class="tiq-req">*</span>' : ""}`;
      editable(
        label.querySelector(".cod-etq"),
        (v) => {
          if (!v) return;
          campo.etiqueta = v;
          const entrada = div.querySelector("input,textarea");
          if (entrada) entrada.placeholder = v;
        },
        () => campo.etiqueta
      );
    });

    // Nombres de tarifas y etiquetas de ofertas (ya son spans propios).
    capa.querySelectorAll(".tiq-cod-envio__nombre").forEach((el, i) => {
      editable(el, (v) => { if (v && c.tarifas[i]) c.tarifas[i].nombre = v; }, () => c.tarifas[i]?.nombre || "");
    });
    capa.querySelectorAll(".tiq-cod-oferta").forEach((tarjeta, i) => {
      // solo el nombre (sin el chip de descuento) es editable
      const nombre = tarjeta.querySelector(".tiq-cod-oferta__nombre");
      const chip = nombre?.querySelector(".tiq-cod-oferta__chip");
      if (!nombre) return;
      if (chip) {
        nombre.innerHTML = `<span class="cod-etq">${esc(c.ofertas.tiers[i]?.etiqueta || "")}</span>`;
        nombre.appendChild(chip);
        editable(nombre.querySelector(".cod-etq"), (v) => { if (v && c.ofertas.tiers[i]) c.ofertas.tiers[i].etiqueta = v; }, () => c.ofertas.tiers[i]?.etiqueta || "");
      } else {
        editable(nombre, (v) => { if (v && c.ofertas.tiers[i]) c.ofertas.tiers[i].etiqueta = v; }, () => c.ofertas.tiers[i]?.etiqueta || "");
      }
    });

    // Elementos agregados: texto editable donde aplica + ⚙ que salta al
    // Modo edición con la pieza ya seleccionada.
    capa.querySelectorAll('[data-item^="e:"]').forEach((div) => {
      const el = c.elementos.find((x) => "e:" + x.id === div.dataset.item);
      if (!el) return;
      const textual = div.querySelector("h3, p, .tiq-cod-el__wsp, .tiq-cod-el__enlace");
      if (textual && (el.tipo === "titulo" || el.tipo === "texto")) {
        editable(textual, (v) => { if (v) el.texto = v; }, () => el.texto || "");
      }
      const engranaje = document.createElement("button");
      engranaje.type = "button";
      engranaje.className = "cod-engranaje";
      engranaje.title = "Configurar y mover en Modo edición";
      engranaje.textContent = "⚙";
      engranaje.onclick = (e) => {
        e.preventDefault();
        modoSel = div.dataset.item;
        estado.cod.tab = "modo";
        pintarCod();
      };
      div.style.position = "relative";
      div.appendChild(engranaje);
    });
  }

  // ---- elementos agregables + modo edición ----

  let modoSel = null; // pieza seleccionada en Modo edición ("c:..." | "e:...")

  function agregarElementoCod(tipo) {
    const c = estado.cod.config;
    const defaults = {
      titulo: { texto: "Título destacado" },
      texto: { texto: "Escribí acá el texto que quieras mostrar." },
      campo: { etiqueta: "Campo personalizado", obligatorio: false },
      desplegable: { etiqueta: "Elegí una opción", opciones: ["Opción 1", "Opción 2", "Opción 3"], obligatorio: false },
      seleccion: { etiqueta: "Elegí una opción", opciones: ["Opción 1", "Opción 2", "Opción 3"], obligatorio: false },
      casilla: { etiqueta: "", texto_casilla: "Quiero que me llamen antes de enviar", obligatorio: false },
      fecha: { etiqueta: "Fecha de entrega preferida", obligatorio: false },
      imagen: { url: null, tamano: 100 },
      whatsapp: { numero: "", mensaje: "¡Hola! Quiero hacer un pedido: {page_url}", texto: "Consultanos por WhatsApp" },
      enlace: { url: "", texto: "Más información" },
      pago_shopify: { texto: "Pagar con tarjeta", subtitulo: "" },
      cantidad: { etiqueta: "Cantidad" },
      timer: { texto: "Oferta especial: tu pedido queda reservado por", minutos: 10 }
    };
    if (!defaults[tipo]) return;
    const el = { id: "el" + Date.now(), tipo, ...defaults[tipo] };
    c.elementos = c.elementos || [];
    c.elementos.push(el);
    c.orden = window.TiendaIQCOD.ordenResuelto(c); // el nuevo queda al final
    modoSel = "e:" + el.id;
    marcarSucioCod();
    pintarCod();
    // que se vea la pieza nueva (queda al final del formulario)
    requestAnimationFrame(() => {
      $("cod-modo")?.querySelector(".cod-mov--sel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function moverPiezaCod(dir) {
    const c = estado.cod.config;
    const orden = window.TiendaIQCOD.ordenResuelto(c);
    const i = orden.indexOf(modoSel);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= orden.length) return;
    [orden[i], orden[j]] = [orden[j], orden[i]];
    c.orden = orden;
    marcarSucioCod();
    montarModoCod();
  }

  function montarModoCod() {
    const cont = $("cod-modo");
    if (!cont || !window.TiendaIQCOD) return;
    const c = estado.cod.config;

    cont.innerHTML = "";
    const capa = window.TiendaIQCOD.armarModal(c, productoDemoCod(), { preview: true });
    capa.querySelector(".tiq-cod-cerrar")?.remove();
    cont.appendChild(capa);

    capa.querySelectorAll("[data-item]").forEach((el) => {
      el.classList.add("cod-mov");
      if (el.dataset.item === modoSel) el.classList.add("cod-mov--sel");
    });

    cont.onclick = (e) => {
      const it = e.target.closest("[data-item]");
      if (!it) return;
      e.preventDefault();
      if (modoSel !== it.dataset.item) {
        modoSel = it.dataset.item;
        capa.querySelectorAll(".cod-mov--sel").forEach((x) => x.classList.remove("cod-mov--sel"));
        it.classList.add("cod-mov--sel");
        pintarPropsCod();
      }
    };

    pintarPropsCod();
  }

  const TIPO_ELEMENTO = {
    titulo: "Título", texto: "Párrafo", campo: "Campo de texto",
    desplegable: "Campo desplegable", seleccion: "Selección única",
    casilla: "Casilla de selección", fecha: "Selector de fecha",
    imagen: "Imagen o GIF", whatsapp: "Botón de WhatsApp", enlace: "Botón con enlace",
    pago_shopify: "Botón de pago de Shopify", cantidad: "Selector de cantidad", timer: "Timer de urgencia"
  };

  function pintarPropsCod() {
    const panel = $("cod-props");
    if (!panel) return;
    const c = estado.cod.config;

    if (!modoSel) {
      panel.innerHTML = `<div class="cod-props__vacio">👆 Hacé clic en cualquier pieza del formulario para moverla o configurarla.</div>`;
      return;
    }

    const orden = window.TiendaIQCOD.ordenResuelto(c);
    const idx = orden.indexOf(modoSel);
    const esElemento = modoSel.startsWith("e:");
    let titulo = "";
    let campos = "";

    if (!esElemento) {
      const i = c.campos.findIndex((x) => "c:" + x.id === modoSel);
      if (i < 0) return void (panel.innerHTML = "");
      titulo = `Campo · ${c.campos[i].etiqueta}`;
      campos =
        campoCod(`campos.${i}.etiqueta`, "Etiqueta") +
        campoCod(`campos.${i}.visible`, "Visible en el formulario", "check") +
        campoCod(`campos.${i}.obligatorio`, "Obligatorio", "check");
    } else {
      const i = c.elementos.findIndex((x) => "e:" + x.id === modoSel);
      if (i < 0) return void (panel.innerHTML = "");
      const el = c.elementos[i];
      titulo = TIPO_ELEMENTO[el.tipo] || "Elemento";
      if (el.tipo === "titulo" || el.tipo === "texto") campos = campoCod(`elementos.${i}.texto`, "Texto");
      if (el.tipo === "campo")
        campos = campoCod(`elementos.${i}.etiqueta`, "Etiqueta") + campoCod(`elementos.${i}.obligatorio`, "Obligatorio", "check");
      if (el.tipo === "desplegable" || el.tipo === "seleccion")
        campos =
          campoCod(`elementos.${i}.etiqueta`, "Etiqueta") +
          `<div class="campo campo--editor"><label>Opciones (una por línea)</label>
             <textarea rows="4" data-opciones="${i}">${esc((el.opciones || []).join("\n"))}</textarea></div>` +
          campoCod(`elementos.${i}.obligatorio`, "Obligatorio", "check");
      if (el.tipo === "casilla")
        campos =
          campoCod(`elementos.${i}.etiqueta`, "Etiqueta (opcional, arriba de la casilla)") +
          campoCod(`elementos.${i}.texto_casilla`, "Texto de la casilla") +
          campoCod(`elementos.${i}.obligatorio`, "Obligatoria (hay que marcarla para comprar)", "check");
      if (el.tipo === "fecha")
        campos = campoCod(`elementos.${i}.etiqueta`, "Etiqueta") + campoCod(`elementos.${i}.obligatorio`, "Obligatorio", "check");
      if (el.tipo === "imagen")
        campos = `<label class="btn btn--fantasma btn--chico" style="cursor:pointer">🖼 ${el.url ? "Cambiar imagen" : "Subir imagen"}<input type="file" accept="image/*" hidden data-imagen-el="${i}"></label>
          ${el.url ? `<div class="ayuda" style="margin:6px 0 10px">Imagen cargada ✓</div>` : `<div class="ayuda" style="margin:6px 0 10px">Subí un archivo o pegá una URL.</div>`}
          ${campoCod(`elementos.${i}.url`, "…o URL de la imagen / GIF")}
          ${campoCod(`elementos.${i}.tamano`, "Tamaño (% del ancho)", "numero", 'min="10" max="100"')}`;
      if (el.tipo === "pago_shopify")
        campos =
          `<div class="editor__nota">Lleva al cliente al checkout normal de Shopify (paga con tarjeta) con el producto y la cantidad elegida.</div>` +
          campoCod(`elementos.${i}.texto`, "Texto del botón") +
          campoCod(`elementos.${i}.subtitulo`, "Subtítulo (opcional)");
      if (el.tipo === "cantidad")
        campos =
          `<div class="editor__nota">Con las ofertas de cantidad activas este selector se oculta: mandan las ofertas.</div>` +
          campoCod(`elementos.${i}.etiqueta`, "Etiqueta");
      if (el.tipo === "timer")
        campos =
          campoCod(`elementos.${i}.texto`, "Texto del timer") +
          campoCod(`elementos.${i}.minutos`, "Minutos de cuenta regresiva", "numero", 'min="1" max="120"');
      if (el.tipo === "whatsapp")
        campos =
          campoCod(`elementos.${i}.numero`, "Número con código de país (ej: 5491122334455)") +
          campoCod(`elementos.${i}.mensaje`, "Mensaje precargado (opcional)") +
          campoCod(`elementos.${i}.texto`, "Texto del botón");
      if (el.tipo === "enlace")
        campos = campoCod(`elementos.${i}.url`, "URL de destino") + campoCod(`elementos.${i}.texto`, "Texto del botón");
    }

    panel.innerHTML = `
      <div class="cod-props__cab">${esc(titulo)}</div>
      <div class="cod-props__acciones">
        <button class="btn btn--fantasma btn--chico" data-mover="-1" ${idx <= 0 ? "disabled" : ""}>↑ Subir</button>
        <button class="btn btn--fantasma btn--chico" data-mover="1" ${idx >= orden.length - 1 ? "disabled" : ""}>↓ Bajar</button>
        ${esElemento ? `<button class="btn btn--fantasma btn--chico cod-props__borrar" data-borrar-el="1">🗑 Eliminar</button>` : ""}
      </div>
      ${campos}`;
  }

  async function subirImagenElementoCod(archivo, i) {
    const c = estado.cod.config;
    if (!c.elementos?.[i]) return;
    const panel = $("cod-props");
    panel?.insertAdjacentHTML("beforeend", `<div class="ayuda" id="cod-subiendo">Subiendo imagen…</div>`);
    try {
      const base64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1]);
        fr.onerror = () => rej(new Error("No se pudo leer el archivo"));
        fr.readAsDataURL(archivo);
      });
      const r = await api("/cod/imagen", { method: "POST", body: { nombre: archivo.name, mime: archivo.type, base64 } });
      c.elementos[i].url = r.url;
      marcarSucioCod();
      montarModoCod();
    } catch (e) {
      $("cod-subiendo")?.remove();
      panel?.insertAdjacentHTML("beforeend", `<div class="error">✖ ${esc(e.message)}</div>`);
    }
  }

  function pintarBotonPreview() {
    const cont = $("cod-preview-boton");
    if (!cont || !window.TiendaIQCOD) return;
    cont.innerHTML = "";
    cont.appendChild(window.TiendaIQCOD.armarBoton(estado.cod.config));
  }

  function marcarSucioCod() {
    estado.cod.sucio = true;
    const b = $("cod-guardar");
    if (b) {
      b.disabled = false;
      b.textContent = "Guardar cambios";
      b.classList.add("btn--acento");
      b.classList.remove("btn--fantasma");
    }
  }

  async function guardarCod() {
    const b = $("cod-guardar");
    b.disabled = true;
    b.textContent = "Guardando…";
    try {
      estado.cod.config = await api("/cod", { method: "PUT", body: { config: estado.cod.config } });
      estado.cod.sucio = false;
      b.textContent = "✓ Guardado";
      b.classList.remove("btn--acento");
      b.classList.add("btn--fantasma");
      return true;
    } catch (e) {
      b.disabled = false;
      b.textContent = "Guardar cambios";
      vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ No se pudo guardar: ${esc(e.message)}</div>`);
      return false;
    }
  }

  async function instalarCodTema() {
    // Instalar con cambios sin guardar los perdería: primero el PUT.
    if (estado.cod.sucio && !(await guardarCod())) return;
    const b = $("cod-instalar");
    b.disabled = true;
    b.textContent = "Inyectando…";
    try {
      estado.cod.config = await api("/cod/instalar", { method: "POST" });
      pintarCod();
    } catch (e) {
      b.disabled = false;
      b.textContent = "▲ Inyectar en el tema";
      vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ ${esc(e.message)}</div>`);
    }
  }

  function salirCod(destino) {
    if (estado.cod?.sucio && !confirm("Hay cambios sin guardar. ¿Salir igual?")) return;
    ir(destino);
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

  const ESTADO_ETQ = { publicada: "Publicada", borrador: "Borrador" };

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
      return `<div class="clip-mal">✖ Ese link es una página web, no un archivo. Pegá el enlace <strong>directo</strong> (termina en .gif/.mp4), uno de Giphy/YouTube, o subí/arrastrá el archivo.</div>`;
    if (t === "img") {
      const g = url.match(/giphy\.com\/(?:gifs|clips|stickers)\/(?:[^/]*-)?([A-Za-z0-9]{6,})/i);
      const src = g ? `https://media.giphy.com/media/${g[1]}/giphy.gif` : url;
      return `<div class="clip-ok"><img src="${esc(encodeURI(src))}" alt="" loading="lazy">Se ve bien ✓</div>`;
    }
    return `<div class="clip-ok">${t === "yt" ? "Video de YouTube ✓" : "Video ✓"}</div>`;
  }

  // ---------- 1. elegir producto (lanzador tipo command-palette) ----------
  //
  // Nada de grilla: una sola decisión. Un input que busca sobre los productos
  // que ya cargamos (sin backend), operable 100% por teclado. Con el input
  // vacío mostramos atajos: retomar borradores + productos sin página. La
  // selección reusa el flujo existente: estado.producto → ir("informacion").
  function pantallaLista() {
    const IC_LUPA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
    const IC_CHISPA = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.8 4.9 4.9 1.8-4.9 1.8L12 15.9l-1.8-4.9L5.3 9.2l4.9-1.8zM19 14l.9 2.4 2.4.9-2.4.9L19 20.6l-.9-2.4-2.4-.9 2.4-.9z"/></svg>`;
    const IC_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;

    // Tienda sin productos: estado honesto, no una grilla vacía.
    if (!estado.productos.length) {
      vista.innerHTML = `
        <button class="volver" id="volver-inicio">← Inicio</button>
        <div class="cabecera"><h1>Crear página de producto con IA</h1></div>
        <div class="vacio-panel">
          <div class="vacio-panel__tit">Todavía no tenés productos en tu tienda</div>
          <p>Agregá al menos un producto en Shopify y volvé para armar su página con IA.</p>
        </div>`;
      $("volver-inicio").onclick = () => ir("inicio");
      return;
    }

    vista.innerHTML = `
      <div class="crear">
        <button class="volver" id="volver-inicio">← Inicio</button>
        <div class="crear__hero">
          <span class="crear__eyebrow">${IC_CHISPA} Generador con IA</span>
          <h1>Creá tu página de producto</h1>
          <p>Elegí un producto y la IA arma la landing completa en segundos.</p>
        </div>
        <div class="consola">
          <div class="consola__buscar">
            <span class="consola__lupa">${IC_LUPA}</span>
            <input class="consola__input" id="q" type="text" autocomplete="off" spellcheck="false"
                   placeholder="Buscá un producto…" value="${esc(estado.filtro || "")}">
            <span class="cmd__kbd">↑↓ · Enter</span>
          </div>
          <div class="consola__res" id="res" role="listbox" aria-label="Productos"></div>
          <button class="consola__pie" id="ver-todos">${IC_GRID} Ver los ${estado.productos.length} productos de tu tienda</button>
        </div>
      </div>`;

    $("volver-inicio").onclick = () => ir("inicio");
    $("ver-todos").onclick = abrirPickerTodos;
    const q0 = $("q");
    let navIdx = 0;      // fila activa
    let navLista = [];   // ids en orden de navegación

    const fila = (p) => `
      <button class="fila" role="option" data-id="${esc(p.id)}">
        <span class="fila__thumb">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : `<span class="fila__ph">🛍</span>`}</span>
        <span class="fila__txt">
          <span class="fila__tit">${esc(p.titulo)}</span>
          ${p.precio != null ? `<span class="fila__precio">${esc(precioLindo(p.precio, p.moneda))}</span>` : ""}
        </span>
        ${
          p.estado
            ? `<span class="chip chip--${p.estado}">${ESTADO_ETQ[p.estado] || p.estado}</span>`
            : `<span class="fila__cta">Crear página →</span>`
        }
      </button>`;

    function marcarActiva(scroll = true) {
      $("res").querySelectorAll(".fila").forEach((b, i) => {
        const on = i === navIdx;
        b.classList.toggle("is-activa", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        if (on && scroll) b.scrollIntoView({ block: "nearest" });
      });
    }

    function renderResultados() {
      const q = (estado.filtro || "").trim().toLowerCase();
      let html = "";
      let planos = [];

      if (!q) {
        const borradores = estado.productos.filter((p) => p.estado === "borrador").slice(0, 3);
        const sinPagina = estado.productos.filter((p) => !p.estado).slice(0, 4);
        planos = [...borradores, ...sinPagina];
        if (borradores.length) html += `<div class="consola__grupo">Seguí donde dejaste</div>` + borradores.map(fila).join("");
        if (sinPagina.length) html += `<div class="consola__grupo">Empezá una nueva</div>` + sinPagina.map(fila).join("");
      } else {
        planos = estado.productos.filter((p) => p.titulo.toLowerCase().includes(q)).slice(0, 50);
        html = planos.length
          ? planos.map(fila).join("")
          : `<div class="vacio">Ningún producto coincide con “${esc(estado.filtro)}”.</div>`;
      }

      navLista = planos.map((p) => p.id);
      if (navIdx >= navLista.length) navIdx = Math.max(0, navLista.length - 1);

      const cont = $("res");
      cont.innerHTML = html;
      cont.querySelectorAll(".fila").forEach((b) => {
        b.onclick = () => elegirProducto(b.dataset.id);
        b.onmouseenter = () => {
          const i = navLista.indexOf(b.dataset.id);
          if (i >= 0 && i !== navIdx) { navIdx = i; marcarActiva(false); }
        };
      });
      marcarActiva(false);
    }

    renderResultados();
    q0.focus();
    q0.setSelectionRange(q0.value.length, q0.value.length);

    q0.oninput = () => { estado.filtro = q0.value; navIdx = 0; renderResultados(); };
    q0.onkeydown = (e) => {
      const n = navLista.length;
      if (e.key === "ArrowDown") { e.preventDefault(); if (n) { navIdx = (navIdx + 1) % n; marcarActiva(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (n) { navIdx = (navIdx - 1 + n) % n; marcarActiva(); } }
      else if (e.key === "Enter") { e.preventDefault(); if (navLista[navIdx]) elegirProducto(navLista[navIdx]); }
      else if (e.key === "Escape" && q0.value) { q0.value = ""; estado.filtro = ""; navIdx = 0; renderResultados(); }
    };
  }

  function elegirProducto(id) {
    estado.producto = estado.productos.find((p) => p.id === id);
    if (estado.producto) ir("informacion");
  }

  // Sube una imagen (add-on del bundle) a Shopify Files y guarda su URL en la
  // oferta. Reusa /cod/imagen (subida por tienda, no atada a página). Nada de links.
  async function subirImagenBundle(archivo, oferta) {
    try {
      const base64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1]);
        fr.onerror = () => rej(new Error("No se pudo leer el archivo"));
        fr.readAsDataURL(archivo);
      });
      const r = await api("/cod/imagen", { method: "POST", body: { nombre: archivo.name, mime: archivo.type, base64 } });
      oferta.addons = oferta.addons || {};
      oferta.addons.imagen = { on: true, url: r.url };
      marcarSucioBundles();
      pintarPreviewBundle();
      pintarEditorBundle();
    } catch (e) {
      vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ No se pudo subir la imagen: ${esc(e.message)}</div>`);
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
          <button class="picker__x" type="button" aria-label="Cerrar">×</button>
        </div>
        <div class="picker__buscar">
          <span class="picker__lupa">${IC_LUPA}</span>
          <input id="pk-q" type="text" autocomplete="off" spellcheck="false" placeholder="Buscar productos…">
        </div>
        <div class="picker__lista" id="pk-lista"></div>
        <div class="picker__pie" id="pk-conteo"></div>
      </div>`;
    document.body.appendChild(cont);

    const filaP = (p) => `
      <button class="fila" type="button" data-id="${esc(p.id)}">
        <span class="fila__thumb">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : `<span class="fila__ph">🛍</span>`}</span>
        <span class="fila__txt">
          <span class="fila__tit">${esc(p.titulo)}</span>
          ${p.precio != null ? `<span class="fila__precio">${esc(precioLindo(p.precio, p.moneda))}</span>` : ""}
        </span>
        ${
          p.estado
            ? `<span class="chip chip--${p.estado}">${ESTADO_ETQ[p.estado] || p.estado}</span>`
            : `<span class="fila__cta">Elegir →</span>`
        }
      </button>`;

    const lista = cont.querySelector("#pk-lista");
    const conteo = cont.querySelector("#pk-conteo");
    const pintar = (q = "") => {
      const t = q.trim().toLowerCase();
      const arr = t ? estado.productos.filter((p) => p.titulo.toLowerCase().includes(t)) : estado.productos;
      lista.innerHTML = arr.length ? arr.map(filaP).join("") : `<div class="vacio">Ningún producto coincide.</div>`;
      conteo.textContent = `${arr.length} producto${arr.length === 1 ? "" : "s"}`;
      lista.querySelectorAll(".fila").forEach((b) => {
        b.onclick = () => {
          cerrar();
          if (onPick) onPick((estado.productos || []).find((p) => p.id === b.dataset.id) || { id: b.dataset.id });
          else elegirProducto(b.dataset.id);
        };
      });
    };
    const onKey = (e) => { if (e.key === "Escape") cerrar(); };
    function cerrar() { cont.remove(); document.removeEventListener("keydown", onKey); }

    cont.addEventListener("click", (e) => {
      if (e.target === cont || e.target.closest(".picker__x")) cerrar();
    });
    document.addEventListener("keydown", onKey);
    const pkq = cont.querySelector("#pk-q");
    pkq.oninput = () => pintar(pkq.value);
    pintar("");
    pkq.focus();
  }

  // ---------- 2. información del producto ----------

  async function pantallaInformacion() {
    const p = estado.producto;

    vista.innerHTML = `
      <button class="volver" id="volver">← Volver a los productos</button>
      <div class="cabecera">
        <h1>Información del producto</h1>
        <p>Revisá esto antes de generar. Cambiarlo después cuesta una regeneración.</p>
      </div>
      <div class="dos-columnas">
        <div>
          <div class="tarjeta">
            <div class="tarjeta__titulo">Copywriting</div>
            <div class="campo">
              <label for="angulo">Ángulo del producto / enfoque (opcional)</label>
              <input type="text" id="angulo" placeholder="ejemplo: para escritorios chicos">
              <div class="ayuda">Si lo cargás, todos los textos se inclinan hacia ese ángulo.</div>
            </div>
            <div class="campo">
              <label for="idioma">Idioma</label>
              <select id="idioma">
                <option value="es" selected>Español (rioplatense)</option>
                <option value="en">English</option>
                <option value="pt">Português</option>
              </select>
              <div class="ayuda">Aplica solo al texto. Las imágenes se usan como están.</div>
            </div>
          </div>

          <div class="tarjeta">
            <div class="tarjeta__titulo">Color de la página</div>
            <div class="panel__sub" style="margin-bottom:12px">Elegí el color del botón, los círculos de % y los detalles. Después lo podés cambiar en el editor.</div>
            <div id="tema-previo">${swatchesTema(estado.temaElegido === "auto" ? null : estado.temaElegido)}</div>
          </div>

          <div class="tarjeta">
            <div class="tarjeta__titulo">Medios</div>
            <div class="medios" id="medios"><span class="ayuda">Cargando…</span></div>
            <div class="nota" id="nota-medios"></div>
          </div>

          <button class="btn btn--acento btn--grande" id="generar">✨ Crear página de producto con IA</button>
          ${
            p.estado
              ? `<button class="btn btn--fantasma btn--grande" id="abrir" style="margin-top:10px">✎ Editar la página existente</button>`
              : ""
          }
        </div>

        <div class="tarjeta">
          <div class="tarjeta__titulo">Producto</div>
          <div class="ficha__titulo" id="f-titulo">${esc(p.titulo)}</div>
          <div class="ficha__meta" id="f-meta">Cargando…</div>
          <div class="ficha__descripcion" id="f-desc"></div>
        </div>
      </div>`;

    $("volver").onclick = () => ir("lista");
    $("generar").onclick = generar;
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

  // ---------- generando ----------

  async function generar() {
    const angulo = $("angulo").value.trim();
    const idioma = $("idioma").value;
    estado.error = null;
    ir("generando");

    const t0 = Date.now();
    const reloj = setInterval(() => {
      const r = $("reloj");
      if (r) r.textContent = ((Date.now() - t0) / 1000).toFixed(0) + "s";
    }, 100);

    try {
      estado.pagina = await api("/paginas", {
        method: "POST",
        body: { producto_id: estado.producto.id, idioma, angulo }
      });
      // Color elegido antes de generar: se inyecta en la página y se persiste
      // con el PUT que ya existe (sin tocar backend). Sin elección → color del rubro.
      if (estado.temaElegido && estado.temaElegido !== "auto" && estado.pagina?.data) {
        (estado.pagina.data.global ||= {}).tema = estado.temaElegido;
        try {
          estado.pagina = await api(`/paginas/${estado.pagina.id}`, {
            method: "PUT",
            body: { data: estado.pagina.data }
          });
        } catch {}
      }
      clearInterval(reloj);
      ir("preview");
    } catch (e) {
      clearInterval(reloj);
      estado.error = e.message;
      ir("informacion");
      requestAnimationFrame(() => {
        vista.insertAdjacentHTML(
          "afterbegin",
          e.actualizar
            ? `<div class="error">✖ ${esc(estado.error)}
                 <button class="btn btn--acento" id="btn-plan" style="margin-left:12px">Pasar a Pro</button>
               </div>`
            : `<div class="error">✖ ${esc(estado.error)}</div>`
        );
        const b = $("btn-plan");
        if (b) b.onclick = irASuscripcion;
      });
    }
  }

  function pantallaGenerando() {
    vista.innerHTML = `
      <div class="generando">
        <div class="giro"></div>
        <h2>Generando la página…</h2>
        <p>Leyendo las fotos y escribiendo el copy · <span class="reloj" id="reloj">0s</span></p>
        <p class="ayuda" style="margin-top:10px;color:#9b9b9b">Suele tardar unos 35 segundos.</p>
      </div>`;
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
        vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ ${esc(e.message)}</div>`)
      );
    }
  }

  // ---------- 3. preview + editor ----------

  // El editor no es WYSIWYG: es un formulario al lado del preview. Cada campo
  // apunta a una ruta del JSON ("facetas.hero.titulo"); al tipear se actualiza
  // el dato y el iframe se repinta. Guardar = PUT /api/paginas/:id.

  let sucio = false; // hay cambios sin guardar
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
  function campo(ruta, etiqueta, filas, nulo) {
    const v = leer(estado.pagina.data, ruta) ?? "";
    const atributos = `data-ruta="${ruta}"${nulo ? ` data-nulo="1"` : ""}`;
    return `
      <div class="campo campo--editor">
        <label>${etiqueta}</label>
        ${
          filas
            ? `<textarea rows="${filas}" ${atributos}>${esc(v)}</textarea>`
            : `<input type="text" ${atributos} value="${esc(v)}">`
        }
      </div>`;
  }

  function campoNumero(ruta, etiqueta) {
    const v = leer(estado.pagina.data, ruta) ?? 0;
    return `
      <div class="campo campo--editor">
        <label>${etiqueta}</label>
        <input type="number" min="0" data-ruta="${ruta}" data-tipo="numero" value="${esc(v)}">
      </div>`;
  }

  const selectorEstrellas = (ruta, v) =>
    `<select data-ruta="${ruta}" data-tipo="numero">${[5, 4, 3, 2, 1]
      .map((n) => `<option value="${n}" ${n === v ? "selected" : ""}>${"★".repeat(n)}${"☆".repeat(5 - n)}</option>`)
      .join("")}</select>`;

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
      <span class="galeria-picker__subir-mas">＋</span>
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
            ${urls[id] ? `<img src="${esc(urls[id])}" alt="">` : "🖼"}
            ${pos > -1 ? `<span class="galeria-picker__orden">${pos + 1}</span>` : ""}
          </button>`;
        })
        .join("") +
      tileSubir("multi", ruta) +
      `</div>
      <div class="ayuda">Hacé clic para agregar o sacar. El número es el orden; la 1 es la imagen principal. Con ＋ subís una foto nueva desde tu computadora.</div>`
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
             data-img-quitar="${ruta}">✕<span>Sin foto</span></button>`
        : "") +
      pool
        .map(
          (id) => `<button type="button" class="galeria-picker__img ${id === actual ? "elegida" : ""}"
            data-img-uno="${ruta}" data-id="${esc(id)}">
            ${urls[id] ? `<img src="${esc(urls[id])}" alt="">` : "🖼"}
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
      cuerpo?.insertAdjacentHTML("afterbegin", `<div class="error">✖ No se pudo subir la imagen: ${esc(e.message)}</div>`);
    }
  }

  // Cada bloque editable de la página: título del modal + sus campos.
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
            ${selectorEstrellas(`facetas.resenas.items.${i}.estrellas`, r.estrellas ?? 5)}
          </div>
          <textarea rows="2" placeholder="Texto de la reseña"
                    data-ruta="facetas.resenas.items.${i}.texto">${esc(r.texto ?? "")}</textarea>
          <details class="resena-edit__foto">
            <summary>🖼 Foto del cliente${r.imagen ? " · elegida" : ""}</summary>
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
          return (
            campo("facetas.hero.urgencia", "Barra de urgencia (arriba de todo)") +
            campo("facetas.hero.titulo", "Título") +
            campoNumero("facetas.hero.resenas_count", "Cantidad de reseñas (junto a las estrellas)") +
            `<div class="campo campo--editor"><label>Puntaje (de 5, ej: 4.9)</label>
              <input type="number" min="0" max="5" step="0.1" data-ruta="facetas.hero.puntaje" data-tipo="numero" value="${esc(leer(estado.pagina.data, "facetas.hero.puntaje") ?? 4.9)}"></div>` +
            campo("global.cta", "Texto del botón de compra") +
            `<div class="campo campo--editor">
              <label>Color de la página</label>
              ${swatchesTema(leer(estado.pagina.data, "global.tema"))}
              <div class="ayuda">Cambia el color del botón, los círculos de % y los detalles. Todo lo demás queda igual.</div>
            </div>` +
            `<div class="campo campo--editor">
              <label>Rubro (define el color si elegís “Automático”)</label>
              <select data-ruta="global.nicho">${NICHOS.map(
                ([k, t]) => `<option value="${k}" ${k === nichoActual ? "selected" : ""}>${t}</option>`
              ).join("")}</select>
            </div>`
          );
        }
      },
      bullets: {
        titulo: "Beneficios del producto",
        html: () => {
          return (
            `<div class="editor__nota">Cada beneficio: un emoji, el arranque en negrita y el resto de la frase.</div>` +
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
          `<div class="editor__nota">Es la reseña grande del hero. Pegá acá una reseña REAL de un cliente; sin texto, en la tienda no se muestra.</div>` +
          campo("facetas.hero.resena_destacada.autor", "Nombre", 0, true) +
          campo("facetas.hero.resena_destacada.texto", "Texto", 3, true) +
          `<div class="campo campo--editor"><label>Estrellas</label>${selectorEstrellas(
            "facetas.hero.resena_destacada.estrellas",
            f.hero.resena_destacada.estrellas ?? 5
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
            `<div class="editor__nota">Subí o <strong>arrastrá</strong> el video/GIF desde tu compu (lo más simple), o pegá un enlace <strong>directo</strong>: un .gif o .mp4, un link de Giphy o de YouTube. Ojo: el link de una página web común (por ej. una nota) no sirve, tiene que ser el del archivo. Se reproduce solo, en loop, sin controles. Agregá todos los que quieras; los vacíos no se muestran en la tienda.</div>` +
            campo("facetas.clientes.titulo", "Título de la sección") +
            (items.length
              ? items
                  .map(
                    (it, i) => `
              <fieldset class="resena-edit clip-drop">
                <legend>Clip ${i + 1}${manijasMuro(i, items.length)}</legend>
                ${campo(`facetas.clientes.items.${i}.url`, "Enlace del gif o video")}
                <label class="btn btn--fantasma btn--chico sec-subir-video" style="cursor:pointer">⬆ Subir o arrastrar video/gif
                  <input type="file" accept="image/*,video/*" hidden data-video-el="muro:${i}">
                </label>
                <div class="clip-drop__hint">o arrastrá el archivo hasta acá</div>
                <div class="clip-estado">${estadoClip(it && it.url)}</div>
              </fieldset>`
                  )
                  .join("")
              : `<div class="editor__nota">Todavía no agregaste clips.</div>`) +
            `<button class="btn btn--fantasma" type="button" data-muro-add="1">＋ Agregar clip</button>`
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
          `<div class="editor__nota">Los porcentajes son fijos de la plantilla; se editan solo las frases.</div>` +
          campo("facetas.stats.titular", "Titular") +
          f.stats.items
            .map((x, i) => campo(`facetas.stats.items.${i}.frase`, `${x.pct}% — frase (sin números)`, 2))
            .join("") +
          selectorImagenUno("facetas.stats.imagen", "Imagen del bloque")
      },
      faq: {
        titulo: "Preguntas frecuentes",
        html: () =>
          campo("facetas.faq.titular", "Titular") +
          f.faq.items
            .map(
              (_, i) =>
                campo(`facetas.faq.items.${i}.pregunta`, `Pregunta ${i + 1}`) +
                campo(`facetas.faq.items.${i}.respuesta`, `Respuesta ${i + 1}`, 2)
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
            <button class="btn btn--fantasma" id="btn-lote" type="button">↧ Volcar al muro</button>
            <div class="ayuda">Una reseña por bloque, separadas por una línea en blanco: la primera línea es el nombre y el resto el texto. Van reemplazando las tarjetas guía desde la primera.</div>
          </div>` +
          tarjetasMuro
      }
    };
  }

  // ---- el modal de edición ----

  let modalSec = null; // sección abierta

  function cerrarModalEdicion() {
    document.getElementById("editor-modal")?.remove();
    modalSec = null;
    modalDef = null;
  }

  let modalDef = null; // def activa del modal (bloque fijo o section)

  function refrescarModal() {
    const cuerpo = document.getElementById("editor-modal-cuerpo");
    if (cuerpo && modalDef) cuerpo.innerHTML = modalDef.html();
  }

  // ---- editor de una section incrustada ----

  const ANCLAS_UBICACION = [
    ["top", "Al principio de la página"],
    ["hero", "Después del encabezado"],
    ["clientes", "Después del muro de clientes"],
    ["faq", "Después de las preguntas"],
    ["iconos", "Después de los beneficios"],
    ["stats", "Después de las estadísticas"],
    ["resenas", "Después de las reseñas"],
    ["recomendados", "Al final de la página"]
  ];

  function defSeccion(secId) {
    const secs = estado.pagina.data.secciones || [];
    const i = secs.findIndex((s) => s.id === secId);
    if (i < 0) return null;
    const s = secs[i];
    return {
      titulo: s.tipo === "videos" ? "Videos de producto" : "Carrusel de imágenes",
      html: () => htmlSeccion(secs[i], i)
    };
  }

  function htmlSeccion(s, i) {
    const base = `secciones.${i}`;
    const ubicacion = `
      <div class="campo campo--editor">
        <label>Ubicación en la página</label>
        <select data-ruta="${base}.ancla">
          ${ANCLAS_UBICACION.map(
            ([v, t]) => `<option value="${v}" ${(s.ancla || "top") === v ? "selected" : ""}>${t}</option>`
          ).join("")}
        </select>
      </div>`;
    const tituloCampo = s.tipo === "videos" ? campo(`${base}.titulo`, "Título de la sección") : "";
    const cabecera = tituloCampo + ubicacion;

    let items = "";
    if (s.tipo === "videos") {
      items = (s.items || [])
        .map(
          (it, j) => `
          <fieldset class="sec-item">
            <legend>Video ${j + 1}${manijasItem(i, j, s.items.length)}</legend>
            ${campo(`${base}.items.${j}.url`, "Enlace del video (YouTube, Vimeo o MP4)")}
            <label class="btn btn--fantasma btn--chico sec-subir-video" style="cursor:pointer">⬆ Subir video de tu computadora
              <input type="file" accept="video/*" hidden data-video-el="${i}:${j}">
            </label>
            ${it.url && /^https?:\/\/cdn\.shopify/.test(it.url) ? `<div class="ayuda" style="margin-top:6px">Video subido ✓</div>` : ""}
            <details class="resena-edit__foto">
              <summary>🖼 Miniatura (opcional)${it.poster ? " · elegida" : ""}</summary>
              ${selectorImagenUno(`${base}.items.${j}.poster`, "", true)}
            </details>
          </fieldset>`
        )
        .join("");
      items += `<button class="btn btn--fantasma" type="button" data-sec-add="${i}:video">＋ Agregar video</button>`;
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
      items += `<button class="btn btn--fantasma" type="button" data-sec-add="${i}:imagen">＋ Agregar imagen</button>`;
    }

    return (
      cabecera +
      `<div class="cod-separador"></div>` +
      items +
      `<div class="cod-separador"></div>
       <button class="btn btn--fantasma sec-borrar" type="button" data-sec-borrar="${s.id}">🗑 Eliminar esta sección</button>`
    );
  }

  // ↑↓ y ✕ de cada clip del muro de clientes
  const manijasMuro = (i, total) => `
    <span class="sec-item__manijas">
      <button type="button" data-muro-mov="${i}:-1" ${i === 0 ? "disabled" : ""}>↑</button>
      <button type="button" data-muro-mov="${i}:1" ${i === total - 1 ? "disabled" : ""}>↓</button>
      <button type="button" data-muro-del="${i}">✕</button>
    </span>`;

  // ↑↓ y ✕ de cada item de una section
  const manijasItem = (i, j, total) => `
    <span class="sec-item__manijas">
      <button type="button" data-sec-mov="${i}:${j}:-1" ${j === 0 ? "disabled" : ""}>↑</button>
      <button type="button" data-sec-mov="${i}:${j}:1" ${j === total - 1 ? "disabled" : ""}>↓</button>
      <button type="button" data-sec-item-del="${i}:${j}">✕</button>
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
      secs[+i].items.push(tipo === "video" ? { url: "", poster: null } : { media_id: null, caption: "", link: "" });
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
      cerrarModalEdicion();
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
    cerrarModalEdicion();
    const def = id.startsWith("sec:") ? defSeccion(id.slice(4)) : seccionesPagina()[id];
    if (!def) return;
    modalSec = id;
    modalDef = def;

    const m = document.createElement("div");
    m.className = "editor-modal";
    m.id = "editor-modal";
    m.innerHTML = `
      <div class="editor-modal__caja">
        <div class="editor-modal__cab">
          <span>${def.titulo}</span>
          <button class="editor-modal__x" type="button" aria-label="Cerrar">×</button>
        </div>
        <div class="editor-modal__cuerpo" id="editor-modal-cuerpo">${def.html()}</div>
        <div class="editor-modal__pie">
          <button class="btn btn--acento" id="editor-modal-guardar" type="button">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(m);

    m.addEventListener("input", (e) => {
      if (e.target.dataset.ruta) actualizarDato(e.target);
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
          `<div class="error">✖ Solo se pueden soltar videos, imágenes o GIFs.</div>`
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
        `<div class="error">✖ No se pudo subir el video: ${esc(e.message)}</div>`
      );
    }
  }

  // ---- el botón "✎ Editar" flotante adentro del iframe ----

  // A qué modal lleva cada bloque de la página. El orden importa: gana el
  // primer selector que matchee con closest().
  const ZONAS_EDICION = [
    { sel: ".hero__galeria", id: "galeria" },
    { sel: ".hero__bullets", id: "bullets" },
    { sel: ".hero__resenas, .hero__titulo, .hero__subtitulo, .hero__precios, .hero__cantidad", id: "encabezado" },
    { sel: ".acordeon", id: "acordeones" },
    { sel: ".resena-destacada", id: "destacada" },
    { sel: ".iconos", id: "iconos" },
    { sel: ".stats", id: "stats" },
    { sel: ".faq", id: "faq" },
    { sel: ".resenas", id: "resenas" },
    { sel: ".muro", id: "clientes" }
  ];

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
      #tiq-edit-bar { position: absolute; z-index: 99999; display: none; gap: 6px;
        font: 600 13px/1 Inter, -apple-system, sans-serif; }
      #tiq-edit-bar button { display: flex; align-items: center; gap: 6px;
        background: #fff; border: 1px solid #d9d9de; border-radius: 9px; box-shadow: 0 4px 14px rgba(0,0,0,.16);
        padding: 8px 12px; color: #1a1a1a; cursor: pointer; font: inherit; }
      #tiq-edit-bar button:hover { background: #f6f6f7; }
      #tiq-edit-bar .tiq-del { color: #dc2626; }
      #tiq-edit-bar .tiq-del:hover { background: #fdeaea; }
      .tiq-zona-hover { outline: 2px dashed #4f46e5; outline-offset: 5px; border-radius: 4px; }`;
    doc.head.appendChild(st);

    const bar = doc.createElement("div");
    bar.id = "tiq-edit-bar";
    bar.innerHTML = `<button class="tiq-editar" type="button">✎ Editar</button><button class="tiq-del" type="button" title="Eliminar sección" style="display:none">🗑</button>`;
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
      btnDel.style.display = hit.id.startsWith("sec:") ? "flex" : "none"; // borrar solo sections
      btn.style.display = "flex";
      btn.style.top = `${scrollY + r.top + 12}px`;
      btn.style.left = `${Math.max(10, Math.min(r.right - 150, doc.documentElement.clientWidth - 160))}px`;
    });

    btnEditar.addEventListener("click", () => abrirModalEdicion(btn.dataset.sec));
    btnDel.addEventListener("click", () => {
      const id = btn.dataset.sec;
      if (!id.startsWith("sec:")) return;
      if (!confirm("¿Eliminar esta sección de la página?")) return;
      const secs = estado.pagina.data.secciones;
      const idx = secs.findIndex((s) => s.id === id.slice(4));
      if (idx > -1) secs.splice(idx, 1);
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
        vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ No se pudo subir la imagen: ${esc(e.message)}</div>`);
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
    faq: "las preguntas", resenas: "las reseñas", recomendados: "los recomendados"
  };

  function montarDragSections(marco) {
    const panel = $("panel-sections");
    if (!panel) return;
    panel.querySelectorAll(".section-card").forEach((card) => {
      card.addEventListener("pointerdown", (e) => iniciarDragSection(e, card, marco));
    });
  }

  function iniciarDragSection(ev, card, marco) {
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
      "position:absolute;left:0;right:0;height:3px;background:#4f46e5;z-index:100000;display:none;box-shadow:0 0 0 4px rgba(79,70,229,.15);border-radius:2px;pointer-events:none";
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
    const nueva =
      tipo === "videos"
        ? { id: "s" + Date.now(), tipo: "videos", ancla, items: [{ url: "", poster: null }, { url: "", poster: null }, { url: "", poster: null }] }
        : { id: "s" + Date.now(), tipo: "carrusel", ancla, items: [{ media_id: null, caption: "", link: "" }, { media_id: null, caption: "", link: "" }, { media_id: null, caption: "", link: "" }, { media_id: null, caption: "", link: "" }] };
    estado.pagina.data.secciones.push(nueva);
    marcarSucio();
    repintarPreview();
  }

  // ---- reacción a cada tecla ----

  function actualizarDato(el) {
    let v = el.value;
    if (el.dataset.tipo === "numero") v = Number(v) || 0;
    if (el.dataset.nulo === "1" && v.trim() === "") v = null;
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
      b.disabled = false;
      b.textContent = "Guardar cambios";
      b.classList.add("btn--acento");
      b.classList.remove("btn--fantasma");
    }
    const h = $("hint-republicar");
    if (h && estado.pagina.estado === "publicada") h.style.display = "";
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
      const item = { autor, estrellas: 5, imagen: null, texto };
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
      b.disabled = true;
      b.textContent = "Guardando…";
    }
    try {
      estado.pagina = await api(`/paginas/${estado.pagina.id}`, {
        method: "PUT",
        body: { data: estado.pagina.data }
      });
      sucio = false;
      if (b) {
        b.textContent = "✓ Guardado";
        b.classList.remove("btn--acento");
        b.classList.add("btn--fantasma");
      }
      return true;
    } catch (e) {
      if (b) {
        b.disabled = false;
        b.textContent = "Guardar cambios";
      }
      vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ No se pudo guardar: ${esc(e.message)}</div>`);
      return false;
    }
  }

  // Catálogo de sections arrastrables. Cada una tiene su mini-ilustración.
  const SECTIONS_DISPONIBLES = [
    {
      tipo: "videos",
      nombre: "Videos de producto",
      desc: "Carrusel de videos (YouTube, Vimeo o MP4)",
      mini: `<div class="section-card__mini section-card__mini--videos"><span></span><span></span><span></span></div>`
    },
    {
      tipo: "carrusel",
      nombre: "Carrusel de imágenes",
      desc: "Galería deslizable de fotos",
      mini: `<div class="section-card__mini section-card__mini--imgs"><span></span><span></span><span></span><span></span></div>`
    }
  ];

  function pantallaPreview() {
    const pg = estado.pagina;
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

    vista.innerHTML = `
      <button class="volver" id="volver">← ${
        estado.volverA === "paginas" ? "Volver a mis páginas" : "Volver a los productos"
      }</button>

      ${
        publicada && pg.url_publica
          ? `<div class="exito">
               <div class="exito__titulo">✅ Publicada en tu tienda</div>
               <a href="${esc(pg.url_publica)}" target="_blank">${esc(pg.url_publica)}</a>
             </div>`
          : ""
      }

      ${
        pg.avisos?.length
          ? `<div class="avisos">
               <strong>⚠ ${pg.avisos.length} aviso${pg.avisos.length > 1 ? "s" : ""} de la validación</strong>
               <ul>${pg.avisos.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
             </div>`
          : ""
      }

      <div class="preview-barra">
        <div class="preview-barra__info">
          <div class="preview-barra__titulo">${esc(pg.data.facetas.hero.titulo)}</div>
          <div class="preview-barra__sub">${esc(pg.data.facetas.hero.subtitulo)}</div>
        </div>
        <button class="btn btn--fantasma" id="guardar" disabled>✓ Guardado</button>
        <button class="btn btn--fantasma" id="regenerar">↻ Regenerar</button>
        <button class="btn ${publicada ? "btn--fantasma" : "btn--acento"}" id="publicar">
          ${publicada ? "↻ Volver a publicar" : "▲ Publicar página"}
        </button>
      </div>

      <div class="aviso-republicar" id="hint-republicar" style="display:none">
        ⚠ Los cambios se guardan acá, pero en la tienda no se ven hasta que vuelvas a publicar.
      </div>

      <div class="editor-hint">✎ Pasá el mouse por cualquier bloque y tocá <strong>Editar</strong>. Arrastrá una <strong>sección</strong> del panel izquierdo a la página para sumarla.</div>

      <div class="constructor">
        <aside class="panel-sections" id="panel-sections">
          <div class="panel-sections__titulo">Secciones</div>
          <div class="panel-sections__ayuda">Arrastralas a la página</div>
          ${SECTIONS_DISPONIBLES.map(
            (s) => `
            <div class="section-card" data-nueva="${s.tipo}" title="Arrastrar a la página">
              ${s.mini}
              <div class="section-card__txt">
                <div class="section-card__nombre">${s.nombre}</div>
                <div class="section-card__desc">${s.desc}</div>
              </div>
              <span class="section-card__grip">⠿</span>
            </div>`
          ).join("")}
        </aside>

        <div class="marco marco--full">
          <iframe id="marco" src="/preview/index.html?app=1&t=${Date.now()}"></iframe>
        </div>
      </div>`;

    // El iframe no lee ningún archivo global: recibe LOS DATOS DE ESTA página
    // por mensaje. Dos merchants generando a la vez no se pisan. El botón
    // "✎ Editar" flotante y los lápices se montan una vez por carga.
    const marco = $("marco");
    marco.onload = () => {
      repintarPreview();
      montarEdicionEnIframe(marco);
      montarDragSections(marco);
    };

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
  }

  async function publicar() {
    // Publicar con cambios sin guardar los guardaría a medias: primero el PUT.
    if (sucio && !(await guardarCambios())) return;

    const b = $("publicar");
    b.disabled = true;
    b.textContent = "Publicando…";
    try {
      estado.pagina = await api(`/paginas/${estado.pagina.id}/publicar`, { method: "POST" });
      pantallaPreview();
    } catch (e) {
      b.disabled = false;
      b.textContent = "▲ Publicar página";
      vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ ${esc(e.message)}</div>`);
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
      el.innerHTML = `⚠ El texto de la insignia se lee mal (contraste ${c.toFixed(1)}:1). <button type="button" class="bdl-fixc" data-fix-contraste>Arreglar</button>`;
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
      ofertas: [
        { cantidad: 1, descuento: 0,  titulo: "Comprá 1", subtitulo: "Precio normal", etiqueta: "",        badge: "",            popular: false, predeterminada: false },
        { cantidad: 2, descuento: 10, titulo: "Comprá 2", subtitulo: "",              etiqueta: "10% OFF", badge: "Más elegido", popular: true,  predeterminada: true },
        { cantidad: 3, descuento: 15, titulo: "Comprá 3", subtitulo: "",              etiqueta: "15% OFF", badge: "Mejor valor", popular: false, predeterminada: false }
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

  // Toast reutilizable: feedback de acciones, con "Deshacer" opcional.
  function toast(msg, opts = {}) {
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

  async function pantallaBundles() {
    if (!estado.bundles) {
      try {
        estado.bundles = { config: await api("/bundles"), vista: "lista", editIdx: null, tab: "ofertas", sucio: false, previewProd: null, metricas: null };
      } catch (e) {
        vista.innerHTML = `<div class="error">✖ No se pudo leer los bundles: ${esc(e.message)}</div>`;
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
      <div class="bdl-metrica__t">${esc(titulo)} <span class="bdl-metrica__i" title="${esc(ayuda || "")}">ⓘ</span></div>
      <div class="bdl-metrica__v">${esc(valor)}</div>
    </div>`;
  }

  // Métricas reales: se calculan en el server sobre los pedidos que traen
  // aplicado alguno de nuestros descuentos. Mientras cargan, se muestran "—"
  // en vez de ceros (un cero acá es un dato, no un placeholder).
  function bloqueMetricas() {
    const m = estado.bundles.metricas;
    const rango = estado.bundles.rango || 30;
    const selector = `<div class="bdl-rango" role="group" aria-label="Rango de tiempo">
      ${[7, 30, 90].map((d) => `<button class="bdl-rango__b ${rango === d ? "is-sel" : ""}" data-rango="${d}">${d} días</button>`).join("")}
    </div>`;
    if (!m) {
      // Skeleton mientras cargan (un "0" o "—" fijo lee a dato falso).
      const sk = (t) => `<div class="bdl-metrica"><div class="bdl-metrica__t">${esc(t)}</div><div class="bdl-metrica__v"><span class="bdl-sk"></span></div></div>`;
      return selector + `<div class="bdl-metricas">
        ${sk("Pedidos con bundle")}${sk("Ingresos")}${sk("Ticket promedio")}${sk("Descuento aplicado")}
      </div>`;
    }
    const plata = (n) =>
      "$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return selector + `
      <div class="bdl-metricas">
        ${tarjetaMetrica("Pedidos con bundle", String(m.pedidos), `Pedidos de los últimos ${m.dias} días que llegaron con un descuento de TiendaIQ aplicado.`)}
        ${tarjetaMetrica("Ingresos", plata(m.ingresos), "Suma del total de esos pedidos.")}
        ${tarjetaMetrica("Ticket promedio", plata(m.ticket), "Ingresos divididos por la cantidad de pedidos con bundle.")}
        ${tarjetaMetrica("Descuento aplicado", plata(m.descuento), "Total de descuentos otorgados en esos pedidos.")}
      </div>
      <div class="panel__sub" style="margin:-8px 0 18px">
        Últimos ${m.dias} días · moneda ${esc(m.moneda)}${m.parcial ? " · muestra parcial (se recorrieron los 500 pedidos más recientes)" : ""}
      </div>`;
  }

  // ---------- galería "Elegí el tema" (nueva, estilo Pumper) ----------
  // Paleta de acentos para los swatches (recolorea las previews en vivo).
  const BT_COLORES = ["#1a1a1a", "#16a34a", "#0d9488", "#0ea5e9", "#2563eb", "#4f46e5", "#7c3aed", "#db2777", "#e11d48", "#ea580c", "#92400e", "#b45309"];

  // Crea un bundle del tipo elegido y salta al editor.
  function crearDesdeTema(tipo) {
    const nb = nuevoBundleLocal(tipo);
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
        ${bv ? `<span class="bt-bv">Best Value</span>` : ""}
        <span class="bt-radio"></span>
        <span class="bt-row__main"><b>Buy ${n}</b> ${pill ? `<span class="bt-pill">${pill}</span>` : `<span class="bt-std">Standard Price</span>`}</span>
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
      ${rowBogo("Buy 1", "Standard Price", "$10.00", "", true)}
      ${rowBogo("Buy 2 Get 1 Free!", "33% OFF", "$20.00", "$30.00", false)}
      ${rowBogo("Buy 3 Get 2 Free!", "40% OFF", "$30.00", "$50.00", false)}`;

    // --- Card 3: Unlock Free Gifts ---
    const cardGift = `
      <div class="bt-row is-sel">
        <span class="bt-radio"></span>
        <span class="bt-row__main"><b>Single</b> <span class="bt-std">Standard Price</span>
          <span class="bt-size">Size <select disabled><option>S</option></select></span></span>
        <span class="bt-price">$10.00</span>
      </div>
      <div class="bt-row">
        <span class="bt-bv bt-bv--pop">Most Popular</span>
        <span class="bt-radio"></span>
        <span class="bt-row__main"><b>Duo</b> <span class="bt-sub">You Save $4.00</span></span>
        <span class="bt-price">$16.00 <s>$20.00</s></span>
      </div>
      <div class="bt-row bt-gift"><span class="bt-gift__ico">${GIFT}</span><span class="bt-row__main"><b>+1 FREE GIFT</b></span><span class="bt-price"><s>$100.00</s></span></div>`;

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
        <button class="bt-card__btn ${activo ? "" : "is-soon"}" ${activo ? `data-tema="${tipo}"` : "disabled"}>${activo ? btnTxt : "Próximamente"}</button>
      </div>`;

    vista.innerHTML = `
      <div class="bt" style="--bt-ac:${ac}">
        <div class="bt-cab">
          <button class="volver-flecha" id="bt-volver">←</button>
          <div><h1>Elegí el tema de bundle ganador</h1><p>Personalización completa justo después</p></div>
          <div class="bt-sws">${BT_COLORES.map((c) => `<button class="bt-sw ${c === ac ? "is-sel" : ""}" data-color="${c}" style="--sw:${c}" aria-label="Color ${c}"></button>`).join("")}</div>
        </div>
        <div class="bt-grid">
          ${card("Buy More Save More", cardVolumen, "Personalizar ahora", "volumen", true)}
          ${card("BOGO Offers", cardBogo, "Personalizar ahora", "bxgy", false)}
          ${card("Unlock Free Gifts", cardGift, "Personalizar ahora", "gift", false)}
          ${card("Bundle y Ahorrá", cardCombo, "Crear un Paquete", "combo", false)}
        </div>
      </div>`;

    $("bt-volver").onclick = () => { estado.bundles.vista = "lista"; pintarDashboardBundles(); };
    vista.querySelectorAll(".bt-sw").forEach((b) => (b.onclick = () => { estado.bundles.temaColor = b.dataset.color; pantallaBundleTemas(); }));
    vista.querySelectorAll(".bt-card__btn[data-tema]").forEach((b) => (b.onclick = () => crearDesdeTema(b.dataset.tema)));
  }

  function pintarDashboardBundles() {
    const lista = estado.bundles.config.lista || [];
    const inst = estado.bundles.config.instalado;

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

    // Ingresos por-bundle (atribuidos por el título del descuento). Skeleton
    // mientras cargan; un bundle sin ventas todavía muestra $0 (dato real).
    const met = estado.bundles.metricas;
    const fmtIngr = (nombre) => {
      if (!met) return `<span class="bdl-sk bdl-sk--s"></span>`;
      const pb = met.porBundle && met.porBundle[nombre];
      const v = pb ? pb.ingresos : 0;
      return `<span class="bdl-fila2__ingr-v" title="Ingresos atribuidos en ${met.dias} días">$${Number(v).toLocaleString("es-AR", { maximumFractionDigits: 0 })}</span>`;
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
        <div class="bdl-fila2__ingr">${fmtIngr(b.nombre)}</div>
        <div class="bdl-fila2__estado">
          <button class="be-toggle ${on ? "is-on" : ""}" data-toggle-activo="${i}" role="switch" aria-checked="${on}" title="${on ? "Activo — clic para pausar" : "Pausado — clic para activar"}"><span></span></button>
        </div>
        <div class="bdl-fila2__acc"><button class="bdl-acc-btn" data-acc="${i}" aria-label="Más acciones">⋯</button></div>
      </div>`;
    };

    const tabsHTML = `<div class="cod-tabs bdl-filtros">
      <button class="cod-tab ${filtro === "todas" ? "cod-tab--activa" : ""}" data-filtro="todas">Todas <span class="bdl-filtros__n">${lista.length}</span></button>
      <button class="cod-tab ${filtro === "activas" ? "cod-tab--activa" : ""}" data-filtro="activas">Activas <span class="bdl-filtros__n">${nAct}</span></button>
      <button class="cod-tab ${filtro === "pausadas" ? "cod-tab--activa" : ""}" data-filtro="pausadas">Pausadas <span class="bdl-filtros__n">${nPaus}</span></button>
    </div>`;

    const cuerpoTabla = visibles.length
      ? `<div class="tarjeta bdl-tabla2">
          <div class="bdl-tabla2__cab"><span class="bdl-check"><input type="checkbox" data-selall ${visibles.length && visibles.every(({ b }) => sel.includes(b.id)) ? "checked" : ""} aria-label="Seleccionar todo"></span><span></span><span>Bundle</span><span>Alcance</span><span>Ingresos${met ? ` (${met.dias}d)` : ""}</span><span>Estado</span><span></span></div>
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
          <button class="bdl-bulk__x" data-bulk="limpiar" aria-label="Deseleccionar">✕</button>
        </div>`
      : "";

    // Estado del widget: sutil cuando está OK (no un banner verde permanente,
    // que grita MVP), banner de aviso solo si NO está inyectado.
    const widgetEstado = inst
      ? `<div class="bdl-wstatus"><span class="bdl-wdot" aria-hidden="true"></span><span class="bdl-wtxt">Widget activo en <strong>${esc(inst.tema)}</strong></span><span class="bdl-wfecha">${esc(fechaCorta(inst.fecha))}</span><button class="bdl-wlink" id="bdl-instalar">Reinyectar</button></div>`
      : lista.length
        ? `<div class="cod-banner cod-banner--aviso">⚠ Los bundles no están inyectados en tu tema: no aparecen en la tienda. <button class="btn btn--chico" id="bdl-instalar">▲ Inyectar en el tema</button></div>`
        : "";

    const pasoOnb = (hecho, texto, accion) =>
      `<div class="bdl-paso ${hecho ? "is-ok" : ""}"><span class="bdl-paso__c">${hecho ? "✓" : ""}</span><span class="bdl-paso__t">${texto}</span><span class="bdl-paso__a">${hecho ? "Listo" : accion}</span></div>`;
    const nHechos = inst ? 1 : 0;
    const onboarding = `
      <div class="tarjeta bdl-onboard">
        <div class="bdl-onboard__cab"><strong>Primeros pasos</strong><span class="panel__sub">${nHechos} de 3 completado${nHechos === 1 ? "" : "s"}</span></div>
        <div class="bdl-onboard__bar"><i style="width:${Math.round((nHechos / 3) * 100)}%"></i></div>
        ${pasoOnb(!!inst, "Activá el widget en tu tema", `<button class="btn btn--chico" id="bdl-instalar">Inyectar</button>`)}
        ${pasoOnb(false, "Creá tu primer bundle", `<button class="btn btn--chico bdl-onb-crear">Crear</button>`)}
        ${pasoOnb(false, "Previsualizá en tu tienda", `<span class="panel__sub">tras crear</span>`)}
      </div>
      <div class="tarjeta bdl-vacio">
        <div class="bdl-vacio__ico">${ICO_BOX}</div>
        <div class="bdl-vacio__t">Creá tu primer bundle</div>
        <div class="bdl-vacio__s">Subí el ticket promedio con descuentos por volumen (comprá más, pagá menos) o "comprá X y obtené Y".</div>
        <div class="bdl-plantillas">
          <button class="bdl-plant" data-plant="volumen">${ICO_BOX}<strong>Descuento por volumen</strong><span>Comprá más, pagá menos</span></button>
          <button class="bdl-plant" data-plant="bxgy">${ICO_GIFT}<strong>Comprá X y obtené Y</strong><span>Llevá una cantidad de regalo</span></button>
        </div>
      </div>`;

    vista.innerHTML = `
      <div class="inicio-cabecera">
        <h1><button class="volver-flecha" id="volver-inicio">←</button> Bundles, upsells y regalos</h1>
        <div class="inicio-cabecera__acciones"><button class="btn btn--marca" id="bdl-nuevo">＋ Crear bundle</button></div>
      </div>
      ${widgetEstado}
      ${lista.length ? bloqueMetricas() + tabsHTML + bulkBar + cuerpoTabla : onboarding}
      <div class="pagina-help">¿Dudas? Revisá la documentación de bundles.</div>`;

    $("volver-inicio").onclick = () => ir("inicio");
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

    // Selector de rango temporal: refetch con el nuevo rango.
    vista.querySelectorAll("[data-rango]").forEach((el) => (el.onclick = () => {
      estado.bundles.rango = Number(el.dataset.rango);
      estado.bundles.metricas = null; // fuerza skeleton + refetch
      pintarDashboardBundles();
    }));

    // Métricas reales: se piden (según el rango) y se repintan al llegar.
    if (!estado.bundles.metricas) {
      api("/bundles/metricas?dias=" + (estado.bundles.rango || 30))
        .then((m) => {
          estado.bundles.metricas = m;
          if (estado.bundles.vista === "lista") pintarDashboardBundles();
        })
        .catch(() => {});
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
      <button type="button" class="be-toggle ${on ? "is-on" : ""}" ${attr}><span></span></button></div>`;

  // ---------- EDITOR estilo Pumper (Tema 1: Descuento por Cantidad) ----------
  function pintarEditorBundle() {
    const b = bundleActual();
    if (!b) { estado.bundles.vista = "lista"; return pintarDashboardBundles(); }
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
    // Bundles muy viejos podían no tener `diseno`: sin esto, escribir
    // "diseno.geometry.radius" desde el slider tira TypeError (fijar no crea rutas).
    if (!b.diseno) b.diseno = {};
    // Geometría (Paso 2): radius unificado desde el legacy `radio`; breathing
    // arranca en 10 (≈ densidad actual, así el look no cambia en bundles viejos).
    if (b.diseno && !b.diseno.geometry) b.diseno.geometry = { radius: b.diseno.radio ?? 12, breathing: 10 };
    // Layout (Paso 4): plantilla vertical por defecto = comportamiento actual.
    if (b.diseno && !b.diseno.layout) b.diseno.layout = { template: "vertical" };
    // Tipografía (Paso 6): fuente heredada, pesos = los actuales (700/700).
    if (b.diseno && !b.diseno.type) b.diseno.type = { font: "heredar", titleWeight: 700, priceWeight: 700 };
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
        <button class="volver-flecha" id="bdl-volver">←</button>
        <h1>Crear un descuento por cantidad</h1>
        <div class="be-top__act">
          <button class="btn btn--fantasma" id="bdl-borrador">Guardar como borrador</button>
          <button class="btn" id="bdl-guardar">Publicar</button>
        </div>
      </div>
      <div class="be-layout">
        <div class="be-left" id="be-left">
          <div class="be-sec__title be-sec__title--top">Las ofertas ganadoras comienzan aquí</div>
          ${bdlSeccionSetup(b, s)}
          ${bdlSeccionNiveles(b, s)}
          <div class="be-guinda">
            <div class="be-guinda__t">La guinda del pastel</div>
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

    bindEditorBundle(b, s);
    pintarPreviewBundle();

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
            <div class="campo campo--editor" style="flex:1">${campoBdl("diseno.titulo", "Texto de encabezado").replace(/^<div class="campo campo--editor">|<\/div>$/g, "")}</div>
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
      <button class="be-sec__head" data-sec="setup"><span>Select Product & Basic Setup</span><span class="be-chev ${s.setupOpen ? "is-open" : ""}">⌄</span></button>
      ${cuerpo}
    </section>`;
  }

  // Sección "Editar Ofertas de Nivel": tarjetas colapsables por nivel.
  function bdlSeccionNiveles(b, s) {
    const cards = (b.ofertas || []).map((o, i) => bdlNivelCard(o, i, b, s)).join("");
    return `<section class="be-sec be-sec--plain">
      <div class="be-sec__title">Editar ofertas de nivel</div>
      <div class="be-lvs">${cards}</div>
      <button class="be-add" data-add-nivel>⊕ Agregar nivel</button>
    </section>`;
  }

  function bdlNivelCard(o, i, b, s) {
    const open = s.nivelOpen === i;
    const activo = o.activo !== false;
    const tipo = o.tipo_desc || (Number(o.descuento) > 0 ? "porcentaje" : "ninguno");
    const head = `
      <div class="be-lv__head">
        <span class="be-lv__drag">⠿</span>
        <button class="be-toggle ${activo ? "is-on" : ""}" data-lv-toggle="${i}" title="Prender/apagar nivel"><span></span></button>
        <span class="be-lv__name"><span class="be-lv__n">Nivel ${i + 1}:</span> <b>${esc(o.titulo || "Buy " + (Number(o.cantidad) || 1))}</b>${o.predeterminada ? '<span class="be-lv__chip">★ Por defecto</span>' : ""}</span>
        <button class="be-lv__icn" data-lv-dup="${i}" title="Duplicar nivel" aria-label="Duplicar nivel ${i + 1}">${BE_DUP}</button>
        <button class="be-lv__star ${o.predeterminada ? "is-star" : ""}" data-lv-star="${i}" title="Oferta predeterminada: es la que los clientes ven pre-seleccionada al entrar por primera vez" aria-label="Marcar como oferta predeterminada" aria-pressed="${o.predeterminada ? "true" : "false"}">${BE_STAR}</button>
        <button class="be-lv__chev ${open ? "is-open" : ""}" data-lv-open="${i}" title="Abrir/cerrar">${BE_CHEV}</button>
      </div>`;
    if (!open) return `<div class="be-lv${o.predeterminada ? " is-def" : ""}">${head}</div>`;

    const TIPOS = [["porcentaje", "% Descuento"], ["fijo", "Fijo"], ["especifico", "Precio específico"], ["bogo", "BOGO"], ["ninguno", "Ninguno"]];
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
      campos = `<div class="be-warn">⚠ Este tipo de descuento solo puede usarse con un producto seleccionado.</div>
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
          <div class="campo campo--editor"><label>Descuento en %</label><input type="number" data-b="ofertas.${i}.descuento" data-tipo="numero" min="0" max="100" value="${esc(o.descuento ?? 0)}"></div>${cant}</div>${redondeo}`;
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
          ${campoOjo(`ofertas.${i}.etiqueta`, "Etiqueta (ej. 20% OFF / Standard Price)", "etiqueta")}
          ${campoOjo(`ofertas.${i}.subtitulo`, "Subtítulo (ej. You Save $4.00)", "subtitulo")}
          ${campoOjo(`ofertas.${i}.badge`, "Insignia (ej. Most Popular / Best Value)", "badge")}
        </div>
        <div class="be-block">${beToggleRow("Marcar como agotado", `data-lv-bool="${i}:agotado"`, !!o.agotado, "Muestra el nivel como sin stock")}</div>
        ${(() => {
          const ad = o.addons || {};
          const btn = (key, ic, label) => `<button type="button" class="be-addon ${ad[key]?.on ? "is-on" : ""}" data-addon-toggle="${i}:${key}">${ic}<span>${label}</span></button>`;
          const cfgImagen = ad.imagen?.on ? `<div class="be-addon-cfg">
              <div class="be-addon-cfg__t">🖼 Agregar imagen<button class="be-addon-cfg__x" data-addon-toggle="${i}:imagen">Eliminar</button></div>
              ${ad.imagen.url
                ? `<div class="be-gift-sel"><span class="be-gift-sel__img"><img src="${esc(ad.imagen.url)}" alt=""></span><span class="be-gift-sel__n">Imagen cargada ✓</span><label class="be-gift-sel__ch" style="cursor:pointer">Cambiar<input type="file" accept="image/*" hidden data-addon-img="${i}"></label></div>`
                : `<label class="be-img-btn">⬆ Seleccionar imagen de tu computadora<input type="file" accept="image/*" hidden data-addon-img="${i}"></label>`}</div>` : "";
          const g = ad.regalo || {};
          const gifts = g.items || [];
          const sel = Math.min(g.sel || 0, Math.max(0, gifts.length - 1));
          const editorRegalo = (it, gi) => `
            <div class="be-gift__body">
              <div class="be-gift__thumb">${it.imagen ? `<img src="${esc(it.imagen)}" alt="">` : "🎁"}<button class="be-gift__cambiar" data-gift-pick="${i}:${gi}">Cambiar regalo</button></div>
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
              <div class="be-addon-cfg__t"><span>🎁 Regalo gratis</span>${gifts.length ? `<a class="be-gift__more" data-gift-add="${i}">Agregar más regalo</a>` : ""}</div>
              ${gifts.length
                ? `<div class="be-gift__tabs">${gifts.map((_, gi) => `<span class="be-gift__tab ${gi === sel ? "is-sel" : ""}" data-gift-tab="${i}:${gi}">Regalo ${gi + 1}<button data-gift-del="${i}:${gi}" title="Quitar">×</button></span>`).join("")}</div>${editorRegalo(gifts[sel], sel)}`
                : `<button class="be-gift-btn" data-addon-gift="${i}">＋ Seleccionar producto de regalo</button>`}</div>` : "";
          const cfgEnvio = ad.envio?.on ? `<div class="be-addon-cfg">
              <div class="be-addon-cfg__t">🚚 Envío gratis<button class="be-addon-cfg__x" data-addon-toggle="${i}:envio">Eliminar</button></div>
              <div class="campo campo--editor"><label>Texto</label><input type="text" data-b="ofertas.${i}.addons.envio.texto" value="${esc(ad.envio.texto || "FREE SHIPPING")}"></div></div>` : "";
          return `<div class="be-addons">
            <div class="be-addons__t">＋ Add-Ons</div>
            <div class="be-addons__row">
              ${btn("imagen", BE_IMG, "+ Imagen")}
              ${btn("regalo", BE_GIFT2, "+ Regalo gratis")}
              ${btn("envio", BE_TRUCK, "+ Envío Gratis")}
            </div>
            ${cfgImagen}${cfgRegalo}${cfgEnvio}
          </div>`;
        })()}
        <button class="be-del" data-lv-del="${i}">🗑 Eliminar nivel ${i + 1}</button>
      </div>`;
    return `<div class="be-lv is-open${o.predeterminada ? " is-def" : ""}">${head}${body}</div>`;
  }

  // Íconos de las secciones extra (estilo Polaris: 20px, stroke fino).
  const IC_PALETA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.3"/><circle cx="17" cy="10.5" r="1.3"/><circle cx="8.5" cy="7.5" r="1.3"/><circle cx="6.5" cy="12.5" r="1.3"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.4-4.5-8-10-8z"/></svg>`;
  const IC_ENGRANAJE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  const IC_GRID = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;
  const IC_ESQUINA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12V8a4 4 0 0 1 4-4h4"/><path d="M20 12v4a4 4 0 0 1-4 4h-4"/></svg>`;
  const IC_AIRE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7 4 12l4 5M16 7l4 5-4 5"/></svg>`;

  // Slider de geometría (Redondeo / Aire) — control continuo con valor a la
  // derecha, estilo Pumper. Escribe una ruta numérica del modelo (data-b).
  function sliderBdl(ruta, ico, etiqueta, min, max) {
    const v = leer(bundleActual(), ruta) ?? min;
    return `<div class="bdl-slider">
      <span class="bdl-slider__ico">${ico}</span>
      <label class="bdl-slider__lab" for="sl-${ruta.replace(/\W/g, "-")}">${esc(etiqueta)}</label>
      <input type="range" id="sl-${ruta.replace(/\W/g, "-")}" min="${min}" max="${max}" step="1" data-b="${ruta}" data-tipo="numero" data-slider value="${esc(v)}">
      <output class="bdl-slider__val">${esc(v)} / ${max}</output>
    </div>`;
  }

  // Select atado a una ruta del modelo. opciones = [[valor, etiqueta], ...].
  function selectBdl(ruta, etiqueta, opciones, tipo) {
    const v = leer(bundleActual(), ruta);
    const opts = opciones.map(([val, lab]) => `<option value="${esc(val)}" ${String(v) === String(val) ? "selected" : ""}>${esc(lab)}</option>`).join("");
    return `<div class="campo campo--editor"><label>${esc(etiqueta)}</label><select data-b="${ruta}"${tipo ? ` data-tipo="${tipo}"` : ""}>${opts}</select></div>`;
  }

  // Mapa "Personalizar": refleja el color tocado en la mini-tarjeta del editor
  // sin re-renderizar (targeted update, como el valor del slider).
  function actualizarMiniPerso(token, v) {
    const card = document.querySelector("[data-mid-card]");
    if (!card) return;
    const el = (k) => card.querySelector(`[data-mid-el="${k}"]`);
    if (token === "color_borde") { card.style.borderColor = v; const d = el("dot"); if (d) d.style.borderColor = v; }
    else if (token === "color_badge") { const b = el("badge"); if (b) b.style.background = v; }
    else if (token === "color_badge_texto") { const b = el("badge"); if (b) b.style.color = v; }
    else if (token === "color_etiqueta") { const e = el("etq"); if (e) { e.style.color = v; e.style.borderColor = v; } }
    else if (token === "color_texto") { const t = el("title"); if (t) t.style.color = v; }
  }

  // Un acordeón de la columna izquierda (mismo componente que "Select Product").
  function bdlAcordeon(id, ico, titulo, cuerpo, abierto) {
    return `<div class="be-sec">
      <button class="be-sec__head" data-sec="${id}"><span class="be-sec__lead"><span class="be-sec__ico">${ico}</span><span>${esc(titulo)}</span></span><span class="be-chev ${abierto ? "is-open" : ""}">⌄</span></button>
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
        <span class="bdl-tpl__name">${nombre}${tpl === id ? " ✓" : ""}</span></button>`;
    const colorYEstilo = `
      <div class="bdl-hist">
        <button type="button" id="bdl-undo" class="bdl-histbtn" data-hist="-1" title="Deshacer" ${histDe(b).idx <= 0 ? "disabled" : ""}>↩</button>
        <button type="button" id="bdl-redo" class="bdl-histbtn" data-hist="1" title="Rehacer" ${histDe(b).idx >= histDe(b).stack.length - 1 ? "disabled" : ""}>↪</button>
      </div>
      <div class="bdl-subsec">Diseño de plantilla</div>
      <div class="bdl-tpls">${tplCard("vertical", "Vertical", "v")}${tplCard("horizontal", "Horizontal", "h")}</div>
      <div class="bdl-subsec">Diseño</div>
      ${sliderBdl("diseno.geometry.radius", IC_ESQUINA, "Redondeo de esquinas", 0, 50)}
      ${sliderBdl("diseno.geometry.breathing", IC_AIRE, "Espacio de aire", 4, 24)}
      <div class="bdl-subsec">Paletas de colores</div>
      <div class="bdl-presets">${presets}</div>
      <div class="bdl-subsec">Forma de la insignia</div>
      <div class="bdl-badgeformas">
        ${FORMAS_BADGE.map(([k, nombre]) => `<button type="button" class="bdl-bform ${(leer(b, "diseno.badge_forma") || "soft") === k ? "is-sel" : ""}" data-badgeforma="${k}" aria-label="Insignia ${nombre}"><span class="bdl-bform__prev"><span class="tiq-bdl__badge tiq-bdl__badge--${k}">Top</span></span><span class="bdl-bform__n">${nombre}</span></button>`).join("")}
      </div>
      <div class="bdl-subsec">Personalizar</div>
      ${(() => {
        const dc = (t, def) => esc(leer(b, "diseno." + t) || def);
        const sw = (token, etiqueta, def) => `<label class="perso-sw"><input type="color" data-b="diseno.${token}" data-mid="${token}" value="${dc(token, def)}"><span class="perso-sw__lab">${etiqueta}</span><span class="perso-sw__line"></span></label>`;
        return `<div class="perso">
          <div class="perso-col perso-col--l">
            ${sw("color_borde", "Borde", "#111111")}
            ${sw("color_badge", "Insignia", "#111111")}
            ${sw("color_etiqueta", "Etiqueta", "#e11d48")}
          </div>
          <div class="perso-mid" data-mid-card style="border-color:${dc("color_borde", "#111")}">
            <span class="perso-mid__badge" data-mid-el="badge" style="background:${dc("color_badge", "#111")};color:${dc("color_badge_texto", "#fff")}">Más elegido</span>
            <span class="perso-mid__dot" data-mid-el="dot" style="border-color:${dc("color_borde", "#111")}"></span>
            <span class="perso-mid__title" data-mid-el="title" style="color:${dc("color_texto", "#111")}">Comprá 2</span>
            <span class="perso-mid__etq" data-mid-el="etq" style="color:${dc("color_etiqueta", "#e11d48")};border-color:${dc("color_etiqueta", "#e11d48")}">10% OFF</span>
          </div>
          <div class="perso-col perso-col--r">
            ${sw("color_texto", "Texto", "#111111")}
            ${sw("color_badge_texto", "Texto insignia", "#ffffff")}
          </div>
        </div>
        ${(() => {
          const c = contrasteWCAG(leer(b, "diseno.color_badge") || "#111111", leer(b, "diseno.color_badge_texto") || "#ffffff");
          return c < 4.5
            ? `<div class="perso-aviso" id="bdl-aviso-contraste">⚠ El texto de la insignia se lee mal (contraste ${c.toFixed(1)}:1). <button type="button" class="bdl-fixc" data-fix-contraste>Arreglar</button></div>`
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
    return `<div class="be-secs-extra">
      ${bdlAcordeon("color", IC_PALETA, "Color y estilo", colorYEstilo + textosYTipo, !!s.secOpen.color)}
      ${bdlAcordeon("avanzada", IC_ENGRANAJE, "Configuración avanzada", avanzada, !!s.secOpen.avanzada)}
    </div>`;
  }

  function bindEditorBundle(b, s) {
    const root = $("be-left");
    if (!root) return;

    root.addEventListener("input", (e) => {
      const ruta = e.target.dataset.b;
      if (!ruta) return;
      let v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (e.target.dataset.tipo === "numero") v = Number(v) || 0;
      fijar(b, ruta, v);
      // Editar un color a mano rompe el vínculo con el preset: deja de marcarlo
      // como "Rosa" y pasa a "personalizado" (el swatch se des-resalta al re-render).
      if (/^diseno\.(color_|boton\.color)/.test(ruta) && b.diseno && b.diseno.preset) {
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
      const del = t.closest("[data-lv-del]"); if (del) { b.ofertas.splice(+del.dataset.lvDel, 1); if (!b.ofertas.length) b.ofertas.push({ cantidad: 1, descuento: 0, titulo: "Buy 1", ver: {}, activo: true }); s.nivelOpen = null; marcarSucioBundles(); return pintarEditorBundle(); }
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
      const add = t.closest("[data-add-nivel]"); if (add) { const n = b.ofertas.length + 1; b.ofertas.push({ cantidad: n, descuento: 0, titulo: "Buy " + n, subtitulo: "", etiqueta: "", badge: "", popular: false, activo: true, ver: {} }); s.nivelOpen = b.ofertas.length - 1; marcarSucioBundles(); return pintarEditorBundle(); }
    });

    if (b.activador?.tipo === "productos" && !(estado.productos || []).length) {
      api("/productos").then((prods) => { estado.productos = prods; if (estado.bundles.vista === "editor") pintarEditorBundle(); }).catch(() => {});
    }
  }

  // Activador compartido por los dos tipos de bundle.
  function bloqueActivador(b) {
    const a = b.activador || { tipo: "todos", ids: [] };
    return `
      <div class="campo campo--editor">
        <label>Se aplica a</label>
        <select data-b="activador.tipo">
          <option value="todos" ${a.tipo === "todos" ? "selected" : ""}>Todos los productos</option>
          <option value="productos" ${a.tipo === "productos" ? "selected" : ""}>Productos específicos</option>
        </select>
      </div>
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
            ${b.ofertas.length > 1 ? `<button class="bdl-oferta__del" data-oferta-del="${i}" title="Quitar">✕</button>` : ""}
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
            <label class="cod-check"><input type="radio" name="bdl-pred" data-pred="${i}" ${o.predeterminada ? "checked" : ""}> Seleccionada por defecto</label>
          </div>
        </div>`)
      .join("");

    return `
      <div class="tarjeta__titulo">Ofertas</div>
      <div class="panel__sub">Creá los peldaños de precio. El más conveniente se aplica solo en el checkout.</div>

      ${campoBdl("nombre", "Nombre del bundle")}
      ${bloqueActivador(b)}

      <div class="bdl-ofertas">${ofertas}</div>
      ${b.ofertas.length < 3 ? `<button class="btn btn--fantasma btn--chico" id="bdl-add-oferta">＋ Agregar oferta</button>` : `<div class="panel__sub">Máximo 3 ofertas.</div>`}`;
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
          <span class="bdl-prod__foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : "🖼"}</span>
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
        <span class="cod-color__fila"><input type="color" data-b="${ruta}" value="${esc(v || "#000000")}">
        <code>${esc(v || "#000000")}</code></span></div>`;
    }
    if (tipo === "bool") {
      return `<label class="cod-check"><input type="checkbox" data-b="${ruta}" data-tipo="bool" ${v ? "checked" : ""}> ${etiqueta}</label>`;
    }
    if (tipo === "numero") {
      return `<div class="campo campo--editor"><label>${etiqueta}</label>
        <input type="number" data-b="${ruta}" data-tipo="numero" value="${esc(v ?? 0)}" ${extra}></div>`;
    }
    return `<div class="campo campo--editor"><label>${etiqueta}</label>
      <input type="text" data-b="${ruta}" value="${esc(v ?? "")}"></div>`;
  }

  function bindPanelBundle() {
    const b = bundleActual();
    const panel = $("bdl-panel");

    panel.addEventListener("input", (e) => {
      const ruta = e.target.dataset.b;
      if (!ruta) return;
      let v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
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
    const foto = sel && sel.imagen ? `<img src="${esc(sel.imagen)}" alt="">` : "🛍";
    const mobile = !!estado.bundles.previewMobile;
    return `<aside class="tarjeta cod-preview">
      <div class="tarjeta__titulo">Vista previa</div>
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
      <div class="bdl-preview__marco ${mobile ? "is-mobile" : ""}">
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
      // Tipografía (Paso 6): fuente solo si no es "heredar"; pesos por rol.
      (ty.font && ty.font !== "heredar" ? `--tiq-font:${FONTS_BDL[ty.font] || "inherit"};` : "") +
      (ty.titleWeight ? `--tiq-title-w:${ty.titleWeight};` : "") +
      (ty.priceWeight ? `--tiq-price-w:${ty.priceWeight};` : "") +
      `--tiq-bot-fondo:${bot.color_fondo || "#111"};--tiq-bot-txt:${bot.color_texto || "#fff"};--tiq-bot-radio:${bot.radio ?? 8}px;--tiq-bot-tam:${bot.tamano ?? 16}px`
    );
  }

  function previewBundleHTML(b, PU = PRECIO_DEMO) {
    const d = b.diseno || {};
    const bot = d.boton || {};
    const vars = disenoAVars(d);

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
              ${sub
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
    if (b) { b.disabled = false; b.textContent = "Guardar cambios"; b.classList.add("btn--acento"); b.classList.remove("btn--fantasma"); }
    saveBar.show({ onSave: () => guardarBundles(), onDiscard: () => descartarBundles() });
  }

  // Descartar: vuelve a la última versión guardada en el server y repinta.
  async function descartarBundles() {
    try {
      estado.bundles.config = await api("/bundles");
      estado.bundles.sucio = false;
      saveBar.hide();
      pintarEditorBundle();
    } catch (e) {
      vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ No se pudo descartar: ${esc(e.message)}</div>`);
    }
  }

  async function guardarBundles() {
    const b = $("bdl-guardar");
    if (b) { b.disabled = true; b.textContent = "Guardando…"; }
    saveBar.guardando(true);
    try {
      estado.bundles.config = await api("/bundles", { method: "PUT", body: { config: estado.bundles.config } });
      estado.bundles.sucio = false;
      if (b) { b.textContent = "✓ Guardado"; b.classList.remove("btn--acento"); b.classList.add("btn--fantasma"); }
      saveBar.guardando(false);
      saveBar.hide();
      return true;
    } catch (e) {
      if (b) { b.disabled = false; b.textContent = "Guardar cambios"; }
      saveBar.guardando(false);
      vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ No se pudo guardar: ${esc(e.message)}</div>`);
      return false;
    }
  }

  async function instalarBundlesTema() {
    if (estado.bundles.sucio && !(await guardarBundles())) return;
    const b = $("bdl-instalar");
    if (b) { b.disabled = true; b.textContent = "Inyectando…"; }
    try {
      estado.bundles.config = await api("/bundles/instalar", { method: "POST" });
      pintarDashboardBundles();
    } catch (e) {
      if (b) { b.disabled = false; b.textContent = "▲ Inyectar en el tema"; }
      vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ ${esc(e.message)}</div>`);
    }
  }

  function salirBundles() {
    if (estado.bundles?.sucio && !confirm("Hay cambios sin guardar. ¿Salir igual?")) return;
    estado.bundles.vista = "lista";
    estado.bundles.sucio = false;
    saveBar.hide();
    pintarDashboardBundles();
  }

  // ---------- ruteo ----------

  const PANTALLAS = {
    inicio: pantallaInicio,
    paginas: pantallaPaginas,
    cod: pantallaCod,
    bundles: pantallaBundles,
    lista: pantallaLista,
    informacion: pantallaInformacion,
    generando: pantallaGenerando,
    preview: pantallaPreview
  };

  // La URL del iframe refleja la pantalla. Sin esto, el menú del admin no
  // puede navegar: si la app queda siempre en "/", tocar "TiendaIQ" desde
  // el flujo es "navegar a donde ya estás" y Shopify no hace nada.
  function sincronizarURL(pantalla) {
    const ruta =
      pantalla === "paginas" ? "/paginas"
      : pantalla === "cod" ? "/cod"
      : pantalla === "bundles" ? "/bundles"
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
    sincronizarURL(pantalla);
    pintarPasos();
    PANTALLAS[pantalla]();
    window.scrollTo(0, 0);
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
      vista.innerHTML = `<div class="error">✖ No se pudo leer la tienda: ${esc(e.message)}</div>`;
    }
  }

  // La marca del header (solo fuera del admin) vuelve al inicio.
  const marca = document.querySelector(".barra__marca");
  if (marca) {
    marca.style.cursor = "pointer";
    marca.onclick = () => ir("inicio");
  }

  // Ruteo por URL: el menú lateral del admin navega por estas rutas.
  function rutear() {
    const ruta = location.pathname.replace(/\/$/, "");
    if (ruta === "/paginas") ir("paginas");
    else if (ruta === "/cod") ir("cod");
    else if (ruta === "/bundles") ir("bundles");
    else if (ruta === "/crear") cargarLista();
    else ir("inicio");
  }
  window.addEventListener("popstate", rutear);
  rutear();
})();
