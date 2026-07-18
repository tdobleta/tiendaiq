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
    pantalla: "lista",
    productos: [],
    filtro: "",
    producto: null, // el elegido
    pagina: null, // el registro que devuelve el server
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
      throw e;
    }
    return cuerpo;
  }

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  // ---------- barra de pasos ----------

  function pintarPasos() {
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
        vista.insertAdjacentHTML("afterbegin", `<div class="error">✖ ${esc(estado.error)}</div>`);
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

  // ---------- 3. preview ----------

  function pantallaPreview() {
    const pg = estado.pagina;
    const publicada = pg.estado === "publicada";

    vista.innerHTML = `
      <button class="volver" id="volver">← Volver a los productos</button>

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
        <button class="btn btn--fantasma" id="regenerar">↻ Regenerar</button>
        <button class="btn ${publicada ? "btn--fantasma" : "btn--acento"}" id="publicar">
          ${publicada ? "↻ Volver a publicar" : "▲ Publicar página"}
        </button>
      </div>

      <div class="marco">
        <iframe id="marco" src="/preview/index.html?t=${Date.now()}"></iframe>
      </div>`;

    $("volver").onclick = () => cargarLista();
    $("regenerar").onclick = () => ir("informacion");
    $("publicar").onclick = publicar;
  }

  async function publicar() {
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
    lista: pantallaLista,
    informacion: pantallaInformacion,
    generando: pantallaGenerando,
    preview: pantallaPreview
  };

  function ir(pantalla) {
    estado.pantalla = pantalla;
    pintarPasos();
    PANTALLAS[pantalla]();
    window.scrollTo(0, 0);
  }

  async function cargarLista() {
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

  cargarLista();
})();
