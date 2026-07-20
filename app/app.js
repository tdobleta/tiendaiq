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
    producto: null, // el elegido
    pagina: null, // el registro que devuelve el server
    volverA: "lista", // desde dónde se abrió el editor: "lista" o "paginas"
    cod: null, // { config, tab, sucio } de la pantalla COD
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
    // El inicio y la tabla de páginas son paneles, no pasos del flujo.
    if (["inicio", "paginas", "cod"].includes(estado.pantalla)) {
      $("pasos").innerHTML = "";
      return;
    }
    const pasos = [
      { id: "lista", texto: "Elegir producto" },
      { id: "informacion", texto: "Información" },
      { id: "preview", texto: "Publicar" }
    ];
    const actual = estado.pantalla === "generando" ? "informacion" : estado.pantalla;
    const i = pasos.findIndex((p) => p.id === actual);

    $("pasos").innerHTML = pasos
      .map((p, n) => {
        const clase = n < i ? "paso--hecho" : n === i ? "paso--activo" : "";
        return (
          (n ? `<span class="paso__sep">›</span>` : "") +
          `<span class="paso ${clase}"><span class="paso__n">${n < i ? "✓" : n + 1}</span>${p.texto}</span>`
        );
      })
      .join("");
  }

  // ---------- 0. inicio (panel principal, estilo PagePilot) ----------
  //
  // Todo lo que muestra es REAL: páginas y plan salen del server. Nada de
  // métricas de venta que no medimos ni links a cosas que no existen.

  async function pantallaInicio() {
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Leyendo tu tienda…</h2></div>`;
    try {
      const [plan, paginas] = await Promise.all([api("/plan"), api("/paginas")]);
      estado.plan = plan;
      estado.paginas = paginas;
    } catch (e) {
      vista.innerHTML = `<div class="error">✖ No se pudo leer la tienda: ${esc(e.message)}</div>`;
      return;
    }
    if (estado.pantalla !== "inicio") return; // navegó mientras cargaba

    const plan = estado.plan;
    const creadas = estado.paginas.length;
    const publicadas = estado.paginas.filter((p) => p.estado === "publicada").length;
    const hechos = (creadas > 0 ? 1 : 0) + (publicadas > 0 ? 1 : 0);
    const sinCupo = plan.plan !== "pro" && plan.usadas >= plan.limite;

    // Íconos de línea monocromos, como PagePilot: círculo negro sólido si el
    // paso está hecho, punteado si falta.
    const ICONO_PASO = {
      chispa: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 2l1.7 5.4L18 9l-5.3 1.6L11 16l-1.7-5.4L4 9l5.3-1.6z"/><path d="M18.5 14l.9 2.8 2.8.9-2.8.9-.9 2.8-.9-2.8-2.8-.9 2.8-.9z"/></svg>`,
      publicar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="M7 9l5-5 5 5"/><path d="M4 19h16"/></svg>`,
      tienda: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4h13.6L20 9"/><path d="M4 9c0 1.4 1.2 2.5 2.7 2.5S9.3 10.4 9.3 9c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.2 2.5 2.7 2.5S20 10.4 20 9"/><path d="M5 11.5V20h14v-8.5"/><path d="M10 20v-5h4v5"/></svg>`
    };

    const pasoCard = (icono, titulo, texto, hecho, cola, tinte, off) => `
      <article class="paso-card paso-card--${tinte} ${off ? "paso-card--off" : ""}" ${off ? 'aria-disabled="true"' : ""}>
        <div class="paso-card__icono ${hecho ? "paso-card__icono--hecho" : ""}">${icono}</div>
        <div class="paso-card__titulo">${titulo}</div>
        <p class="paso-card__texto">${texto}</p>
        ${cola}
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

    vista.innerHTML = `
      <div class="inicio-cabecera">
        <h1>Bienvenido a TiendaIQ</h1>
        <div class="inicio-cabecera__acciones">
          <button class="btn btn--fantasma" id="ir-paginas">❐ Ver mis páginas</button>
          <button class="btn btn--marca" id="ir-crear">✦ Crear página de producto con IA</button>
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
            <span>${hechos} de 2 completado</span>
            <div class="progreso__barra"><div style="width:${(hechos / 2) * 100}%"></div></div>
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
            ICONO_PASO.tienda,
            "Crear tu tienda con IA",
            "Una tienda Shopify completa armada desde cero.",
            false,
            `<span class="chip-estado chip-estado--pronto">Próximamente</span>`,
            "azul",
            true
          )}
        </div>
      </section>

      <section class="tarjeta">
        <div class="tarjeta__titulo">Herramientas</div>
        <div class="panel__sub">Explorá lo que TiendaIQ puede hacer por tu tienda.</div>
        <div class="herramientas">
          <div class="herramienta">
            <div class="herramienta__nombre">Páginas de producto con IA</div>
            <p>Elegí un producto y la IA arma la landing completa.</p>
            <button class="btn btn--chico" id="herr-crear">Crear página de producto</button>
            <div class="herramienta__preview herramienta__preview--paginas">
              <div class="mini-app">
                <div class="mini-app__barra"><span></span><span></span><span></span></div>
                <div class="mini-app__cuerpo">
                  <div class="mini-app__media"></div>
                  <div class="mini-app__col">
                    <div class="mini-linea mini-linea--titulo"></div>
                    <div class="mini-linea"></div>
                    <div class="mini-linea mini-linea--corta"></div>
                    <div class="mini-cta"></div>
                  </div>
                </div>
              </div>
              <span class="mini-chip-ia">✦ IA</span>
            </div>
          </div>
          <div class="herramienta">
            <div class="herramienta__nombre">Formulario contra reembolso (COD)</div>
            <p>Tus clientes piden y pagan al recibir: el formulario crea el pedido en Shopify.</p>
            <button class="btn btn--chico" id="herr-cod">Configurar COD</button>
            <div class="herramienta__preview herramienta__preview--cod">
              <div class="mini-app">
                <div class="mini-app__barra"><span></span><span></span><span></span></div>
                <div class="mini-app__cuerpo">
                  <div class="mini-app__col">
                    <div class="mini-linea mini-linea--titulo"></div>
                    <div class="mini-linea"></div>
                    <div class="mini-linea"></div>
                    <div class="mini-linea mini-linea--corta"></div>
                    <div class="mini-cta mini-cta--cod"></div>
                  </div>
                </div>
              </div>
              <span class="mini-chip-ia">🛵 COD</span>
            </div>
          </div>
          <div class="herramienta">
            <div class="herramienta__nombre">Tienda Shopify con IA</div>
            <p>Una tienda completa armada por IA desde cero.</p>
            <button class="btn btn--chico btn--fantasma" disabled>Próximamente</button>
            <div class="herramienta__preview herramienta__preview--tienda">
              <div class="mini-app">
                <div class="mini-app__barra"><span></span><span></span><span></span></div>
                <div class="mini-hero"></div>
                <div class="mini-grid"><span></span><span></span><span></span></div>
              </div>
              <span class="mini-chip-ia">✦ IA</span>
            </div>
          </div>
        </div>
      </section>

      <section class="tarjeta">
        <div class="tarjeta__titulo">Tus números</div>
        <div class="panel__sub">Sincronizado con tu tienda, en tiempo real</div>
        <div class="metricas">
          ${metrica(ICONO_METRICA.pagina, "Páginas creadas", creadas, "violeta")}
          ${metrica(ICONO_METRICA.check, "Publicadas", publicadas, "verde")}
          ${metrica(ICONO_METRICA.lapiz, "Borradores", creadas - publicadas)}
          ${metrica(
            ICONO_METRICA.estrella,
            "Plan",
            plan.plan === "pro" ? "Pro · sin límite" : `${plan.usadas} de ${plan.limite}`
          )}
        </div>
      </section>

      <section class="tarjeta">
        <div class="tarjeta__titulo">Resumen de rendimiento</div>
        <div class="panel__sub">Tu embudo, hitos y mejores páginas de producto</div>
        <div class="resumen-grilla">
          <div class="resumen-card">
            <div class="resumen-card__titulo">Embudo de conversión</div>
            <div class="resumen-card__sub">De la visita a la compra</div>
            <div class="embudo-fila">
              <div class="embudo-fila__cab"><span>Vistas de página</span></div>
              <div class="embudo-fila__valor">0</div>
              <div class="mini-barra"><div style="width:0%"></div></div>
            </div>
            <div class="embudo-fila">
              <div class="embudo-fila__cab"><span>Añadido al carrito</span><span class="embudo-fila__pct">0.0%<small>de las vistas de página</small></span></div>
              <div class="embudo-fila__valor">0</div>
              <div class="mini-barra"><div style="width:0%"></div></div>
            </div>
            <div class="embudo-fila">
              <div class="embudo-fila__cab"><span>Compras</span><span class="embudo-fila__pct">0.0%<small>de las vistas de página</small></span></div>
              <div class="embudo-fila__valor">0</div>
              <div class="mini-barra"><div style="width:0%"></div></div>
            </div>
          </div>

          <div class="resumen-card">
            <div class="resumen-card__titulo">Hitos</div>
            <div class="resumen-card__sub">Desbloqueá hitos a medida que crecés</div>
            ${["Primera venta", "Primeros 100 $ de ingresos", "Primeros 1.000 $ de ingresos", "Primeros 100 pedidos"]
              .map(
                (h) => `
                <div class="hito-fila">
                  <div class="hito-fila__cab"><span>${h}</span><span>0%</span></div>
                  <div class="mini-barra"><div style="width:0%"></div></div>
                </div>`
              )
              .join("")}
          </div>

          <div class="resumen-card">
            <div class="resumen-card__titulo">Páginas de producto principales</div>
            <div class="resumen-card__sub">Tus últimas páginas publicadas</div>
            ${
              publicadas
                ? estado.paginas
                    .filter((p) => p.estado === "publicada")
                    .slice(0, 4)
                    .map(
                      (p) => `
                      <div class="pagina-mini">
                        <div class="pagina-mini__foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : "🖼"}</div>
                        <div class="pagina-mini__titulo">${esc(p.titulo || "Sin título")}</div>
                        ${p.url_publica ? `<a href="${esc(p.url_publica)}" target="_blank">Ver</a>` : ""}
                      </div>`
                    )
                    .join("")
                : `<div class="resumen-vacio">
                     <div class="resumen-vacio__icono">◧</div>
                     <div class="resumen-vacio__titulo">Aún no hay datos de productos</div>
                     <p>Creá tu primera página de producto con IA para empezar a registrar ingresos acá.</p>
                     <button class="btn btn--chico" id="resumen-crear">＋ Crear página de producto con IA</button>
                   </div>`
            }
          </div>
        </div>
      </section>`;

    const aLista = () => cargarLista();
    ["ir-crear", "paso-crear", "herr-crear", "resumen-crear"].forEach((id) => {
      const b = $(id);
      if (b) b.onclick = aLista;
    });
    // Ver/gestionar páginas → la tabla de páginas (ahí se publica y edita).
    ["ir-paginas", "paso-publicar"].forEach((id) => {
      const b = $(id);
      if (b) b.onclick = () => ir("paginas");
    });
    const bPlan = $("ir-plan");
    if (bPlan) bPlan.onclick = irASuscripcion;
    const bCod = $("herr-cod");
    if (bCod) bCod.onclick = () => ir("cod");
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

  const PRODUCTO_DEMO = {
    titulo: "Producto de ejemplo",
    imagen: null,
    moneda: "USD",
    variantes: [{ id: 1, titulo: "Default", precio: 3999, disponible: true }]
  };

  async function pantallaCod() {
    vista.innerHTML = `<div class="generando"><div class="giro"></div><h2>Leyendo la configuración…</h2></div>`;
    try {
      estado.cod = { config: await api("/cod"), tab: estado.cod?.tab || "vista", sucio: false };
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
        <div class="cod-vista-barra">
          <div class="editor__nota" style="margin:0;flex:1">Así lo ve tu cliente. <strong>Hacé clic sobre los textos</strong> para editarlos acá mismo. Para mover o configurar piezas, usá <strong>Modo edición</strong>.</div>
          <div class="cod-agregar">
            <button class="btn btn--chico" id="cod-agregar-btn" type="button">＋ Agregar elemento</button>
            <div class="cod-agregar__menu" id="cod-agregar-menu" hidden>
              <div class="cod-agregar__grupo">Contenido</div>
              <button type="button" data-el="titulo"><strong>T</strong> Título o texto destacado</button>
              <button type="button" data-el="texto">¶ Párrafo de texto</button>
              <button type="button" data-el="imagen">🖼 Imagen</button>
              <div class="cod-agregar__grupo">Campos</div>
              <button type="button" data-el="campo">▭ Campo de texto</button>
              <div class="cod-agregar__grupo">Botones</div>
              <button type="button" data-el="whatsapp">✆ Botón de WhatsApp</button>
              <button type="button" data-el="enlace">🔗 Botón con enlace</button>
            </div>
          </div>
        </div>
        <div class="cod-vista-inline" id="cod-vista"></div>
        <div class="cod-separador"></div>
        <div class="fila-doble-cod">
          ${campoCod("textos.cta", "Botón de enviar — {total} se reemplaza por el total")}
          ${campoCod("textos.subtitulo", "Subtítulo del formulario")}
        </div>`;

    if (estado.cod.tab === "modo")
      return `
        <div class="editor__nota">Hacé clic en cualquier pieza del formulario para seleccionarla: la podés <strong>mover</strong> con ↑ ↓, configurar sus opciones o eliminarla (los elementos agregados). Los cambios se ven al instante.</div>
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
      const precioDemo = PRODUCTO_DEMO.variantes[0].precio; // solo para la vista de precios
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
                     <div class="cod-preview__foto">🛍</div>
                     <div>
                       <div class="cod-preview__nombre">${esc(PRODUCTO_DEMO.titulo)}</div>
                       <div class="cod-preview__precio">$ 39,99</div>
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
        const capa = window.TiendaIQCOD.armarModal(estado.cod.config, PRODUCTO_DEMO, { preview: true });
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
    const capa = window.TiendaIQCOD.armarModal(c, PRODUCTO_DEMO, { preview: true });
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
      imagen: { url: null },
      whatsapp: { numero: "", mensaje: "", texto: "Consultanos por WhatsApp" },
      enlace: { url: "", texto: "Más información" }
    };
    if (!defaults[tipo]) return;
    const el = { id: "el" + Date.now(), tipo, ...defaults[tipo] };
    c.elementos = c.elementos || [];
    c.elementos.push(el);
    c.orden = window.TiendaIQCOD.ordenResuelto(c); // el nuevo queda al final
    modoSel = "e:" + el.id;
    marcarSucioCod();
    // imagen/whatsapp/enlace necesitan configuración: directo al Modo edición
    if (tipo === "imagen" || tipo === "whatsapp" || tipo === "enlace") estado.cod.tab = "modo";
    pintarCod();
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
    const capa = window.TiendaIQCOD.armarModal(c, PRODUCTO_DEMO, { preview: true });
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
    imagen: "Imagen", whatsapp: "Botón de WhatsApp", enlace: "Botón con enlace"
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
      if (el.tipo === "imagen")
        campos = `<label class="btn btn--fantasma btn--chico" style="cursor:pointer">🖼 ${el.url ? "Cambiar imagen" : "Subir imagen"}<input type="file" accept="image/*" hidden data-imagen-el="${i}"></label>
          ${el.url ? `<div class="ayuda" style="margin-top:6px">Imagen cargada ✓</div>` : `<div class="ayuda" style="margin-top:6px">Todavía no cargaste la imagen.</div>`}`;
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

  function pantallaLista() {
    const q = estado.filtro.toLowerCase();
    const vistos = estado.productos.filter((p) => p.titulo.toLowerCase().includes(q));

    const tarjeta = (p) => `
      <button class="producto" data-id="${esc(p.id)}">
        <div class="producto__foto">
          ${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : "🖼"}
        </div>
        <div class="producto__cuerpo">
          <div class="producto__titulo">${esc(p.titulo)}</div>
          ${
            p.estado
              ? `<span class="etiqueta etiqueta--${p.estado}">${p.estado}</span>`
              : ""
          }
        </div>
      </button>`;

    vista.innerHTML = `
      <button class="volver" id="volver-inicio">← Inicio</button>
      <div class="cabecera">
        <h1>Crear página de producto con IA</h1>
        <p>Elegí uno de tus productos y la IA arma la landing completa.</p>
      </div>
      <input class="buscador" id="q" placeholder="Buscar entre ${estado.productos.length} productos…"
             value="${esc(estado.filtro)}">
      ${
        vistos.length
          ? `<div class="grilla">${vistos.map(tarjeta).join("")}</div>`
          : `<div class="vacio">Ningún producto coincide con "${esc(estado.filtro)}".</div>`
      }`;

    $("volver-inicio").onclick = () => ir("inicio");

    const q0 = $("q");
    q0.oninput = () => {
      estado.filtro = q0.value;
      const pos = q0.selectionStart;
      pintarLista_soloGrilla();
      const q1 = $("q");
      q1.focus();
      q1.setSelectionRange(pos, pos);
    };

    engancharProductos();
  }

  // Repinta solo la grilla para no perder el foco del buscador en cada tecla.
  function pintarLista_soloGrilla() {
    pantallaLista();
  }

  function engancharProductos() {
    vista.querySelectorAll(".producto").forEach((b) => {
      b.onclick = () => {
        estado.producto = estado.productos.find((p) => p.id === b.dataset.id);
        ir("informacion");
      };
    });
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
        html: () =>
          campo("facetas.hero.titulo", "Título") +
          campo("facetas.hero.subtitulo", "Subtítulo", 2) +
          campoNumero("facetas.hero.resenas_count", "Cantidad de reseñas (junto a las estrellas)") +
          campo("global.cta", "Texto del botón de compra")
      },
      bullets: {
        titulo: "Beneficios del producto",
        html: () => f.hero.bullets.map((_, i) => campo(`facetas.hero.bullets.${i}`, `Bullet ${i + 1}`)).join("")
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
      texto1: {
        titulo: "Texto + imagen 1",
        html: () =>
          campo("facetas.texto_img_1.titular", "Titular") +
          campo("facetas.texto_img_1.parrafo", "Párrafo", 4) +
          selectorImagenUno("facetas.texto_img_1.imagen", "Imagen del bloque")
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
      tabla: {
        titulo: "Tabla comparativa",
        html: () =>
          campo("facetas.tabla.titular", "Titular") +
          campo("facetas.tabla.parrafo", "Párrafo", 2) +
          f.tabla.filas.map((_, i) => campo(`facetas.tabla.filas.${i}`, `Fila ${i + 1} (1-2 palabras)`)).join("") +
          campo("facetas.tabla.col_otros", "Nombre de la columna de la competencia")
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
      texto2: {
        titulo: "Texto + imagen 2",
        html: () =>
          campo("facetas.texto_img_2.titular", "Titular") +
          campo("facetas.texto_img_2.parrafo", "Párrafo", 4) +
          selectorImagenUno("facetas.texto_img_2.imagen", "Imagen del bloque")
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
      garantia: {
        titulo: "Garantía",
        html: () => campo("facetas.garantia.titular", "Titular") + campo("facetas.garantia.parrafo", "Párrafo", 3)
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
  }

  function refrescarModal() {
    const cuerpo = document.getElementById("editor-modal-cuerpo");
    if (cuerpo && modalSec) cuerpo.innerHTML = seccionesPagina()[modalSec].html();
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
    const def = seccionesPagina()[id];
    if (!def) return;
    modalSec = id;

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
    });
    m.addEventListener("click", async (e) => {
      if (e.target === m || e.target.closest(".editor-modal__x")) return cerrarModalEdicion();
      if (e.target.id === "editor-modal-guardar") {
        await guardarCambios();
        cerrarModalEdicion();
        return;
      }
      if (e.target.id === "btn-lote") return cargarLote();
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
    });
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
    { sel: ".tabla", id: "tabla" },
    { sel: ".stats", id: "stats" },
    { sel: ".faq", id: "faq" },
    { sel: ".garantia", id: "garantia" },
    { sel: ".resenas", id: "resenas" },
    { sel: ".dupla", id: null } // texto1 o texto2 según posición
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
      #tiq-edit-btn { position: absolute; z-index: 99999; display: none; align-items: center; gap: 6px;
        background: #fff; border: 1px solid #d9d9de; border-radius: 9px; box-shadow: 0 4px 14px rgba(0,0,0,.16);
        padding: 8px 14px; font: 600 13px/1 Inter, -apple-system, sans-serif; color: #1a1a1a; cursor: pointer; }
      #tiq-edit-btn:hover { background: #f6f6f7; }
      .tiq-zona-hover { outline: 2px dashed #4f46e5; outline-offset: 5px; border-radius: 4px; }`;
    doc.head.appendChild(st);

    const btn = doc.createElement("button");
    btn.id = "tiq-edit-btn";
    btn.type = "button";
    btn.textContent = "✎ Editar";
    doc.body.appendChild(btn);

    let zonaEl = null;

    const limpiar = () => {
      btn.style.display = "none";
      if (zonaEl) zonaEl.classList.remove("tiq-zona-hover");
      zonaEl = null;
    };

    doc.addEventListener("mouseover", (e) => {
      if (e.target === btn || btn.contains(e.target)) return; // no soltar el botón

      let hit = null;
      for (const z of ZONAS_EDICION) {
        const el = e.target.closest?.(z.sel);
        if (el) {
          let id = z.id;
          if (!id) id = [...doc.querySelectorAll(".dupla")].indexOf(el) === 0 ? "texto1" : "texto2";
          hit = { el, id };
          break;
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
      btn.style.display = "flex";
      btn.style.top = `${scrollY + r.top + r.height / 2 - 17}px`;
      btn.style.left = `${Math.max(10, Math.min(r.right - 104, doc.documentElement.clientWidth - 118))}px`;
    });

    btn.addEventListener("click", () => abrirModalEdicion(btn.dataset.sec));

    // Los lápices que ya dibuja la plantilla abren su modal.
    doc.addEventListener("click", (e) => {
      if (e.target.closest(".resenas__editar")) abrirModalEdicion("resenas");
      if (e.target.closest(".resena-destacada__editar")) abrirModalEdicion("destacada");
    });
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

  function pantallaPreview() {
    const pg = estado.pagina;
    sucio = false;
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

      <div class="editor-hint">✎ Pasá el mouse por cualquier bloque de la página y tocá <strong>Editar</strong> para cambiarlo.</div>

      <div class="marco marco--full">
        <iframe id="marco" src="/preview/index.html?app=1&t=${Date.now()}"></iframe>
      </div>`;

    // El iframe no lee ningún archivo global: recibe LOS DATOS DE ESTA página
    // por mensaje. Dos merchants generando a la vez no se pisan. El botón
    // "✎ Editar" flotante y los lápices se montan una vez por carga.
    const marco = $("marco");
    marco.onload = () => {
      repintarPreview();
      montarEdicionEnIframe(marco);
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

  // ---------- ruteo ----------

  const PANTALLAS = {
    inicio: pantallaInicio,
    paginas: pantallaPaginas,
    cod: pantallaCod,
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
      : pantalla === "inicio" ? "/" : "/crear";
    if (location.pathname !== ruta) {
      history.pushState({ pantalla }, "", ruta + location.search);
    }
  }

  function ir(pantalla) {
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
    else if (ruta === "/crear") cargarLista();
    else ir("inicio");
  }
  window.addEventListener("popstate", rutear);
  rutear();
})();
