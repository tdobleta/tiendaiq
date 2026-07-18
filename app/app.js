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
    paginas: [], // resumen de páginas para el inicio
    plan: null,
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
    // El inicio es un panel, no un paso del flujo: sin barra.
    if (estado.pantalla === "inicio") {
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

    const pasoCard = (icono, titulo, texto, cola) => `
      <div class="paso-card">
        <div class="paso-card__icono">${icono}</div>
        <div class="paso-card__titulo">${titulo}</div>
        <p class="paso-card__texto">${texto}</p>
        ${cola}
      </div>`;

    const metrica = (icono, nombre, valor, acento) => `
      <div class="metrica ${acento ? "metrica--acento" : ""}">
        <div class="metrica__icono">${icono}</div>
        <div>
          <div class="metrica__nombre">${nombre}</div>
          <div class="metrica__valor">${valor}</div>
        </div>
      </div>`;

    vista.innerHTML = `
      <div class="inicio-cabecera">
        <h1>Bienvenido a TiendaIQ</h1>
        <div class="inicio-cabecera__acciones">
          <button class="btn btn--fantasma" id="ir-paginas">◧ Ver mis páginas</button>
          <button class="btn btn--acento" id="ir-crear">✨ Crear página de producto con IA</button>
        </div>
      </div>

      ${
        sinCupo
          ? `<div class="banner-plan">
               <span>Usaste las ${plan.limite} páginas gratis de este mes. Pasate a Pro para generar sin límite.</span>
               <button class="btn btn--acento" id="ir-plan">Actualizar plan</button>
             </div>`
          : ""
      }

      <div class="tarjeta">
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
            "✨",
            "Crear página de producto",
            "Generá tu primera página de producto con IA.",
            creadas
              ? `<span class="chip-estado chip-estado--ok">Completado</span>`
              : `<button class="btn btn--chico" id="paso-crear">Crear página</button>`
          )}
          ${pasoCard(
            "▲",
            "Publicar en la tienda",
            "Publicá una página de producto en tu tienda.",
            publicadas
              ? `<span class="chip-estado chip-estado--ok">Completado</span>`
              : `<button class="btn btn--chico" id="paso-publicar">Publicar página</button>`
          )}
          ${pasoCard(
            "🏪",
            "Crear tu tienda con IA",
            "Una tienda Shopify completa armada desde cero.",
            `<span class="chip-estado chip-estado--pronto">Próximamente</span>`
          )}
        </div>
      </div>

      <div class="tarjeta">
        <div class="tarjeta__titulo">Tus números</div>
        <div class="panel__sub">Sincronizado con tu tienda, en tiempo real</div>
        <div class="metricas">
          ${metrica("◧", "Páginas creadas", creadas, true)}
          ${metrica("▲", "Publicadas", publicadas)}
          ${metrica("✎", "Borradores", creadas - publicadas)}
          ${metrica(
            "✦",
            "Plan",
            plan.plan === "pro" ? "Pro · sin límite" : `${plan.usadas} de ${plan.limite} este mes`
          )}
        </div>
      </div>

      <div class="tarjeta">
        <div class="tarjeta__titulo">Herramientas</div>
        <div class="panel__sub">Explorá lo que TiendaIQ puede hacer por tu tienda.</div>
        <div class="herramientas">
          <div class="herramienta">
            <div class="herramienta__nombre">Páginas de producto con IA</div>
            <p>Elegí un producto de tu catálogo y la IA escribe el copy, clasifica las fotos y arma la landing completa.</p>
            <button class="btn" id="herr-crear">Crear página de producto</button>
          </div>
          <div class="herramienta herramienta--pronto">
            <div class="herramienta__nombre">Tienda Shopify con IA</div>
            <p>Una tienda completa con productos ganadores, armada por IA desde cero.</p>
            <button class="btn btn--fantasma" disabled>Próximamente</button>
          </div>
        </div>
      </div>`;

    const aLista = () => cargarLista();
    ["ir-crear", "ir-paginas", "paso-crear", "paso-publicar", "herr-crear"].forEach((id) => {
      const b = $(id);
      if (b) b.onclick = aLista;
    });
    const bPlan = $("ir-plan");
    if (bPlan) bPlan.onclick = irASuscripcion;
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

  function pintarEditor() {
    const cont = $("editor");
    // Qué secciones estaban abiertas, para no cerrarlas al repintar.
    const abiertas = cont.querySelector("details")
      ? new Set([...cont.querySelectorAll("details[open]")].map((x) => x.dataset.sec))
      : new Set(["hero"]);
    const S = (id, titulo, cuerpo) => `
      <details class="seccion" data-sec="${id}" ${abiertas.has(id) ? "open" : ""}>
        <summary>${titulo}</summary>
        <div class="seccion__cuerpo">${cuerpo}</div>
      </details>`;

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
        </fieldset>`
      )
      .join("");

    cont.innerHTML = `
      <div class="editor__titulo">Editar la página</div>
      <div class="editor__ayuda">Los cambios se ven al instante en el preview. Guardá para no perderlos.</div>

      ${S(
        "hero",
        "Encabezado",
        campo("facetas.hero.titulo", "Título") +
          campo("facetas.hero.subtitulo", "Subtítulo", 2) +
          f.hero.bullets.map((_, i) => campo(`facetas.hero.bullets.${i}`, `Bullet ${i + 1}`)).join("") +
          campoNumero("facetas.hero.resenas_count", "Cantidad de reseñas (junto a las estrellas)") +
          campo("global.cta", "Texto del botón de compra")
      )}

      ${S(
        "destacada",
        "Reseña destacada",
        `<div class="editor__nota">Es la reseña grande del hero. Pegá acá una reseña REAL de un cliente; sin texto, en la tienda no se muestra.</div>` +
          campo("facetas.hero.resena_destacada.autor", "Nombre", 0, true) +
          campo("facetas.hero.resena_destacada.texto", "Texto", 3, true) +
          `<div class="campo campo--editor"><label>Estrellas</label>${selectorEstrellas(
            "facetas.hero.resena_destacada.estrellas",
            f.hero.resena_destacada.estrellas ?? 5
          )}</div>`
      )}

      ${S(
        "acordeones",
        "Envío y devoluciones",
        (f.hero.acordeones ?? [])
          .map(
            (_, i) =>
              campo(`facetas.hero.acordeones.${i}.titulo`, `Acordeón ${i + 1} · título`) +
              campo(`facetas.hero.acordeones.${i}.contenido`, `Acordeón ${i + 1} · contenido`, 2)
          )
          .join("")
      )}

      ${S(
        "texto1",
        "Texto + imagen 1",
        campo("facetas.texto_img_1.titular", "Titular") + campo("facetas.texto_img_1.parrafo", "Párrafo", 4)
      )}

      ${S(
        "iconos",
        "Beneficios (íconos)",
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
            .join("")
      )}

      ${S(
        "tabla",
        "Tabla comparativa",
        campo("facetas.tabla.titular", "Titular") +
          campo("facetas.tabla.parrafo", "Párrafo", 2) +
          f.tabla.filas.map((_, i) => campo(`facetas.tabla.filas.${i}`, `Fila ${i + 1} (1-2 palabras)`)).join("") +
          campo("facetas.tabla.col_otros", "Nombre de la columna de la competencia")
      )}

      ${S(
        "stats",
        "Estadísticas",
        `<div class="editor__nota">Los porcentajes son fijos de la plantilla; se editan solo las frases.</div>` +
          campo("facetas.stats.titular", "Titular") +
          f.stats.items
            .map((s, i) => campo(`facetas.stats.items.${i}.frase`, `${s.pct}% — frase (sin números)`, 2))
            .join("")
      )}

      ${S(
        "texto2",
        "Texto + imagen 2",
        campo("facetas.texto_img_2.titular", "Titular") + campo("facetas.texto_img_2.parrafo", "Párrafo", 4)
      )}

      ${S(
        "faq",
        "Preguntas frecuentes",
        campo("facetas.faq.titular", "Titular") +
          f.faq.items
            .map(
              (_, i) =>
                campo(`facetas.faq.items.${i}.pregunta`, `Pregunta ${i + 1}`) +
                campo(`facetas.faq.items.${i}.respuesta`, `Respuesta ${i + 1}`, 2)
            )
            .join("")
      )}

      ${S(
        "garantia",
        "Garantía",
        campo("facetas.garantia.titular", "Titular") + campo("facetas.garantia.parrafo", "Párrafo", 3)
      )}

      ${S(
        "resenas",
        "Muro de reseñas",
        campo("facetas.resenas.titular", "Titular") +
          campo("facetas.resenas.subtitulo", "Subtítulo") +
          `
          <div class="cargador">
            <label>Cargar reseñas reales en lote</label>
            <textarea id="lote" rows="6" placeholder="Una reseña por bloque, separadas por una línea en blanco.
La primera línea es el nombre; el resto, el texto.

María G.
Me llegó en 3 días y funciona tal cual el video.

Carla R.
Al principio dudaba pero lo uso todos los días."></textarea>
            <button class="btn btn--fantasma" id="btn-lote" type="button">↧ Volcar al muro</button>
            <div class="ayuda">Van reemplazando las tarjetas guía desde la primera. Las guía que queden no se borran: son el molde para cuando tengas más reseñas.</div>
          </div>` +
          tarjetasMuro
      )}`;
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
    pintarEditor();
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
        <button class="btn btn--fantasma" id="guardar" disabled>✓ Guardado</button>
        <button class="btn btn--fantasma" id="regenerar">↻ Regenerar</button>
        <button class="btn ${publicada ? "btn--fantasma" : "btn--acento"}" id="publicar">
          ${publicada ? "↻ Volver a publicar" : "▲ Publicar página"}
        </button>
      </div>

      <div class="aviso-republicar" id="hint-republicar" style="display:none">
        ⚠ Los cambios se guardan acá, pero en la tienda no se ven hasta que vuelvas a publicar.
      </div>

      <div class="taller">
        <aside class="editor" id="editor"></aside>
        <div class="marco">
          <iframe id="marco" src="/preview/index.html?app=1&t=${Date.now()}"></iframe>
        </div>
      </div>`;

    pintarEditor();

    // Un solo listener para todos los campos, presentes y futuros.
    const editor = $("editor");
    editor.oninput = (e) => {
      if (e.target.dataset.ruta) actualizarDato(e.target);
    };
    editor.onclick = (e) => {
      if (e.target.id === "btn-lote") cargarLote();
    };

    // El iframe no lee ningún archivo global: recibe LOS DATOS DE ESTA página
    // por mensaje. Dos merchants generando a la vez no se pisan.
    const marco = $("marco");
    marco.onload = () => {
      repintarPreview();
      // Los lápices "✎ Editar" que ya dibuja la plantilla abren la sección
      // del editor que corresponde. Mismo origen, delegado en el document
      // para sobrevivir a cada repintado del iframe.
      try {
        marco.contentWindow.document.addEventListener("click", (e) => {
          if (e.target.closest(".resenas__editar")) abrirSeccion("resenas");
          if (e.target.closest(".resena-destacada__editar")) abrirSeccion("destacada");
        });
      } catch {}
    };

    $("volver").onclick = () => {
      if (sucio && !confirm("Hay cambios sin guardar. ¿Salir igual?")) return;
      cargarLista();
    };
    $("regenerar").onclick = () => {
      if (sucio && !confirm("Regenerar descarta los cambios sin guardar. ¿Seguir?")) return;
      ir("informacion");
    };
    $("guardar").onclick = guardarCambios;
    $("publicar").onclick = publicar;
  }

  function abrirSeccion(id) {
    const d = vista.querySelector(`details[data-sec="${id}"]`);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: "smooth", block: "start" });
    d.querySelector("input, textarea")?.focus({ preventScroll: true });
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

  // La marca del header (solo fuera del admin) vuelve al inicio.
  const marca = document.querySelector(".barra__marca");
  if (marca) {
    marca.style.cursor = "pointer";
    marca.onclick = () => ir("inicio");
  }

  ir("inicio");
})();
