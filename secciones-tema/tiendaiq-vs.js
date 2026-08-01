/* TiendaIQ · Video slider — comportamiento (autoplay muted, pausa/sonido,
   flechas, YouTube on-click). Compatible con el editor de temas: re-inicializa
   en shopify:section:load y hace foco al bloque en shopify:block:select.
   Lo escribe la app; no editar a mano. */
(function () {
  "use strict";

  function nav(vs, dir) {
    var track = vs.querySelector(".tiq-vs__track");
    if (!track) return;
    var card = track.querySelector(".tiq-vs__slide");
    var paso = card ? card.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
    track.scrollBy({ left: dir * paso, behavior: "smooth" });
  }

  function autoplay(vs) {
    var vids = vs.querySelectorAll("video.tiq-vs__vid");
    if (!vids.length || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { v.play && v.play().catch(function () {}); }
        else { v.pause && v.pause(); }
      });
    }, { threshold: 0.5 });
    vids.forEach(function (v) { io.observe(v); });
  }

  function video(btn) {
    var slide = btn.closest(".tiq-vs__slide");
    return slide ? slide.querySelector("video.tiq-vs__vid") : null;
  }
  function pausa(btn) {
    var v = video(btn); if (!v) return;
    if (v.paused) { v.play().catch(function () {}); btn.classList.add("is-play"); }
    else { v.pause(); btn.classList.remove("is-play"); }
  }
  function sonido(btn) {
    var v = video(btn); if (!v) return;
    v.muted = !v.muted;
    btn.classList.toggle("is-activo", !v.muted);
  }
  function ytplay(btn) {
    var cont = btn.closest(".tiq-vs__yt");
    if (!cont) return;
    var src = cont.getAttribute("data-embed");
    if (!src) return;
    cont.innerHTML = '<iframe src="' + src + '" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>';
  }

  function initVS(vs) {
    if (vs.__tiqInit) return;
    vs.__tiqInit = true;
    autoplay(vs);
  }
  function initAll(scope) {
    (scope || document).querySelectorAll(".tiq-vs").forEach(initVS);
  }

  document.addEventListener("click", function (e) {
    var t = e.target, b;
    if ((b = t.closest(".tiq-vs__flecha"))) { nav(b.closest(".tiq-vs"), b.classList.contains("tiq-vs__flecha--izq") ? -1 : 1); return; }
    if ((b = t.closest(".tiq-vs__cbtn--pausa"))) { pausa(b); return; }
    if ((b = t.closest(".tiq-vs__cbtn--sonido"))) { sonido(b); return; }
    if ((b = t.closest(".tiq-vs__ytplay"))) { ytplay(b); return; }
  });

  if (document.readyState !== "loading") initAll();
  else document.addEventListener("DOMContentLoaded", function () { initAll(); });

  document.addEventListener("shopify:section:load", function (e) {
    var vs = e.target.querySelector(".tiq-vs");
    if (vs) { vs.__tiqInit = false; initVS(vs); }
  });
  document.addEventListener("shopify:block:select", function (e) {
    var slide = e.target.closest ? e.target.closest(".tiq-vs__slide") : null;
    slide = slide || (e.target.querySelector && e.target.querySelector(".tiq-vs__slide"));
    if (slide && slide.scrollIntoView) slide.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  });
})();
