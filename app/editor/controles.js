// ============================================================
// CONTROLES — los 16 tipos de campo, dibujados y leídos.
//
// Este archivo es el que hace que agregar una sección no cueste un panel nuevo.
// El panel no sabe qué es una "sección de reseñas": sabe dibujar un `richtext`,
// una `medida` y una `lista`, y el registro le dice cuáles tiene el tipo
// seleccionado. Por eso el conjunto es CERRADO (docs §3.4): cada clase nueva es
// código nuevo acá para siempre, mientras que una sección nueva es gratis.
//
// Todo lo de este archivo es puro: `html*` arma cadenas y `parsear` convierte
// las partes crudas de un formulario en el valor tipado que va al documento.
// Ni un querySelector. Eso permite testearlo en Node sin un DOM falso, y —más
// importante— que la conversión de tipos (que es donde de verdad se rompen los
// formularios) tenga tests de verdad.
//
// El micro-toggle de herencia se dibuja acá, junto al control, porque es parte
// del control: un valor que no se puede "devolver a heredar" es un valor que se
// escapó del sistema de marca (invariante I4).
// ============================================================

"use strict";

const { sanear } = require("../../nucleo/resolver");
const { CLAVES_TOKEN, NOMBRES_TOKEN } = require("../../nucleo/tokens");

const ICONO_ENLACE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.2 9.8l3.6-3.6M5.1 6.4l-1.3 1.3a2.5 2.5 0 003.5 3.5l1.3-1.3M10.9 9.6l1.3-1.3a2.5 2.5 0 00-3.5-3.5L7.4 6.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

const esc = (texto) =>
  String(texto === null || texto === undefined ? "" : texto)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Qué partes de formulario tiene cada clase. La capa de DOM las junta con
// [data-parte="..."] y se las pasa a parsear(): así el lector no necesita saber
// nada de cada control en particular.
const PARTES = {
  texto_plano: ["valor"],
  texto_largo: ["valor"],
  richtext: ["valor"],
  numero: ["valor"],
  medida: ["valor"],
  booleano: ["marcado"],
  seleccion: ["valor"],
  segmentado: ["valor"],
  token_color: ["token", "hex"],
  color: ["hex", "sin"],
  imagen: ["src", "alt"],
  video: ["src", "poster"],
  icono: ["valor"],
  enlace: ["url", "texto", "nueva_pestana"],
  producto: ["valor"],
  lista: ["items"]
};

const vacio = (v) => v === null || v === undefined || v === "";

// Un repetidor puede llegar desde el DOM como un mapa de partes
// (`{valor:"Ana"}`), pero también desde una semilla, una migración o una
// prueba como valor ya tipado (`"Ana"`, `5`, `{src:"…"}`). Normalizar acá evita
// que el parser interprete una cadena como si fuera un objeto de partes y la
// convierta silenciosamente en vacío.
function partesDeItem(campo, valor) {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    if (campo.tipo === "imagen" && Object.prototype.hasOwnProperty.call(valor, "src")) {
      return { src: valor.src, alt: valor.alt };
    }
    if (campo.tipo === "video" && Object.prototype.hasOwnProperty.call(valor, "src")) {
      return { src: valor.src, poster: valor.poster };
    }
    if (campo.tipo === "enlace" && Object.prototype.hasOwnProperty.call(valor, "url")) {
      return { url: valor.url, texto: valor.texto, nueva_pestana: valor.nueva_pestana };
    }
    // Es la forma que produce `lector.leerLista()` para todos los controles
    // primitivos y también para valores ya preparados por el editor.
    if (Object.keys(valor).some((clave) => ["valor", "marcado", "token", "hex", "sin", "src", "alt", "poster", "url", "texto", "nueva_pestana", "items"].includes(clave))) {
      return valor;
    }
  }
  if (campo.tipo === "booleano") return { marcado: Boolean(valor) };
  if (campo.tipo === "lista") return { items: Array.isArray(valor) ? valor : [] };
  return { valor };
}

// ------------------------------------------------------------
// Lectura: partes crudas -> valor tipado
// ------------------------------------------------------------

