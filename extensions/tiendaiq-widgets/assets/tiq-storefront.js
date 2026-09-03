// ============================================================
// TIQ STOREFRONT — hidrata un documento v1 ya publicado.
//
// El HTML de cada bloque lo produce TiqRender, exactamente igual que en el
// editor. Este archivo solo conecta interacciones nativas del navegador que no
// forman parte del árbol editorial: miniaturas de la galería, selección de
// packs y el contador de oferta.
// ============================================================

(function () {
  "use strict";

  const raiz = document.getElementById("tiq-documento");
  const documento = window.TIQ_DOCUMENTO;
  if (!raiz || !documento || !window.TiqRender?.render) return;

  const producto = window.TIQ_PRODUCTO || {};
  const urls = window.TIQ_URLS || {};

  function pintar() {
    try {
      const salida = window.TiqRender.render(documento, {
        modo: "tienda",
        producto,
        urls,
        carritoUrl: window.TIQ_CARRITO_URL || "/cart/add"
      });
      raiz.innerHTML = salida.html;
      let estilo = raiz.querySelector("style[data-tiq-responsive]");
      if (!estilo) {
        estilo = document.createElement("style");
        estilo.dataset.tiqResponsive = "";
        raiz.appendChild(estilo);
      }
      estilo.textContent = salida.css || "";
      conectarGaleria();
      conectarPacks();
      conectarCompra();
      conectarContadores();
    } catch (error) {
      // Una página publicada no debe romper el layout del tema por un bloque
      // inválido. El diagnóstico queda en consola para soporte, no para el
      // comprador.
      console.error("TiendaIQ: no se pudo dibujar el documento publicado", error);
    }
  }

  function conectarGaleria() {
    raiz.querySelectorAll("[data-tiq-galeria-mini]").forEach((miniaturas) => {
      const principal = miniaturas.parentElement?.querySelector("[data-tiq-galeria-principal]");
      if (!principal) return;
      miniaturas.querySelectorAll("[data-tiq-galeria-indice]").forEach((boton) => {
        boton.addEventListener("click", () => {
          const foto = boton.querySelector("img");
          const actual = principal.querySelector("img");
          if (!foto || !actual) return;
          actual.src = foto.currentSrc || foto.src;
          actual.removeAttribute("srcset");
          actual.alt = foto.alt || actual.alt;
          miniaturas.querySelectorAll("[aria-current]").forEach((otro) => otro.removeAttribute("aria-current"));
          boton.setAttribute("aria-current", "true");
        });
      });
    });
  }

  function conectarPacks() {
    raiz.querySelectorAll(".tiq-packs").forEach((packs) => {
      packs.addEventListener("change", (evento) => {
        const seleccionado = evento.target.closest("input[type=radio]");
        if (!seleccionado) return;
        packs.querySelectorAll(".tiq-pack").forEach((pack) => {
          pack.classList.toggle("es-activo", pack.contains(seleccionado));
        });
        const cantidad = seleccionado.value;
        raiz.querySelectorAll(".tiq-boton-carrito input[name=quantity]").forEach((entrada) => { entrada.value = cantidad; });
      });
    });
  }

  // Los controles de compra son primitivas independientes en el árbol, pero
  // todos escriben en el mismo formulario del CTA. Así el merchant puede
  // ordenar variante, cantidad y botón como una composición sin dejar un
  // selector decorativo que no llegue al carrito.
  function conectarCompra() {
    const formularios = raiz.querySelectorAll("[data-tiq-variante-form]");
    const variantes = raiz.querySelectorAll("[data-tiq-variante]");
    const cantidades = raiz.querySelectorAll("[data-tiq-cantidad]");
    const sincronizarVariante = (valor) => formularios.forEach((campo) => { campo.value = valor; });
    const sincronizarCantidad = (valor) => {
      const cantidad = Math.max(1, Math.min(99, Math.floor(Number(valor) || 1)));
      raiz.querySelectorAll("[data-tiq-cantidad-form]").forEach((campo) => { campo.value = String(cantidad); });
      cantidades.forEach((campo) => { if (campo.value !== String(cantidad)) campo.value = String(cantidad); });
    };
    variantes.forEach((select) => select.addEventListener("change", () => sincronizarVariante(select.value)));
    cantidades.forEach((campo) => {
      campo.addEventListener("input", () => sincronizarCantidad(campo.value));
      campo.addEventListener("change", () => sincronizarCantidad(campo.value));
    });
    const inicial = [...variantes].find((select) => select.value)?.value || producto.variante_id || producto.variant_id;
    if (inicial) sincronizarVariante(inicial);
    const cantidadInicial = [...cantidades].find((campo) => campo.value)?.value || 1;
    sincronizarCantidad(cantidadInicial);
  }

  function conectarContadores() {
    raiz.querySelectorAll("[data-tiq-contador]").forEach((contador) => {
      const minutos = Math.max(1, Number(contador.dataset.tiqMinutos) || 60);
      const final = Date.now() + minutos * 60 * 1000;
      let reloj = null;
      const actualizar = () => {
        const restante = Math.max(0, final - Date.now());
        const total = Math.floor(restante / 1000);
        contador.querySelector("[data-tiq-tiempo]")?.replaceChildren(document.createTextNode(
          `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
        ));
        if (restante <= 0) clearInterval(reloj);
      };
      actualizar();
      reloj = setInterval(actualizar, 1000);
    });
  }

  pintar();
}());
