/* ============================================================
   TiendaIQ Bundles — widget de la página de producto.
   Generado por la app; se inyecta como asset del tema. No depende del
   server para renderizar: la config viaja en window.TIENDAIQ_BUNDLES.

   Qué hace:
     1. Elige el primer bundle activo que matchea el producto actual.
     2. Dibuja las tarjetas de oferta ("Comprá 1 / 2 / 3") con el diseño
        configurado y calcula precios/ahorro en vivo.
     3. Al agregar al carrito, mete la cantidad del peldaño elegido. El
        DESCUENTO real lo aplica Shopify en el checkout (descuento
        automático creado por la app), no este script.
   ============================================================ */
(function () {
  "use strict";

  // La config puede venir EMBEBIDA (window.TIENDAIQ_BUNDLES, inyección directa
  // en el tema) o traída por FETCH (app embed del theme app extension, que solo
  // deja window.TIENDAIQ_BUNDLES_SRC). Toda la lógica vive en arrancar().
  function arrancar() {
    var CFG = window.TIENDAIQ_BUNDLES;
    var PROD = window.TIENDAIQ_PRODUCTO;
    // El control real es bundle.activo (lo filtra aplica()); no hay switch
    // maestro por ahora, así que no gateamos por CFG.activo.
    if (!CFG || !PROD || !Array.isArray(CFG.lista)) return;

  // --- elegir el bundle que aplica a este producto ---
  function aplica(bundle) {
    if (bundle.activo === false) return false;
    var a = bundle.activador || { tipo: "todos" };
    if (a.tipo === "todos") return true;
    var idNum = Number(PROD.id);
    if (a.tipo === "productos") {
      return (a.ids || []).some(function (gid) { return Number(String(gid).split("/").pop()) === idNum; });
    }
    if (a.tipo === "coleccion") {
      var cols = (PROD.colecciones || []).map(Number);
      return (a.ids || []).some(function (gid) { return cols.indexOf(Number(String(gid).split("/").pop())) !== -1; });
    }
    return false;
  }

  var bundle = CFG.lista.filter(aplica)[0];
  if (!bundle) return;
  var esBxgy = bundle.tipo === "bxgy";
  if (!esBxgy && !(bundle.ofertas || []).length) return;

  var D = bundle.diseno || {};
  var BOT = D.boton || {};
  var AV = D.avanzado || {}; // toggles de "Configuración avanzada"

  // "Excluir clientes B2B": si el cliente es B2B y el toggle está ON, ni montamos.
  if (AV.excluir_b2b && (window.TIENDAIQ_CLIENTE || {}).b2b) return;

  // --- dinero ---
  // product.price viene en centavos (entero). Formateamos con el money_format
  // de la tienda; si es raro, caemos a un formato simple. Si avanzado.sin_decimales
  // está ON, mostramos enteros (útil para CLP/JPY o para un look más limpio).
  var formato = (PROD.moneda || "${{amount}}");
  function fmt(cents) {
    var n = Math.round(cents) / 100;
    var enteros = Math.round(n).toLocaleString("es-AR");
    var conComa = AV.sin_decimales ? enteros : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var conPunto = AV.sin_decimales ? String(Math.round(n)) : n.toFixed(2);
    return formato
      .replace(/\{\{\s*amount\s*\}\}/g, conComa)
      .replace(/\{\{\s*amount_with_comma_separator\s*\}\}/g, conComa)
      .replace(/\{\{\s*amount_no_decimals\s*\}\}/g, enteros)
      .replace(/\{\{\s*amount_no_decimals_with_comma_separator\s*\}\}/g, enteros)
      .replace(/\{\{\s*amount_with_period_and_space_separator\s*\}\}/g, conPunto) ||
      ("$" + conComa);
  }

  // --- precio unitario: intenta leer la variante seleccionada del form,
  // cae al precio que mandó Liquid ---
  // Info de la variante actual desde el mapa que inyecta Liquid (precio/compare/stock).
  function varInfo() {
    var id = varianteActual();
    var m = window.TIENDAIQ_VARIANTES || {};
    return (id != null && m[id]) ? m[id] : null;
  }
  // "Coincidir precio del widget" (ON por defecto): el precio sigue a la variante
  // elegida. Sin mapa (temas custom) cae al precio de Liquid (variante inicial).
  function precioUnitario() {
    if (AV.precio_en_vivo !== false) {
      var vi = varInfo();
      if (vi && vi.precio != null) return Number(vi.precio) || 0;
    }
    return Number(PROD.precio) || 0;
  }
  // Precio unitario de REFERENCIA (para el tachado): compare-at del producto si
  // "Usar precio de comparación" está ON y es mayor que el precio; si no, el precio.
  function precioRef(pu) {
    if (AV.usar_compare_at !== false) {
      var vi = varInfo();
      if (vi && vi.compare && Number(vi.compare) > pu) return Number(vi.compare);
    }
    return pu;
  }

  // La variante puede venir del form de Dawn, de un input suelto, o de un
  // global que setean los temas custom (landing PagePilot / TiendaIQ).
  function varianteActual() {
    var el = document.querySelector('form[action*="/cart/add"] [name="id"]') || document.querySelector('[name="id"]');
    if (el && el.value) return el.value;
    if (window.TIENDAIQ_VARIANT) return window.TIENDAIQ_VARIANT;
    if (window.VARIANT) return window.VARIANT;
    if (PROD.variante) return PROD.variante;
    return null;
  }

  // --- render ---
  var seleccion = 0;
  (bundle.ofertas || []).forEach(function (o, i) { if (o.predeterminada) seleccion = i; });

  // --- Suscripción (F3/F4). Solo real si el producto tiene selling plans de una
  // app de terceros; si no, no se ofrece la opción Subscribe. ---
  var SUB = D.sub || {};
  var SP = window.TIENDAIQ_SELLING_PLANS || [];
  var haySub = !!SUB.on && SP.length > 0 && !esBxgy;
  var modoSub = false; // false = compra única · true = suscripción
  function planActual() {
    for (var i = 0; i < SP.length; i++) { var pl = SP[i].plans || []; if (pl.length) return pl[0]; }
    return null;
  }
  // Precio con el ajuste del selling plan (sale de la app de terceros, no lo
  // calculamos nosotros). total en centavos.
  function precioSub(total) {
    var p = planActual(); if (!p || p.adj == null) return total;
    var adj = Number(p.adj) || 0;
    if (p.adjType === "percentage") return Math.round(total * (1 - adj / 100));
    if (p.adjType === "fixed_amount") return Math.max(0, total - Math.round(adj * 100));
    if (p.adjType === "price") return Math.round(adj * 100);
    return total;
  }

  var raiz = document.createElement("div");
  raiz.className = "tiq-bdl" + ((D.layout && D.layout.template === "horizontal") ? " tiq-bdl--horizontal" : "");
  raiz.style.setProperty("--tiq-borde", D.color_borde || "#111");
  raiz.style.setProperty("--tiq-badge", D.color_badge || "#111");
  raiz.style.setProperty("--tiq-badge-txt", D.color_badge_texto || "#fff");
  raiz.style.setProperty("--tiq-etq", D.color_etiqueta || "#e11d48");
  raiz.style.setProperty("--tiq-txt", D.color_texto || "#111");
  // Fondo de la tarjeta (no-seleccionada). Solo si el merchant lo eligió.
  if (D.color_fondo) raiz.style.setProperty("--tiq-card-bg", D.color_fondo);
  // Geometría (Paso 2): radius unificado (fallback al legacy `radio`); breathing
  // → --tiq-gap (densidad entre tarjetas). Mismo contrato que disenoAVars() del admin.
  var G = D.geometry || {};
  raiz.style.setProperty("--tiq-radio", (G.radius != null ? G.radius : (D.radio != null ? D.radio : 12)) + "px");
  if (G.breathing != null) raiz.style.setProperty("--tiq-gap", G.breathing + "px");
  // Tipografía (Paso 6): fuente + pesos por rol. Mismo contrato que el admin.
  var FONTS = { heredar: "inherit", sans: "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", serif: "Georgia,'Times New Roman',serif", redondeada: "'Nunito','Quicksand','Varela Round',system-ui,sans-serif", mono: "'SF Mono',ui-monospace,'Courier New',monospace" };
  var TY = D.type || {};
  if (TY.font && TY.font !== "heredar") raiz.style.setProperty("--tiq-font", FONTS[TY.font] || "inherit");
  if (TY.titleWeight) raiz.style.setProperty("--tiq-title-w", TY.titleWeight);
  if (TY.priceWeight) raiz.style.setProperty("--tiq-price-w", TY.priceWeight);
  // Estilo por elemento (paridad con disenoAVars/vElAVars del admin). Fase 1.
  (function () {
    var EL = TY.el || {};
    function setEl(name, o) {
      o = o || {};
      if (o.font && o.font !== "heredar") raiz.style.setProperty("--tiq-" + name + "-font", FONTS[o.font] || "inherit");
      if (o.size) raiz.style.setProperty("--tiq-" + name + "-size", o.size + "px");
      if (o.weight) raiz.style.setProperty("--tiq-" + name + "-w", o.weight);
      if (o.color) raiz.style.setProperty("--tiq-" + name + "-color", o.color);
    }
    setEl("h1", EL.enc); setEl("titulo", EL.titulo); setEl("precio", EL.precio);
    setEl("etq", EL.etq); setEl("badge", EL.badge); setEl("oos", EL.oos);
  })();
  // Fondo de etiqueta, color de agotado, ancho de borde (Fase 2).
  if (D.color_etiqueta_fondo) raiz.style.setProperty("--tiq-etq-bg", D.color_etiqueta_fondo);
  if (D.color_oos) raiz.style.setProperty("--tiq-agotado-color", D.color_oos);
  if (G.borderWidth != null) raiz.style.setProperty("--tiq-bd-w", G.borderWidth + "px");
  raiz.style.setProperty("--tiq-bot-fondo", BOT.color_fondo || "#111");
  raiz.style.setProperty("--tiq-bot-txt", BOT.color_texto || "#fff");
  raiz.style.setProperty("--tiq-bot-radio", (BOT.radio != null ? BOT.radio : 8) + "px");
  raiz.style.setProperty("--tiq-bot-tam", (BOT.tamano != null ? BOT.tamano : 16) + "px");

  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }

  // Cantidad total a agregar al carrito según el tipo y la selección.
  function cantidadElegida() {
    if (esBxgy) {
      var b = bundle.bxgy || {};
      return Math.max(1, Number(b.compra_cantidad) || 1) + Math.max(1, Number(b.regalo_cantidad) || 1);
    }
    return Math.max(1, Number(bundle.ofertas[seleccion].cantidad) || 1);
  }

  // Tarjeta única para BXGY (comprá X y obtené Y). No es seleccionable.
  function cardBxgy(pu) {
    var b = bundle.bxgy || {};
    var compra = Math.max(1, Number(b.compra_cantidad) || 1);
    var regalo = Math.max(1, Number(b.regalo_cantidad) || 1);
    var desc = Math.min(100, Math.max(1, Number(b.regalo_descuento) || 100));
    var bruto = pu * (compra + regalo);
    var total = Math.round(pu * compra + pu * regalo * (1 - desc / 100));
    var ahorro = bruto - total;
    var gratis = desc >= 100;
    var titulo = "Comprá " + compra + ", llevás " + regalo + (gratis ? " gratis" : " al " + desc + "% off");
    var etq = gratis ? (compra + regalo) + "x" + compra : desc + "% OFF";
    return {
      html:
        '<label class="tiq-bdl__card is-sel is-pop">' +
          '<span class="tiq-bdl__badge tiq-bdl__badge--' + FORMA_BADGE(bundle.diseno) + '">' + (gratis ? "Regalo" : "Oferta") + "</span>" +
          '<span class="tiq-bdl__radio" aria-hidden="true"></span>' +
          '<span class="tiq-bdl__main">' +
            '<span class="tiq-bdl__titulo">' + esc(titulo) + ' <span class="tiq-bdl__etq">' + esc(etq) + "</span></span>" +
            (D.mostrar_ahorro && ahorro > 0 ? '<span class="tiq-bdl__ahorro">Ahorrás ' + fmt(ahorro) + "</span>" : "") +
          "</span>" +
          '<span class="tiq-bdl__precio">' +
            '<span class="tiq-bdl__precio-now">' + fmt(total) + "</span>" +
            '<span class="tiq-bdl__precio-old">' + fmt(bruto) + "</span>" +
          "</span>" +
        "</label>",
      total: total
    };
  }

  // --- add-ons de un nivel (regalo, imagen, envío) — mismo marcado que el
  // preview del admin (app.js: addonsPreviewBdl / filaRegaloBdl) ---
  function filaRegalo(it) {
    var cant = it.cantidad || 1;
    var ic = it.imagen
      ? '<span class="tiq-bdl__gift-ic tiq-bdl__gift-ic--img"><img src="' + esc(it.imagen) + '" alt=""></span>'
      : '<span class="tiq-bdl__gift-ic">🎁</span>';
    var vars = (it.variantes || []).filter(function (v) { return !it.varSel || it.varSel.indexOf(v.id) !== -1; });
    var selc = "";
    if (vars.length > 1) selc = '<select class="tiq-bdl__gift-var" aria-label="' + esc(it.opcionNombre || "Opción") + '">' + vars.map(function (v) { return "<option>" + esc(v.titulo) + "</option>"; }).join("") + "</select>";
    else if (vars.length === 1) selc = '<span class="tiq-bdl__gift-varone">' + esc(vars[0].titulo) + "</span>";
    var pill = '<span class="tiq-bdl__gift-free"' + (it.colorGratis ? ' style="background:' + esc(it.colorGratis) + '"' : "") + ">" + esc(it.textoGratis || "GRATIS") + "</span>";
    var cents = it.precio != null ? Math.round(parseFloat(it.precio) * 100) * cant : 0;
    var old = (it.mostrarPrecio !== false && cents > 0) ? '<s class="tiq-bdl__gift-old">' + fmt(cents) + "</s>" : "";
    return '<div class="tiq-bdl__gift">' + ic +
      '<span class="tiq-bdl__gift-main"><span class="tiq-bdl__gift-name">' + cant + "x " + esc(it.nombre || "Regalo") + "</span>" + selc + "</span>" +
      '<span class="tiq-bdl__gift-right">' + pill + old + "</span></div>";
  }
  // Forma/plantilla de la insignia (whitelist: evita inyección de clases).
  function FORMA_BADGE(d) {
    var f = { soft: 1, pill: 1, rect: 1, ribbon: 1, tag: 1 };
    var v = (d || {}).badge_forma;
    return f[v] ? v : "soft";
  }
  // Thumbnail de imagen del nivel: va integrado a la tarjeta (izq en vertical,
  // arriba en horizontal), NO como bloque suelto abajo.
  function thumbHTML(o) {
    var im = (o.addons || {}).imagen;
    return im && im.on && im.url
      ? '<span class="tiq-bdl__thumb"><img src="' + esc(im.url) + '" alt="" loading="lazy"></span>'
      : "";
  }
  function addonsHTML(o) {
    var ad = o.addons || {};
    var h = "";
    if (ad.regalo && ad.regalo.on) {
      var items = ad.regalo.items || (ad.regalo.nombre ? [{ nombre: ad.regalo.nombre, cantidad: 1 }] : []);
      items.forEach(function (it) { h += filaRegalo(it); });
    }
    if (ad.envio && ad.envio.on) h += '<div class="tiq-bdl__ship">🚚 + ' + esc(ad.envio.texto || "FREE SHIPPING") + "</div>";
    return h ? '<div class="tiq-bdl__addons">' + h + "</div>" : "";
  }

  // Opciones de compra (One-Time / Subscribe & Save). Solo si haySub. El precio de
  // Subscribe sale del ajuste del selling plan. total = total del nivel elegido.
  function buyoptsHTML(total) {
    if (!haySub) return "";
    var ver = SUB.ver || {};
    var subT = precioSub(total);
    var pctS = total > 0 ? Math.round((total - subT) / total * 100) : 0;
    var pill = (SUB.mostrar_label_desc && pctS > 0) ? ' <span class="tiq-bdl__etq">-' + pctS + "%</span>" : "";
    var head = (ver.encabezado !== false && SUB.encabezado) ? '<div class="tiq-bdl__buyhead">' + esc(SUB.encabezado) + "</div>" : "";
    function opt(esSub, titulo, color, subt, verKey, precio, pillHTML) {
      return '<label class="tiq-bdl__buyopt' + (modoSub === esSub ? " is-sel" : "") + '" data-sub="' + (esSub ? 1 : 0) + '" role="radio" aria-checked="' + (modoSub === esSub) + '" tabindex="0">' +
        '<span class="tiq-bdl__radio" aria-hidden="true"></span>' +
        '<span class="tiq-bdl__buyopt-main">' +
          '<span class="tiq-bdl__buyopt-t"' + (color ? ' style="color:' + esc(color) + '"' : "") + ">" + esc(titulo) + (pillHTML || "") + "</span>" +
          (ver[verKey] !== false && subt ? '<span class="tiq-bdl__buyopt-s">' + esc(subt) + "</span>" : "") +
        "</span>" +
        '<span class="tiq-bdl__precio"><span class="tiq-bdl__precio-now">' + fmt(precio) + "</span></span>" +
      "</label>";
    }
    return '<div class="tiq-bdl__buyopts" role="radiogroup" aria-label="Opciones de compra">' + head +
      opt(false, SUB.titulo_once || "One-Time Purchase", SUB.color_once, SUB.sub_once, "sub_once", total, "") +
      opt(true, SUB.titulo_sub || "Subscribe & Save", SUB.color_sub, SUB.sub_sub, "sub_sub", subT, pill) +
      (modoSub && ver.detalles !== false && SUB.detalles ? '<div class="tiq-bdl__subdetail">' + esc(SUB.detalles) + "</div>" : "") +
    "</div>";
  }

  function pintar() {
    var pu = precioUnitario();
    var tarjetas, totalSel;

    if (esBxgy) {
      var c = cardBxgy(pu);
      tarjetas = c.html;
      totalSel = c.total;
    } else {
      // La selección tiene que caer SIEMPRE en un nivel disponible (ni desactivado
      // ni agotado); si no, el botón agregaría un nivel que no se muestra.
      var actualSel = bundle.ofertas[seleccion];
      if (!actualSel || actualSel.activo === false || actualSel.agotado) {
        for (var kSel = 0; kSel < bundle.ofertas.length; kSel++) {
          var okSel = bundle.ofertas[kSel];
          if (okSel && okSel.activo !== false && !okSel.agotado) { seleccion = kSel; break; }
        }
      }
      tarjetas = bundle.ofertas.map(function (o, i) {
        if (o.activo === false) return ""; // nivel desactivado: no se muestra (paridad con el editor)
        var cant = Math.max(1, Number(o.cantidad) || 1);
        var desc = Number(o.descuento) || 0;
        var bruto = pu * cant;
        var total = Math.round(bruto * (1 - desc / 100));
        // Precio de referencia (tachado): el compare-at del producto si el toggle
        // está ON y es mayor que el precio; si no, el bruto (pu × cant).
        var ref = precioRef(pu) * cant;
        if (ref < bruto) ref = bruto;
        var ahorro = ref - total;
        var pct = ref > 0 ? Math.round((ahorro / ref) * 100) : 0;
        var etq = o.etiqueta || (ahorro > 0 ? pct + "% OFF" : ""); // % calculado si el merchant no lo tipeó
        var puUnit = Math.round(total / cant);                   // precio por unidad (el número que convierte)
        var agot = !!o.agotado;
        var sel = i === seleccion && !agot;
        return (
          '<label class="tiq-bdl__card' + (sel ? " is-sel" : "") + (o.popular ? " is-pop" : "") + (agot ? " is-agotado" : "") + '"' +
            ' data-i="' + i + '" role="radio" aria-checked="' + (sel ? "true" : "false") + '"' +
            (agot ? ' aria-disabled="true"' : ' tabindex="' + (sel ? "0" : "-1") + '"') + ">" +
            (o.badge ? '<span class="tiq-bdl__badge tiq-bdl__badge--' + FORMA_BADGE(bundle.diseno) + '">' + esc(o.badge) + "</span>" : "") +
            '<span class="tiq-bdl__radio" aria-hidden="true"></span>' +
            thumbHTML(o) +
            '<span class="tiq-bdl__main">' +
              '<span class="tiq-bdl__titulo">' + esc(o.titulo || (cant + " unidades")) +
                (etq ? ' <span class="tiq-bdl__etq">' + esc(etq) + "</span>" : "") +
              "</span>" +
              // UNA sola línea secundaria: agotado > subtítulo del merchant > ahorro
              // automático. Antes se apilaban subtítulo + ahorro (redundante con el pill).
              (agot
                ? '<span class="tiq-bdl__sub">' + esc(AV.oos_on && AV.oos_texto ? AV.oos_texto : "Agotado") + "</span>"
                : o.subtitulo
                  ? '<span class="tiq-bdl__sub">' + esc(o.subtitulo) + "</span>"
                  : (D.mostrar_ahorro && ahorro > 0 ? '<span class="tiq-bdl__ahorro">Ahorrás ' + fmt(ahorro) + "</span>" : "")) +
            "</span>" +
            '<span class="tiq-bdl__precio">' +
              '<span class="tiq-bdl__precio-now">' + fmt(total) + "</span>" +
              (ref > total ? '<span class="tiq-bdl__precio-old">' + fmt(ref) + "</span>" : "") +
              (AV.precio_por_unidad && cant > 1 ? '<span class="tiq-bdl__unit">' + fmt(puUnit) + " c/u</span>" : "") +
            "</span>" +
            addonsHTML(o) +
          "</label>"
        );
      }).join("");
      var oSel = bundle.ofertas[seleccion];
      totalSel = Math.round(pu * Math.max(1, Number(oSel.cantidad) || 1) * (1 - (Number(oSel.descuento) || 0) / 100));
    }

    raiz.innerHTML =
      (D.mostrar_encabezado !== false
        ? '<div class="tiq-bdl__head">' +
            (D.titulo ? '<div class="tiq-bdl__h1">' + esc(D.titulo) + "</div>" : "") +
            (D.subtitulo ? '<div class="tiq-bdl__h2">' + esc(D.subtitulo) + "</div>" : "") +
          "</div>"
        : "") +
      '<div class="tiq-bdl__cards"' + (esBxgy ? "" : ' role="radiogroup" aria-label="Elegí tu paquete"') + ">" + tarjetas + "</div>" +
      buyoptsHTML(totalSel) +
      (AV.pie_on && AV.pie_texto ? '<div class="tiq-bdl__foot">' + esc(AV.pie_texto) + "</div>" : "");

    if (!esBxgy) {
      var tarjs = [].slice.call(raiz.querySelectorAll(".tiq-bdl__card"));
      var elegibles = function () {
        var r = [];
        tarjs.forEach(function (c) {
          var idx = Number(c.dataset.i), o = bundle.ofertas[idx];
          if (o && o.activo !== false && !o.agotado) r.push(idx);
        });
        return r;
      };
      var elegir = function (idx) {
        seleccion = idx; pintar();
        var s = raiz.querySelector(".tiq-bdl__card.is-sel");
        if (s) s.focus();
      };
      tarjs.forEach(function (el) {
        el.addEventListener("click", function () {
          var o = bundle.ofertas[Number(el.dataset.i)];
          if (o && o.agotado) return; // agotado no es seleccionable
          seleccion = Number(el.dataset.i); pintar();
        });
        // Accesibilidad: navegación por flechas + Enter/Espacio (radiogroup).
        el.addEventListener("keydown", function (e) {
          var elig = elegibles(); if (!elig.length) return;
          var pos = elig.indexOf(Number(el.dataset.i));
          if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); elegir(elig[(pos + 1) % elig.length]); }
          else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); elegir(elig[(pos - 1 + elig.length) % elig.length]); }
          else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(Number(el.dataset.i)); }
        });
      });
    }
    // Opciones de compra (One-Time / Subscribe): alternan modoSub y re-pintan.
    [].slice.call(raiz.querySelectorAll(".tiq-bdl__buyopt")).forEach(function (el) {
      el.addEventListener("click", function () { modoSub = el.dataset.sub === "1"; pintar(); });
    });
    // El widget NO agrega al carrito: la compra la hace el botón del tema. Solo
    // sincroniza la cantidad y —si eligió suscripción— el selling_plan en el form.
    sincronizarCantidad();
    sincronizarSellingPlan();
  }

  // Pasa el selling_plan elegido al form del tema (compra única = vacío). Mismo
  // mecanismo que sincronizarCantidad: setea/crea un input oculto que /cart/add lee.
  function sincronizarSellingPlan() {
    try {
      var form = document.querySelector('form[action*="/cart/add"]');
      if (!form) return;
      var plan = planActual();
      var val = (haySub && modoSub && plan) ? String(plan.id).split("/").pop() : "";
      var inp = form.querySelector('input[name="selling_plan"]');
      if (!inp && val) { inp = document.createElement("input"); inp.type = "hidden"; inp.name = "selling_plan"; form.appendChild(inp); }
      if (inp && String(inp.value) !== val) {
        inp.value = val;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (e) { if (window.console) console.warn("[TiendaIQ Bundles] selling_plan", e); }
  }

  // "Ocultar widget de suscripción de terceros": best-effort, oculta selectores
  // conocidos de apps de suscripción para no duplicar. No universal (cada app usa
  // sus clases); puede requerir ajuste por tema.
  function ocultarTerceros() {
    if (!SUB.ocultar_terceros) return;
    try {
      var sels = document.querySelectorAll('.subscription-selector, .selling-plan-selector, .product-form__selling-plan, [data-selling-plan-group], .rc_option, .appstle_subscription_wrapper');
      [].slice.call(sels).forEach(function (el) { if (!raiz.contains(el)) el.style.display = "none"; });
    } catch (e) {}
  }

  // Refleja cantidadElegida() en el input de cantidad del form de producto. Si el
  // tema no tiene input visible, inyecta uno oculto para que /cart/add lo lea.
  function sincronizarCantidad() {
    try {
      var form = document.querySelector('form[action*="/cart/add"]');
      if (!form) return;
      var n = cantidadElegida();
      var inp = form.querySelector('input[name="quantity"], select[name="quantity"]');
      if (!inp) {
        inp = document.createElement("input");
        inp.type = "hidden";
        inp.name = "quantity";
        form.appendChild(inp);
      }
      if (String(inp.value) !== String(n)) {
        inp.value = n;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (e) { if (window.console) console.warn("[TiendaIQ Bundles] cantidad", e); }
  }

  // Busca el botón/zona de "Agregar al carrito" del tema. Primero los
  // selectores estándar de Dawn; si no, cualquier botón/enlace cuyo texto sea
  // "agregar al carrito" (temas custom tipo landing PagePilot/TiendaIQ).
  function buscarAncla() {
    var estandar =
      document.querySelector(".product-form__buttons") ||
      document.querySelector('form[action*="/cart/add"] button[name="add"]') ||
      document.querySelector('button[name="add"]') ||
      document.querySelector('form[action*="/cart/add"]');
    if (estandar) return estandar;

    var re = /(agregar|añadir|agrega)\s+al\s+carrito|add\s+to\s+cart|comprar\s+ahora/i;
    var cands = document.querySelectorAll('button, a[role="button"], input[type="submit"], [onclick]');
    for (var i = 0; i < cands.length; i++) {
      var t = (cands[i].textContent || cands[i].value || "").trim();
      if (t && re.test(t) && cands[i].offsetParent !== null) return cands[i];
    }
    return null;
  }

  // --- montar cerca del botón de compra del tema ---
  function montar() {
    if (document.querySelector(".tiq-bdl")) return true; // ya montado
    var ancla = buscarAncla();
    if (!ancla) return false;

    // El botón de compra es el DEL TEMA (no lo tocamos): el widget se monta
    // JUSTO ARRIBA y solo sincroniza la cantidad. Así no hay dos botones y la
    // compra sigue siendo la nativa de la página de producto.
    var cont =
      (ancla.classList && ancla.classList.contains("product-form__buttons"))
        ? ancla
        : (ancla.closest && (ancla.closest(".product-form__buttons") || ancla.closest('form[action*="/cart/add"]'))) || ancla;

    if (cont.parentNode) {
      // Por defecto va ARRIBA del botón; con avanzado.debajo_boton, justo abajo.
      cont.parentNode.insertBefore(raiz, AV.debajo_boton ? cont.nextSibling : cont);
    } else {
      ancla.insertBefore(raiz, ancla.firstChild);
    }
    pintar();
    ocultarTerceros();

    // Precio en vivo: si el tema cambia de variante, re-pintamos para reflejar el
    // precio/compare-at nuevo. Escuchamos el form (id oculto u opciones).
    if (AV.precio_en_vivo !== false) {
      var form = document.querySelector('form[action*="/cart/add"]');
      if (form) form.addEventListener("change", function (e) {
        var n = (e.target && e.target.name) || "";
        if (n === "id" || n.indexOf("options[") === 0) pintar();
      });
    }
    return true;
  }

  // En temas custom la página se renderiza por JS: el botón puede aparecer
  // después del DOMContentLoaded. Reintentamos con un observer (tope 8s).
  function intentarMontar() {
    if (montar()) return;
    if (typeof MutationObserver === "undefined") return;
    var obs = new MutationObserver(function () { if (montar()) obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 8000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", intentarMontar);
  } else {
    intentarMontar();
  }
  } // --- fin arrancar() ---

  // Bootstrap: config embebida → arrancar ya; si no, traerla por fetch (el
  // app embed deja la URL en window.TIENDAIQ_BUNDLES_SRC).
  if (window.TIENDAIQ_BUNDLES) {
    arrancar();
  } else if (window.TIENDAIQ_BUNDLES_SRC) {
    fetch(window.TIENDAIQ_BUNDLES_SRC, { credentials: "omit" })
      .then(function (r) { return r.json(); })
      .then(function (cfg) { window.TIENDAIQ_BUNDLES = cfg; arrancar(); })
      .catch(function (e) { if (window.console) console.warn("[TiendaIQ Bundles] config", e); });
  }
})();