function parsear(campo, partes = {}) {
  switch (campo.tipo) {
    case "texto_plano":
    case "texto_largo":
    case "icono":
      return partes.valor === undefined ? "" : String(partes.valor);

    // El saneado ocurre al GUARDAR, no solo al renderizar: así lo que queda en
    // la base ya está limpio y no dependemos de que todos los consumidores
    // futuros se acuerden de sanear.
    case "richtext":
      return sanear(partes.valor);

    case "numero":
    case "medida": {
      if (vacio(partes.valor)) return null;
      const numero = Number(partes.valor);
      return Number.isFinite(numero) ? numero : null;
    }

    case "booleano":
      return !!partes.marcado;

    case "seleccion":
    case "segmentado":
      return vacio(partes.valor) ? null : String(partes.valor);

    case "token_color":
      if (vacio(partes.token)) return null;
      if (partes.token !== "personalizado") return String(partes.token);
      return /^#[0-9A-Fa-f]{6}$/.test(partes.hex || "") ? partes.hex : null;

    case "color":
      if (partes.sin) return null;
      return /^#[0-9A-Fa-f]{6}$/.test(partes.hex || "") ? partes.hex : null;

    case "imagen":
      return vacio(partes.src) ? null : { src: String(partes.src), alt: String(partes.alt || "") };

    case "video":
      return vacio(partes.src) ? null : { src: String(partes.src), poster: partes.poster || null };

    case "enlace":
      return vacio(partes.url)
        ? null
        : { url: String(partes.url), texto: partes.texto || null, nueva_pestana: !!partes.nueva_pestana };

    case "producto":
      return vacio(partes.valor) ? null : String(partes.valor);

    case "lista": {
      const items = Array.isArray(partes.items) ? partes.items : [];
      return items.map((item) => {
        const salida = {};
        for (const sub of campo.item_campos) salida[sub.clave] = parsear(sub, partesDeItem(sub, item?.[sub.clave]));
        return salida;
      });
    }

    default:
      return null;
  }
}

// ------------------------------------------------------------
// Dibujo
// ------------------------------------------------------------

const parte = (nombre) => ` data-parte="${nombre}"`;

// El micro-toggle. Solo aparece si el campo puede heredar algo, que es siempre
// salvo que el tipo declare el campo sin defecto.
function htmlHerencia(campo, overrideado) {
  if (campo.defecto === undefined) return "";
  const titulo = overrideado ? "Volver a heredar de la marca" : "Heredado de la marca";
  return `<button type="button" class="ed-heredar${overrideado ? " es-propio" : ""}" ` +
    `data-heredar="${esc(campo.clave)}" aria-pressed="${overrideado}" title="${esc(titulo)}"></button>`;
}

function opciones(lista, seleccionado) {
  return lista.map(([valor, etiqueta]) =>
    `<option value="${esc(valor)}"${valor === seleccionado ? " selected" : ""}>${esc(etiqueta)}</option>`
  ).join("");
}

