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

  var CFG = window.TIENDAIQ_BUNDLES;
  var PROD = window.TIENDAIQ_PRODUCTO;
  if (!CFG || !CFG.activo || !PROD || !Array.isArray(CFG.lista)) return;

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

  // --- dinero ---
  // product.price viene en centavos (entero). Formateamos con el money_format
  // de la tienda; si es raro, caemos a un formato simple.
  var formato = (PROD.moneda || "${{amount}}");
  function fmt(cents) {
    var n = Math.round(cents) / 100;
    var conComa = n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var conPunto = n.toFixed(2);
    var enteros = Math.round(n).toLocaleString("es-AR");
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
  function precioUnitario() {
    var input = document.querySelector('form[action*="/cart/add"] [name="id"], form[action*="/cart/add"] select[name="id"]');
    // Sin data de variante confiable en el DOM, usamos el precio de Liquid.
    return Number(PROD.precio) || 0;
  }

  function varianteActual() {
    var el = document.querySelector('form[action*="/cart/add"] [name="id"]');
    if (el && el.value) return el.value;
    return null;
  }

  // --- render ---
  var seleccion = 0;
  (bundle.ofertas || []).forEach(function (o, i) { if (o.predeterminada) seleccion = i; });

  var raiz = document.createElement("div");
  raiz.className = "tiq-bdl";
  raiz.style.setProperty("--tiq-borde", D.color_borde || "#111");
  raiz.style.setProperty("--tiq-badge", D.color_badge || "#111");
  raiz.style.setProperty("--tiq-badge-txt", D.color_badge_texto || "#fff");
  raiz.style.setProperty("--tiq-etq", D.color_etiqueta || "#e11d48");
  raiz.style.setProperty("--tiq-txt", D.color_texto || "#111");
  raiz.style.setProperty("--tiq-radio", (D.radio != null ? D.radio : 12) + "px");
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
          '<span class="tiq-bdl__badge">' + (gratis ? "Regalo" : "Oferta") + "</span>" +
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

  // Barra de progreso "te falta $X para el envío gratis". Se calcula contra el
  // total del pack elegido (lo que el cliente está por agregar). El envío
  // gratis real lo aplica el descuento nativo en el checkout.
  function barraEnvio(total) {
    var g = bundle.regalos;
    if (!g || !g.activo || g.tipo !== "envio") return "";
    var umbral = (Number(g.desde_subtotal) || 0) * 100;
    if (umbral <= 0) return "";
    var pct = Math.min(100, Math.round((total / umbral) * 100));
    var falta = Math.max(0, umbral - total);
    var ok = falta <= 0;
    var texto = ok
      ? (g.etiqueta || "🎁 Envío gratis") + " desbloqueado"
      : "Agregá " + fmt(falta) + " y sumás envío gratis";
    return (
      '<div class="tiq-bdl__envio' + (ok ? " is-ok" : "") + '">' +
        '<div class="tiq-bdl__envio-txt">' + esc(texto) + "</div>" +
        '<div class="tiq-bdl__envio-barra"><span style="width:' + pct + '%"></span></div>' +
      "</div>"
    );
  }

  function pintar() {
    var pu = precioUnitario();
    var tarjetas, totalSel;

    if (esBxgy) {
      var c = cardBxgy(pu);
      tarjetas = c.html;
      totalSel = c.total;
    } else {
      tarjetas = bundle.ofertas.map(function (o, i) {
        var cant = Math.max(1, Number(o.cantidad) || 1);
        var desc = Number(o.descuento) || 0;
        var bruto = pu * cant;
        var total = Math.round(bruto * (1 - desc / 100));
        var ahorro = bruto - total;
        var sel = i === seleccion;
        return (
          '<label class="tiq-bdl__card' + (sel ? " is-sel" : "") + (o.popular ? " is-pop" : "") + '" data-i="' + i + '">' +
            (o.badge ? '<span class="tiq-bdl__badge">' + esc(o.badge) + "</span>" : "") +
            '<span class="tiq-bdl__radio" aria-hidden="true"></span>' +
            '<span class="tiq-bdl__main">' +
              '<span class="tiq-bdl__titulo">' + esc(o.titulo || (cant + " unidades")) +
                (o.etiqueta ? ' <span class="tiq-bdl__etq">' + esc(o.etiqueta) + "</span>" : "") +
              "</span>" +
              (o.subtitulo ? '<span class="tiq-bdl__sub">' + esc(o.subtitulo) + "</span>" : "") +
              (D.mostrar_ahorro && ahorro > 0 ? '<span class="tiq-bdl__ahorro">Ahorrás ' + fmt(ahorro) + "</span>" : "") +
            "</span>" +
            '<span class="tiq-bdl__precio">' +
              '<span class="tiq-bdl__precio-now">' + fmt(total) + "</span>" +
              (desc > 0 ? '<span class="tiq-bdl__precio-old">' + fmt(bruto) + "</span>" : "") +
            "</span>" +
          "</label>"
        );
      }).join("");
      var oSel = bundle.ofertas[seleccion];
      totalSel = Math.round(pu * Math.max(1, Number(oSel.cantidad) || 1) * (1 - (Number(oSel.descuento) || 0) / 100));
    }

    var textoBoton = (BOT.texto || "Agregar al carrito — {total}").replace(/\{total\}/g, fmt(totalSel));

    raiz.innerHTML =
      (D.mostrar_encabezado !== false
        ? '<div class="tiq-bdl__head">' +
            (D.titulo ? '<div class="tiq-bdl__h1">' + esc(D.titulo) + "</div>" : "") +
            (D.subtitulo ? '<div class="tiq-bdl__h2">' + esc(D.subtitulo) + "</div>" : "") +
          "</div>"
        : "") +
      '<div class="tiq-bdl__cards">' + tarjetas + "</div>" +
      barraEnvio(totalSel) +
      '<button type="button" class="tiq-bdl__cta">' + esc(textoBoton) + "</button>";

    if (!esBxgy) {
      raiz.querySelectorAll(".tiq-bdl__card").forEach(function (el) {
        el.addEventListener("click", function () {
          seleccion = Number(el.dataset.i);
          pintar();
        });
      });
    }
    raiz.querySelector(".tiq-bdl__cta").addEventListener("click", agregar);
  }

  var enviando = false;
  function agregar() {
    if (enviando) return;
    var cant = cantidadElegida();
    var vid = varianteActual();
    if (!vid) { window.location.href = "/cart"; return; }

    enviando = true;
    var btn = raiz.querySelector(".tiq-bdl__cta");
    var txt = btn.textContent;
    btn.textContent = "Agregando…";
    btn.disabled = true;

    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: [{ id: Number(vid), quantity: cant }] })
    })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.description || "No se pudo agregar"); return j; }); })
      .then(function () { window.location.href = "/cart"; })
      .catch(function (e) {
        enviando = false;
        btn.disabled = false;
        btn.textContent = txt;
        console.warn("[TiendaIQ Bundles]", e);
        alert("No pudimos agregar el producto. Probá de nuevo.");
      });
  }

  // --- montar cerca del botón de compra del tema ---
  function montar() {
    var ancla =
      document.querySelector(".product-form__buttons") ||
      document.querySelector('form[action*="/cart/add"] button[name="add"]') ||
      document.querySelector('form[action*="/cart/add"]');
    if (!ancla) return false;

    // El widget toma la compra: ocultamos los botones nativos para no dejar
    // dos "Agregar al carrito". Si el ancla es el form entero, insertamos al
    // inicio y no ocultamos nada.
    if (ancla.classList && ancla.classList.contains("product-form__buttons")) {
      ancla.parentNode.insertBefore(raiz, ancla);
      ancla.style.display = "none";
    } else if (ancla.tagName === "BUTTON") {
      var cont = ancla.closest(".product-form__buttons") || ancla.parentNode;
      cont.parentNode.insertBefore(raiz, cont);
      cont.style.display = "none";
    } else {
      ancla.insertBefore(raiz, ancla.firstChild);
    }
    pintar();
    return true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar);
  } else {
    montar();
  }
})();
