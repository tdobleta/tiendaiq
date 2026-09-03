// ============================================================
// EDITOR — el ensamblado de los tres paneles.
//
// Este archivo cablea; no decide nada de diseño ni conoce ningún tipo de
// bloque. Toda la inteligencia está en el núcleo (qué campos hay), en comandos
// (qué se puede hacer) y en las funciones puras de UI (cómo se dibuja).
//
// -------- por qué el panel no se repinta al tipear --------
//
// Si al escribir en un input se re-renderiza el panel, el input se reemplaza,
// el foco se pierde y el cursor salta al principio. Es el bug número uno de los
// editores hechos a las apuradas. Acá los cambios que nacen DEL panel repintan
// árbol y lienzo, pero no el panel; los que nacen de otro lado (deshacer,
// heredar, seleccionar) sí lo repintan.
// ============================================================

"use strict";

const { crearEstado } = require("./comandos");
const { crearLienzo } = require("./lienzo");
const { leerCampo } = require("./lector");
const { htmlPanel, htmlPanelVacio, htmlPanelDesconocido } = require("./panel");
const { htmlArbol, ancestrosDe } = require("./arbol");
const { htmlLibreria } = require("./libreria");
const { htmlMarca } = require("./marca");
const registro = require("../../nucleo/registro");
const { contexto } = require("../../nucleo/resolver");
const { render } = require("../../nucleo/render");
const { tokensDe } = require("../../nucleo/tokens");

const ICONOS_FLOTA = {
  volver: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ocultar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A11.8 11.8 0 0112 5c5.4 0 9.3 4.4 10 7a10.8 10.8 0 01-2.1 4.2M6.1 6.1C3.8 7.7 2.4 10.1 2 12c.6 2.6 4.5 7 10 7 1 0 2-.2 2.9-.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  duplicar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  agregar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  borrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0v13h12V7M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ia: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
};

const ICONOS_CROMO = {
  cursor: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l8.4 5.1-4 1.1-1.4 4.1L3 2z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>',
  escritorio: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2" width="13" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M6 14h4M8 11v3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  movil: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="1.5" width="7" height="13" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M7 12.5h2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
  expandir: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  acciones: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l1.2 2.4 2.6.4-1.9 1.9.5 2.7L8 8.4 5.6 9.6l.5-2.7-1.9-1.9 2.6-.4L8 2.2z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M12.5 10.5v3M11 12h3" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>'
};