function htmlEntrada(campo, valor, muestra) {
  switch (campo.tipo) {
    case "texto_plano":
      return `<input type="text" class="ed-texto"${parte("valor")} value="${esc(valor)}">`;

    case "texto_largo":
      return `<textarea class="ed-area" rows="3"${parte("valor")}>${esc(valor)}</textarea>`;

    case "richtext":
      return `<div class="ed-rich">` +
        `<div class="ed-rich__barra">` +
        ["bold:B", "italic:I", "underline:U"].map((par) => {
          const [comando, letra] = par.split(":");
          return `<button type="button" data-formato="${comando}" title="${comando}">${letra}</button>`;
        }).join("") +
        `<button type="button" data-formato="enlace" title="Enlace">${ICONO_ENLACE}</button>` +
        `<button type="button" class="ed-rich__ia" data-ia="${esc(campo.clave)}">Editar con IA</button>` +
        `</div>` +
        `<div class="ed-rich__area" contenteditable="true"${parte("valor")}>${sanear(valor)}</div>` +
        `</div>`;

    case "numero":
    case "medida":
      return `<span class="ed-num">` +
        `<input type="number" class="ed-num__input"${parte("valor")} value="${esc(valor)}"` +
        `${campo.min !== undefined ? ` min="${campo.min}"` : ""}${campo.max !== undefined ? ` max="${campo.max}"` : ""}` +
        `${campo.tipo === "medida" && campo.unidad === "" ? ' step="0.1"' : ""}>` +
        `${campo.unidad ? `<span class="ed-num__unidad">${esc(campo.unidad)}</span>` : ""}</span>`;

    case "booleano":
      return `<label class="ed-switch"><input type="checkbox"${parte("marcado")}${valor ? " checked" : ""}><span></span></label>`;

    case "seleccion":
      return `<div class="ed-select"><select${parte("valor")}>${opciones(campo.opciones, valor)}</select></div>`;

    case "segmentado":
      return `<div class="ed-seg" role="radiogroup"${parte("valor")} data-valor="${esc(valor)}">` +
        campo.opciones.map(([v, etiqueta]) =>
          `<button type="button" role="radio" aria-checked="${v === valor}" data-opcion="${esc(v)}">${esc(etiqueta)}</button>`
        ).join("") + `</div>`;

    case "token_color": {
      const esToken = typeof valor === "string" && valor.startsWith("@");
      const lista = [["", "Ninguno"], ...CLAVES_TOKEN.map((c) => [`@${c}`, NOMBRES_TOKEN[c]]), ["personalizado", "Personalizado…"]];
      const seleccionado = esToken ? valor : (valor ? "personalizado" : "");
      return `<div class="ed-color">` +
        `<span class="ed-color__muestra" data-muestra style="background:${esc(muestra || "transparent")}"></span>` +
        `<div class="ed-select"><select${parte("token")}>${opciones(lista, seleccionado)}</select></div>` +
        `<input type="color" class="ed-color__hex"${parte("hex")} value="${esc(esToken || !valor ? "#000000" : valor)}"` +
        `${seleccionado === "personalizado" ? "" : " hidden"}>` +
        `</div>`;
    }

    case "color":
      return `<div class="ed-color">` +
        `<input type="color" class="ed-color__hex"${parte("hex")} value="${esc(valor || "#000000")}"${valor ? "" : " hidden"}>` +
        `<label class="ed-color__sin"><input type="checkbox"${parte("sin")}${valor ? "" : " checked"}> Sin color</label>` +
        `</div>`;

    case "imagen": {
      const v = valor || {};
      return `<div class="ed-media">` +
        (v.src ? `<img class="ed-media__vista" src="${esc(v.src)}" alt="">` : `<div class="ed-media__vacio">Sin imagen</div>`) +
        `<label class="ed-media__archivo">Subir imagen<input type="file" data-subir-imagen accept="image/jpeg,image/png,image/webp,image/gif"></label>` +
        `<input type="url" class="ed-texto"${parte("src")} value="${esc(v.src)}" placeholder="URL de la imagen">` +
        `<input type="text" class="ed-texto"${parte("alt")} value="${esc(v.alt)}" placeholder="Texto alternativo (accesibilidad y SEO)">` +
        `</div>`;
    }

    case "video": {
      const v = valor || {};
      return `<div class="ed-media">` +
        `<input type="url" class="ed-texto"${parte("src")} value="${esc(v.src)}" placeholder="URL del video">` +
        `<input type="url" class="ed-texto"${parte("poster")} value="${esc(v.poster)}" placeholder="Imagen de portada">` +
        `</div>`;
    }

    case "icono":
      return `<div class="ed-select"><select${parte("valor")}>` +
        opciones((campo.opciones || []).length ? campo.opciones : [["", "Ninguno"]], valor) + `</select></div>`;

    case "enlace": {
      const v = valor || {};
      return `<div class="ed-enlace">` +
        `<input type="url" class="ed-texto"${parte("url")} value="${esc(v.url)}" placeholder="https://">` +
        `<input type="text" class="ed-texto"${parte("texto")} value="${esc(v.texto)}" placeholder="Texto del botón">` +
        `<label class="ed-check"><input type="checkbox"${parte("nueva_pestana")}${v.nueva_pestana ? " checked" : ""}> Abrir en otra pestaña</label>` +
        `</div>`;
    }

    case "producto":
      return `<div class="ed-producto">` +
        `<input type="text" class="ed-texto"${parte("valor")} value="${esc(valor)}" placeholder="gid://shopify/Product/…" readonly>` +
        `<button type="button" class="ed-boton" data-elegir-producto>Elegir</button></div>`;

    // La lista es el control que evita inventar clases nuevas: reseñas, FAQ,
    // beneficios y estadísticas son todas la misma cosa con otros subcampos.
    case "lista": {
      const items = Array.isArray(valor) ? valor : [];
      return `<div class="ed-lista">` +
        items.map((item, i) =>
          `<div class="ed-lista__item" data-item="${i}">` +
          `<div class="ed-lista__cabecera"><span>${esc(campo.nombre_item || "Elemento")} ${i + 1}</span>` +
          `<button type="button" data-subir="${i}" title="Subir">↑</button>` +
          `<button type="button" data-bajar="${i}" title="Bajar">↓</button>` +
          `<button type="button" data-quitar="${i}" title="Quitar">✕</button></div>` +
          campo.item_campos.map((sub) =>
            `<div class="ed-lista__campo" data-subcampo="${esc(sub.clave)}"><span>${esc(sub.etiqueta)}</span>` +
            htmlEntrada(sub, item[sub.clave]) + `</div>`
          ).join("") + `</div>`
        ).join("") +
        `<button type="button" class="ed-boton ed-boton--ancho" data-agregar-item>` +
        `Agregar ${esc((campo.nombre_item || "elemento").toLowerCase())}</button></div>`;
    }

    default:
      return "";
  }
}

// Un campo completo: etiqueta, micro-toggle de herencia, control y ayuda.
function htmlCampo(campo, valor, { overrideado = false, muestra = null } = {}) {
  const enPila = ["richtext", "texto_largo", "imagen", "video", "enlace", "lista", "producto"].includes(campo.tipo);
  return `<div class="ed-campo${enPila ? " ed-campo--pila" : ""}" data-clave="${esc(campo.clave)}" data-tipo="${esc(campo.tipo)}">` +
    `<div class="ed-campo__cabecera">` +
    htmlHerencia(campo, overrideado) +
    `<label class="ed-campo__etiqueta">${esc(campo.etiqueta)}</label>` +
    `</div>` +
    `<div class="ed-campo__control">${htmlEntrada(campo, valor, muestra)}</div>` +
    (campo.ayuda ? `<p class="ed-campo__ayuda">${esc(campo.ayuda)}</p>` : "") +
    `</div>`;
}

module.exports = { PARTES, parsear, htmlCampo, htmlEntrada, htmlHerencia, esc };
