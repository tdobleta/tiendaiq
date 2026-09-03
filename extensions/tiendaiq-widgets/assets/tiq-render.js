// Generado por scripts/construir-render.js — no editar a mano.
"use strict";
var TiqRender = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

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

  // nucleo/registro.js
  var require_registro = __commonJS({
    "nucleo/registro.js"(exports, module) {
      "use strict";
      var definiciones = require_indice();
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
        esquemaPanel,
        esquemaPanelParaEditor,
        resumenParaIA,
        // expuesto solo para las pruebas del propio registro
        _normalizar: normalizar
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

  // nucleo/entrada-navegador.js
  var require_entrada_navegador = __commonJS({
    "nucleo/entrada-navegador.js"(exports, module) {
      var { render, renderNodo, PUNTO_QUIEBRE } = require_render();
      var registro = require_registro();
      var resolver = require_resolver();
      var tokens = require_tokens();
      module.exports = {
        render,
        renderNodo,
        PUNTO_QUIEBRE,
        // Lo que necesita el editor para armar la UI sin conocer ningún tipo.
        catalogo: registro.catalogo,
        esquemaPanel: registro.esquemaPanel,
        tipos: registro.tipos,
        definicion: registro.definicion,
        // Para el micro-toggle heredado/override del panel.
        hayOverride: resolver.hayOverride,
        // Para el panel de branding.
        presets: tokens.listaPresets,
        variablesCss: tokens.variablesCss,
        CLAVES_TOKEN: tokens.CLAVES_TOKEN,
        NOMBRES_TOKEN: tokens.NOMBRES_TOKEN
      };
    }
  });
  return require_entrada_navegador();
})();