const ESQUELETO = `
<div class="ed ed--avanzado">
  <header class="ed__barra">
    <div class="ed__barra-izq">
      <button type="button" class="ed-icono ed-icono--volver" data-volver title="Volver a páginas">${ICONOS_FLOTA.volver}</button>
      <div class="ed-identidad"><strong data-editor-titulo>Página de producto</strong><span data-editor-subtitulo>Editor</span></div>
      <button type="button" class="ed-boton ed-boton--branding" data-branding aria-expanded="false"><span class="ed-branding__muestras" aria-hidden="true"><i></i><i></i><i></i></span><span>Marca</span></button>
      <button type="button" class="ed-boton ed-boton--modo" data-modo-avanzado aria-pressed="true"><span class="ed-modo__switch" aria-hidden="true"><i></i></span><span>Modo avanzado</span></button>
      <button type="button" class="ed-boton ed-boton--panel" data-panel-toggle="arbol">Estructura</button>
      <button type="button" class="ed-boton ed-boton--panel" data-panel-toggle="panel">Inspector</button>
    </div>
    <div class="ed__barra-centro">
      <div class="ed-vp ed-vp--grande" role="group" aria-label="Vista del lienzo">
        <button type="button" class="ed-vp__boton ed-vp__herramienta es-activo" data-viewport-tool="select" aria-pressed="true" aria-label="Seleccionar bloque" title="Seleccionar bloque">${ICONOS_CROMO.cursor}</button>
        <button type="button" class="ed-vp__boton es-activo" data-viewport="escritorio" aria-pressed="true" aria-label="Vista de escritorio" title="Vista de escritorio">${ICONOS_CROMO.escritorio}</button>
        <button type="button" class="ed-vp__boton" data-viewport="movil" aria-pressed="false" aria-label="Vista móvil" title="Vista móvil">${ICONOS_CROMO.movil}</button>
        <button type="button" class="ed-vp__boton ed-vp__herramienta" data-viewport-tool="fullscreen" aria-pressed="false" aria-label="Vista expandida" title="Vista expandida">${ICONOS_CROMO.expandir}</button>
      </div>
    </div>
    <div class="ed__barra-der">
      <span class="ed-estado" data-editor-estado data-estado="borrador">Borrador</span>
      <button type="button" class="ed-icono" data-deshacer title="Deshacer (Ctrl+Z)" disabled>↶</button>
      <button type="button" class="ed-icono" data-rehacer title="Rehacer (Ctrl+Shift+Z)" disabled>↷</button>
      <button type="button" class="ed-boton" data-guardar disabled>Guardar</button>
      <button type="button" class="ed-boton ed-boton--primario" data-publicar>Publicar en la tienda</button>
      <button type="button" class="ed-boton ed-boton--secundario" data-editar-variantes hidden>Editar variantes</button>
      <div class="ed-acciones" data-acciones-wrap>
        <button type="button" class="ed-boton ed-boton--acciones" data-acciones aria-expanded="false" aria-haspopup="menu">${ICONOS_CROMO.acciones}<span>Acciones</span></button>
        <div class="ed-acciones__menu" data-acciones-menu hidden role="menu">
          <button type="button" data-accion-editor="copiar-documento" role="menuitem">Copiar estructura</button>
        </div>
      </div>
    </div>
  </header>
  <div class="ed__cuerpo">
    <aside class="ed__izq" data-zona="arbol"></aside>
    <main class="ed__centro"><div class="ed-lienzo" data-zona="lienzo"></div></main>
    <aside class="ed__der" data-zona="panel"></aside>
  </div>
  <div class="ed__modal" data-zona="modal" hidden></div>
  <div class="ed-flota" data-zona="flota" hidden>
    <button type="button" class="ed-flota__ia" data-accion="ia">${ICONOS_FLOTA.ia}<span>Editar con IA</span></button>
    <button type="button" data-accion="ocultar" title="Ocultar">${ICONOS_FLOTA.ocultar}</button>
    <button type="button" data-accion="duplicar" title="Duplicar">${ICONOS_FLOTA.duplicar}</button>
    <button type="button" data-accion="agregar" title="Añadir bloque adentro">${ICONOS_FLOTA.agregar}</button>
    <button type="button" data-accion="borrar" title="Eliminar">${ICONOS_FLOTA.borrar}</button>
  </div>
</div>`;

// Calcula la posición de la barra sin depender del DOM. El borde de referencia
// es el lienzo visible: arriba de un bloque solo se usa si entra dentro de ese
// borde; de lo contrario la barra cae debajo del bloque y nunca invade la barra
// superior del editor.
function posicionFlota(caja, lienzoCaja, { ancho = 190, alto = 34, margen = 8 } = {}) {
  const arriba = caja.arriba - alto - margen;
  const debajo = caja.arriba + caja.alto + margen;
  const topPreferido = arriba >= lienzoCaja.top + margen ? arriba : debajo;
  const topMaximo = Math.max(lienzoCaja.top + margen, lienzoCaja.bottom - alto - margen);
  const leftMaximo = Math.max(lienzoCaja.left + margen, lienzoCaja.right - ancho - margen);
  return {
    top: Math.max(lienzoCaja.top + margen, Math.min(topPreferido, topMaximo)),
    left: Math.max(lienzoCaja.left + margen, Math.min(caja.izquierda, leftMaximo)),
    debajo: arriba < lienzoCaja.top + margen
  };
}

