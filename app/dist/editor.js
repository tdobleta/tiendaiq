// Generado por scripts/construir-editor.js — no editar a mano.
"use strict";
var TiqEditor = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // nucleo/tipos/_base.js
  var require_base = __commonJS({
    "nucleo/tipos/_base.js"(exports, module) {
      "use strict";
      var RADIO = {
        clave: "radio",
        tipo: "seleccion",
        etiqueta: "Esquinas",
        opciones: [["marca", "De la marca"], ["ninguno", "Rectas"], ["chico", "Chicas"], ["grande", "Grandes"]],
        defecto: "marca",
        css: "border-radius",
        mapa_css: { marca: "var(--tiq-radio)", ninguno: "0", chico: "6px", grande: "20px" }
      };
      var BORDE = {
        clave: "borde",
        tipo: "seleccion",
        etiqueta: "Borde",
        opciones: [["ninguno", "Ninguno"], ["fino", "Fino"], ["medio", "Medio"]],
        defecto: "ninguno",
        css: "border",
        mapa_css: { ninguno: "", fino: "1px solid var(--tiq-secundario)", medio: "2px solid var(--tiq-secundario)" }
      };
      var SOMBRA = {
        clave: "sombra",
        tipo: "seleccion",
        etiqueta: "Sombra",
        opciones: [["ninguna", "Ninguna"], ["suave", "Suave"], ["media", "Media"]],
        defecto: "ninguna",
        css: "box-shadow",
        mapa_css: { ninguna: "", suave: "0 1px 3px rgba(0,0,0,.08)", media: "0 6px 20px rgba(0,0,0,.12)" }
      };
      function alineacion(clave = "alineacion", etiqueta = "Alineaci\xF3n") {
        return {
          clave,
          tipo: "segmentado",
          etiqueta,
          opciones: [["izquierda", "Izquierda"], ["centro", "Centro"], ["derecha", "Derecha"]],
          defecto: "izquierda",
          css: "text-align",
          mapa_css: { izquierda: "left", centro: "center", derecha: "right" }
        };
      }
      function grupoApariencia({ fondo = true, borde = true, radio = true, sombra = false } = {}) {
        const campos = [];
        if (fondo) campos.push({ clave: "fondo", tipo: "token_color", etiqueta: "Color de fondo", defecto: null, css: "background-color" });
        if (borde) campos.push({ ...BORDE });
        if (radio) campos.push({ ...RADIO });
        if (sombra) campos.push({ ...SOMBRA });
        return { id: "apariencia", nombre: "Apariencia", responsive: true, campos };
      }
      function grupoEspaciado({ margen = false } = {}) {
        const campos = [
          { clave: "pad_arriba", tipo: "medida", etiqueta: "Arriba", unidad: "px", defecto: 0, min: 0, max: 240, css: "padding-top" },
          { clave: "pad_abajo", tipo: "medida", etiqueta: "Abajo", unidad: "px", defecto: 0, min: 0, max: 240, css: "padding-bottom" },
          { clave: "pad_izquierda", tipo: "medida", etiqueta: "Izquierda", unidad: "px", defecto: 0, min: 0, max: 240, css: "padding-left" },
          { clave: "pad_derecha", tipo: "medida", etiqueta: "Derecha", unidad: "px", defecto: 0, min: 0, max: 240, css: "padding-right" }
        ];
        if (margen) {
          campos.push({ clave: "margen_arriba", tipo: "medida", etiqueta: "Margen arriba", unidad: "px", defecto: 0, min: 0, max: 240, css: "margin-top" });
          campos.push({ clave: "margen_abajo", tipo: "medida", etiqueta: "Margen abajo", unidad: "px", defecto: 0, min: 0, max: 240, css: "margin-bottom" });
        }
        return { id: "espaciado", nombre: "Espaciado", responsive: true, campos };
      }
      function grupoVisibilidad() {
        return {
          id: "visibilidad",
          nombre: "Visibilidad",
          responsive: false,
          campos: [
            { clave: "mostrar_escritorio", tipo: "booleano", etiqueta: "Mostrar en escritorio", defecto: true },
            { clave: "mostrar_movil", tipo: "booleano", etiqueta: "Mostrar en m\xF3vil", defecto: true }
          ]
        };
      }
      function grupoAvanzado() {
        return {
          id: "avanzado",
          nombre: "Avanzado",
          responsive: false,
          campos: [
            { clave: "clase", tipo: "texto_plano", etiqueta: "Clase CSS", defecto: "", ayuda: "Pod\xE9s usar esta clase para aplicarle estilos propios al bloque. Separ\xE1 varias con espacios." }
          ]
        };
      }
      function gruposComunes(opciones = {}) {
        return [
          grupoApariencia(opciones.apariencia),
          grupoEspaciado(opciones.espaciado),
          grupoVisibilidad(),
          grupoAvanzado()
        ];
      }
      var CLAVES_APARIENCIA = ["fondo", "borde", "radio", "sombra"];
      var CLAVES_ESPACIADO = ["pad_arriba", "pad_abajo", "pad_izquierda", "pad_derecha", "margen_arriba", "margen_abajo"];
      var CLAVES_COMUNES = [...CLAVES_APARIENCIA, ...CLAVES_ESPACIADO];
      module.exports = {
        RADIO,
        BORDE,
        SOMBRA,
        alineacion,
        grupoApariencia,
        grupoEspaciado,
        grupoVisibilidad,
        grupoAvanzado,
        gruposComunes,
        CLAVES_APARIENCIA,
        CLAVES_ESPACIADO,
        CLAVES_COMUNES
      };
    }
  });

  // nucleo/tipos/grupo.js
  var require_grupo = __commonJS({
    "nucleo/tipos/grupo.js"(exports, module) {
      "use strict";
      var base = require_base();
      function css(nodo, ctx, claves) {
        return ctx.estilos(nodo, claves);
      }
      module.exports = {
        tipo: "grupo",
        nombre: "Grupo",
        categoria: "layout",
        icono: "grupo",
        visible_en_catalogo: false,
        admite_hijos: true,
        limite_por_pagina: null,
        grupos: [
          {
            id: "disposicion",
            nombre: "Disposici\xF3n",
            responsive: true,
            campos: [
              {
                clave: "direccion",
                tipo: "segmentado",
                etiqueta: "Direcci\xF3n",
                opciones: [["vertical", "Vertical"], ["horizontal", "Horizontal"]],
                defecto: "vertical",
                css: "flex-direction",
                mapa_css: { vertical: "column", horizontal: "row" }
              },
              { clave: "gap", tipo: "medida", etiqueta: "Separaci\xF3n", unidad: "px", defecto: 16, min: 0, max: 120, css: "gap" },
              base.alineacion()
            ]
          },
          ...base.gruposComunes({ apariencia: { sombra: false }, espaciado: { margen: false } })
        ],
        render(nodo, ctx) {
          const estilos = css(nodo, ctx, ["direccion", "gap", "alineacion", ...base.CLAVES_COMUNES]);
          return `<div class="tiq-grupo" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${ctx.hijos(nodo)}</div>`;
        }
      };
    }
  });

  // nucleo/tipos/comercio.js
  var require_comercio = __commonJS({
    "nucleo/tipos/comercio.js"(exports, module) {
      "use strict";
      var base = require_base();
      function css(nodo, ctx, claves) {
        return ctx.estilos(nodo, claves);
      }
      function envoltorio(nodo, ctx, clase, contenido, estilos = "") {
        return `<section class="${clase}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${contenido}</section>`;
      }
      function variantesDe(ctx) {
        const producto = ctx.producto || {};
        const lista = Array.isArray(producto.variantes) ? producto.variantes : producto.variants;
        return (Array.isArray(lista) ? lista : []).filter((v) => v && (v.id || v.variant_id || v.variantId));
      }
      var selector = {
        tipo: "selector_variantes",
        nombre: "Selector de variantes",
        categoria: "producto",
        icono: "variantes",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { etiqueta: "Eleg\xED una opci\xF3n", mostrar_si_unica: false },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [
            { clave: "etiqueta", tipo: "texto_plano", etiqueta: "Etiqueta", defecto: "Eleg\xED una opci\xF3n" },
            { clave: "mostrar_si_unica", tipo: "booleano", etiqueta: "Mostrar si hay una sola variante", defecto: false }
          ] },
          { id: "tipografia", nombre: "Tipograf\xEDa", responsive: true, campos: [
            { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 14, min: 11, max: 24, css: "font-size" }
          ] },
          ...base.gruposComunes()
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const variantes = variantesDe(ctx);
          const ocultar = variantes.length <= 1 && v.mostrar_si_unica !== true;
          if (ocultar && ctx.modo !== "editor") return "";
          const opciones = variantes.map((variante) => {
            var _a, _b;
            const id = variante.id || variante.variant_id || variante.variantId;
            const titulo = variante.titulo || variante.title || "Variante";
            const disponible = variante.disponible !== false && variante.available !== false;
            const activo = String(id) === String(((_a = ctx.producto) == null ? void 0 : _a.variante_id) || ((_b = ctx.producto) == null ? void 0 : _b.variant_id) || "");
            return `<option value="${ctx.escapar(String(id))}"${activo ? " selected" : ""}${disponible ? "" : " disabled"}>${ctx.escapar(String(titulo))}${disponible ? "" : " \u2014 Agotado"}</option>`;
          }).join("");
          const cuerpo = ocultar ? `<p class="tiq-selector-variantes__vacio">La variante se elige autom\xE1ticamente.</p>` : `<label><span>${ctx.sanear(v.etiqueta || "Eleg\xED una opci\xF3n")}</span><select name="id" data-tiq-variante aria-label="${ctx.escapar(v.etiqueta || "Variante")}">${opciones || `<option value="">No hay variantes disponibles</option>`}</select></label>`;
          return envoltorio(nodo, ctx, "tiq-selector-variantes", cuerpo, css(nodo, ctx, ["tamano", ...base.CLAVES_COMUNES]));
        }
      };
      var cantidad = {
        tipo: "cantidad_producto",
        nombre: "Cantidad",
        categoria: "producto",
        icono: "cantidad",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { etiqueta: "Cantidad", valor: 1 },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [
            { clave: "etiqueta", tipo: "texto_plano", etiqueta: "Etiqueta", defecto: "Cantidad" },
            { clave: "valor", tipo: "numero", etiqueta: "Valor inicial", defecto: 1, min: 1, max: 99 }
          ] },
          { id: "tipografia", nombre: "Tipograf\xEDa", responsive: true, campos: [
            { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 14, min: 11, max: 24, css: "font-size" }
          ] },
          ...base.gruposComunes()
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const valor = Math.max(1, Math.min(99, Math.floor(Number(v.valor) || 1)));
          return envoltorio(nodo, ctx, "tiq-cantidad-producto", `<label><span>${ctx.sanear(v.etiqueta || "Cantidad")}</span><input type="number" data-tiq-cantidad min="1" max="99" step="1" value="${valor}" aria-label="${ctx.escapar(v.etiqueta || "Cantidad")}"></label>`, css(nodo, ctx, ["tamano", ...base.CLAVES_COMUNES]));
        }
      };
      module.exports = [selector, cantidad];
    }
  });

  // nucleo/tipos/seccion.js
  var require_seccion = __commonJS({
    "nucleo/tipos/seccion.js"(exports, module) {
      "use strict";
      var base = require_base();
      module.exports = {
        tipo: "seccion",
        nombre: "Secci\xF3n",
        categoria: "layout",
        icono: "seccion",
        admite_hijos: true,
        limite_por_pagina: null,
        grupos: [
          {
            id: "disposicion",
            nombre: "Disposici\xF3n",
            responsive: true,
            campos: [
              {
                clave: "ancho",
                tipo: "segmentado",
                etiqueta: "Ancho de la secci\xF3n",
                opciones: [["pagina", "P\xE1gina"], ["completo", "Completo"]],
                defecto: "pagina",
                responsive: false
              },
              {
                clave: "ancho_contenido",
                tipo: "segmentado",
                etiqueta: "Ancho del contenido",
                opciones: [["pagina", "P\xE1gina"], ["completo", "Completo"]],
                defecto: "pagina",
                responsive: false
              },
              {
                clave: "direccion",
                tipo: "segmentado",
                etiqueta: "Direcci\xF3n",
                opciones: [["vertical", "Vertical"], ["horizontal", "Horizontal"]],
                defecto: "vertical",
                css: "flex-direction",
                mapa_css: { vertical: "column", horizontal: "row" }
              },
              { clave: "gap", tipo: "medida", etiqueta: "Separaci\xF3n", unidad: "px", defecto: 16, min: 0, max: 120, css: "gap" },
              base.alineacion()
            ]
          },
          ...base.gruposComunes({ apariencia: { sombra: true }, espaciado: { margen: true } })
        ],
        render(nodo, ctx) {
          if (!ctx.visible(nodo)) return "";
          const v = ctx.valores(nodo);
          const estilos = ctx.estilos(nodo, ["direccion", "gap", "alineacion", ...base.CLAVES_COMUNES]);
          const clases = [
            "tiq-seccion",
            `tiq-seccion--${v.ancho}`,
            `tiq-seccion--contenido-${v.ancho_contenido}`,
            ctx.escapar(v.clase || "")
          ].filter(Boolean).join(" ");
          return `<section class="${clases}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${ctx.hijos(nodo)}</section>`;
        }
      };
    }
  });

  // nucleo/tipos/texto.js
  var require_texto = __commonJS({
    "nucleo/tipos/texto.js"(exports, module) {
      "use strict";
      var base = require_base();
      module.exports = {
        tipo: "texto",
        nombre: "Texto",
        categoria: "contenido",
        icono: "texto",
        admite_hijos: false,
        limite_por_pagina: null,
        // Solo contenido: un bloque recién insertado tiene que verse. Los estilos no
        // se siembran nunca (ver nucleo/registro.js).
        semilla: { html: "Escrib\xED ac\xE1 tu texto." },
        grupos: [
          {
            id: "tipografia",
            nombre: "Tipograf\xEDa",
            responsive: true,
            campos: [
              { clave: "html", tipo: "richtext", etiqueta: "Texto", defecto: "", responsive: false, ia: true },
              {
                clave: "etiqueta",
                tipo: "seleccion",
                etiqueta: "Nivel",
                opciones: [["p", "P\xE1rrafo"], ["h2", "T\xEDtulo 2"], ["h3", "T\xEDtulo 3"], ["h4", "T\xEDtulo 4"]],
                defecto: "p",
                responsive: false
              },
              { clave: "color", tipo: "token_color", etiqueta: "Color de marca", defecto: "@parrafos", css: "color" },
              { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 16, min: 8, max: 96, css: "font-size" },
              {
                clave: "peso",
                tipo: "seleccion",
                etiqueta: "Grosor",
                opciones: [["regular", "Regular"], ["medium", "Medium"], ["semibold", "Semibold"], ["bold", "Bold"]],
                defecto: "regular",
                css: "font-weight",
                mapa_css: { regular: "400", medium: "500", semibold: "600", bold: "700" }
              },
              {
                clave: "interletrado",
                tipo: "segmentado",
                etiqueta: "Interletrado",
                opciones: [["ajustado", "Ajustado"], ["normal", "Normal"], ["amplio", "Amplio"]],
                defecto: "normal",
                css: "letter-spacing",
                mapa_css: { ajustado: "-0.02em", normal: "0", amplio: "0.06em" }
              },
              {
                clave: "caja",
                tipo: "seleccion",
                etiqueta: "May\xFAsculas",
                opciones: [["normal", "Normal"], ["altas", "MAY\xDASCULAS"], ["bajas", "min\xFAsculas"]],
                defecto: "normal",
                css: "text-transform",
                mapa_css: { normal: "none", altas: "uppercase", bajas: "lowercase" }
              },
              { clave: "interlineado", tipo: "medida", etiqueta: "Altura de l\xEDnea", unidad: "", defecto: null, min: 0.8, max: 3, css: "line-height" }
            ]
          },
          {
            id: "disposicion",
            nombre: "Disposici\xF3n",
            responsive: true,
            campos: [
              {
                clave: "ancho",
                tipo: "segmentado",
                etiqueta: "Ancho",
                opciones: [["llenar", "Llenar"], ["ajustar", "Ajustar"]],
                defecto: "llenar",
                css: "width",
                mapa_css: { llenar: "100%", ajustar: "fit-content" }
              },
              base.alineacion()
            ]
          },
          ...base.gruposComunes()
        ],
        render(nodo, ctx) {
          if (!ctx.visible(nodo)) return "";
          const v = ctx.valores(nodo);
          const etiqueta = ["p", "h2", "h3", "h4"].includes(v.etiqueta) ? v.etiqueta : "p";
          const estilos = ctx.estilos(nodo, [
            "color",
            "tamano",
            "peso",
            "interletrado",
            "caja",
            "interlineado",
            "ancho",
            "alineacion",
            ...base.CLAVES_COMUNES
          ]);
          const clases = ["tiq-texto", ctx.escapar(v.clase || "")].filter(Boolean).join(" ");
          return `<${etiqueta} class="${clases}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${ctx.sanear(v.html)}</${etiqueta}>`;
        }
      };
    }
  });

  // nucleo/tipos/imagen.js
  var require_imagen = __commonJS({
    "nucleo/tipos/imagen.js"(exports, module) {
      "use strict";
      var base = require_base();
      module.exports = {
        tipo: "imagen",
        nombre: "Imagen",
        categoria: "imagen_contenido",
        icono: "imagen",
        admite_hijos: false,
        limite_por_pagina: null,
        grupos: [
          {
            id: "contenido",
            nombre: "Imagen",
            responsive: false,
            campos: [
              { clave: "imagen", tipo: "imagen", etiqueta: "Archivo", defecto: null },
              { clave: "enlace", tipo: "enlace", etiqueta: "Enlace al hacer clic", defecto: null }
            ]
          },
          {
            id: "disposicion",
            nombre: "Disposici\xF3n",
            responsive: true,
            campos: [
              {
                clave: "relacion",
                tipo: "seleccion",
                etiqueta: "Relaci\xF3n de aspecto",
                opciones: [["original", "Original"], ["1-1", "Cuadrada"], ["4-5", "Vertical 4:5"], ["16-9", "Apaisada 16:9"]],
                defecto: "original",
                css: "aspect-ratio",
                mapa_css: { original: "", "1-1": "1 / 1", "4-5": "4 / 5", "16-9": "16 / 9" }
              },
              {
                clave: "ajuste",
                tipo: "segmentado",
                etiqueta: "Ajuste",
                opciones: [["cubrir", "Cubrir"], ["contener", "Contener"]],
                defecto: "cubrir",
                css: "object-fit",
                mapa_css: { cubrir: "cover", contener: "contain" }
              },
              { clave: "ancho_max", tipo: "medida", etiqueta: "Ancho m\xE1ximo", unidad: "px", defecto: null, min: 40, max: 2e3, css: "max-width" },
              base.alineacion()
            ]
          },
          ...base.gruposComunes({ apariencia: { sombra: true } })
        ],
        render(nodo, ctx) {
          if (!ctx.visible(nodo)) return "";
          const v = ctx.valores(nodo);
          if (!v.imagen || !v.imagen.src || !ctx.urlSegura(v.imagen.src, { media: true })) return "";
          const estilos = ctx.estilos(nodo, ["relacion", "ajuste", "ancho_max", ...base.CLAVES_COMUNES]);
          const clases = ["tiq-imagen", ctx.escapar(v.clase || "")].filter(Boolean).join(" ");
          const img = `<img class="${clases}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}" src="${ctx.escapar(v.imagen.src)}" alt="${ctx.escapar(v.imagen.alt || "")}" loading="lazy" decoding="async">`;
          if (v.enlace && v.enlace.url && ctx.urlSegura(v.enlace.url)) {
            return `<a class="tiq-imagen__enlace" href="${ctx.escapar(v.enlace.url)}"${v.enlace.nueva_pestana ? ' target="_blank" rel="noopener"' : ""}>${img}</a>`;
          }
          return img;
        }
      };
    }
  });

  // nucleo/tipos/imagen-texto.js
  var require_imagen_texto = __commonJS({
    "nucleo/tipos/imagen-texto.js"(exports, module) {
      "use strict";
      var base = require_base();
      function imagenSegura(ctx, imagen, alt) {
        if (!imagen || !ctx.urlSegura(imagen.src, { media: true })) return "";
        return `<img src="${ctx.escapar(imagen.src)}" alt="${ctx.escapar(imagen.alt || alt || "")}" loading="lazy" decoding="async">`;
      }
      module.exports = {
        tipo: "imagen_texto",
        nombre: "Imagen con texto",
        categoria: "imagen_contenido",
        icono: "imagen-texto",
        admite_hijos: false,
        limite_por_pagina: null,
        semilla: { titulo: "Un cambio visible desde el primer uso", texto: "Cont\xE1 qu\xE9 hace diferente a tu producto.", imagen: null },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [
            { clave: "titulo", tipo: "texto_plano", etiqueta: "T\xEDtulo", defecto: "Un cambio visible desde el primer uso" },
            { clave: "texto", tipo: "texto_largo", etiqueta: "Texto", defecto: "Cont\xE1 qu\xE9 hace diferente a tu producto." },
            { clave: "imagen", tipo: "imagen", etiqueta: "Imagen", defecto: null },
            { clave: "enlace", tipo: "enlace", etiqueta: "Enlace", defecto: null }
          ] },
          { id: "disposicion", nombre: "Disposici\xF3n", responsive: true, campos: [
            { clave: "direccion", tipo: "segmentado", etiqueta: "Direcci\xF3n", opciones: [["imagen-izquierda", "Imagen izquierda"], ["imagen-derecha", "Imagen derecha"]], defecto: "imagen-izquierda", css: "--tiq-imagen-texto-direccion", mapa_css: { "imagen-izquierda": "row", "imagen-derecha": "row-reverse" } },
            base.alineacion()
          ] },
          ...base.gruposComunes({ apariencia: { sombra: true }, espaciado: { margen: true } })
        ],
        render(nodo, ctx) {
          if (!ctx.visible(nodo)) return "";
          const v = ctx.valores(nodo);
          const titulo = ctx.sanear(v.titulo || "");
          const texto = ctx.sanear(v.texto || "");
          const imagen = imagenSegura(ctx, v.imagen, v.titulo);
          const enlace = v.enlace && ctx.urlSegura(v.enlace.url) ? `<a class="tiq-imagen-texto__cta" href="${ctx.escapar(v.enlace.url)}"${v.enlace.nueva_pestana ? ' target="_blank" rel="noopener noreferrer"' : ""}>${ctx.escapar(v.enlace.texto || "Conocer m\xE1s")}</a>` : "";
          return `<section class="tiq-imagen-texto" data-nodo="${ctx.escapar(nodo.id)}" style="${ctx.estilos(nodo, ["direccion", "alineacion", ...base.CLAVES_COMUNES])}"><div class="tiq-imagen-texto__imagen">${imagen || `<div class="tiq-imagen-texto__vacio">Imagen pendiente</div>`}</div><div class="tiq-imagen-texto__copy">${titulo ? `<h2>${titulo}</h2>` : ""}${texto ? `<p>${texto}</p>` : ""}${enlace}</div></section>`;
        }
      };
    }
  });

  // nucleo/tipos/tabla-comparacion.js
  var require_tabla_comparacion = __commonJS({
    "nucleo/tipos/tabla-comparacion.js"(exports, module) {
      "use strict";
      var base = require_base();
      module.exports = {
        tipo: "tabla_comparacion",
        nombre: "Tabla comparativa",
        categoria: "beneficios",
        icono: "tabla",
        admite_hijos: false,
        limite_por_pagina: null,
        semilla: { titulo: "Por qu\xE9 elegirlo", otro: "Alternativa", filas: [{ etiqueta: "Calidad", nosotros: true, otro: false }] },
        grupos: [
          { id: "contenido", nombre: "Comparaci\xF3n", responsive: false, campos: [
            { clave: "titulo", tipo: "texto_plano", etiqueta: "T\xEDtulo", defecto: "Por qu\xE9 elegirlo" },
            { clave: "intro", tipo: "texto_largo", etiqueta: "Introducci\xF3n", defecto: "" },
            { clave: "otro", tipo: "texto_plano", etiqueta: "Alternativa", defecto: "Alternativa" },
            { clave: "filas", tipo: "lista", etiqueta: "Filas", nombre_item: "Atributo", max_items: 12, item_campos: [
              { clave: "etiqueta", tipo: "texto_plano", etiqueta: "Atributo", defecto: "Calidad" },
              { clave: "nosotros", tipo: "booleano", etiqueta: "Nuestro producto", defecto: true },
              { clave: "otro", tipo: "booleano", etiqueta: "Alternativa", defecto: false }
            ], defecto: [] }
          ] },
          { id: "tipografia", nombre: "Tipograf\xEDa", responsive: true, campos: [
            { clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" },
            { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 15, min: 11, max: 24, css: "font-size" }
          ] },
          ...base.gruposComunes({ apariencia: { sombra: false }, espaciado: { margen: true } })
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const filas = Array.isArray(v.filas) ? v.filas : [];
          const cuerpo = filas.map((fila) => `<tr><th scope="row">${ctx.escapar(fila.etiqueta || "Atributo")}</th><td aria-label="${v.titulo ? ctx.escapar(v.titulo) : "Producto"}">${fila.nosotros ? "\u2713" : "\u2014"}</td><td aria-label="${ctx.escapar(v.otro || "Alternativa")}">${fila.otro ? "\u2713" : "\u2715"}</td></tr>`).join("");
          return `<section class="tiq-tabla-comparacion" data-nodo="${ctx.escapar(nodo.id)}" style="${ctx.estilos(nodo, ["color", "tamano", ...base.CLAVES_COMUNES])}"><h2>${ctx.escapar(v.titulo || "Por qu\xE9 elegirlo")}</h2>${v.intro ? `<p>${ctx.sanear(v.intro)}</p>` : ""}<table><thead><tr><th></th><th>Nosotros</th><th>${ctx.escapar(v.otro || "Alternativa")}</th></tr></thead><tbody>${cuerpo}</tbody></table></section>`;
        }
      };
    }
  });

  // nucleo/tipos/estadisticas.js
  var require_estadisticas = __commonJS({
    "nucleo/tipos/estadisticas.js"(exports, module) {
      "use strict";
      var base = require_base();
      module.exports = {
        tipo: "estadisticas",
        nombre: "Estad\xEDsticas destacadas",
        categoria: "prueba_social",
        icono: "estadisticas",
        admite_hijos: false,
        limite_por_pagina: null,
        semilla: { titulo: "Lo que notaron quienes lo usaron", items: [{ porcentaje: 90, texto: "Notaron una mejora visible." }] },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [
            { clave: "imagen", tipo: "imagen", etiqueta: "Imagen", defecto: null },
            { clave: "titulo", tipo: "texto_plano", etiqueta: "T\xEDtulo", defecto: "Lo que notaron quienes lo usaron" },
            { clave: "items", tipo: "lista", etiqueta: "Resultados", nombre_item: "Resultado", max_items: 6, item_campos: [
              { clave: "porcentaje", tipo: "numero", etiqueta: "Porcentaje", defecto: 90, min: 0, max: 100 },
              { clave: "texto", tipo: "texto_largo", etiqueta: "Resultado", defecto: "Notaron una mejora visible." }
            ], defecto: [] }
          ] },
          { id: "estilo", nombre: "Estad\xEDsticas", responsive: true, campos: [
            { clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@primario", css: "color" },
            { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 15, min: 11, max: 24, css: "font-size" }
          ] },
          ...base.gruposComunes({ apariencia: { fondo: false, borde: false, radio: true, sombra: false }, espaciado: { margen: true } })
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const items = Array.isArray(v.items) ? v.items : [];
          const imagen = v.imagen ? `<div class="tiq-estadisticas__imagen">${ctx.urlSegura(v.imagen.src, { media: true }) ? `<img src="${ctx.escapar(v.imagen.src)}" alt="${ctx.escapar(v.imagen.alt || v.titulo || "")}" loading="lazy" decoding="async">` : ""}</div>` : "";
          return `<section class="tiq-estadisticas" data-nodo="${ctx.escapar(nodo.id)}" style="${ctx.estilos(nodo, ["color", "tamano", ...base.CLAVES_COMUNES])}">${imagen}<h2>${ctx.escapar(v.titulo || "Resultados")}</h2><div class="tiq-estadisticas__lista">${items.map((item) => {
            const porcentaje = Math.max(0, Math.min(100, Number(item.porcentaje) || 0));
            return `<article><strong>${porcentaje}%</strong><div><span>${ctx.escapar(item.texto || "")}</span><i style="--tiq-porcentaje:${porcentaje}%"></i></div></article>`;
          }).join("")}</div></section>`;
        }
      };
    }
  });

  // nucleo/tipos/garantia.js
  var require_garantia = __commonJS({
    "nucleo/tipos/garantia.js"(exports, module) {
      "use strict";
      var base = require_base();
      module.exports = {
        tipo: "garantia",
        nombre: "Garant\xEDa y devoluciones",
        categoria: "garantia",
        icono: "garantia",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { titulo: "Compra tranquila", texto: "Explic\xE1 de forma clara c\xF3mo acompa\xF1\xE1s al cliente si algo no sale bien." },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [
            { clave: "titulo", tipo: "texto_plano", etiqueta: "T\xEDtulo", defecto: "Compra tranquila" },
            { clave: "texto", tipo: "texto_largo", etiqueta: "Texto", defecto: "Explic\xE1 de forma clara c\xF3mo acompa\xF1\xE1s al cliente si algo no sale bien." },
            { clave: "enlace", tipo: "enlace", etiqueta: "Pol\xEDtica completa", defecto: null }
          ] },
          { id: "tipografia", nombre: "Tipograf\xEDa", responsive: true, campos: [
            { clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" },
            { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 15, min: 11, max: 24, css: "font-size" }
          ] },
          ...base.gruposComunes({ apariencia: { sombra: true }, espaciado: { margen: true } })
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const enlace = v.enlace && ctx.urlSegura(v.enlace.url) ? `<a href="${ctx.escapar(v.enlace.url)}"${v.enlace.nueva_pestana ? ' target="_blank" rel="noopener noreferrer"' : ""}>${ctx.escapar(v.enlace.texto || "Ver pol\xEDtica")}</a>` : "";
          return `<section class="tiq-garantia" data-nodo="${ctx.escapar(nodo.id)}" style="${ctx.estilos(nodo, ["color", "tamano", ...base.CLAVES_COMUNES])}"><h2>${ctx.escapar(v.titulo || "Compra tranquila")}</h2><p>${ctx.escapar(v.texto || "")}</p>${enlace}</section>`;
        }
      };
    }
  });

  // nucleo/tipos/piloto.js
  var require_piloto = __commonJS({
    "nucleo/tipos/piloto.js"(exports, module) {
      "use strict";
      var base = require_base();
      var lista = (clave, etiqueta, nombre_item, item_campos, defecto = []) => ({
        clave,
        tipo: "lista",
        etiqueta,
        nombre_item,
        item_campos,
        defecto,
        max_items: 30
      });
      var campoTexto = (clave, etiqueta, defecto = "") => ({ clave, tipo: "texto_plano", etiqueta, defecto });
      var campoLargo = (clave, etiqueta, defecto = "") => ({ clave, tipo: "texto_largo", etiqueta, defecto });
      function comun({ sombra = false } = {}) {
        return base.gruposComunes({ apariencia: { sombra }, espaciado: { margen: true } });
      }
      function css(nodo, ctx, claves) {
        return ctx.estilos(nodo, claves);
      }
      function envoltorio(nodo, ctx, clase, contenido, estilos = "") {
        if (!ctx.visible(nodo)) return "";
        const claseSegura = [clase, ctx.escapar(ctx.valores(nodo).clase || "")].filter(Boolean).join(" ");
        return `<section class="${claseSegura}" data-nodo="${ctx.escapar(nodo.id)}" style="${estilos}">${contenido}</section>`;
      }
      function textoSeguro(ctx, valor, fallback = "") {
        return ctx.sanear(typeof valor === "string" && valor ? valor : fallback);
      }
      function imagenesDelProducto(ctx) {
        const producto = ctx.producto || {};
        return Array.isArray(producto.imagenes) ? producto.imagenes : Array.isArray(producto.images) ? producto.images : [];
      }
      function imagenProducto(ctx, imagen, alt = "Imagen del producto") {
        if (!imagen) return "";
        const src = typeof imagen === "string" ? imagen : imagen.src || imagen.url;
        if (!ctx.urlSegura(src, { media: true })) return "";
        const textoAlt = typeof imagen === "object" && imagen.alt ? imagen.alt : alt;
        return `<img src="${ctx.escapar(src)}" alt="${ctx.escapar(textoAlt)}" loading="lazy" decoding="async">`;
      }
      var galeria = {
        tipo: "galeria_producto",
        nombre: "Galer\xEDa de producto",
        categoria: "producto",
        icono: "galeria",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { imagenes: [] },
        grupos: [
          { id: "contenido", nombre: "Im\xE1genes", responsive: false, campos: [
            lista("imagenes", "Galer\xEDa", "Imagen", [
              { clave: "imagen", tipo: "imagen", etiqueta: "Archivo", defecto: null },
              campoTexto("alt", "Texto alternativo", "")
            ], [])
          ] },
          { id: "disposicion", nombre: "Disposici\xF3n", responsive: true, campos: [
            { clave: "miniaturas", tipo: "booleano", etiqueta: "Mostrar miniaturas", defecto: true },
            { clave: "relacion", tipo: "seleccion", etiqueta: "Relaci\xF3n", opciones: [["original", "Original"], ["cuadrada", "Cuadrada"], ["vertical", "Vertical"]], defecto: "original", css: "aspect-ratio", mapa_css: { original: "", cuadrada: "1 / 1", vertical: "4 / 5" } },
            { clave: "ajuste", tipo: "segmentado", etiqueta: "Ajuste", opciones: [["cubrir", "Cubrir"], ["contener", "Contener"]], defecto: "cubrir", css: "object-fit", mapa_css: { cubrir: "cover", contener: "contain" } }
          ] },
          ...comun({ sombra: true })
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const definidas = Array.isArray(v.imagenes) ? v.imagenes.map((item) => item == null ? void 0 : item.imagen).filter(Boolean) : [];
          const fotos = definidas.length ? definidas : imagenesDelProducto(ctx);
          const principal = imagenProducto(ctx, fotos[0]);
          if (!principal) return envoltorio(nodo, ctx, "tiq-galeria", `<div class="tiq-galeria__vacio">A\xF1ad\xED im\xE1genes del producto</div>`);
          const miniaturas = v.miniaturas && fotos.length > 1 ? `<div class="tiq-galeria__miniaturas" data-tiq-galeria-mini>${fotos.map((foto, i) => `<button type="button" data-tiq-galeria-indice="${i}" aria-label="Ver imagen ${i + 1}"${i === 0 ? ' aria-current="true"' : ""}>${imagenProducto(ctx, foto)}</button>`).join("")}</div>` : "";
          return envoltorio(nodo, ctx, "tiq-galeria", `<div class="tiq-galeria__principal" data-tiq-galeria-principal style="${css(nodo, ctx, ["relacion"])}">${principal}</div>${miniaturas}`, css(nodo, ctx, base.CLAVES_COMUNES));
        }
      };
      var titulo = {
        tipo: "titulo_producto",
        nombre: "T\xEDtulo del producto",
        categoria: "producto",
        icono: "titulo",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { texto: "" },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [campoTexto("texto", "T\xEDtulo", "")] },
          { id: "tipografia", nombre: "Tipograf\xEDa", responsive: true, campos: [
            { clave: "color", tipo: "token_color", etiqueta: "Color de marca", defecto: "@titulos", css: "color" },
            { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 40, min: 16, max: 100, css: "font-size" },
            { clave: "peso", tipo: "seleccion", etiqueta: "Grosor", opciones: [["regular", "Regular"], ["medium", "Medium"], ["semibold", "Semibold"], ["bold", "Bold"]], defecto: "semibold", css: "font-weight", mapa_css: { regular: "400", medium: "500", semibold: "600", bold: "700" } },
            base.alineacion()
          ] },
          ...comun()
        ],
        render(nodo, ctx) {
          var _a, _b;
          const v = ctx.valores(nodo);
          const contenido = textoSeguro(ctx, v.texto, ((_a = ctx.producto) == null ? void 0 : _a.titulo) || ((_b = ctx.producto) == null ? void 0 : _b.title) || "T\xEDtulo del producto");
          return envoltorio(nodo, ctx, "tiq-titulo-producto", `<h1 style="${css(nodo, ctx, ["color", "tamano", "peso", "alineacion"])}">${contenido}</h1>`, css(nodo, ctx, base.CLAVES_COMUNES));
        }
      };
      var precio = {
        tipo: "precio_producto",
        nombre: "Precio del producto",
        categoria: "producto",
        icono: "precio",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { prefijo: "", oferta: "Oferta" },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [campoTexto("prefijo", "Prefijo", ""), campoTexto("oferta", "Etiqueta de oferta", "Oferta"), { clave: "mostrar_comparacion", tipo: "booleano", etiqueta: "Mostrar precio anterior", defecto: true }] },
          { id: "tipografia", nombre: "Tipograf\xEDa", responsive: true, campos: [
            { clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@primario", css: "color" },
            { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 22, min: 12, max: 64, css: "font-size" },
            { clave: "peso", tipo: "seleccion", etiqueta: "Grosor", opciones: [["regular", "Regular"], ["medium", "Medium"], ["bold", "Bold"]], defecto: "bold", css: "font-weight", mapa_css: { regular: "400", medium: "500", bold: "700" } }
          ] },
          ...comun()
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const p = ctx.producto || {};
          const actual = p.precio_formateado || p.price || p.precio || "Precio del producto";
          const anterior = p.precio_anterior_formateado || p.compare_at_price || p.precio_anterior;
          const comparacion = v.mostrar_comparacion && anterior ? `<s>${ctx.escapar(anterior)}</s>` : "";
          const badge = v.oferta && anterior ? `<span class="tiq-precio__badge">${textoSeguro(ctx, v.oferta)}</span>` : "";
          return envoltorio(nodo, ctx, "tiq-precio-producto", `<p style="${css(nodo, ctx, ["color", "tamano", "peso"])}">${textoSeguro(ctx, v.prefijo)}${ctx.escapar(String(actual))} ${comparacion}${badge}</p>`, css(nodo, ctx, base.CLAVES_COMUNES));
        }
      };
      var beneficios = {
        tipo: "beneficios_producto",
        nombre: "Beneficios destacados",
        categoria: "beneficios",
        icono: "beneficios",
        admite_hijos: false,
        limite_por_pagina: null,
        semilla: { titulo: "Detalles que marcan la diferencia", puntos: [{ icono: "\u2713", texto: "Un beneficio claro para tu rutina." }] },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [{ clave: "imagen", tipo: "imagen", etiqueta: "Imagen", defecto: null }, campoTexto("titulo", "T\xEDtulo", "Detalles que marcan la diferencia"), lista("puntos", "Puntos", "Punto", [campoTexto("icono", "Icono", "\u2713"), campoLargo("texto", "Texto", "")], [])] },
          { id: "tipografia", nombre: "Tipograf\xEDa", responsive: true, campos: [{ clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" }, { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 15, min: 10, max: 32, css: "font-size" }] },
          ...comun()
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const puntos = Array.isArray(v.puntos) ? v.puntos : [];
          const imagen = v.imagen ? `<div class="tiq-beneficios__imagen">${imagenProducto(ctx, v.imagen, v.titulo)}</div>` : "";
          const contenido = `${imagen}${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}<ul>${puntos.map((p) => `<li><span>${textoSeguro(ctx, p.icono, "\u2713")}</span><div>${textoSeguro(ctx, p.texto)}</div></li>`).join("")}</ul>`;
          return envoltorio(nodo, ctx, "tiq-beneficios", contenido, `${css(nodo, ctx, ["color", "tamano", ...base.CLAVES_COMUNES])}`);
        }
      };
      var packs = {
        tipo: "packs_compra",
        nombre: "Packs de compra",
        categoria: "conversion",
        icono: "packs",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { titulo: "Opciones de compra", packs: [{ titulo: "1 unidad", subtitulo: "Presentaci\xF3n del producto", cantidad: "1", precio: "", badge: "" }] },
        grupos: [
          { id: "contenido", nombre: "Packs", responsive: false, campos: [campoTexto("titulo", "T\xEDtulo", "Opciones de compra"), lista("packs", "Packs", "Pack", [campoTexto("titulo", "T\xEDtulo"), campoTexto("subtitulo", "Subt\xEDtulo"), campoTexto("cantidad", "Cantidad", "1"), campoTexto("precio", "Precio"), campoTexto("badge", "Etiqueta", ""), { clave: "imagen", tipo: "imagen", etiqueta: "Miniatura", defecto: null }], [])] },
          { id: "apariencia", nombre: "Apariencia", responsive: true, campos: [{ clave: "color_activo", tipo: "token_color", etiqueta: "Borde activo", defecto: "@primario", css: "--tiq-pack-activo" }, { clave: "radio_pack", tipo: "seleccion", etiqueta: "Esquinas", opciones: [["marca", "De la marca"], ["rectas", "Rectas"], ["redondas", "Redondas"]], defecto: "marca", css: "border-radius", mapa_css: { marca: "var(--tiq-radio)", rectas: "0", redondas: "16px" } }] },
          ...comun()
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const items = Array.isArray(v.packs) ? v.packs : [];
          const html = `${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}<div class="tiq-packs">${items.map((pack, i) => `<label class="tiq-pack${i === 0 ? " es-activo" : ""}"><input type="radio" name="pack-${ctx.escapar(nodo.id)}" value="${ctx.escapar(String(pack.cantidad || i + 1))}"${i === 0 ? " checked" : ""}><span class="tiq-pack__imagen">${imagenProducto(ctx, pack.imagen)}</span><span class="tiq-pack__copy"><b>${textoSeguro(ctx, pack.titulo, `Pack ${i + 1}`)}</b><small>${textoSeguro(ctx, pack.subtitulo)}</small>${pack.badge ? `<em>${textoSeguro(ctx, pack.badge)}</em>` : ""}</span><strong>${ctx.escapar(String(pack.precio || ""))}</strong></label>`).join("")}</div>`;
          return envoltorio(nodo, ctx, "tiq-packs-compra", html, css(nodo, ctx, ["radio_pack", "color_activo", ...base.CLAVES_COMUNES]));
        }
      };
      var boton = {
        tipo: "boton_carrito",
        nombre: "A\xF1adir al carrito",
        categoria: "conversion",
        icono: "carrito",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { texto: "A\xF1adir al carrito" },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [campoTexto("texto", "Texto", "A\xF1adir al carrito"), { clave: "mostrar_pago_rapido", tipo: "booleano", etiqueta: "Mostrar pago acelerado", defecto: false }] },
          { id: "apariencia", nombre: "Bot\xF3n", responsive: true, campos: [{ clave: "color_boton", tipo: "token_color", etiqueta: "Color de fondo", defecto: "@boton_fondo", css: "background-color" }, { clave: "color_texto", tipo: "token_color", etiqueta: "Color de texto", defecto: "@boton_texto", css: "color" }, { clave: "tamano_boton", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 16, min: 11, max: 28, css: "font-size" }, { clave: "radio_boton", tipo: "seleccion", etiqueta: "Esquinas", opciones: [["marca", "De la marca"], ["rectas", "Rectas"], ["redondas", "Redondas"]], defecto: "marca", css: "border-radius", mapa_css: { marca: "var(--tiq-radio)", rectas: "0", redondas: "999px" } }] },
          ...comun()
        ],
        render(nodo, ctx) {
          var _a, _b;
          const v = ctx.valores(nodo);
          const textoBoton = v.texto || "A\xF1adir al carrito";
          return envoltorio(nodo, ctx, "tiq-boton-carrito", `<form action="${ctx.escapar(ctx.carritoUrl || "/cart/add")}" method="post"><input type="hidden" name="id" value="${ctx.escapar(((_a = ctx.producto) == null ? void 0 : _a.variante_id) || ((_b = ctx.producto) == null ? void 0 : _b.variant_id) || "")}" data-tiq-variante-form><input type="hidden" name="quantity" value="1" data-tiq-cantidad-form><button type="submit" style="${css(nodo, ctx, ["color_boton", "color_texto", "tamano_boton", "radio_boton"])}">${textoSeguro(ctx, textoBoton)}</button></form>`, css(nodo, ctx, base.CLAVES_COMUNES));
        }
      };
      var rese\u00F1a = {
        tipo: "resena_destacada",
        nombre: "Rese\xF1a destacada",
        categoria: "prueba_social",
        icono: "resena",
        admite_hijos: false,
        limite_por_pagina: null,
        semilla: { autor: "Nombre del cliente", texto: "Escrib\xED la rese\xF1a de tu cliente.", puntaje: 5, verificada: true },
        grupos: [
          { id: "contenido", nombre: "Rese\xF1a", responsive: false, campos: [campoTexto("autor", "Nombre", "Nombre del cliente"), campoLargo("texto", "Texto", "Escrib\xED la rese\xF1a de tu cliente."), { clave: "puntaje", tipo: "numero", etiqueta: "Puntaje", defecto: 5, min: 1, max: 5 }, { clave: "verificada", tipo: "booleano", etiqueta: "Compra verificada", defecto: true }, { clave: "avatar", tipo: "imagen", etiqueta: "Avatar", defecto: null }] },
          { id: "tipografia", nombre: "Tipograf\xEDa", responsive: true, campos: [{ clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" }, { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 14, min: 10, max: 28, css: "font-size" }] },
          ...comun({ sombra: true })
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const estrellas = "\u2605".repeat(Math.max(0, Math.min(5, Number(v.puntaje) || 0)));
          const avatar = v.avatar ? imagenProducto(ctx, v.avatar, v.autor) : "";
          return envoltorio(nodo, ctx, "tiq-resena", `<div class="tiq-resena__avatar">${avatar}</div><div><div class="tiq-resena__estrellas" aria-label="${ctx.escapar(String(v.puntaje || 0))} de 5">${estrellas}</div><blockquote>${textoSeguro(ctx, v.texto)}</blockquote><p><b>${textoSeguro(ctx, v.autor, "Cliente")}</b>${v.verificada ? ` <span class="tiq-verificada">\u2713 Compra verificada</span>` : ""}</p></div>`, css(nodo, ctx, ["color", "tamano", ...base.CLAVES_COMUNES]));
        }
      };
      var carrusel = {
        tipo: "carrusel_resenas",
        nombre: "Carrusel de rese\xF1as",
        categoria: "prueba_social",
        icono: "carrusel",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { titulo: "Lo que dicen nuestros clientes", resenas: [] },
        grupos: [
          { id: "contenido", nombre: "Rese\xF1as", responsive: false, campos: [campoTexto("titulo", "T\xEDtulo", "Lo que dicen nuestros clientes"), lista("resenas", "Tarjetas", "Rese\xF1a", [campoTexto("autor", "Nombre"), campoLargo("texto", "Comentario"), { clave: "puntaje", tipo: "numero", etiqueta: "Puntaje", defecto: 5, min: 1, max: 5 }, { clave: "imagen", tipo: "imagen", etiqueta: "Imagen", defecto: null }], [])] },
          { id: "disposicion", nombre: "Disposici\xF3n", responsive: true, campos: [{ clave: "columnas", tipo: "numero", etiqueta: "Columnas", defecto: 3, min: 1, max: 4, css: "--tiq-columnas" }, base.alineacion()] },
          ...comun({ sombra: false })
        ],
        render(nodo, ctx) {
          var _a, _b;
          const v = ctx.valores(nodo);
          const items = Array.isArray(v.resenas) ? v.resenas : [];
          const datos = items.length ? items : ((_a = ctx.producto) == null ? void 0 : _a.resenas) || ((_b = ctx.producto) == null ? void 0 : _b.reviews) || [];
          return envoltorio(nodo, ctx, "tiq-carrusel-resenas", `${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}<div class="tiq-carrusel-resenas__pista" style="${css(nodo, ctx, ["columnas"])}">${datos.map((item) => `<article>${item.imagen ? `<figure>${imagenProducto(ctx, item.imagen, item.autor)}</figure>` : ""}<div class="tiq-resena__estrellas">${"\u2605".repeat(Math.max(0, Math.min(5, Number(item.puntaje) || 0)))}</div><p>${textoSeguro(ctx, item.texto || item.comentario)}</p><b>${textoSeguro(ctx, item.autor, "Cliente")}</b></article>`).join("")}</div>`, css(nodo, ctx, base.CLAVES_COMUNES));
        }
      };
      var acordeon = {
        tipo: "acordeon_faq",
        nombre: "Preguntas frecuentes",
        categoria: "faq",
        icono: "faq",
        admite_hijos: false,
        limite_por_pagina: null,
        semilla: { titulo: "Preguntas frecuentes", items: [{ pregunta: "\xBFC\xF3mo funciona?", respuesta: "Agreg\xE1 la respuesta para tus clientes." }] },
        grupos: [
          { id: "contenido", nombre: "Preguntas", responsive: false, campos: [campoTexto("titulo", "T\xEDtulo", "Preguntas frecuentes"), lista("items", "Preguntas", "Pregunta", [campoTexto("pregunta", "Pregunta"), campoLargo("respuesta", "Respuesta")], [])] },
          { id: "tipografia", nombre: "Tipograf\xEDa", responsive: true, campos: [{ clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@parrafos", css: "color" }, { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 16, min: 11, max: 28, css: "font-size" }] },
          ...comun()
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const items = Array.isArray(v.items) ? v.items : [];
          return envoltorio(nodo, ctx, "tiq-acordeon-faq", `${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}${items.map((item) => `<details><summary>${textoSeguro(ctx, item.pregunta)}</summary><div>${textoSeguro(ctx, item.respuesta)}</div></details>`).join("")}`, css(nodo, ctx, ["color", "tamano", ...base.CLAVES_COMUNES]));
        }
      };
      var lineaTiempo = {
        tipo: "linea_tiempo",
        nombre: "L\xEDnea de tiempo",
        categoria: "beneficios",
        icono: "tiempo",
        admite_hijos: false,
        limite_por_pagina: null,
        semilla: { titulo: "Qu\xE9 esperar", intro: "Una gu\xEDa simple para acompa\xF1ar tu rutina.", pasos: [] },
        grupos: [
          { id: "contenido", nombre: "Contenido", responsive: false, campos: [campoTexto("titulo", "T\xEDtulo", "Qu\xE9 esperar"), campoLargo("intro", "Introducci\xF3n", ""), lista("pasos", "Pasos", "Paso", [campoTexto("etiqueta", "Etiqueta"), campoTexto("titulo", "T\xEDtulo"), campoLargo("texto", "Texto")], [])] },
          { id: "disposicion", nombre: "Disposici\xF3n", responsive: true, campos: [{ clave: "direccion", tipo: "segmentado", etiqueta: "Direcci\xF3n", opciones: [["vertical", "Vertical"], ["horizontal", "Horizontal"]], defecto: "vertical", css: "flex-direction", mapa_css: { vertical: "column", horizontal: "row" } }, { clave: "gap", tipo: "medida", etiqueta: "Separaci\xF3n", unidad: "px", defecto: 32, min: 8, max: 120, css: "gap" }] },
          ...comun()
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const pasos = Array.isArray(v.pasos) ? v.pasos : [];
          return envoltorio(nodo, ctx, "tiq-linea-tiempo", `${v.titulo ? `<h2>${textoSeguro(ctx, v.titulo)}</h2>` : ""}${v.intro ? `<p>${textoSeguro(ctx, v.intro)}</p>` : ""}<div class="tiq-linea-tiempo__pasos" style="${css(nodo, ctx, ["direccion", "gap"])}">${pasos.map((paso) => `<article><span>${textoSeguro(ctx, paso.etiqueta)}</span><h3>${textoSeguro(ctx, paso.titulo)}</h3><p>${textoSeguro(ctx, paso.texto)}</p></article>`).join("")}</div>`, css(nodo, ctx, base.CLAVES_COMUNES));
        }
      };
      var contador = {
        tipo: "contador_oferta",
        nombre: "Contador de oferta",
        categoria: "conversion",
        icono: "contador",
        admite_hijos: false,
        limite_por_pagina: 1,
        semilla: { texto: "La oferta finaliza en", minutos: 60 },
        grupos: [
          { id: "contenido", nombre: "Oferta", responsive: false, campos: [campoTexto("texto", "Texto", "La oferta finaliza en"), { clave: "minutos", tipo: "numero", etiqueta: "Minutos", defecto: 60, min: 1, max: 1440 }] },
          { id: "apariencia", nombre: "Apariencia", responsive: true, campos: [{ clave: "color", tipo: "token_color", etiqueta: "Color", defecto: "@primario", css: "color" }, { clave: "tamano", tipo: "medida", etiqueta: "Tama\xF1o", unidad: "px", defecto: 14, min: 10, max: 28, css: "font-size" }] },
          ...comun()
        ],
        render(nodo, ctx) {
          const v = ctx.valores(nodo);
          const minutos = Math.max(1, Math.floor(Number(v.minutos) || 60));
          return envoltorio(nodo, ctx, "tiq-contador-oferta", `<span>${textoSeguro(ctx, v.texto)}</span><strong data-tiq-contador data-tiq-minutos="${minutos}"><span data-tiq-tiempo>${String(minutos).padStart(2, "0")}:00</span></strong>`, css(nodo, ctx, ["color", "tamano", ...base.CLAVES_COMUNES]));
        }
      };
      module.exports = [galeria, titulo, precio, beneficios, packs, boton, rese\u00F1a, carrusel, acordeon, lineaTiempo, contador];
    }
  });

  // nucleo/tipos/indice.js
  var require_indice = __commonJS({
    "nucleo/tipos/indice.js"(exports, module) {
      "use strict";
      module.exports = [
        require_grupo(),
        ...require_comercio(),
        require_seccion(),
        require_texto(),
        require_imagen(),
        require_imagen_texto(),
        require_tabla_comparacion(),
        require_estadisticas(),
        require_garantia(),
        ...require_piloto()
      ];
    }
  });

  // nucleo/catalogo/secciones.js
  var require_secciones = __commonJS({
    "nucleo/catalogo/secciones.js"(exports, module) {
      "use strict";
      var COMPOSICIONES = [
        {
          id: "hero_producto",
          nombre: "H\xE9roe del producto",
          categoria: "producto",
          icono: "galeria",
          limite_por_pagina: null,
          arbol: [{
            tipo: "seccion",
            props: { ancho: "pagina", ancho_contenido: "pagina", direccion: "horizontal", gap: 32 },
            hijos: [
              { tipo: "galeria_producto", props: {} },
              {
                tipo: "grupo",
                props: { direccion: "vertical", gap: 16 },
                hijos: [
                  { tipo: "titulo_producto", props: {} },
                  { tipo: "precio_producto", props: {} },
                  { tipo: "beneficios_producto", props: {} },
                  { tipo: "packs_compra", props: {} },
                  { tipo: "boton_carrito", props: {} }
                ]
              }
            ]
          }]
        },
        {
          id: "beneficios_producto",
          nombre: "Beneficios destacados",
          categoria: "beneficios",
          icono: "beneficios",
          limite_por_pagina: null,
          arbol: [{
            tipo: "seccion",
            props: { ancho: "pagina", ancho_contenido: "pagina", direccion: "vertical", gap: 16 },
            hijos: [{
              tipo: "grupo",
              props: { direccion: "vertical", gap: 16 },
              hijos: [{ tipo: "beneficios_producto", props: {} }]
            }]
          }]
        },
        {
          id: "linea_tiempo_producto",
          nombre: "L\xEDnea de tiempo",
          categoria: "beneficios",
          icono: "tiempo",
          limite_por_pagina: null,
          arbol: [{
            tipo: "seccion",
            props: { ancho: "pagina", ancho_contenido: "pagina", direccion: "vertical", gap: 16 },
            hijos: [{
              tipo: "grupo",
              props: { direccion: "vertical", gap: 16 },
              hijos: [{ tipo: "linea_tiempo", props: {} }]
            }]
          }]
        }
      ];
      function clonar(valor) {
        return JSON.parse(JSON.stringify(valor));
      }
      function todas() {
        return COMPOSICIONES.map(({ arbol, ...meta }) => ({
          ...meta,
          tipo: `composicion:${meta.id}`,
          composicion_id: meta.id,
          admite_hijos: false
        }));
      }
      function existe(id) {
        return COMPOSICIONES.some((composicion) => composicion.id === id);
      }
      function arbolDe(id) {
        const composicion = COMPOSICIONES.find((item) => item.id === id);
        return composicion ? clonar(composicion.arbol) : null;
      }
      module.exports = { todas, existe, arbolDe };
    }
  });

  // nucleo/registro.js
  var require_registro = __commonJS({
    "nucleo/registro.js"(exports, module) {
      "use strict";
      var definiciones = require_indice();
      var composiciones = require_secciones();
      var TIPOS_CAMPO = /* @__PURE__ */ new Set([
        "texto_plano",
        "texto_largo",
        "richtext",
        "numero",
        "medida",
        "booleano",
        "seleccion",
        "segmentado",
        "token_color",
        "color",
        "imagen",
        "video",
        "icono",
        "enlace",
        "lista",
        "producto"
      ]);
      var CATEGORIAS = /* @__PURE__ */ new Set([
        "contenido",
        "prueba_social",
        "beneficios",
        "imagen_contenido",
        "conversion",
        "faq",
        "garantia",
        "layout",
        "integraciones",
        "producto"
      ]);
      var NOMBRES_CATEGORIA = {
        contenido: "Contenido",
        prueba_social: "Prueba social y confianza",
        beneficios: "Beneficios y caracter\xEDsticas",
        imagen_contenido: "Imagen y contenido",
        conversion: "Conversi\xF3n / CTA",
        faq: "Preguntas frecuentes",
        garantia: "Garant\xEDa",
        layout: "Estructura",
        integraciones: "Integraciones",
        producto: "Producto"
      };
      var RegistroInvalido = class extends Error {
        constructor(errores2) {
          super(`Definiciones de tipo inv\xE1lidas:
  - ${errores2.join("\n  - ")}`);
          this.name = "RegistroInvalido";
          this.errores = errores2;
        }
      };
      var esTexto = (v) => typeof v === "string" && v.length > 0;
      function normalizarCampo(campo, grupo, tipo, errores2) {
        const donde = `${tipo}.${grupo.id}.${campo && campo.clave}`;
        if (!campo || !esTexto(campo.clave)) {
          errores2.push(`${tipo}.${grupo.id}: hay un campo sin clave`);
          return null;
        }
        if (!TIPOS_CAMPO.has(campo.tipo)) {
          errores2.push(`${donde}: clase de campo desconocida "${campo.tipo}" (ver TIPOS_CAMPO)`);
          return null;
        }
        if (!esTexto(campo.etiqueta)) errores2.push(`${donde}: falta etiqueta`);
        if (campo.tipo === "seleccion" || campo.tipo === "segmentado") {
          const opciones = campo.opciones;
          if (!Array.isArray(opciones) || opciones.length === 0) {
            errores2.push(`${donde}: un campo ${campo.tipo} necesita opciones`);
          } else {
            const valores = opciones.map((o) => o && o[0]);
            if (valores.some((v) => !esTexto(v))) errores2.push(`${donde}: cada opci\xF3n es [valor, etiqueta]`);
            if (campo.defecto !== null && campo.defecto !== void 0 && !valores.includes(campo.defecto)) {
              errores2.push(`${donde}: el defecto "${campo.defecto}" no est\xE1 entre las opciones`);
            }
            if (campo.mapa_css) {
              const faltan = valores.filter((v) => !Object.prototype.hasOwnProperty.call(campo.mapa_css, v));
              if (faltan.length) errores2.push(`${donde}: mapa_css no cubre ${faltan.join(", ")}`);
            }
          }
        }
        if (campo.tipo === "lista" && !Array.isArray(campo.item_campos)) {
          errores2.push(`${donde}: un campo lista necesita item_campos`);
        }
        if (campo.mapa_css && !campo.css) errores2.push(`${donde}: declara mapa_css pero no css`);
        if (campo.unidad !== void 0 && !campo.css) errores2.push(`${donde}: declara unidad pero no css`);
        return {
          ...campo,
          responsive: campo.responsive === void 0 ? !!grupo.responsive : !!campo.responsive,
          grupo: grupo.id
        };
      }
      function normalizar(definicion2, errores2) {
        const tipo = definicion2 && definicion2.tipo;
        if (!esTexto(tipo)) {
          errores2.push("hay una definici\xF3n sin `tipo`");
          return null;
        }
        if (!esTexto(definicion2.nombre)) errores2.push(`${tipo}: falta nombre`);
        if (!CATEGORIAS.has(definicion2.categoria)) errores2.push(`${tipo}: categor\xEDa desconocida "${definicion2.categoria}"`);
        if (typeof definicion2.render !== "function") errores2.push(`${tipo}: falta la funci\xF3n render`);
        if (typeof definicion2.admite_hijos !== "boolean") errores2.push(`${tipo}: admite_hijos tiene que ser booleano`);
        const limite = definicion2.limite_por_pagina;
        if (limite !== null && limite !== void 0 && !(Number.isInteger(limite) && limite >= 1)) {
          errores2.push(`${tipo}: limite_por_pagina tiene que ser null o un entero >= 1`);
        }
        if (!Array.isArray(definicion2.grupos) || definicion2.grupos.length === 0) {
          errores2.push(`${tipo}: necesita al menos un grupo de campos`);
          return null;
        }
        const grupos = [];
        const campos = [];
        const porClave = /* @__PURE__ */ Object.create(null);
        for (const grupo of definicion2.grupos) {
          if (!grupo || !esTexto(grupo.id) || !esTexto(grupo.nombre) || !Array.isArray(grupo.campos)) {
            errores2.push(`${tipo}: grupo mal formado (${grupo && grupo.id})`);
            continue;
          }
          const camposGrupo = [];
          for (const crudo of grupo.campos) {
            const campo = normalizarCampo(crudo, grupo, tipo, errores2);
            if (!campo) continue;
            if (porClave[campo.clave]) {
              errores2.push(`${tipo}: la clave "${campo.clave}" est\xE1 repetida en dos grupos`);
              continue;
            }
            porClave[campo.clave] = campo;
            camposGrupo.push(campo);
            campos.push(campo);
          }
          grupos.push({ id: grupo.id, nombre: grupo.nombre, responsive: !!grupo.responsive, campos: camposGrupo });
        }
        return {
          tipo: definicion2.tipo,
          nombre: definicion2.nombre,
          categoria: definicion2.categoria,
          icono: definicion2.icono || definicion2.tipo,
          admite_hijos: definicion2.admite_hijos,
          limite_por_pagina: limite === void 0 ? null : limite,
          tipos_hijos: definicion2.tipos_hijos || null,
          // null = cualquiera
          // Contenido mínimo con el que se inserta el bloque. Solo contenido: los
          // estilos NO se siembran, porque escribirlos en props los convertiría en
          // overrides y el bloque dejaría de seguir al branding (invariante I4).
          semilla: definicion2.semilla || {},
          grupos,
          campos,
          porClave,
          render: definicion2.render,
          visible_en_catalogo: definicion2.visible_en_catalogo !== false
        };
      }
      var errores = [];
      var PorTipo = /* @__PURE__ */ new Map();
      for (const definicion2 of definiciones) {
        const normalizada = normalizar(definicion2, errores);
        if (!normalizada) continue;
        if (PorTipo.has(normalizada.tipo)) {
          errores.push(`el tipo "${normalizada.tipo}" est\xE1 declarado dos veces`);
          continue;
        }
        PorTipo.set(normalizada.tipo, normalizada);
      }
      var idsComposiciones = /* @__PURE__ */ new Set();
      for (const composicion of composiciones.todas()) {
        if (idsComposiciones.has(composicion.composicion_id)) {
          errores.push(`composici\xF3n duplicada "${composicion.composicion_id}"`);
          continue;
        }
        idsComposiciones.add(composicion.composicion_id);
        const specs = composiciones.arbolDe(composicion.composicion_id) || [];
        if (!specs.length) {
          errores.push(`composici\xF3n "${composicion.composicion_id}" sin \xE1rbol`);
          continue;
        }
        const revisarSpec = (spec, ruta, raiz = false) => {
          const def = PorTipo.get(spec && spec.tipo);
          if (!def) {
            errores.push(`composici\xF3n "${composicion.composicion_id}" ${ruta}: tipo desconocido "${spec && spec.tipo}"`);
            return;
          }
          if (raiz && def.tipo !== "seccion") errores.push(`composici\xF3n "${composicion.composicion_id}" ${ruta}: la ra\xEDz debe ser "seccion"`);
          for (const clave of Object.keys(spec.props || {})) {
            if (!def.porClave[clave]) errores.push(`composici\xF3n "${composicion.composicion_id}" ${ruta}: prop desconocida "${clave}"`);
          }
          const hijos = Array.isArray(spec.hijos) ? spec.hijos : [];
          if (hijos.length && !def.admite_hijos) errores.push(`composici\xF3n "${composicion.composicion_id}" ${ruta}: "${def.tipo}" no admite hijos`);
          if (def.tipos_hijos) {
            for (const hijo of hijos) {
              if (!def.tipos_hijos.includes(hijo.tipo)) errores.push(`composici\xF3n "${composicion.composicion_id}" ${ruta}: "${def.tipo}" no admite "${hijo.tipo}"`);
            }
          }
          hijos.forEach((hijo, indice) => revisarSpec(hijo, `${ruta}.hijos[${indice}]`));
        };
        specs.forEach((spec, indice) => revisarSpec(spec, `arbol[${indice}]`, true));
      }
      if (errores.length) throw new RegistroInvalido(errores);
      function todos() {
        return [...PorTipo.values()];
      }
      function existe(tipo) {
        return PorTipo.has(tipo);
      }
      function definicion(tipo) {
        const encontrada = PorTipo.get(tipo);
        if (!encontrada) throw new Error(`tipo de bloque desconocido: "${tipo}"`);
        return encontrada;
      }
      function definicionParaEditor(tipo) {
        if (existe(tipo)) return definicion(tipo);
        return {
          tipo: String(tipo || "desconocido"),
          nombre: "Bloque no disponible",
          categoria: "layout",
          icono: "error",
          admite_hijos: false,
          limite_por_pagina: null,
          tipos_hijos: null,
          semilla: {},
          grupos: [],
          campos: [],
          porClave: /* @__PURE__ */ Object.create(null),
          desconocido: true
        };
      }
      function tipos() {
        return [...PorTipo.keys()];
      }
      function catalogo() {
        const porCategoria = /* @__PURE__ */ new Map();
        for (const def of PorTipo.values()) {
          if (def.visible_en_catalogo === false) continue;
          if (!porCategoria.has(def.categoria)) porCategoria.set(def.categoria, []);
          porCategoria.get(def.categoria).push({
            tipo: def.tipo,
            nombre: def.nombre,
            icono: def.icono,
            admite_hijos: def.admite_hijos,
            limite_por_pagina: def.limite_por_pagina
          });
        }
        for (const item of composiciones.todas()) {
          if (!porCategoria.has(item.categoria)) porCategoria.set(item.categoria, []);
          porCategoria.get(item.categoria).push(item);
        }
        return [...porCategoria.entries()].map(([id, items]) => ({
          id,
          nombre: NOMBRES_CATEGORIA[id] || id,
          items
        }));
      }
      function esquemaPanel(tipo) {
        const def = definicion(tipo);
        return {
          tipo: def.tipo,
          nombre: def.nombre,
          admite_hijos: def.admite_hijos,
          grupos: def.grupos.map((g) => ({
            id: g.id,
            nombre: g.nombre,
            responsive: g.responsive,
            campos: g.campos.map(({ render, ...campo }) => campo)
          }))
        };
      }
      function catalogoComposiciones() {
        return composiciones.todas();
      }
      function esquemaPanelParaEditor(tipo) {
        const def = definicionParaEditor(tipo);
        if (!def.desconocido) return esquemaPanel(tipo);
        return { tipo: def.tipo, nombre: def.nombre, admite_hijos: false, desconocido: true, grupos: [] };
      }
      function resumenParaIA() {
        return todos().map((def) => ({
          tipo: def.tipo,
          nombre: def.nombre,
          categoria: def.categoria,
          admite_hijos: def.admite_hijos,
          campos: def.campos.filter((c) => c.tipo === "richtext" || c.tipo === "texto_plano" || c.tipo === "texto_largo" || c.tipo === "lista" || c.tipo === "imagen").map((c) => ({ clave: c.clave, tipo: c.tipo, etiqueta: c.etiqueta }))
        }));
      }
      module.exports = {
        TIPOS_CAMPO,
        CATEGORIAS,
        NOMBRES_CATEGORIA,
        RegistroInvalido,
        todos,
        tipos,
        existe,
        definicion,
        definicionParaEditor,
        catalogo,
        catalogoComposiciones,
        esquemaPanel,
        esquemaPanelParaEditor,
        resumenParaIA,
        // expuesto solo para las pruebas del propio registro
        _normalizar: normalizar
      };
    }
  });

  // nucleo/nodos.js
  var require_nodos = __commonJS({
    "nucleo/nodos.js"(exports, module) {
      "use strict";
      var registro = require_registro();
      function hexAleatorio(bytes) {
        const buffer = new Uint8Array(bytes);
        globalThis.crypto.getRandomValues(buffer);
        return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
      }
      var nuevoId = () => "n_" + hexAleatorio(4);
      function crearNodo(tipo) {
        const definicion = registro.definicion(tipo);
        const nodo = { id: nuevoId(), tipo, props: { ...definicion.semilla || {} } };
        if (definicion.admite_hijos) nodo.hijos = [];
        return nodo;
      }
      module.exports = { hexAleatorio, nuevoId, crearNodo };
    }
  });

  // app/editor/comandos.js
  var require_comandos = __commonJS({
    "app/editor/comandos.js"(exports, module) {
      "use strict";
      var { crearNodo, nuevoId } = require_nodos();
      var registro = require_registro();
      var catalogoComposiciones = require_secciones();
      var MS_FUSION = 600;
      var MAX_HISTORIAL = 100;
      var AMBITO_PAGINA = "__pagina__";
      var clonar = (valor) => JSON.parse(JSON.stringify(valor));
      var sello = (doc) => JSON.stringify(doc);
      function localizar(doc, id, lista = doc.arbol, padre = null) {
        for (let i = 0; i < lista.length; i++) {
          const nodo = lista[i];
          if (nodo.id === id) return { nodo, padre, lista, indice: i };
          if (nodo.hijos && nodo.hijos.length) {
            const encontrado = localizar(doc, id, nodo.hijos, nodo);
            if (encontrado) return encontrado;
          }
        }
        return null;
      }
      function recorrer(lista, fn, padre = null) {
        for (const nodo of lista || []) {
          fn(nodo, padre);
          if (nodo.hijos) recorrer(nodo.hijos, fn, nodo);
        }
      }
      function recorrerConAmbito(lista, fn, padre = null, ambito = AMBITO_PAGINA) {
        for (const nodo of lista || []) {
          fn(nodo, padre, ambito);
          const ambitoHijos = nodo.tipo === "seccion" ? nodo.id : ambito;
          if (nodo.hijos) recorrerConAmbito(nodo.hijos, fn, nodo, ambitoHijos);
        }
      }
      function ambitoDePadre(doc, padreId) {
        if (!padreId) return AMBITO_PAGINA;
        let resultado = AMBITO_PAGINA;
        recorrerConAmbito(doc.arbol, (nodo, _padre, ambito) => {
          if (nodo.id === padreId) resultado = nodo.tipo === "seccion" ? nodo.id : ambito;
        });
        return resultado;
      }
      function contarPorTipo(doc, tipo, { padreId = null, excluirId = null } = {}) {
        const ambitoObjetivo = ambitoDePadre(doc, padreId);
        let total = 0;
        recorrerConAmbito(doc.arbol, (nodo, _padre, ambito) => {
          if (nodo.tipo === tipo && ambito === ambitoObjetivo && nodo.id !== excluirId) total++;
        });
        return total;
      }
      function conIdsNuevos(nodo) {
        const copia = clonar(nodo);
        recorrer([copia], (n) => {
          n.id = nuevoId();
        });
        return copia;
      }
      function materializar(spec) {
        const nodo = crearNodo(spec.tipo);
        nodo.id = nuevoId();
        nodo.props = { ...clonar(nodo.props), ...clonar(spec.props || {}) };
        if (Array.isArray(spec.hijos)) nodo.hijos = spec.hijos.map(materializar);
        return nodo;
      }
      function puedeInsertar(doc, tipo, opciones = {}) {
        if (!registro.existe(tipo)) return false;
        const limite = registro.definicion(tipo).limite_por_pagina;
        if (limite === null || limite === void 0) return true;
        return contarPorTipo(doc, tipo, opciones) < limite;
      }
      function crearEstado(documentoInicial, { alCambiar = null } = {}) {
        let doc = clonar(documentoInicial);
        let seleccion = null;
        let viewport = "escritorio";
        let selloGuardado = sello(doc);
        const historial = [];
        const rehacer = [];
        const oyentes = alCambiar ? [alCambiar] : [];
        function avisar(motivo) {
          for (const oyente of oyentes) oyente({ documento: doc, seleccion, viewport, motivo });
        }
        function aplicar(mutar, { etiqueta, fusion = null } = {}) {
          const antes = clonar(doc);
          const borrador = clonar(doc);
          const resultado = mutar(borrador);
          if (resultado === false) return false;
          const ultimo = historial[historial.length - 1];
          const fusiona = fusion && ultimo && ultimo.fusion === fusion && Date.now() - ultimo.ts < MS_FUSION;
          if (fusiona) {
            ultimo.ts = Date.now();
          } else {
            historial.push({ antes, etiqueta, fusion, ts: Date.now() });
            if (historial.length > MAX_HISTORIAL) historial.shift();
          }
          rehacer.length = 0;
          doc = borrador;
          avisar(etiqueta);
          return true;
        }
        function fijarProp(nodoId, clave, valor) {
          const ubicacion = localizar(doc, nodoId);
          if (!ubicacion) return false;
          const campo = registro.definicion(ubicacion.nodo.tipo).porClave[clave];
          if (!campo) return false;
          const enMovil = viewport === "movil" && campo.responsive;
          const bolsa = enMovil ? "props_movil" : "props";
          return aplicar((borrador) => {
            const nodo = localizar(borrador, nodoId).nodo;
            if (valor === void 0) {
              if (!nodo[bolsa] || !(clave in nodo[bolsa])) return false;
              delete nodo[bolsa][clave];
              if (bolsa === "props_movil" && Object.keys(nodo.props_movil).length === 0) delete nodo.props_movil;
            } else {
              if (!nodo[bolsa]) nodo[bolsa] = {};
              nodo[bolsa][clave] = valor;
            }
          }, {
            etiqueta: valor === void 0 ? `heredar ${clave}` : `cambiar ${clave}`,
            fusion: valor === void 0 ? null : `${nodoId}:${bolsa}:${clave}`
          });
        }
        const heredarProp = (nodoId, clave) => fijarProp(nodoId, clave, void 0);
        function insertar(tipo, { padreId = null, indice = null } = {}) {
          if (padreId) {
            const padre = localizar(doc, padreId);
            if (!padre || !registro.definicion(padre.nodo.tipo).admite_hijos) return false;
          }
          if (!puedeInsertar(doc, tipo, { padreId })) return false;
          const nuevo = crearNodo(tipo);
          const hecho = aplicar((borrador) => {
            const lista = padreId ? localizar(borrador, padreId).nodo.hijos : borrador.arbol;
            lista.splice(indice === null ? lista.length : indice, 0, nuevo);
          }, { etiqueta: `agregar ${tipo}` });
          if (hecho) seleccionar(nuevo.id);
          return hecho ? nuevo.id : false;
        }
        function insertarComposicion(composicionId, { padreId = null, indice = null } = {}) {
          const specs = catalogoComposiciones.arbolDe(composicionId);
          if (!specs || !specs.length) return false;
          if (padreId) {
            const padre = localizar(doc, padreId);
            if (!padre || !registro.definicion(padre.nodo.tipo).admite_hijos) return false;
          }
          const nuevos = specs.map(materializar);
          const hecho = aplicar((borrador) => {
            const lista = padreId ? localizar(borrador, padreId).nodo.hijos : borrador.arbol;
            lista.splice(indice === null ? lista.length : indice, 0, ...nuevos);
          }, { etiqueta: `agregar composici\xF3n ${composicionId}` });
          if (hecho) seleccionar(nuevos[0].id);
          return hecho ? nuevos[0].id : false;
        }
        function borrar(nodoId) {
          const ubicacion = localizar(doc, nodoId);
          if (!ubicacion) return false;
          const hecho = aplicar((borrador) => {
            const donde = localizar(borrador, nodoId);
            donde.lista.splice(donde.indice, 1);
          }, { etiqueta: `borrar ${ubicacion.nodo.tipo}` });
          if (hecho && seleccion === nodoId) seleccionar(null);
          return hecho;
        }
        function duplicar(nodoId) {
          const ubicacion = localizar(doc, nodoId);
          if (!ubicacion) return false;
          if (!puedeInsertar(doc, ubicacion.nodo.tipo, { padreId: ubicacion.padre ? ubicacion.padre.id : null })) return false;
          const copia = conIdsNuevos(ubicacion.nodo);
          const hecho = aplicar((borrador) => {
            const donde = localizar(borrador, nodoId);
            donde.lista.splice(donde.indice + 1, 0, copia);
          }, { etiqueta: `duplicar ${ubicacion.nodo.tipo}` });
          if (hecho) seleccionar(copia.id);
          return hecho ? copia.id : false;
        }
        function mover(nodoId, { padreId = null, indice = 0 } = {}) {
          const ubicacion = localizar(doc, nodoId);
          if (!ubicacion) return false;
          if (padreId) {
            if (padreId === nodoId) return false;
            const destino = localizar(doc, padreId);
            if (!destino || !registro.definicion(destino.nodo.tipo).admite_hijos) return false;
            if (localizar(doc, padreId, [ubicacion.nodo])) return false;
          }
          if (!puedeInsertar(doc, ubicacion.nodo.tipo, { padreId, excluirId: nodoId })) return false;
          return aplicar((borrador) => {
            const desde = localizar(borrador, nodoId);
            const mismoPadre = (desde.padre ? desde.padre.id : null) === padreId;
            desde.lista.splice(desde.indice, 1);
            const lista = padreId ? localizar(borrador, padreId).nodo.hijos : borrador.arbol;
            const destino = mismoPadre && indice > desde.indice ? indice - 1 : indice;
            lista.splice(Math.max(0, Math.min(destino, lista.length)), 0, desde.nodo);
          }, { etiqueta: "mover bloque" });
        }
        function fijarBranding(clave, valor) {
          return aplicar((borrador) => {
            if (!borrador.branding) borrador.branding = {};
            if (clave.startsWith("tokens.")) {
              const token = clave.slice(7);
              if (!borrador.branding.tokens) borrador.branding.tokens = {};
              if (valor === void 0) delete borrador.branding.tokens[token];
              else borrador.branding.tokens[token] = valor;
            } else if (clave.startsWith("tipografia.")) {
              const fuente = clave.slice("tipografia.".length);
              if (!borrador.branding.tipografia) borrador.branding.tipografia = {};
              if (valor === void 0) delete borrador.branding.tipografia[fuente];
              else borrador.branding.tipografia[fuente] = valor;
            } else {
              borrador.branding[clave] = valor;
            }
          }, { etiqueta: `marca: ${clave}`, fusion: `branding:${clave}` });
        }
        function fijarSeo(clave, valor) {
          return aplicar((borrador) => {
            if (!borrador.seo) borrador.seo = {};
            borrador.seo[clave] = valor;
          }, { etiqueta: `seo: ${clave}`, fusion: `seo:${clave}` });
        }
        function deshacerUno() {
          const entrada = historial.pop();
          if (!entrada) return false;
          rehacer.push({ ...entrada, antes: clonar(doc) });
          doc = entrada.antes;
          if (seleccion && !localizar(doc, seleccion)) seleccion = null;
          avisar("deshacer");
          return true;
        }
        function rehacerUno() {
          const entrada = rehacer.pop();
          if (!entrada) return false;
          historial.push({ ...entrada, antes: clonar(doc) });
          doc = entrada.antes;
          if (seleccion && !localizar(doc, seleccion)) seleccion = null;
          avisar("rehacer");
          return true;
        }
        function seleccionar(id) {
          if (id !== null && !localizar(doc, id)) return false;
          seleccion = id;
          avisar("seleccion");
          return true;
        }
        function fijarViewport(nuevo) {
          if (nuevo !== "escritorio" && nuevo !== "movil") return false;
          viewport = nuevo;
          avisar("viewport");
          return true;
        }
        return {
          // lectura
          documento: () => doc,
          nodo: (id) => {
            const u = localizar(doc, id);
            return u ? u.nodo : null;
          },
          nodoSeleccionado: () => seleccion ? localizar(doc, seleccion).nodo : null,
          seleccion: () => seleccion,
          viewport: () => viewport,
          puedeInsertar: (tipo, opciones = {}) => puedeInsertar(doc, tipo, opciones),
          contarPorTipo: (tipo, opciones = {}) => contarPorTipo(doc, tipo, opciones),
          ubicacion: (id) => localizar(doc, id),
          // comandos
          fijarProp,
          heredarProp,
          insertar,
          insertarComposicion,
          borrar,
          duplicar,
          mover,
          fijarBranding,
          fijarSeo,
          // historial
          deshacer: deshacerUno,
          rehacer: rehacerUno,
          puedeDeshacer: () => historial.length > 0,
          puedeRehacer: () => rehacer.length > 0,
          pasosDeshacer: () => historial.length,
          // guardado
          hayCambios: () => sello(doc) !== selloGuardado,
          marcarGuardado: () => {
            selloGuardado = sello(doc);
            avisar("guardado");
          },
          // vista
          seleccionar,
          fijarViewport,
          suscribir: (fn) => {
            oyentes.push(fn);
            return () => oyentes.splice(oyentes.indexOf(fn), 1);
          }
        };
      }
      module.exports = { crearEstado, localizar, recorrer, puedeInsertar, conIdsNuevos, MS_FUSION };
    }
  });

  // app/editor/lienzo.js
  var require_lienzo = __commonJS({
    "app/editor/lienzo.js"(exports, module) {
      "use strict";
      var ANCHOS = { escritorio: null, movil: 390 };
      var CSS_POR_DEFECTO = "/dist/render.css";
      function destinoScroll(actual, altoVentana, rect) {
        const centro = Math.max(24, (altoVentana - rect.height) / 2);
        return Math.max(0, actual + rect.top - centro);
      }
      var plantillaCon = (css) => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="' + css + '"><style id="tiq-responsive"></style><style>body{margin:0}[data-nodo]{outline-offset:-1px}[data-nodo]:hover{outline:1px dashed rgba(0,0,0,.25)}.tiq-sel{outline:2px solid #1a73e8 !important;outline-offset:-2px}</style></head><body></body></html>';
      function crearLienzo(contenedor, { alSeleccionar = () => {
      }, alDesplazar = () => {
      }, rutaCss = CSS_POR_DEFECTO } = {}) {
        const marco = contenedor.ownerDocument.createElement("iframe");
        marco.className = "ed-lienzo__marco";
        marco.setAttribute("title", "Vista previa de la p\xE1gina");
        contenedor.appendChild(marco);
        let doc = null;
        let seleccionActual = null;
        let nodoPorVer = null;
        function preparar() {
          doc = marco.contentDocument;
          doc.open();
          doc.write(plantillaCon(rutaCss));
          doc.close();
          doc.addEventListener("click", (evento) => {
            const enlace = evento.target.closest && evento.target.closest("a");
            if (enlace) evento.preventDefault();
            const elemento = evento.target.closest && evento.target.closest("[data-nodo]");
            alSeleccionar(elemento ? elemento.dataset.nodo : null);
          });
          doc.defaultView.addEventListener("scroll", alDesplazar, { passive: true });
        }
        function pintar({ html, css, seleccion }) {
          if (!doc) preparar();
          const vista = doc.defaultView;
          const scrollX = (vista == null ? void 0 : vista.scrollX) || 0;
          const scrollY = (vista == null ? void 0 : vista.scrollY) || 0;
          doc.body.innerHTML = html;
          doc.getElementById("tiq-responsive").textContent = css;
          marcar(seleccion);
          const idPorVer = nodoPorVer;
          nodoPorVer = null;
          if (idPorVer) desplazarA(idPorVer, "auto");
          else if (vista == null ? void 0 : vista.scrollTo) {
            try {
              vista.scrollTo({ left: scrollX, top: scrollY, behavior: "auto" });
            } catch {
              vista.scrollTo(scrollX, scrollY);
            }
          }
        }
        function marcar(id) {
          if (!doc) return;
          seleccionActual = id;
          for (const el of doc.querySelectorAll(".tiq-sel")) el.classList.remove("tiq-sel");
          const elegido = id && doc.querySelector(`[data-nodo="${id}"]`);
          if (elegido) elegido.classList.add("tiq-sel");
          return elegido || null;
        }
        function rectangulo(id) {
          if (!doc) return null;
          const elemento = doc.querySelector(`[data-nodo="${id || seleccionActual}"]`);
          if (!elemento) return null;
          const dentro = elemento.getBoundingClientRect();
          const marcoRect = marco.getBoundingClientRect();
          return {
            arriba: marcoRect.top + dentro.top,
            izquierda: marcoRect.left + dentro.left,
            ancho: dentro.width,
            alto: dentro.height
          };
        }
        function fijarViewport(viewport) {
          const ancho = ANCHOS[viewport];
          marco.style.width = ancho ? `${ancho}px` : "100%";
          marco.style.flex = ancho ? `0 0 ${ancho}px` : "1 1 auto";
          marco.classList.toggle("es-movil", !!ancho);
        }
        function desplazarA(id, behavior = "smooth") {
          if (!doc || !id) return null;
          const elemento = doc.querySelector(`[data-nodo="${id}"]`);
          if (!elemento) return null;
          const vista = doc.defaultView;
          const rect = elemento.getBoundingClientRect();
          const altoVentana = (vista == null ? void 0 : vista.innerHeight) || marco.clientHeight || 0;
          const actual = (vista == null ? void 0 : vista.scrollY) || 0;
          const destino = destinoScroll(actual, altoVentana, rect);
          if (vista == null ? void 0 : vista.scrollTo) {
            try {
              vista.scrollTo({ top: destino, left: vista.scrollX || 0, behavior });
            } catch {
              vista.scrollTo(vista.scrollX || 0, destino);
            }
          } else if (elemento.scrollIntoView) {
            elemento.scrollIntoView({ block: "center", behavior });
          }
          return elemento;
        }
        function verNodo(id) {
          nodoPorVer = id || null;
          return desplazarA(id);
        }
        return { pintar, marcar, rectangulo, fijarViewport, verNodo, marco };
      }
      module.exports = { crearLienzo, ANCHOS, CSS_POR_DEFECTO, destinoScroll };
    }
  });

  // nucleo/tokens.js
  var require_tokens = __commonJS({
    "nucleo/tokens.js"(exports, module) {
      "use strict";
      var CLAVES_TOKEN = [
        "primario",
        "primario_suave",
        "secundario",
        "secundario_suave",
        "boton_fondo",
        "boton_texto",
        "titulos",
        "subtitulos",
        "parrafos"
      ];
      var NOMBRES_TOKEN = {
        primario: "Primario",
        primario_suave: "Primario suave",
        secundario: "Secundario",
        secundario_suave: "Secundario suave",
        boton_fondo: "Fondo de botones",
        boton_texto: "Texto de botones",
        titulos: "T\xEDtulos",
        subtitulos: "Subt\xEDtulos",
        parrafos: "P\xE1rrafos"
      };
      var PRESETS = {
        verde: {
          nombre: "Verde",
          tokens: {
            primario: "#1D3B1D",
            primario_suave: "#FCFCF7",
            secundario: "#E9F0CA",
            secundario_suave: "#F8FAEF",
            boton_fondo: "#1D3B1D",
            boton_texto: "#FCFCF7",
            titulos: "#1D3B1D",
            subtitulos: "#1D3B1D",
            parrafos: "#1D3B1D"
          }
        },
        azul: {
          nombre: "Azul",
          tokens: {
            primario: "#12305C",
            primario_suave: "#F7FAFF",
            secundario: "#CFE0F7",
            secundario_suave: "#F0F5FD",
            boton_fondo: "#12305C",
            boton_texto: "#F7FAFF",
            titulos: "#0E2547",
            subtitulos: "#1B3D6E",
            parrafos: "#233247"
          }
        },
        violeta: {
          nombre: "Violeta",
          tokens: {
            primario: "#4A2A7A",
            primario_suave: "#FAF8FF",
            secundario: "#DED2F5",
            secundario_suave: "#F4F0FD",
            boton_fondo: "#4A2A7A",
            boton_texto: "#FAF8FF",
            titulos: "#331E56",
            subtitulos: "#4A2A7A",
            parrafos: "#332B3F"
          }
        },
        rosa: {
          nombre: "Rosa",
          tokens: {
            primario: "#9B2058",
            primario_suave: "#FFF8FB",
            secundario: "#F7D3E2",
            secundario_suave: "#FDF1F6",
            boton_fondo: "#9B2058",
            boton_texto: "#FFF8FB",
            titulos: "#3D1024",
            subtitulos: "#7A1A46",
            parrafos: "#42222E"
          }
        },
        amarillo: {
          nombre: "Amarillo",
          tokens: {
            primario: "#7A5A05",
            primario_suave: "#FFFCF2",
            secundario: "#FBE7A1",
            secundario_suave: "#FEF8E4",
            boton_fondo: "#7A5A05",
            boton_texto: "#FFFCF2",
            titulos: "#3F2E02",
            subtitulos: "#7A5A05",
            parrafos: "#3B3327"
          }
        },
        turquesa: {
          nombre: "Turquesa",
          tokens: {
            primario: "#0C4F52",
            primario_suave: "#F5FDFD",
            secundario: "#C7EBEA",
            secundario_suave: "#EDF9F9",
            boton_fondo: "#0C4F52",
            boton_texto: "#F5FDFD",
            titulos: "#08383A",
            subtitulos: "#0C4F52",
            parrafos: "#20383A"
          }
        },
        gris: {
          nombre: "Gris",
          tokens: {
            primario: "#1F2328",
            primario_suave: "#FBFBFC",
            secundario: "#E4E6E9",
            secundario_suave: "#F4F5F6",
            boton_fondo: "#1F2328",
            boton_texto: "#FBFBFC",
            titulos: "#14171A",
            subtitulos: "#1F2328",
            parrafos: "#3A4046"
          }
        }
      };
      var PRESET_POR_DEFECTO = "verde";
      var RADIOS = { ninguno: "0px", pequeno: "8px", grande: "20px" };
      var RADIO_POR_DEFECTO = "pequeno";
      var TIPOGRAFIAS = {
        sistema: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        grotesca: '"Archivo", "Helvetica Neue", Helvetica, Arial, sans-serif',
        serif: '"Instrument Serif", Georgia, "Times New Roman", serif'
      };
      var TIPOGRAFIA_POR_DEFECTO = { titulos: "grotesca", cuerpo: "sistema" };
      var HEX = /^#[0-9A-Fa-f]{6}$/;
      function esReferencia(valor) {
        return typeof valor === "string" && valor.startsWith("@");
      }
      function tokensDe(branding = {}) {
        const preset = PRESETS[branding.preset] || PRESETS[PRESET_POR_DEFECTO];
        const propios = branding.tokens || {};
        const salida = {};
        for (const clave of CLAVES_TOKEN) {
          const override = propios[clave];
          salida[clave] = HEX.test(override) ? override : preset.tokens[clave];
        }
        return salida;
      }
      function desreferenciar(valor, tokens) {
        if (!esReferencia(valor)) return valor;
        const clave = valor.slice(1);
        return Object.prototype.hasOwnProperty.call(tokens, clave) ? tokens[clave] : null;
      }
      function radioDe(branding = {}) {
        return RADIOS[branding.radio] || RADIOS[RADIO_POR_DEFECTO];
      }
      function tipografiasDe(branding = {}) {
        const elegidas = { ...TIPOGRAFIA_POR_DEFECTO, ...branding.tipografia || {} };
        return {
          titulos: TIPOGRAFIAS[elegidas.titulos] || TIPOGRAFIAS.grotesca,
          cuerpo: TIPOGRAFIAS[elegidas.cuerpo] || TIPOGRAFIAS.sistema
        };
      }
      function variablesCss(branding = {}) {
        const tokens = tokensDe(branding);
        const fuentes = tipografiasDe(branding);
        const partes = CLAVES_TOKEN.map((clave) => `--tiq-${clave}:${tokens[clave]}`);
        partes.push(`--tiq-radio:${radioDe(branding)}`);
        partes.push(`--tiq-fuente-titulos:${fuentes.titulos}`);
        partes.push(`--tiq-fuente-cuerpo:${fuentes.cuerpo}`);
        return partes.join(";") + ";";
      }
      function listaPresets() {
        return Object.entries(PRESETS).map(([id, preset]) => ({
          id,
          nombre: preset.nombre,
          muestra: [preset.tokens.primario, preset.tokens.secundario_suave, preset.tokens.secundario]
        }));
      }
      module.exports = {
        CLAVES_TOKEN,
        NOMBRES_TOKEN,
        PRESETS,
        PRESET_POR_DEFECTO,
        RADIOS,
        RADIO_POR_DEFECTO,
        TIPOGRAFIAS,
        TIPOGRAFIA_POR_DEFECTO,
        esReferencia,
        tokensDe,
        desreferenciar,
        radioDe,
        tipografiasDe,
        variablesCss,
        listaPresets
      };
    }
  });

  // nucleo/resolver.js
  var require_resolver = __commonJS({
    "nucleo/resolver.js"(exports, module) {
      "use strict";
      var { tokensDe, desreferenciar } = require_tokens();
      var registro = require_registro();
      var VIEWPORTS = ["escritorio", "movil"];
      function presente(objeto, clave) {
        return !!objeto && Object.prototype.hasOwnProperty.call(objeto, clave) && objeto[clave] !== void 0;
      }
      function valorCrudo(nodo, campo, viewport) {
        if (viewport === "movil" && campo.responsive && presente(nodo.props_movil, campo.clave)) {
          return nodo.props_movil[campo.clave];
        }
        if (presente(nodo.props, campo.clave)) return nodo.props[campo.clave];
        return campo.defecto === void 0 ? null : campo.defecto;
      }
      function hayOverride(nodo, clave, viewport = "escritorio") {
        if (viewport === "movil") return presente(nodo.props_movil, clave);
        return presente(nodo.props, clave);
      }
      function valorResuelto(nodo, campo, viewport) {
        const crudo = valorCrudo(nodo, campo, viewport);
        return crudo === void 0 ? null : crudo;
      }
      function aCss(valor, campo, tokens) {
        const resuelto = desreferenciar(valor, tokens);
        if (resuelto === null || resuelto === void 0) return null;
        if (campo.mapa_css && Object.prototype.hasOwnProperty.call(campo.mapa_css, resuelto)) {
          return campo.mapa_css[resuelto];
        }
        return resuelto;
      }
      var ETIQUETAS_SIMPLES = /* @__PURE__ */ new Set(["b", "strong", "i", "em", "u", "s", "br", "p", "span", "ul", "ol", "li", "h2", "h3", "h4"]);
      var PROTOCOLOS = /^(https?:|mailto:|tel:)/i;
      function urlSegura(valor, { media = false } = {}) {
        const url = typeof valor === "string" ? valor.trim() : "";
        if (!url || /[\u0000-\u001f\u007f\s<>"']/.test(url)) return false;
        if (url.startsWith("/")) return true;
        return media ? /^https?:/i.test(url) : /^(https?:|mailto:|tel:)/i.test(url);
      }
      function escapar(texto) {
        return String(texto).replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }
      function etiquetaPermitida(cruda) {
        var _a;
        const cierre = /^<\/\s*([a-z0-9]+)\s*>$/i.exec(cruda);
        if (cierre) {
          const nombre2 = cierre[1].toLowerCase();
          if (nombre2 === "a") return "</a>";
          return ETIQUETAS_SIMPLES.has(nombre2) ? `</${nombre2}>` : "";
        }
        const apertura = /^<\s*([a-z0-9]+)([^>]*)>$/i.exec(cruda);
        if (!apertura) return "";
        const nombre = apertura[1].toLowerCase();
        if (ETIQUETAS_SIMPLES.has(nombre)) return nombre === "br" ? "<br>" : `<${nombre}>`;
        if (nombre === "a") {
          const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(apertura[2]);
          const url = (href && ((_a = href[2]) != null ? _a : href[3]) || "").trim();
          if (!PROTOCOLOS.test(url)) return "<a>";
          return `<a href="${escapar(url)}" rel="noopener nofollow" target="_blank">`;
        }
        return "";
      }
      function sanear(html) {
        if (typeof html !== "string" || !html) return "";
        const etiquetas = /<[^>]*>/g;
        let salida = "";
        let ultimo = 0;
        let m;
        while ((m = etiquetas.exec(html)) !== null) {
          salida += escapar(html.slice(ultimo, m.index));
          salida += etiquetaPermitida(m[0]);
          ultimo = m.index + m[0].length;
        }
        salida += escapar(html.slice(ultimo));
        return salida;
      }
      function contexto(documento, { viewport = "escritorio" } = {}) {
        if (!VIEWPORTS.includes(viewport)) throw new Error(`viewport desconocido: ${viewport}`);
        const tokens = tokensDe(documento && documento.branding);
        const cache = /* @__PURE__ */ new Map();
        function valores(nodo) {
          const enCache = cache.get(nodo);
          if (enCache) return enCache;
          const definicion = registro.definicion(nodo.tipo);
          const salida = {};
          for (const campo of definicion.campos) salida[campo.clave] = valorResuelto(nodo, campo, viewport);
          cache.set(nodo, salida);
          return salida;
        }
        function estilos(nodo, claves) {
          const definicion = registro.definicion(nodo.tipo);
          const resueltos = valores(nodo);
          const partes = [];
          for (const clave of claves) {
            const campo = definicion.porClave[clave];
            if (!campo || !campo.css) continue;
            const valor = aCss(resueltos[clave], campo, tokens);
            if (valor === null || valor === void 0 || valor === "") continue;
            partes.push(`${campo.css}:${valor}${campo.unidad || ""}`);
          }
          return partes.join(";");
        }
        function visible(nodo) {
          const resueltos = valores(nodo);
          const enEscritorio = !("mostrar_escritorio" in resueltos) || resueltos.mostrar_escritorio !== false;
          const enMovil = !("mostrar_movil" in resueltos) || resueltos.mostrar_movil !== false;
          return enEscritorio || enMovil;
        }
        const comoCss = (nodo, clave) => aCss(valores(nodo)[clave], registro.definicion(nodo.tipo).porClave[clave], tokens);
        return { viewport, tokens, valores, estilos, comoCss, visible, sanear, escapar, urlSegura };
      }
      module.exports = {
        VIEWPORTS,
        presente,
        valorCrudo,
        valorResuelto,
        aCss,
        hayOverride,
        sanear,
        escapar,
        urlSegura,
        contexto
      };
    }
  });

  // app/editor/controles.js
  var require_controles = __commonJS({
    "app/editor/controles.js"(exports, module) {
      "use strict";
      var { sanear } = require_resolver();
      var { CLAVES_TOKEN, NOMBRES_TOKEN } = require_tokens();
      var ICONO_ENLACE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.2 9.8l3.6-3.6M5.1 6.4l-1.3 1.3a2.5 2.5 0 003.5 3.5l1.3-1.3M10.9 9.6l1.3-1.3a2.5 2.5 0 00-3.5-3.5L7.4 6.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
      var esc = (texto) => String(texto === null || texto === void 0 ? "" : texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      var PARTES = {
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
      var vacio = (v) => v === null || v === void 0 || v === "";
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
          if (Object.keys(valor).some((clave) => ["valor", "marcado", "token", "hex", "sin", "src", "alt", "poster", "url", "texto", "nueva_pestana", "items"].includes(clave))) {
            return valor;
          }
        }
        if (campo.tipo === "booleano") return { marcado: Boolean(valor) };
        if (campo.tipo === "lista") return { items: Array.isArray(valor) ? valor : [] };
        return { valor };
      }
      function parsear(campo, partes = {}) {
        switch (campo.tipo) {
          case "texto_plano":
          case "texto_largo":
          case "icono":
            return partes.valor === void 0 ? "" : String(partes.valor);
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
            return vacio(partes.url) ? null : { url: String(partes.url), texto: partes.texto || null, nueva_pestana: !!partes.nueva_pestana };
          case "producto":
            return vacio(partes.valor) ? null : String(partes.valor);
          case "lista": {
            const items = Array.isArray(partes.items) ? partes.items : [];
            return items.map((item) => {
              const salida = {};
              for (const sub of campo.item_campos) salida[sub.clave] = parsear(sub, partesDeItem(sub, item == null ? void 0 : item[sub.clave]));
              return salida;
            });
          }
          default:
            return null;
        }
      }
      var parte = (nombre) => ` data-parte="${nombre}"`;
      function htmlHerencia(campo, overrideado) {
        if (campo.defecto === void 0) return "";
        const titulo = overrideado ? "Volver a heredar de la marca" : "Heredado de la marca";
        return `<button type="button" class="ed-heredar${overrideado ? " es-propio" : ""}" data-heredar="${esc(campo.clave)}" aria-pressed="${overrideado}" title="${esc(titulo)}"></button>`;
      }
      function opciones(lista, seleccionado) {
        return lista.map(
          ([valor, etiqueta]) => `<option value="${esc(valor)}"${valor === seleccionado ? " selected" : ""}>${esc(etiqueta)}</option>`
        ).join("");
      }
      function htmlEntrada(campo, valor, muestra) {
        switch (campo.tipo) {
          case "texto_plano":
            return `<input type="text" class="ed-texto"${parte("valor")} value="${esc(valor)}">`;
          case "texto_largo":
            return `<textarea class="ed-area" rows="3"${parte("valor")}>${esc(valor)}</textarea>`;
          case "richtext":
            return `<div class="ed-rich"><div class="ed-rich__barra">` + ["bold:B", "italic:I", "underline:U"].map((par) => {
              const [comando, letra] = par.split(":");
              return `<button type="button" data-formato="${comando}" title="${comando}">${letra}</button>`;
            }).join("") + `<button type="button" data-formato="enlace" title="Enlace">${ICONO_ENLACE}</button><button type="button" class="ed-rich__ia" data-ia="${esc(campo.clave)}">Editar con IA</button></div><div class="ed-rich__area" contenteditable="true"${parte("valor")}>${sanear(valor)}</div></div>`;
          case "numero":
          case "medida":
            return `<span class="ed-num"><input type="number" class="ed-num__input"${parte("valor")} value="${esc(valor)}"${campo.min !== void 0 ? ` min="${campo.min}"` : ""}${campo.max !== void 0 ? ` max="${campo.max}"` : ""}${campo.tipo === "medida" && campo.unidad === "" ? ' step="0.1"' : ""}>${campo.unidad ? `<span class="ed-num__unidad">${esc(campo.unidad)}</span>` : ""}</span>`;
          case "booleano":
            return `<label class="ed-switch"><input type="checkbox"${parte("marcado")}${valor ? " checked" : ""}><span></span></label>`;
          case "seleccion":
            return `<div class="ed-select"><select${parte("valor")}>${opciones(campo.opciones, valor)}</select></div>`;
          case "segmentado":
            return `<div class="ed-seg" role="radiogroup"${parte("valor")} data-valor="${esc(valor)}">` + campo.opciones.map(
              ([v, etiqueta]) => `<button type="button" role="radio" aria-checked="${v === valor}" data-opcion="${esc(v)}">${esc(etiqueta)}</button>`
            ).join("") + `</div>`;
          case "token_color": {
            const esToken = typeof valor === "string" && valor.startsWith("@");
            const lista = [["", "Ninguno"], ...CLAVES_TOKEN.map((c) => [`@${c}`, NOMBRES_TOKEN[c]]), ["personalizado", "Personalizado\u2026"]];
            const seleccionado = esToken ? valor : valor ? "personalizado" : "";
            return `<div class="ed-color"><span class="ed-color__muestra" data-muestra style="background:${esc(muestra || "transparent")}"></span><div class="ed-select"><select${parte("token")}>${opciones(lista, seleccionado)}</select></div><input type="color" class="ed-color__hex"${parte("hex")} value="${esc(esToken || !valor ? "#000000" : valor)}"${seleccionado === "personalizado" ? "" : " hidden"}></div>`;
          }
          case "color":
            return `<div class="ed-color"><input type="color" class="ed-color__hex"${parte("hex")} value="${esc(valor || "#000000")}"${valor ? "" : " hidden"}><label class="ed-color__sin"><input type="checkbox"${parte("sin")}${valor ? "" : " checked"}> Sin color</label></div>`;
          case "imagen": {
            const v = valor || {};
            return `<div class="ed-media">` + (v.src ? `<img class="ed-media__vista" src="${esc(v.src)}" alt="">` : `<div class="ed-media__vacio">Sin imagen</div>`) + `<label class="ed-media__archivo">Subir imagen<input type="file" data-subir-imagen accept="image/jpeg,image/png,image/webp,image/gif"></label><input type="url" class="ed-texto"${parte("src")} value="${esc(v.src)}" placeholder="URL de la imagen"><input type="text" class="ed-texto"${parte("alt")} value="${esc(v.alt)}" placeholder="Texto alternativo (accesibilidad y SEO)"></div>`;
          }
          case "video": {
            const v = valor || {};
            return `<div class="ed-media"><input type="url" class="ed-texto"${parte("src")} value="${esc(v.src)}" placeholder="URL del video"><input type="url" class="ed-texto"${parte("poster")} value="${esc(v.poster)}" placeholder="Imagen de portada"></div>`;
          }
          case "icono":
            return `<div class="ed-select"><select${parte("valor")}>` + opciones((campo.opciones || []).length ? campo.opciones : [["", "Ninguno"]], valor) + `</select></div>`;
          case "enlace": {
            const v = valor || {};
            return `<div class="ed-enlace"><input type="url" class="ed-texto"${parte("url")} value="${esc(v.url)}" placeholder="https://"><input type="text" class="ed-texto"${parte("texto")} value="${esc(v.texto)}" placeholder="Texto del bot\xF3n"><label class="ed-check"><input type="checkbox"${parte("nueva_pestana")}${v.nueva_pestana ? " checked" : ""}> Abrir en otra pesta\xF1a</label></div>`;
          }
          case "producto":
            return `<div class="ed-producto"><input type="text" class="ed-texto"${parte("valor")} value="${esc(valor)}" placeholder="gid://shopify/Product/\u2026" readonly><button type="button" class="ed-boton" data-elegir-producto>Elegir</button></div>`;
          // La lista es el control que evita inventar clases nuevas: reseñas, FAQ,
          // beneficios y estadísticas son todas la misma cosa con otros subcampos.
          case "lista": {
            const items = Array.isArray(valor) ? valor : [];
            return `<div class="ed-lista">` + items.map(
              (item, i) => `<div class="ed-lista__item" data-item="${i}"><div class="ed-lista__cabecera"><span>${esc(campo.nombre_item || "Elemento")} ${i + 1}</span><button type="button" data-subir="${i}" title="Subir">\u2191</button><button type="button" data-bajar="${i}" title="Bajar">\u2193</button><button type="button" data-quitar="${i}" title="Quitar">\u2715</button></div>` + campo.item_campos.map(
                (sub) => `<div class="ed-lista__campo" data-subcampo="${esc(sub.clave)}"><span>${esc(sub.etiqueta)}</span>` + htmlEntrada(sub, item[sub.clave]) + `</div>`
              ).join("") + `</div>`
            ).join("") + `<button type="button" class="ed-boton ed-boton--ancho" data-agregar-item>Agregar ${esc((campo.nombre_item || "elemento").toLowerCase())}</button></div>`;
          }
          default:
            return "";
        }
      }
      function htmlCampo(campo, valor, { overrideado = false, muestra = null } = {}) {
        const enPila = ["richtext", "texto_largo", "imagen", "video", "enlace", "lista", "producto"].includes(campo.tipo);
        return `<div class="ed-campo${enPila ? " ed-campo--pila" : ""}" data-clave="${esc(campo.clave)}" data-tipo="${esc(campo.tipo)}"><div class="ed-campo__cabecera">` + htmlHerencia(campo, overrideado) + `<label class="ed-campo__etiqueta">${esc(campo.etiqueta)}</label></div><div class="ed-campo__control">${htmlEntrada(campo, valor, muestra)}</div>` + (campo.ayuda ? `<p class="ed-campo__ayuda">${esc(campo.ayuda)}</p>` : "") + `</div>`;
      }
      module.exports = { PARTES, parsear, htmlCampo, htmlEntrada, htmlHerencia, esc };
    }
  });

  // app/editor/lector.js
  var require_lector = __commonJS({
    "app/editor/lector.js"(exports, module) {
      "use strict";
      var { parsear } = require_controles();
      function valorDeParte(el) {
        if (!el) return void 0;
        if (el.classList && el.classList.contains("ed-seg")) return el.dataset.valor || "";
        if (el.isContentEditable) return el.innerHTML;
        if (el.type === "checkbox") return el.checked;
        return el.value;
      }
      function partesDirectas(raiz) {
        const partes = {};
        for (const el of raiz.querySelectorAll("[data-parte]")) {
          if (el.closest(".ed-lista__item") && !raiz.classList.contains("ed-lista__item")) continue;
          partes[el.dataset.parte] = valorDeParte(el);
        }
        return partes;
      }
      function leerLista(elCampo, campo) {
        const items = [];
        for (const elItem of elCampo.querySelectorAll(".ed-lista__item")) {
          const item = {};
          for (const sub of campo.item_campos) {
            const elSub = elItem.querySelector(`[data-subcampo="${sub.clave}"]`);
            item[sub.clave] = elSub ? partesDirectas(elSub) : {};
          }
          items.push(item);
        }
        return { items };
      }
      function leerCampo(elCampo, campo) {
        const partes = campo.tipo === "lista" ? leerLista(elCampo, campo) : partesDirectas(elCampo);
        return parsear(campo, partes);
      }
      module.exports = { leerCampo, partesDirectas, valorDeParte };
    }
  });

  // app/editor/panel.js
  var require_panel = __commonJS({
    "app/editor/panel.js"(exports, module) {
      "use strict";
      var { htmlCampo, esc } = require_controles();
      var ICONO_ESCRITORIO = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1" y="2" width="14" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 14h4" stroke="currentColor" stroke-width="1.4"/></svg>';
      var ICONO_MOVIL = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 12.5h2" stroke="currentColor" stroke-width="1.4"/></svg>';
      function htmlToggleViewport(viewport) {
        const boton = (valor, icono, titulo) => `<button type="button" class="ed-vp__boton${viewport === valor ? " es-activo" : ""}" data-viewport="${valor}" title="${titulo}" aria-pressed="${viewport === valor}">${icono}</button>`;
        return `<div class="ed-vp">${boton("escritorio", ICONO_ESCRITORIO, "Editar para escritorio")}${boton("movil", ICONO_MOVIL, "Editar para m\xF3vil")}</div>`;
      }
      function htmlPanelVacio() {
        return `<div class="ed-panel ed-panel--vacio"><p class="ed-panel__titulo">Inspector</p></div>`;
      }
      function htmlPanelDesconocido({ nodo, tipo } = {}) {
        const nombre = tipo || (nodo == null ? void 0 : nodo.tipo) || "desconocido";
        return `<div class="ed-panel ed-panel--desconocido" data-nodo="${esc((nodo == null ? void 0 : nodo.id) || "")}"><header class="ed-panel__cabecera"><h2 class="ed-panel__titulo">Bloque no disponible</h2></header><div class="ed-panel__estado" role="status"><strong>${esc(nombre)}</strong><p>Este bloque fue creado con una versi\xF3n m\xE1s nueva. Pod\xE9s eliminarlo o actualizar la app para editarlo.</p></div><footer class="ed-panel__pie"><button type="button" class="ed-boton ed-boton--peligro" data-borrar-nodo>Eliminar bloque</button></footer></div>`;
      }
      function htmlPanel({ esquema, nodo, valores, overrideado = () => false, muestra = () => null, viewport = "escritorio" }) {
        if (!esquema || !nodo) return htmlPanelVacio();
        const grupos = esquema.grupos.map((grupo) => {
          const campos = grupo.campos.map(
            (campo) => htmlCampo(campo, valores[campo.clave], { overrideado: overrideado(campo.clave), muestra: muestra(campo.clave) })
          ).join("");
          return `<section class="ed-grupo" data-grupo="${esc(grupo.id)}"><header class="ed-grupo__cabecera"><h3 class="ed-grupo__titulo">${esc(grupo.nombre)}</h3>` + (grupo.responsive ? htmlToggleViewport(viewport) : "") + `</header>${campos}</section>`;
        }).join("");
        return `<div class="ed-panel" data-nodo="${esc(nodo.id)}" data-viewport="${esc(viewport)}"><header class="ed-panel__cabecera"><h2 class="ed-panel__titulo">${esc(esquema.nombre)}</h2></header>` + grupos + `<footer class="ed-panel__pie"><button type="button" class="ed-boton ed-boton--peligro" data-borrar-nodo>Eliminar bloque</button></footer></div>`;
      }
      module.exports = { htmlPanel, htmlPanelVacio, htmlPanelDesconocido, htmlToggleViewport };
    }
  });

  // app/editor/arbol.js
  var require_arbol = __commonJS({
    "app/editor/arbol.js"(exports, module) {
      "use strict";
      var { esc } = require_controles();
      var CLAVES_TEXTO = ["html", "titulo", "titular", "texto", "nombre", "etiqueta_texto"];
      var MAX_ETIQUETA = 34;
      function sinEtiquetas(html) {
        return String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      }
      function recortarEtiqueta(texto) {
        return texto.length > MAX_ETIQUETA ? texto.slice(0, MAX_ETIQUETA - 1) + "\u2026" : texto;
      }
      function etiquetaPropia(nodo, definicion, valores) {
        for (const clave of CLAVES_TEXTO) {
          const campo = definicion.porClave && definicion.porClave[clave];
          if (!campo) continue;
          const crudo = sinEtiquetas(valores ? valores[clave] : (nodo.props || {})[clave]);
          if (crudo) return recortarEtiqueta(crudo);
        }
        return null;
      }
      function etiquetaDe(nodo, definicion, valores, { definir = null, resolverValores = null, descendientes = false } = {}) {
        const propia = etiquetaPropia(nodo, definicion, valores);
        if (propia) return propia;
        if (descendientes && Array.isArray(nodo.hijos) && nodo.hijos.length && definir) {
          const buscar = (hijos) => {
            for (const hijo of hijos || []) {
              const defHijo = definir(hijo.tipo);
              const valoresHijo = resolverValores ? resolverValores(hijo) : null;
              const texto = etiquetaPropia(hijo, defHijo, valoresHijo);
              if (texto) return texto;
              const anidado = defHijo.admite_hijos ? buscar(hijo.hijos) : null;
              if (anidado) return anidado;
            }
            return null;
          };
          const encontrada = buscar(nodo.hijos);
          if (encontrada) return encontrada;
          const primerHijo = definir(nodo.hijos[0].tipo);
          if (primerHijo && primerHijo.nombre) return primerHijo.nombre;
        }
        return definicion.nombre;
      }
      function contarHijos(nodo) {
        let total = 0;
        for (const hijo of nodo.hijos || []) total += 1 + contarHijos(hijo);
        return total;
      }
      var CHEVRON = '<svg class="ed-arbol__chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      var ICONOS_ARBOL = {
        grupo: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M7 4.5h2M11.5 7v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        error: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5v4M8 11.5v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        seccion: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4l6-2 6 2-6 2-6-2zm0 4l6 2 6-2M2 12l6 2 6-2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        texto: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10M8 3v10M5 13h6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        imagen: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.5" cy="6" r="1" fill="currentColor"/><path d="M3.5 12l3.2-3 2.2 2 1.5-1.3 2.1 2.3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        "imagen-texto": '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2" width="5.5" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9 4h5M9 7h5M9 10h3M9 13h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        galeria: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="2" width="9" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="4" width="9" height="10" rx="1" fill="var(--ed-panel)" stroke="currentColor" stroke-width="1.2"/></svg>',
        titulo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h10M8 3v10M5 13h6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        precio: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5V2.5h6l5 5-6 6-5-5v-4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="5.5" cy="5.5" r=".8" fill="currentColor"/></svg>',
        beneficios: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l1.7 3.5 3.9.6-2.8 2.8.7 3.9L8 11.2l-3.5 1.8.7-3.9-2.8-2.8 3.9-.6L8 2.2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        packs: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="3" rx=".8" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="7" width="12" height="3" rx=".8" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="11" width="12" height="2" rx=".8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
        carrito: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h2l1.2 7h7.5l1.5-5.2H5M6 13.2h.1M12 13.2h.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        resena: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.2h10v7H7l-3 2v-2H3z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5 5.7h6M5 8h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        carrusel: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="8" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 6l-1 2 1 2M14 6l1 2-1 2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        faq: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.3 6.2a1.8 1.8 0 113.1 1.2c-.9.8-1.4 1-1.4 2M8 11.7v.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        tiempo: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8l2.4 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        contador: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8l2 1.2M5 1.8h6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        tabla: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h12M2 9.5h12M6 2.5v11M10 2.5v11" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
        estadisticas: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5V9.5h3v4M6.5 13.5V5.5h3v8M10.5 13.5V2.5h3v11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        garantia: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l5 2v3.8c0 3.1-2.1 5.1-5 6.2-2.9-1.1-5-3.1-5-6.2V4l5-2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 8l1.7 1.7 3.3-3.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      };
      var ICONO_FALLBACK = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 6h7M4.5 9h5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
      function iconoDe(definicion) {
        return ICONOS_ARBOL[definicion && definicion.icono] || ICONO_FALLBACK;
      }
      function htmlFila(nodo, { definicion, valores, seleccion, oculto, colapsado = false, etiqueta = null }) {
        const tieneHijos = definicion.admite_hijos;
        const cantidad = contarHijos(nodo);
        const clases = [
          "ed-arbol__fila",
          nodo.id === seleccion ? "es-seleccionada" : "",
          oculto ? "es-oculta" : ""
        ].filter(Boolean).join(" ");
        return `<div class="${clases}" data-nodo="${esc(nodo.id)}" tabindex="0" role="treeitem" aria-selected="${nodo.id === seleccion}" draggable="true">` + (tieneHijos ? `<button type="button" class="ed-arbol__toggle" data-colapsar aria-expanded="${!colapsado}" title="${colapsado ? "Expandir" : "Contraer"}">${CHEVRON}</button>` : `<span class="ed-arbol__hueco"></span>`) + `<span class="ed-arbol__icono" data-icono="${esc(definicion.icono)}">${iconoDe(definicion)}</span><span class="ed-arbol__texto">${esc(etiqueta || etiquetaDe(nodo, definicion, valores))}</span>` + (tieneHijos && cantidad ? `<span class="ed-arbol__cuenta">${cantidad}</span>` : "") + `</div>`;
      }
      function htmlArbol(documento, ctx) {
        const rama = (nodos, nivel) => nodos.map((nodo) => {
          const definicion = ctx.definicion(nodo.tipo);
          const valores = ctx.valores ? ctx.valores(nodo) : null;
          const colapsado = definicion.admite_hijos && ctx.colapsados && ctx.colapsados.has(nodo.id);
          const fila = htmlFila(nodo, {
            definicion,
            valores,
            seleccion: ctx.seleccion,
            oculto: ctx.estaOculto ? ctx.estaOculto(nodo) : false,
            colapsado,
            etiqueta: etiquetaDe(nodo, definicion, valores, {
              descendientes: definicion.admite_hijos,
              definir: ctx.definicion,
              resolverValores: ctx.valores
            })
          });
          const hijos = definicion.admite_hijos ? `<div class="ed-arbol__hijos">${rama(nodo.hijos || [], nivel + 1)}<button type="button" class="ed-arbol__agregar" data-agregar-en="${esc(nodo.id)}">+ A\xF1adir bloque</button></div>` : "";
          return `<div class="ed-arbol__nodo${colapsado ? " es-colapsado" : ""}" data-nivel="${nivel}" data-nodo-contenedor="${esc(nodo.id)}">${fila}${hijos}</div>`;
        }).join("");
        return `<nav class="ed-arbol" aria-label="Estructura de la p\xE1gina" role="tree"><header class="ed-arbol__cabecera"><h2>P\xE1gina de producto</h2></header><div class="ed-arbol__cuerpo">${rama(documento.arbol || [], 0)}</div><button type="button" class="ed-arbol__agregar ed-arbol__agregar--raiz" data-agregar-seccion>+ A\xF1adir secci\xF3n</button></nav>`;
      }
      function ancestrosDe(documento, id) {
        const buscar = (nodos, padres) => {
          for (const nodo of nodos || []) {
            if (nodo.id === id) return padres;
            const encontrado = buscar(nodo.hijos, [...padres, nodo.id]);
            if (encontrado) return encontrado;
          }
          return null;
        };
        return buscar(documento && documento.arbol, []) || [];
      }
      module.exports = { htmlArbol, etiquetaDe, contarHijos, sinEtiquetas, iconoDe, ancestrosDe };
    }
  });

  // app/editor/libreria.js
  var require_libreria = __commonJS({
    "app/editor/libreria.js"(exports, module) {
      "use strict";
      var { esc } = require_controles();
      function normalizar(texto) {
        return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      }
      function filtrar(catalogo, { categoria = null, busqueda = "" } = {}) {
        const aguja = normalizar(busqueda);
        return catalogo.filter((grupo) => !categoria || grupo.id === categoria).map((grupo) => ({
          ...grupo,
          items: grupo.items.filter((item) => !aguja || normalizar(item.nombre).includes(aguja))
        })).filter((grupo) => grupo.items.length > 0);
      }
      function miniaturaDe(item) {
        const icono = String(item.icono || "bloque");
        const trazos = {
          galeria: '<rect x="8" y="8" width="84" height="48" rx="4"/><circle cx="28" cy="24" r="5"/><path d="M12 50l18-16 12 9 12-12 34 19"/>',
          titulo: '<path d="M12 22h64M12 32h48M12 42h30"/>',
          precio: '<path d="M12 24h50M12 36h35"/><rect x="58" y="40" width="27" height="10" rx="5"/>',
          beneficios: '<circle cx="18" cy="18" r="5"/><path d="M30 18h52M12 34h12M30 34h52M18 50h6M30 50h40"/>',
          packs: '<rect x="10" y="13" width="80" height="12" rx="3"/><rect x="10" y="31" width="80" height="12" rx="3"/><rect x="10" y="49" width="80" height="8" rx="3"/>',
          carrito: '<rect x="12" y="16" width="76" height="26" rx="5"/><path d="M28 51h44"/>',
          resena: '<circle cx="22" cy="26" r="9"/><path d="M38 19h45M38 28h35M38 37h27"/>',
          carrusel: '<rect x="8" y="14" width="25" height="38" rx="4"/><rect x="38" y="14" width="25" height="38" rx="4"/><rect x="68" y="14" width="25" height="38" rx="4"/>',
          faq: '<path d="M12 18h76M12 34h76M12 50h76"/><path d="M78 14l5 4-5 4M78 30l5 4-5 4M78 46l5 4-5 4"/>',
          tiempo: '<path d="M18 18v36M18 23h68M18 38h55M18 53h42"/><circle cx="18" cy="18" r="4"/><circle cx="18" cy="38" r="4"/><circle cx="18" cy="53" r="4"/>',
          contador: '<rect x="14" y="22" width="72" height="24" rx="12"/><path d="M31 34h8M48 34h8M65 34h8"/>',
          imagen: '<rect x="10" y="10" width="38" height="48" rx="4"/><path d="M54 20h32M54 31h27M54 42h32M54 53h20"/>',
          tabla: '<path d="M10 16h80M10 30h80M10 44h80M10 58h80M10 16v42M38 16v42M64 16v42M90 16v42"/>',
          estadisticas: '<path d="M14 55V35M34 55V22M54 55V30M74 55V14M94 55V40"/>',
          garantia: '<path d="M50 10l30 10v18c0 14-12 22-30 29-18-7-30-15-30-29V20z"/><path d="M35 38l10 9 20-21"/>'
        };
        const cuerpo = trazos[icono] || '<rect x="12" y="14" width="76" height="40" rx="5"/><path d="M23 28h54M23 39h38"/>';
        return `<svg class="ed-lib__miniatura" viewBox="0 0 100 66" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${cuerpo}</g></svg>`;
      }
      function htmlTarjeta(item, { usados = 0 } = {}) {
        const limite = item.limite_por_pagina;
        const agotado = limite ? usados >= limite : false;
        const identificador = item.composicion_id ? `data-composicion="${esc(item.composicion_id)}"` : `data-tipo="${esc(item.tipo)}"`;
        return `<button type="button" class="ed-lib__tarjeta${agotado ? " es-agotada" : ""}" ${identificador}${agotado ? " disabled" : ""}><span class="ed-lib__nombre">${esc(item.nombre)}</span>` + (limite ? `<span class="ed-lib__cupo">${usados}/${limite}</span>` : "") + `<span class="ed-lib__vista" data-vista="${esc(item.tipo)}">${miniaturaDe(item)}</span></button>`;
      }
      function htmlLibreria(catalogo, { categoria = null, busqueda = "", contarUsados = () => 0 } = {}) {
        const visibles = filtrar(catalogo, { categoria, busqueda });
        const total = catalogo.reduce((suma, grupo) => suma + grupo.items.length, 0);
        const lateral = `<aside class="ed-lib__lateral"><button type="button" class="ed-lib__cat${!categoria ? " es-activa" : ""}" data-categoria=""><span>Todas</span><span class="ed-lib__cuenta">${total}</span></button>` + catalogo.map(
          (grupo) => `<button type="button" class="ed-lib__cat${categoria === grupo.id ? " es-activa" : ""}" data-categoria="${esc(grupo.id)}"><span>${esc(grupo.nombre)}</span><span class="ed-lib__cuenta">${grupo.items.length}</span></button>`
        ).join("") + `</aside>`;
        const cuerpo = visibles.length ? visibles.map(
          (grupo) => `<section class="ed-lib__grupo"><h3 class="ed-lib__titulo">${esc(grupo.nombre)}</h3><div class="ed-lib__grilla">${grupo.items.map((item) => htmlTarjeta(item, { usados: contarUsados(item.tipo, item) })).join("")}</div></section>`
        ).join("") : `<p class="ed-lib__vacio">No hay secciones que coincidan con \u201C${esc(busqueda)}\u201D.</p>`;
        return `<div class="ed-lib" role="dialog" aria-label="A\xF1adir secci\xF3n"><header class="ed-lib__cabecera"><h2>A\xF1adir secci\xF3n</h2><button type="button" class="ed-lib__cerrar" data-cerrar aria-label="Cerrar">\u2715</button></header><input type="search" class="ed-lib__buscar" data-buscar placeholder="Buscar\u2026" value="${esc(busqueda)}"><div class="ed-lib__cuerpo">${lateral}<div class="ed-lib__lista">${cuerpo}</div></div></div>`;
      }
      module.exports = { htmlLibreria, htmlTarjeta, filtrar, normalizar, miniaturaDe };
    }
  });

  // app/editor/marca.js
  var require_marca = __commonJS({
    "app/editor/marca.js"(exports, module) {
      "use strict";
      var {
        CLAVES_TOKEN,
        NOMBRES_TOKEN,
        PRESETS,
        RADIOS,
        TIPOGRAFIAS,
        tokensDe,
        listaPresets
      } = require_tokens();
      var esc = (valor) => String(valor === null || valor === void 0 ? "" : valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      var HEX = /^#[0-9a-f]{6}$/i;
      function color(valor, alternativo = "#ffffff") {
        return HEX.test(valor || "") ? valor : alternativo;
      }
      function htmlMarca(branding = {}) {
        const resueltos = tokensDe(branding);
        const propios = branding.tokens || {};
        const presets = listaPresets();
        const presetActual = PRESETS[branding.preset] ? branding.preset : "verde";
        const radioActual = RADIOS[branding.radio] ? branding.radio : "pequeno";
        const tipografias = branding.tipografia || {};
        const tarjetas = presets.map(
          (preset) => `<button type="button" class="ed-marca__preset${preset.id === presetActual ? " es-activo" : ""}" data-branding-preset="${esc(preset.id)}" aria-pressed="${preset.id === presetActual}"><span class="ed-marca__muestras">${preset.muestra.map((muestra) => `<i style="background:${esc(muestra)}"></i>`).join("")}</span><span>${esc(preset.nombre)}</span></button>`
        ).join("");
        const tokens = CLAVES_TOKEN.map((clave) => {
          const propio = HEX.test(propios[clave] || "");
          const valor = propio ? propios[clave] : resueltos[clave];
          return `<label class="ed-marca__token"><span class="ed-marca__token-cabecera"><button type="button" class="ed-marca__heredar${propio ? " es-propio" : ""}" data-branding-heredar="${esc(clave)}" aria-pressed="${propio}" title="${propio ? "Volver al color del preset" : "Color heredado del preset"}"></button><span>${esc(NOMBRES_TOKEN[clave] || clave)}</span></span><span class="ed-marca__color"><i style="background:${esc(valor)}"></i><input type="color" value="${esc(color(valor))}" data-branding-token="${esc(clave)}" aria-label="${esc(NOMBRES_TOKEN[clave] || clave)}"></span></label>`;
        }).join("");
        const opcionesFuente = (clave, seleccionada, titulo) => `<label class="ed-marca__select"><span>${titulo}</span><select data-branding-fuente="${esc(clave)}">` + Object.keys(TIPOGRAFIAS).map((id) => `<option value="${esc(id)}"${id === seleccionada ? " selected" : ""}>${esc(id[0].toUpperCase() + id.slice(1))}</option>`).join("") + `</select></label>`;
        return `<div class="ed-marca" role="dialog" aria-modal="true" aria-label="Marca"><header class="ed-marca__cabecera"><div><h2>Marca</h2><p>La plantilla usa estos tokens en toda la p\xE1gina.</p></div><button type="button" class="ed-lib__cerrar" data-cerrar aria-label="Cerrar">\xD7</button></header><section class="ed-marca__seccion"><h3>Preset</h3><div class="ed-marca__presets">${tarjetas}</div></section><section class="ed-marca__seccion"><h3>Colores</h3><div class="ed-marca__tokens">${tokens}</div></section><section class="ed-marca__seccion ed-marca__fila"><label class="ed-marca__select"><span>Esquinas</span><select data-branding-radio>` + Object.keys(RADIOS).map((id) => `<option value="${esc(id)}"${id === radioActual ? " selected" : ""}>${esc(id === "ninguno" ? "Rectas" : id === "pequeno" ? "Chicas" : "Grandes")}</option>`).join("") + `</select></label>${opcionesFuente("titulos", tipografias.titulos || "grotesca", "Fuente de t\xEDtulos")}${opcionesFuente("cuerpo", tipografias.cuerpo || "sistema", "Fuente de cuerpo")}</section></div>`;
      }
      module.exports = { htmlMarca };
    }
  });

  // nucleo/render.js
  var require_render = __commonJS({
    "nucleo/render.js"(exports, module) {
      "use strict";
      var { contexto, escapar } = require_resolver();
      var registro = require_registro();
      var { variablesCss } = require_tokens();
      var PUNTO_QUIEBRE = 750;
      var MEDIA_MOVIL = `@media (max-width:${PUNTO_QUIEBRE - 1}px)`;
      var MEDIA_ESCRITORIO = `@media (min-width:${PUNTO_QUIEBRE}px)`;
      function marcaDeError(nodo, modo, error) {
        if (modo !== "editor") return `<!-- tiq: bloque "${nodo && nodo.tipo}" omitido -->`;
        const detalle = error ? String(error.message || error) : "tipo desconocido";
        return `<div class="tiq-error" data-nodo="${nodo && nodo.id}">Bloque "${nodo && nodo.tipo}" no se pudo dibujar: ${detalle}</div>`;
      }
      function reglasDeNodo(nodo, ctxMovil, valoresEscritorio) {
        const definicion = registro.definicion(nodo.tipo);
        const reglas = [];
        const selector = `[data-nodo="${nodo.id}"]`;
        const claves = Object.keys(nodo.props_movil || {}).filter((clave) => {
          const campo = definicion.porClave[clave];
          return campo && campo.css;
        });
        const declaraciones = claves.length ? ctxMovil.estilos(nodo, claves) : "";
        if (declaraciones) reglas.push({ media: MEDIA_MOVIL, texto: `${selector}{${declaraciones}}` });
        if (valoresEscritorio.mostrar_movil === false) {
          reglas.push({ media: MEDIA_MOVIL, texto: `${selector}{display:none !important}` });
        }
        if (valoresEscritorio.mostrar_escritorio === false) {
          reglas.push({ media: MEDIA_ESCRITORIO, texto: `${selector}{display:none !important}` });
        }
        return reglas;
      }
      function hojaDe(reglas) {
        if (!reglas.length) return "";
        const porMedia = /* @__PURE__ */ new Map();
        for (const regla of reglas) {
          if (!porMedia.has(regla.media)) porMedia.set(regla.media, []);
          porMedia.get(regla.media).push(regla.texto);
        }
        return [...porMedia.entries()].map(([media, textos]) => `${media}{${textos.join("")}}`).join("");
      }
      function render(documento, { modo = "tienda", producto = null, urls = null, carritoUrl = "/cart/add" } = {}) {
        if (!documento || typeof documento !== "object") throw new Error("render: documento inv\xE1lido");
        const escritorio = contexto(documento, { viewport: "escritorio" });
        const movil = contexto(documento, { viewport: "movil" });
        const reglas = [];
        function unNodo(nodo) {
          if (!nodo || !registro.existe(nodo.tipo)) return marcaDeError(nodo, modo);
          const valores = escritorio.valores(nodo);
          if (!escritorio.visible(nodo)) return "";
          try {
            const html2 = registro.definicion(nodo.tipo).render(nodo, ctx);
            if (html2) reglas.push(...reglasDeNodo(nodo, movil, valores));
            return html2;
          } catch (error) {
            return marcaDeError(nodo, modo, error);
          }
        }
        function listaDeNodos(nodos) {
          return (nodos || []).map(unNodo).join("");
        }
        const ctx = {
          ...escritorio,
          modo,
          producto,
          urls,
          carritoUrl,
          hijos: (nodo) => listaDeNodos(nodo.hijos)
        };
        const cuerpo = listaDeNodos(documento.arbol);
        const html = `<div class="tiq-doc" style="${escapar(variablesCss(documento.branding))}">${cuerpo}</div>`;
        return { html, css: hojaDe(reglas) };
      }
      function renderNodo(documento, nodo, { modo = "editor", producto = null, urls = null, carritoUrl = "/cart/add" } = {}) {
        const completo = render({ ...documento, arbol: [nodo] }, { modo, producto, urls, carritoUrl });
        const desde = completo.html.indexOf(">") + 1;
        return { html: completo.html.slice(desde, completo.html.lastIndexOf("</div>")), css: completo.css };
      }
      module.exports = { render, renderNodo, PUNTO_QUIEBRE, MEDIA_MOVIL, MEDIA_ESCRITORIO };
    }
  });

  // app/editor/editor.js
  var require_editor = __commonJS({
    "app/editor/editor.js"(exports, module) {
      var { crearEstado } = require_comandos();
      var { crearLienzo } = require_lienzo();
      var { leerCampo } = require_lector();
      var { htmlPanel, htmlPanelVacio, htmlPanelDesconocido, htmlToggleViewport } = require_panel();
      var { htmlArbol, ancestrosDe } = require_arbol();
      var { htmlLibreria } = require_libreria();
      var { htmlMarca } = require_marca();
      var registro = require_registro();
      var { contexto } = require_resolver();
      var { render } = require_render();
      var { tokensDe } = require_tokens();
      var ICONOS_FLOTA = {
        volver: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        ocultar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A11.8 11.8 0 0112 5c5.4 0 9.3 4.4 10 7a10.8 10.8 0 01-2.1 4.2M6.1 6.1C3.8 7.7 2.4 10.1 2 12c.6 2.6 4.5 7 10 7 1 0 2-.2 2.9-.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        duplicar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
        agregar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
        borrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0v13h12V7M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        ia: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
      };
      var ESQUELETO = `
<div class="ed">
  <header class="ed__barra">
    <div class="ed__barra-izq">
      <button type="button" class="ed-icono ed-icono--volver" data-volver title="Volver a p\xE1ginas">${ICONOS_FLOTA.volver}</button>
      <div class="ed-identidad"><strong data-editor-titulo>P\xE1gina de producto</strong><span data-editor-subtitulo>Editor</span></div>
      <button type="button" class="ed-boton" data-branding>Marca</button>
      <button type="button" class="ed-boton ed-boton--panel" data-panel-toggle="arbol">Estructura</button>
      <button type="button" class="ed-boton ed-boton--panel" data-panel-toggle="panel">Inspector</button>
    </div>
    <div class="ed__barra-centro">
      ${htmlToggleViewport("escritorio").replace('class="ed-vp"', 'class="ed-vp ed-vp--grande"')}
    </div>
    <div class="ed__barra-der">
      <button type="button" class="ed-icono" data-deshacer title="Deshacer (Ctrl+Z)" disabled>\u21B6</button>
      <button type="button" class="ed-icono" data-rehacer title="Rehacer (Ctrl+Shift+Z)" disabled>\u21B7</button>
      <button type="button" class="ed-boton" data-guardar disabled>Guardar</button>
      <button type="button" class="ed-boton ed-boton--primario" data-publicar>Publicar en la tienda</button>
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
    <button type="button" data-accion="agregar" title="A\xF1adir bloque adentro">${ICONOS_FLOTA.agregar}</button>
    <button type="button" data-accion="borrar" title="Eliminar">${ICONOS_FLOTA.borrar}</button>
  </div>
</div>`;
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
      function montarEditor(raiz, { documento: docInicial, producto = null, alGuardar = null, alPublicar = null, alSubirImagen = null, rutaCss, titulo = "P\xE1gina de producto", subtitulo = "Editor" } = {}) {
        var _a;
        raiz.innerHTML = ESQUELETO;
        raiz.querySelector("[data-editor-titulo]").textContent = titulo || "P\xE1gina de producto";
        raiz.querySelector("[data-editor-subtitulo]").textContent = subtitulo || "Editor";
        const zona = (nombre) => raiz.querySelector(`[data-zona="${nombre}"]`);
        const zonaArbol = zona("arbol");
        const zonaPanel = zona("panel");
        const zonaModal = zona("modal");
        const flota = zona("flota");
        const estado = crearEstado(docInicial);
        const primerNodo = (_a = docInicial == null ? void 0 : docInicial.arbol) == null ? void 0 : _a[0];
        if (primerNodo) estado.seleccionar(primerNodo.id);
        let omitirPanel = false;
        let libreriaAbierta = null;
        let marcaAbierta = false;
        let pendiente = null;
        const colapsados = /* @__PURE__ */ new Set();
        (function cerrarRamasIniciales(nodos) {
          for (const nodo of nodos || []) {
            if (registro.existe(nodo.tipo) && registro.definicion(nodo.tipo).admite_hijos) colapsados.add(nodo.id);
            cerrarRamasIniciales(nodo.hijos);
          }
        })(estado.documento().arbol);
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
        function repintar() {
          const doc = estado.documento();
          const ctx = contexto(doc, { viewport: estado.viewport() });
          const seleccion = estado.seleccion();
          const definirParaEditor = (tipo) => registro.definicionParaEditor(tipo);
          const valoresParaEditor = (nodo) => {
            if (!registro.existe(nodo.tipo)) return {};
            try {
              return ctx.valores(nodo);
            } catch {
              return {};
            }
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
            zonaPanel.innerHTML = nodo ? !registro.existe(nodo.tipo) ? htmlPanelDesconocido({ nodo }) : htmlPanel({
              esquema: registro.esquemaPanelParaEditor(nodo.tipo),
              nodo,
              valores: valoresParaEditor(nodo),
              overrideado: (clave) => hayOverrideDe(nodo, clave),
              muestra: (clave) => ctx.comoCss(nodo, clave),
              viewport: estado.viewport()
            }) : htmlPanelVacio();
          }
          for (const boton of raiz.querySelectorAll("[data-viewport]")) {
            const activo = boton.dataset.viewport === estado.viewport();
            boton.classList.toggle("es-activo", activo);
            boton.setAttribute("aria-pressed", String(activo));
          }
          raiz.querySelector("[data-deshacer]").disabled = !estado.puedeDeshacer();
          raiz.querySelector("[data-rehacer]").disabled = !estado.puedeRehacer();
          raiz.querySelector("[data-guardar]").disabled = !estado.hayCambios();
          const publicar2 = raiz.querySelector("[data-publicar]");
          publicar2.disabled = !alPublicar;
          publicar2.title = alPublicar ? "Publicar en la tienda" : "La publicaci\xF3n se habilita al completar el renderer v1";
          colocarFlota();
        }
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
          if (!caja) {
            flota.hidden = true;
            return;
          }
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
          var _a2;
          const archivo = evento.target.closest("[data-subir-imagen]");
          if (archivo) {
            const file = (_a2 = archivo.files) == null ? void 0 : _a2[0];
            const nodo = estado.nodoSeleccionado();
            const contenedor = archivo.closest("[data-clave]");
            const campo = nodo && campoDe(contenedor, nodo);
            const subcampo = archivo.closest("[data-subcampo]");
            const campoImagen = subcampo && (campo == null ? void 0 : campo.tipo) === "lista" ? campo.item_campos.find((item) => item.clave === subcampo.dataset.subcampo) : campo;
            if (!file || !nodo || !campo || !campoImagen || campoImagen.tipo !== "imagen" || !alSubirImagen) return;
            archivo.disabled = true;
            Promise.resolve().then(() => {
              var _a3;
              return alSubirImagen(file, { nodo, campo: campoImagen, lista: campo.tipo === "lista" ? campo : null, indice: subcampo ? Number((_a3 = subcampo.closest("[data-item]")) == null ? void 0 : _a3.dataset.item) : null });
            }).then((imagen) => {
              if (!imagen) return;
              if (campo.tipo !== "lista") return estado.fijarProp(nodo.id, campo.clave, imagen);
              const actual = contexto(estado.documento(), { viewport: estado.viewport() }).valores(nodo)[campo.clave] || [];
              const siguiente = actual.map((item, indice) => {
                var _a3;
                return indice === Number((_a3 = subcampo.closest("[data-item]")) == null ? void 0 : _a3.dataset.item) ? { ...item, [campoImagen.clave]: imagen } : item;
              });
              estado.fijarProp(nodo.id, campo.clave, siguiente);
            }).catch((error) => raiz.dispatchEvent(new CustomEvent("tiq:error", {
              detail: { mensaje: (error == null ? void 0 : error.message) || "No se pudo subir la imagen." },
              bubbles: true
            }))).finally(() => {
              archivo.disabled = false;
              archivo.value = "";
            });
            return;
          }
          const elCampo = evento.target.closest("[data-clave]");
          if (!elCampo) return;
          const esTexto = evento.target.matches("input[type=text], input[type=url], input[type=number], textarea");
          omitirPanel = esTexto;
          aplicarDesdePanel(elCampo);
          omitirPanel = false;
          if (!esTexto) pedirRepintado();
        });
        zonaPanel.addEventListener("click", (evento) => {
          var _a2;
          const nodo = estado.nodoSeleccionado();
          const formato = evento.target.closest("[data-formato]");
          if (formato) {
            const area = (_a2 = formato.closest("[data-clave]")) == null ? void 0 : _a2.querySelector('[data-parte="valor"]');
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
            return void raiz.dispatchEvent(new CustomEvent("tiq:ia", {
              detail: { nodo, campo: asistente.dataset.ia },
              bubbles: true
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
            for (const sub of campo.item_campos) item[sub.clave] = sub.defecto === void 0 ? null : sub.defecto;
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
        zonaArbol.addEventListener("click", (evento) => {
          var _a2;
          const colapsar = evento.target.closest("[data-colapsar]");
          if (colapsar) {
            const rama = colapsar.closest(".ed-arbol__nodo");
            const id = rama && ((_a2 = rama.querySelector("[data-nodo]")) == null ? void 0 : _a2.dataset.nodo);
            if (id) {
              if (colapsados.has(id)) colapsados.delete(id);
              else colapsados.add(id);
            }
            return void (rama == null ? void 0 : rama.classList.toggle("es-colapsado", id ? colapsados.has(id) : false));
          }
          const agregarEn = evento.target.closest("[data-agregar-en]");
          if (agregarEn) return void abrirLibreria(agregarEn.dataset.agregarEn);
          if (evento.target.closest("[data-agregar-seccion]")) return void abrirLibreria(null);
          const fila = evento.target.closest("[data-nodo]");
          if (fila) {
            estado.seleccionar(fila.dataset.nodo);
            lienzo.verNodo(fila.dataset.nodo);
          }
        });
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
            // El cupo se calcula en el ámbito donde se abrirá la librería: una
            // misma sección puede tener un bloque limitado aunque otra ya lo use.
            contarUsados: (tipo, item) => (item == null ? void 0 : item.composicion_id) ? 0 : estado.contarPorTipo(tipo, { padreId: libreriaAbierta.padreId })
          });
          const buscador = zonaModal.querySelector("[data-buscar]");
          if (buscador && libreriaAbierta.busqueda) {
            buscador.focus();
            buscador.selectionStart = buscador.value.length;
          }
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
                estado.fijarBranding(`tokens.${clave}`, void 0);
              }
              return void pintarMarca();
            }
            const heredar = evento.target.closest("[data-branding-heredar]");
            if (heredar) {
              const clave = heredar.dataset.brandingHeredar;
              const propio = heredar.getAttribute("aria-pressed") === "true";
              if (propio) estado.fijarBranding(`tokens.${clave}`, void 0);
              else {
                const actuales = tokensDe(estado.documento().branding);
                estado.fijarBranding(`tokens.${clave}`, actuales[clave]);
              }
              return void pintarMarca();
            }
            return;
          }
          const cat = evento.target.closest("[data-categoria]");
          if (cat) {
            libreriaAbierta.categoria = cat.dataset.categoria || null;
            return void pintarLibreria();
          }
          const tarjeta = evento.target.closest("[data-tipo], [data-composicion]");
          if (tarjeta && !tarjeta.disabled) {
            if (tarjeta.dataset.composicion) {
              estado.insertarComposicion(tarjeta.dataset.composicion, { padreId: libreriaAbierta.padreId });
            } else {
              estado.insertar(tarjeta.dataset.tipo, { padreId: libreriaAbierta.padreId });
            }
            libreriaAbierta = null;
            pintarLibreria();
          }
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
          lienzo.verNodo(fila.dataset.nodo);
        });
        flota.addEventListener("click", (evento) => {
          const nodo = estado.nodoSeleccionado();
          const accion = evento.target.closest("[data-accion]");
          if (!nodo || !accion) return;
          switch (accion.dataset.accion) {
            case "duplicar":
              return void estado.duplicar(nodo.id);
            case "borrar":
              return void estado.borrar(nodo.id);
            case "agregar":
              return void abrirLibreria(nodo.id);
            case "ocultar": {
              const clave = estado.viewport() === "movil" ? "mostrar_movil" : "mostrar_escritorio";
              if (!registro.existe(nodo.tipo)) return void estado.borrar(nodo.id);
              const valores = contexto(estado.documento(), { viewport: estado.viewport() }).valores(nodo);
              return void estado.fijarProp(nodo.id, clave, valores[clave] === false);
            }
            // La edición con IA por bloque llega en la Fase 6; el botón ya está en su
            // lugar para no tener que rehacer la barra después.
            case "ia":
              return void raiz.dispatchEvent(new CustomEvent("tiq:ia", { detail: { nodo }, bubbles: true }));
          }
        });
        raiz.querySelector(".ed__barra").addEventListener("click", (evento) => {
          const vp = evento.target.closest("[data-viewport]");
          if (vp) {
            estado.fijarViewport(vp.dataset.viewport);
            return void lienzo.fijarViewport(vp.dataset.viewport);
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
            raiz.classList.toggle(`ed--${panel.dataset.panelToggle}-abierto`);
            return;
          }
        });
        async function guardar() {
          if (alGuardar) await alGuardar(estado.documento());
          estado.marcarGuardado();
        }
        async function publicar() {
          const boton = raiz.querySelector("[data-publicar]");
          if (!alPublicar || (boton == null ? void 0 : boton.disabled)) return;
          if (boton) boton.disabled = true;
          try {
            if (estado.hayCambios() && alGuardar) await guardar();
            await alPublicar(estado.documento());
            estado.marcarGuardado();
          } catch (error) {
            raiz.dispatchEvent(new CustomEvent("tiq:error", {
              detail: { mensaje: (error == null ? void 0 : error.message) || "No se pudo publicar la p\xE1gina." },
              bubbles: true
            }));
          } finally {
            if (boton) boton.disabled = false;
            pedirRepintado();
          }
        }
        raiz.ownerDocument.addEventListener("keydown", (evento) => {
          if (!evento.ctrlKey && !evento.metaKey) return;
          const tecla = evento.key.toLowerCase();
          if (tecla === "z") {
            evento.preventDefault();
            return void (evento.shiftKey ? estado.rehacer() : estado.deshacer());
          }
          if (tecla === "y") {
            evento.preventDefault();
            return void estado.rehacer();
          }
          if (tecla === "s") {
            evento.preventDefault();
            return void guardar();
          }
        });
        raiz.ownerDocument.defaultView.addEventListener("resize", colocarFlota);
        raiz.querySelector(".ed__centro").addEventListener("scroll", colocarFlota, { passive: true });
        repintar();
        lienzo.fijarViewport(estado.viewport());
        return { estado, lienzo, repintar };
      }
      module.exports = { montarEditor, posicionFlota };
    }
  });
  return require_editor();
})();