function montarEditor(raiz, { documento: docInicial, producto = null, alGuardar = null, alPublicar = null, alSubirImagen = null, alEditarVariantes = null, alEditarConIA = null, rutaCss, titulo = "Página de producto", subtitulo = "Editor" } = {}) {
  raiz.innerHTML = ESQUELETO;
  const superficie = raiz.querySelector(".ed");
  superficie.classList.toggle("ed--sin-ia", !alEditarConIA);
  raiz.querySelector("[data-editor-titulo]").textContent = titulo || "Página de producto";
  raiz.querySelector("[data-editor-subtitulo]").textContent = subtitulo || "Editor";
  const zona = (nombre) => raiz.querySelector(`[data-zona="${nombre}"]`);
  const zonaArbol = zona("arbol");
  const zonaPanel = zona("panel");
  const zonaModal = zona("modal");
  const flota = zona("flota");
  if (alEditarVariantes) raiz.querySelector("[data-editar-variantes]")?.removeAttribute("hidden");

  const estado = crearEstado(docInicial);
  // Entrar al editor siempre deja un bloque real seleccionado. Las ramas del
  // árbol pueden estar cerradas sin que el inspector quede en un estado vacío.
  const primerNodo = docInicial?.arbol?.[0];
  if (primerNodo) estado.seleccionar(primerNodo.id);

  let omitirPanel = false;      // el cambio nació de un input del panel
  let libreriaAbierta = null;   // { padreId, categoria, busqueda } | null
  let marcaAbierta = false;
  let pendiente = null;
  // Estado de vista separado del documento: las ramas entran cerradas y no
  // vuelven a abrirse cuando un cambio de contenido repinta el árbol.
  const colapsados = new Set();
  (function cerrarRamasIniciales(nodos) {
    for (const nodo of nodos || []) {
      if (registro.existe(nodo.tipo) && registro.definicion(nodo.tipo).admite_hijos) colapsados.add(nodo.id);
      cerrarRamasIniciales(nodo.hijos);
    }
  }(estado.documento().arbol));

  // La selección nacida en el iframe tiene que ser la misma selección que ve
  // el árbol. Se abren únicamente sus padres (no toda la página) y se deja un
  // id pendiente para que el row recién pintado haga scroll dentro del panel.
  let revelarEnArbol = null;
  function seleccionarDesdeLienzo(id) {
    if (!id) return void estado.seleccionar(null);
    for (const padre of ancestrosDe(estado.documento(), id)) colapsados.delete(padre);
    revelarEnArbol = id;
    estado.seleccionar(id);
  }

  const lienzo = crearLienzo(zona("lienzo"), {
    alSeleccionar: seleccionarDesdeLienzo,
    alDesplazar: colocarFlota,
    rutaCss
  });

  // Al seleccionar desde el árbol el iframe puede estar terminando su
  // repintado. Repetir el desplazamiento en el siguiente frame evita que el
  // primer cálculo use la geometría anterior y deje el bloque fuera de vista.
  function verNodoDesdeArbol(id) {
    lienzo.verNodo(id);
    const raf = raiz.ownerDocument.defaultView?.requestAnimationFrame;
    if (raf) raf(() => lienzo.verNodo(id));
  }

  // ---------- pintado ----------

  function repintar() {
    const doc = estado.documento();
    const ctx = contexto(doc, { viewport: estado.viewport() });
    const seleccion = estado.seleccion();
    const definirParaEditor = (tipo) => registro.definicionParaEditor(tipo);
    const valoresParaEditor = (nodo) => {
      if (!registro.existe(nodo.tipo)) return {};
      try { return ctx.valores(nodo); } catch { return {}; }
    };

    zonaArbol.innerHTML = htmlArbol(doc, {
      definicion: definirParaEditor,
      valores: valoresParaEditor,
      seleccion,
      colapsados
    });

    if (revelarEnArbol) {
      const fila = zonaArbol.querySelector(`[data-nodo="${revelarEnArbol}"]`);
      if (fila) {
        fila.scrollIntoView({ block: "nearest", behavior: "smooth" });
        fila.focus({ preventScroll: true });
      }
      revelarEnArbol = null;
    }

    const { html, css } = render(doc, { modo: "editor", producto });
    lienzo.pintar({ html, css, seleccion });

    if (!omitirPanel) {
      const nodo = estado.nodoSeleccionado();
      zonaPanel.innerHTML = nodo
        ? (!registro.existe(nodo.tipo) ? htmlPanelDesconocido({ nodo }) : htmlPanel({
            esquema: registro.esquemaPanelParaEditor(nodo.tipo),
            nodo,
            valores: valoresParaEditor(nodo),
            overrideado: (clave) => hayOverrideDe(nodo, clave),
            muestra: (clave) => ctx.comoCss(nodo, clave),
            viewport: estado.viewport()
          }))
        : htmlPanelVacio();
    }

    for (const boton of raiz.querySelectorAll("[data-viewport]")) {
      const activo = boton.dataset.viewport === estado.viewport();
      boton.classList.toggle("es-activo", activo);
      boton.setAttribute("aria-pressed", String(activo));
    }
    raiz.querySelector("[data-deshacer]").disabled = !estado.puedeDeshacer();
    raiz.querySelector("[data-rehacer]").disabled = !estado.puedeRehacer();
    raiz.querySelector("[data-guardar]").disabled = !estado.hayCambios();
    const estadoUI = raiz.querySelector("[data-editor-estado]");
    if (estadoUI) {
      const sucio = estado.hayCambios();
      estadoUI.dataset.estado = sucio ? "pendiente" : "borrador";
      estadoUI.textContent = sucio ? "Cambios sin guardar" : "Borrador guardado";
    }
    const publicar = raiz.querySelector("[data-publicar]");
    publicar.disabled = !alPublicar;
    publicar.title = alPublicar ? "Publicar en la tienda" : "La publicación se habilita al completar el renderer v1";

    colocarFlota();
  }

  // Programar el repintado en el siguiente cuadro: escribir dispara un comando
  // por tecla, y renderizar el árbol entero en cada una haría que el editor se
  // sienta pesado justo en lo que más se usa.
  function pedirRepintado() {
    if (pendiente) return;
    pendiente = raiz.ownerDocument.defaultView.requestAnimationFrame(() => {
      pendiente = null;
      repintar();
    });
  }

  function hayOverrideDe(nodo, clave) {
    const campo = registro.definicionParaEditor(nodo.tipo).porClave[clave];
    if (!campo) return false;
    const bolsa = estado.viewport() === "movil" && campo.responsive ? nodo.props_movil : nodo.props;
    return !!bolsa && Object.prototype.hasOwnProperty.call(bolsa, clave);
  }

  function colocarFlota() {
    const id = estado.seleccion();
    const caja = id && lienzo.rectangulo(id);
    if (!caja) { flota.hidden = true; return; }
    flota.hidden = false;
    const lienzoCaja = raiz.querySelector(".ed__centro").getBoundingClientRect();
    const altoFlota = flota.offsetHeight || 34;
    const anchoFlota = flota.offsetWidth || 190;
    const posicion = posicionFlota(caja, lienzoCaja, { ancho: anchoFlota, alto: altoFlota });
    flota.style.top = `${posicion.top}px`;
    flota.style.left = `${posicion.left}px`;
    const nodo = estado.nodoSeleccionado();
    flota.querySelector('[data-accion="agregar"]').hidden = !registro.definicionParaEditor(nodo.tipo).admite_hijos;
  }

  estado.suscribir(pedirRepintado);

  // ---------- panel: escribir un valor ----------

  function campoDe(elCampo, nodo) {
    return registro.definicionParaEditor(nodo.tipo).porClave[elCampo.dataset.clave];
  }

  function aplicarDesdePanel(elCampo) {
    const nodo = estado.nodoSeleccionado();
    if (!nodo) return;
    const campo = campoDe(elCampo, nodo);
    if (!campo) return;
    omitirPanel = true;
    estado.fijarProp(nodo.id, campo.clave, leerCampo(elCampo, campo));
    omitirPanel = false;
  }

  zonaPanel.addEventListener("input", (evento) => {
    const elCampo = evento.target.closest("[data-clave]");
    if (elCampo) aplicarDesdePanel(elCampo);
  });

  zonaPanel.addEventListener("change", (evento) => {
    const archivo = evento.target.closest("[data-subir-imagen]");
    if (archivo) {
      const file = archivo.files?.[0];
      const nodo = estado.nodoSeleccionado();
      const contenedor = archivo.closest("[data-clave]");
      const campo = nodo && campoDe(contenedor, nodo);
      const subcampo = archivo.closest("[data-subcampo]");
      const campoImagen = subcampo && campo?.tipo === "lista"
        ? campo.item_campos.find((item) => item.clave === subcampo.dataset.subcampo)
        : campo;
      if (!file || !nodo || !campo || !campoImagen || campoImagen.tipo !== "imagen" || !alSubirImagen) return;
      archivo.disabled = true;
      Promise.resolve()
        .then(() => alSubirImagen(file, { nodo, campo: campoImagen, lista: campo.tipo === "lista" ? campo : null, indice: subcampo ? Number(subcampo.closest("[data-item]")?.dataset.item) : null }))
        .then((imagen) => {
          if (!imagen) return;
          if (campo.tipo !== "lista") return estado.fijarProp(nodo.id, campo.clave, imagen);
          const actual = contexto(estado.documento(), { viewport: estado.viewport() }).valores(nodo)[campo.clave] || [];
          const siguiente = actual.map((item, indice) => indice === Number(subcampo.closest("[data-item]")?.dataset.item)
            ? { ...item, [campoImagen.clave]: imagen } : item);
          estado.fijarProp(nodo.id, campo.clave, siguiente);
        })
        .catch((error) => raiz.dispatchEvent(new CustomEvent("tiq:error", {
          detail: { mensaje: error?.message || "No se pudo subir la imagen." }, bubbles: true
        })))
        .finally(() => { archivo.disabled = false; archivo.value = ""; });
      return;
    }
    const elCampo = evento.target.closest("[data-clave]");
    if (!elCampo) return;
    // Un select o un checkbox sí puede repintar el panel: no hay foco de texto
    // que perder, y algunos controles cambian de forma (token_color).
    const esTexto = evento.target.matches("input[type=text], input[type=url], input[type=number], textarea");
    omitirPanel = esTexto;
    aplicarDesdePanel(elCampo);
    omitirPanel = false;
    if (!esTexto) pedirRepintado();
  });

  zonaPanel.addEventListener("click", (evento) => {
    const nodo = estado.nodoSeleccionado();
    const formato = evento.target.closest("[data-formato]");
    if (formato) {
      const area = formato.closest("[data-clave]")?.querySelector('[data-parte="valor"]');
      if (area) {
        area.focus();
        const comando = formato.dataset.formato === "enlace" ? "createLink" : formato.dataset.formato;
        if (comando === "createLink") {
          const url = raiz.ownerDocument.defaultView.prompt("Enlace", "https://");
          if (!url) return;
          raiz.ownerDocument.execCommand(comando, false, url);
        } else {
          raiz.ownerDocument.execCommand(comando, false, null);
        }
        area.dispatchEvent(new raiz.ownerDocument.defaultView.Event("input", { bubbles: true }));
      }
      return;
    }
    const asistente = evento.target.closest("[data-ia]");
    if (asistente) {
      if (!alEditarConIA) return;
      return void raiz.dispatchEvent(new CustomEvent("tiq:ia", {
        detail: { nodo, campo: asistente.dataset.ia }, bubbles: true
      }));
    }
    const elegirProducto = evento.target.closest("[data-elegir-producto]");
    if (elegirProducto) {
      return void raiz.dispatchEvent(new CustomEvent("tiq:elegir-producto", { detail: { nodo }, bubbles: true }));
    }
    const heredar = evento.target.closest("[data-heredar]");
    if (heredar && nodo) return void estado.heredarProp(nodo.id, heredar.dataset.heredar);

    const vp = evento.target.closest("[data-viewport]");
    if (vp) {
      estado.fijarViewport(vp.dataset.viewport);
      return void lienzo.fijarViewport(vp.dataset.viewport);
    }

    const opcion = evento.target.closest("[data-opcion]");
    if (opcion) {
      const seg = opcion.closest(".ed-seg");
      seg.dataset.valor = opcion.dataset.opcion;
      return void aplicarDesdePanel(opcion.closest("[data-clave]"));
    }

    if (evento.target.closest("[data-borrar-nodo]") && nodo) return void estado.borrar(nodo.id);

    const elCampo = evento.target.closest("[data-clave]");
    if (elCampo && nodo) manejarLista(evento, elCampo, nodo);
  });

  // Alta, baja y reordenamiento de items de una `lista`. Se hace sobre el valor
  // y se manda como un comando, para que entre al historial como todo lo demás.
  function manejarLista(evento, elCampo, nodo) {
    const campo = campoDe(elCampo, nodo);
    if (!campo || campo.tipo !== "lista") return;
    const actual = leerCampo(elCampo, campo) || [];
    const agregar = evento.target.closest("[data-agregar-item]");
    const quitar = evento.target.closest("[data-quitar]");
    const subir = evento.target.closest("[data-subir]");
    const bajar = evento.target.closest("[data-bajar]");

    let siguiente = null;
    if (agregar) {
      const item = {};
      for (const sub of campo.item_campos) item[sub.clave] = sub.defecto === undefined ? null : sub.defecto;
      siguiente = [...actual, item];
    } else if (quitar) {
      siguiente = actual.filter((_, i) => i !== Number(quitar.dataset.quitar));
    } else if (subir || bajar) {
      const i = Number((subir || bajar).dataset[subir ? "subir" : "bajar"]);
      const j = subir ? i - 1 : i + 1;
      if (j < 0 || j >= actual.length) return;
      siguiente = [...actual];
      [siguiente[i], siguiente[j]] = [siguiente[j], siguiente[i]];
    }
    if (siguiente) estado.fijarProp(nodo.id, campo.clave, siguiente);
  }

  // ---------- árbol ----------

  zonaArbol.addEventListener("click", (evento) => {
    const colapsar = evento.target.closest("[data-colapsar]");
    if (colapsar) {
      // El colapso es estado de la vista, no del documento: no ensucia el
      // botón Guardar ni entra al historial.
      const rama = colapsar.closest(".ed-arbol__nodo");
      const id = rama && rama.querySelector("[data-nodo]")?.dataset.nodo;
      if (id) {
        if (colapsados.has(id)) colapsados.delete(id);
        else colapsados.add(id);
      }
      return void rama?.classList.toggle("es-colapsado", id ? colapsados.has(id) : false);
    }
    const agregarEn = evento.target.closest("[data-agregar-en]");
    if (agregarEn) return void abrirLibreria(agregarEn.dataset.agregarEn);
    if (evento.target.closest("[data-agregar-seccion]")) return void abrirLibreria(null);

    const fila = evento.target.closest("[data-nodo]");
    if (fila) {
      estado.seleccionar(fila.dataset.nodo);
      verNodoDesdeArbol(fila.dataset.nodo);
    }
  });

  // ---------- librería ----------

  function abrirLibreria(padreId) {
    marcaAbierta = false;
    libreriaAbierta = { padreId, categoria: null, busqueda: "" };
    pintarLibreria();
  }

  function abrirMarca() {
    libreriaAbierta = null;
    marcaAbierta = true;
    pintarMarca();
  }

  function pintarLibreria() {
    if (!libreriaAbierta) {
      if (marcaAbierta) return pintarMarca();
      zonaModal.hidden = true;
      zonaModal.innerHTML = "";
      return;
    }
    zonaModal.hidden = false;
    zonaModal.innerHTML = htmlLibreria(registro.catalogo(), {
      categoria: libreriaAbierta.categoria,
      busqueda: libreriaAbierta.busqueda,
      // En la raíz se agregan composiciones profesionales; dentro de una
      // sección/grupo se agregan bloques atómicos. Mostrar ambos niveles a la
      // vez es el patrón de "hoja en blanco" que PagePilot evita.
      modo: libreriaAbierta.padreId ? "bloques" : "secciones",
      // El cupo se calcula en el ámbito donde se abrirá la librería: una
      // misma sección puede tener un bloque limitado aunque otra ya lo use.
      contarUsados: (tipo, item) => item?.composicion_id
        ? 0
        : estado.contarPorTipo(tipo, { padreId: libreriaAbierta.padreId })
    });
    const buscador = zonaModal.querySelector("[data-buscar]");
    if (buscador && libreriaAbierta.busqueda) { buscador.focus(); buscador.selectionStart = buscador.value.length; }
  }

  function pintarMarca() {
    if (!marcaAbierta) return pintarLibreria();
    zonaModal.hidden = false;
    zonaModal.innerHTML = htmlMarca(estado.documento().branding);
  }

  zonaModal.addEventListener("click", (evento) => {
    if (evento.target === zonaModal || evento.target.closest("[data-cerrar]")) {
      libreriaAbierta = null;
      marcaAbierta = false;
      return void pintarLibreria();
    }
    if (marcaAbierta) {
      const preset = evento.target.closest("[data-branding-preset]");
      if (preset) {
        estado.fijarBranding("preset", preset.dataset.brandingPreset);
        for (const clave of ["primario", "primario_suave", "secundario", "secundario_suave", "boton_fondo", "boton_texto", "titulos", "subtitulos", "parrafos"]) {
          estado.fijarBranding(`tokens.${clave}`, undefined);
        }
        return void pintarMarca();
      }
      const heredar = evento.target.closest("[data-branding-heredar]");
      if (heredar) {
        const clave = heredar.dataset.brandingHeredar;
        const propio = heredar.getAttribute("aria-pressed") === "true";
        if (propio) estado.fijarBranding(`tokens.${clave}`, undefined);
        else {
          const actuales = tokensDe(estado.documento().branding);
          estado.fijarBranding(`tokens.${clave}`, actuales[clave]);
        }
        return void pintarMarca();
      }
      return;
    }
    const cat = evento.target.closest("[data-categoria]");
    if (cat) { libreriaAbierta.categoria = cat.dataset.categoria || null; return void pintarLibreria(); }
    const tarjeta = evento.target.closest("[data-tipo], [data-composicion]");
    if (tarjeta && tarjeta.getAttribute("aria-disabled") !== "true") {
      if (tarjeta.dataset.composicion) {
        estado.insertarComposicion(tarjeta.dataset.composicion, { padreId: libreriaAbierta.padreId });
      } else {
        estado.insertar(tarjeta.dataset.tipo, { padreId: libreriaAbierta.padreId });
      }
      libreriaAbierta = null;
      pintarLibreria();
    }
  });

  // Las tarjetas son `article[role=button]` porque algunas miniaturas llevan
  // markup de formulario generado por el renderer; así no anidamos botones
  // interactivos inválidos. Enter y espacio conservan la misma UX de teclado.
  zonaModal.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;
    const tarjeta = evento.target.closest("[data-tipo], [data-composicion]");
    if (!tarjeta || tarjeta.getAttribute("aria-disabled") === "true") return;
    evento.preventDefault();
    tarjeta.click();
  });

  zonaModal.addEventListener("input", (evento) => {
    if (!evento.target.closest("[data-buscar]")) return;
    libreriaAbierta.busqueda = evento.target.value;
    pintarLibreria();
  });

  zonaModal.addEventListener("change", (evento) => {
    if (!marcaAbierta) return;
    const token = evento.target.closest("[data-branding-token]");
    if (token) {
      estado.fijarBranding(`tokens.${token.dataset.brandingToken}`, token.value);
      return void pintarMarca();
    }
    const radio = evento.target.closest("[data-branding-radio]");
    if (radio) {
      estado.fijarBranding("radio", radio.value);
      return void pintarMarca();
    }
    const fuente = evento.target.closest("[data-branding-fuente]");
    if (fuente) {
      const clave = fuente.dataset.brandingFuente === "titulos" ? "titulos" : "cuerpo";
      estado.fijarBranding(`tipografia.${clave}`, fuente.value);
      return void pintarMarca();
    }
  });

  zonaArbol.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;
    const fila = evento.target.closest("[data-nodo]");
    if (!fila) return;
    evento.preventDefault();
    estado.seleccionar(fila.dataset.nodo);
    verNodoDesdeArbol(fila.dataset.nodo);
  });

  // ---------- barra flotante ----------

  flota.addEventListener("click", (evento) => {
    const nodo = estado.nodoSeleccionado();
    const accion = evento.target.closest("[data-accion]");
    if (!nodo || !accion) return;
    switch (accion.dataset.accion) {
      case "duplicar": return void estado.duplicar(nodo.id);
      case "borrar": return void estado.borrar(nodo.id);
      case "agregar": return void abrirLibreria(nodo.id);
      case "ocultar": {
        const clave = estado.viewport() === "movil" ? "mostrar_movil" : "mostrar_escritorio";
        if (!registro.existe(nodo.tipo)) return void estado.borrar(nodo.id);
        const valores = contexto(estado.documento(), { viewport: estado.viewport() }).valores(nodo);
        return void estado.fijarProp(nodo.id, clave, valores[clave] === false);
      }
      // La edición con IA por bloque llega en la Fase 6; el botón ya está en su
      // lugar para no tener que rehacer la barra después.
      case "ia": if (alEditarConIA) return void raiz.dispatchEvent(new CustomEvent("tiq:ia", { detail: { nodo }, bubbles: true })); return;
    }
  });

  // ---------- barra superior y teclado ----------

  raiz.querySelector(".ed__barra").addEventListener("click", (evento) => {
    const vp = evento.target.closest("[data-viewport]");
    if (vp) { estado.fijarViewport(vp.dataset.viewport); return void lienzo.fijarViewport(vp.dataset.viewport); }
    const herramienta = evento.target.closest("[data-viewport-tool]");
    if (herramienta) {
      const tipo = herramienta.dataset.viewportTool;
      if (tipo === "fullscreen") {
        const activo = !superficie.classList.contains("ed--pantalla-completa");
        superficie.classList.toggle("ed--pantalla-completa", activo);
        herramienta.setAttribute("aria-pressed", String(activo));
        return void raiz.ownerDocument.defaultView.requestAnimationFrame(colocarFlota);
      }
      if (tipo === "select") {
        superficie.classList.remove("ed--pantalla-completa");
        raiz.querySelector('[data-viewport-tool="fullscreen"]')?.setAttribute("aria-pressed", "false");
        herramienta.setAttribute("aria-pressed", "true");
        return void raiz.ownerDocument.defaultView.requestAnimationFrame(colocarFlota);
      }
    }
    const modo = evento.target.closest("[data-modo-avanzado]");
    if (modo) {
      const avanzado = modo.getAttribute("aria-pressed") !== "true";
      modo.setAttribute("aria-pressed", String(avanzado));
      superficie.classList.toggle("ed--avanzado", avanzado);
      return;
    }
    const variantes = evento.target.closest("[data-editar-variantes]");
    if (variantes && alEditarVariantes) return void alEditarVariantes({ documento: estado.documento() });
    const acciones = evento.target.closest("[data-acciones]");
    if (acciones) {
      const menu = raiz.querySelector("[data-acciones-menu]");
      const abierto = menu?.hasAttribute("hidden");
      menu?.toggleAttribute("hidden", !abierto);
      acciones.setAttribute("aria-expanded", String(abierto));
      return;
    }
    const accion = evento.target.closest("[data-accion-editor]");
    if (accion) {
      raiz.querySelector("[data-acciones-menu]")?.setAttribute("hidden", "");
      raiz.querySelector("[data-acciones]")?.setAttribute("aria-expanded", "false");
      if (accion.dataset.accionEditor === "copiar-documento") {
        const serializado = JSON.stringify(estado.documento(), null, 2);
        const portapapeles = raiz.ownerDocument.defaultView.navigator?.clipboard;
        if (portapapeles?.writeText) {
          Promise.resolve(portapapeles.writeText(serializado)).then(() => {
            raiz.dispatchEvent(new CustomEvent("tiq:notificar", { detail: { mensaje: "Estructura copiada" }, bubbles: true }));
          }).catch(() => {});
        }
      }
      return;
    }
    if (evento.target.closest("[data-deshacer]")) return void estado.deshacer();
    if (evento.target.closest("[data-rehacer]")) return void estado.rehacer();
    if (evento.target.closest("[data-guardar]")) return void guardar();
    if (evento.target.closest("[data-publicar]") && alPublicar) return void publicar();
    if (evento.target.closest("[data-branding]")) return void abrirMarca();
    if (evento.target.closest("[data-volver]")) {
      return void raiz.dispatchEvent(new CustomEvent("tiq:volver", { bubbles: true }));
    }
    const panel = evento.target.closest("[data-panel-toggle]");
    if (panel) {
      const nombre = panel.dataset.panelToggle;
      const clase = `ed--${nombre}-abierto`;
      const abrir = !superficie.classList.contains(clase);
      superficie.classList.toggle(clase, abrir);
      // En teléfono los drawers salen de lados opuestos. Nunca deben quedar
      // abiertos juntos: además de taparse, dejan el preview sin una acción
      // inequívoca y se apartan del patrón de navegación de PagePilot.
      if (abrir) {
        superficie.classList.remove(`ed--${nombre === "arbol" ? "panel" : "arbol"}-abierto`);
      }
      return;
    }
  });

  // Guardar manda el documento tal cual: el que valida es el backend, que es
  // la única autoridad. Si rechaza, el llamador muestra el error y NO se marca
  // como guardado, así el botón sigue encendido y el trabajo no se da por hecho.
  async function guardar() {
    if (alGuardar) await alGuardar(estado.documento());
    estado.marcarGuardado();
  }

  // Publicar siempre parte del mismo snapshot que está viendo el merchant. Si
  // hay cambios pendientes, se guardan primero; así el backend nunca publica
  // un borrador anterior por una carrera entre el inspector y el botón verde.
  async function publicar() {
    const boton = raiz.querySelector("[data-publicar]");
    if (!alPublicar || boton?.disabled) return;
    if (boton) boton.disabled = true;
    try {
      if (estado.hayCambios() && alGuardar) await guardar();
      await alPublicar(estado.documento());
      estado.marcarGuardado();
    } catch (error) {
      raiz.dispatchEvent(new CustomEvent("tiq:error", {
        detail: { mensaje: error?.message || "No se pudo publicar la página." }, bubbles: true
      }));
    } finally {
      if (boton) boton.disabled = false;
      pedirRepintado();
    }
  }

  raiz.ownerDocument.addEventListener("keydown", (evento) => {
    if (!evento.ctrlKey && !evento.metaKey) return;
    const tecla = evento.key.toLowerCase();
    if (tecla === "z") { evento.preventDefault(); return void (evento.shiftKey ? estado.rehacer() : estado.deshacer()); }
    if (tecla === "y") { evento.preventDefault(); return void estado.rehacer(); }
    if (tecla === "s") { evento.preventDefault(); return void guardar(); }
  });

  // Al cambiar de tamaño, la barra flotante queda donde no va.
  raiz.ownerDocument.defaultView.addEventListener("resize", colocarFlota);
  raiz.querySelector(".ed__centro").addEventListener("scroll", colocarFlota, { passive: true });

  repintar();
  lienzo.fijarViewport(estado.viewport());

  return { estado, lienzo, repintar };
}

module.exports = { montarEditor, posicionFlota };
