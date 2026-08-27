(function () {
  "use strict";

  const TEMPLATE_ID = "tiendaiq/pinza-pagepilot@1";

  function text(root, selector, value) {
    const node = root.querySelector(selector);
    if (node && value != null && String(value).trim()) node.textContent = String(value);
  }

  function image(node, media, alt) {
    if (!node || !media?.url) return;
    node.src = media.url;
    node.alt = alt || "";
    node.removeAttribute("data-tiq-remote-asset");
  }

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function money(view) {
    if (view.product.money) return view.product.money;
    const amount = number(view.product.price);
    if (amount === null) return "";
    try {
      return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: view.product.currency || "ARS",
        maximumFractionDigits: 2
      }).format(amount);
    } catch {
      return `${view.product.currency || ""} ${amount}`.trim();
    }
  }

  function hide(root, selectors) {
    selectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((node) => { node.hidden = true; });
    });
  }

  function applyEvidenceGates(root, evidence) {
    if (!evidence.reviews) hide(root, [".rating-line", ".featured-review", ".reviews"]);
    if (!evidence.ugc) hide(root, [".ugc-title", ".ugc-row"]);
    if (!evidence.policies) hide(root, [".assurances", ".guarantee"]);
    if (!evidence.statistics) hide(root, [".problem"]);
    if (!evidence.logos) hide(root, [".logo-strip"]);
    if (!evidence.comparison) hide(root, [".comparison"]);
    // Payment methods must reflect the merchant's checkout configuration.
    // The source badges are not an authority for what a shop accepts.
    if (!evidence.payments) hide(root, [".payments"]);
  }

  function bindGallery(root, view) {
    const media = view.product.media || [];
    const main = root.querySelector("#mainImage");
    const thumbs = root.querySelector(".thumbs");
    const prev = root.querySelector(".gallery-arrow.prev");
    const next = root.querySelector(".gallery-arrow.next");
    if (!main || !thumbs || media.length === 0) {
      hide(root, [".gallery-main", ".thumbs"]);
      return;
    }

    let active = 0;
    const render = () => {
      image(main, media[active], view.product.title);
      thumbs.innerHTML = media.map((item, index) => `
        <button class="thumb${index === active ? " active" : ""}" type="button" data-tiq-media-index="${index}">
          <img src="${escapeText(item.url)}" alt="${escapeText(view.product.title)}" loading="lazy">
        </button>`).join("");
    };
    const select = (index) => {
      active = (index + media.length) % media.length;
      render();
    };
    thumbs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tiq-media-index]");
      if (button) select(Number(button.dataset.tiqMediaIndex));
    });
    prev?.addEventListener("click", () => select(active - 1));
    next?.addEventListener("click", () => select(active + 1));
    render();
  }

  function bindCopy(root, view) {
    const hero = view.content.hero || {};
    text(root, ".product-info h1", view.product.title);
    text(root, ".product-info .lead", view.product.description);
    text(root, ".price-row strong", money(view));

    const now = number(view.product.price);
    const before = number(view.product.compareAtPrice);
    const compare = root.querySelector(".price-row del");
    const savings = root.querySelector(".save-badge");
    if (before !== null && now !== null && before > now) {
      try {
        compare.textContent = new Intl.NumberFormat("es-AR", { style: "currency", currency: view.product.currency || "ARS" }).format(before);
      } catch { compare.textContent = String(before); }
      savings.textContent = `AHORRÁ ${Math.round((1 - now / before) * 100)}%`;
    } else {
      compare?.remove();
      savings?.remove();
    }

    const benefits = root.querySelector(".benefits");
    if (benefits && hero.bullets.length) {
      [...benefits.querySelectorAll(".benefit")].forEach((node, index) => {
        const value = hero.bullets[index];
        const content = typeof value === "string" ? value : (value?.fuerte || value?.resto || "");
        if (content) node.lastChild.textContent = content;
        else node.hidden = true;
      });
    }

    const timeline = view.content.timeline;
    if (timeline) {
      text(root, ".timeline .section-title", timeline.titular);
      text(root, ".timeline .section-copy", timeline.parrafo);
      const timelineImage = root.querySelector(".timeline-image img");
      const timelineMedia = (view.product.media || []).find((item) => item.id === timeline.imagen) || view.product.media?.[1];
      image(timelineImage, timelineMedia, timeline.titular);
    }

    const feature = view.content.feature;
    if (feature) {
      text(root, ".feature-copy h2", feature.titular);
      text(root, ".feature-copy > p", feature.parrafo || feature.subtitulo);
      const featureImage = root.querySelector(".feature-card img");
      const featureMedia = (view.product.media || []).find((item) => item.id === feature.imagen || item.id === feature.imagen_central) || view.product.media?.[0];
      image(featureImage, featureMedia, feature.titular);
    }

    const media = view.product.media || [];
    root.querySelectorAll(".feature-tile img, .step img, .guarantee-side img").forEach((node, index) => {
      image(node, media[index % Math.max(media.length, 1)], view.product.title);
    });

    const iconItems = Array.isArray(view.content.iconItems) ? view.content.iconItems : [];
    if (iconItems.length) {
      root.querySelectorAll(".feature-tile").forEach((node, index) => {
        const item = iconItems[index];
        if (!item) return node.remove();
        text(node, "h3", item.titulo);
        text(node, "p", item.frase);
      });
      root.querySelectorAll(".step").forEach((node, index) => {
        const item = iconItems[index];
        if (!item) return node.remove();
        text(node, "h3", item.titulo);
        text(node, "p", item.frase);
      });
    }

    const faq = view.content.faq;
    if (faq?.items?.length) {
      text(root, ".faq .section-title", faq.titular);
      const target = root.querySelector(".faq-list");
      if (target) {
        target.innerHTML = faq.items.map((item) => `<details><summary>${escapeText(item.pregunta)}</summary><p>${escapeText(item.respuesta)}</p></details>`).join("");
      }
    }

    if (!Array.isArray(view.content.recommendations) || view.content.recommendations.length === 0) {
      hide(root, [".recommended"]);
    }
  }

  function cartAction(host, view) {
    const variantId = view.product.variantId;
    return async (event) => {
      const button = event.target.closest(".cta");
      if (!button) return;
      event.preventDefault();
      if (!variantId) {
        host.dispatchEvent(new CustomEvent("tiendaiq:select-variant", { bubbles: true }));
        return;
      }
      try {
        const response = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] })
        });
        if (!response.ok) throw new Error(`cart/add.js ${response.status}`);
        host.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
        button.textContent = "✓ Agregado al carrito";
        setTimeout(() => { button.textContent = view.content.cta; }, 1800);
      } catch {
        window.location.assign(`/cart/${variantId}:1`);
      }
    };
  }

  function bind(root, view, host) {
    bindGallery(root, view);
    bindCopy(root, view);
    applyEvidenceGates(root, view.evidence || {});
    root.querySelectorAll(".cta").forEach((button) => { button.lastChild.textContent = view.content.cta; });
    root.addEventListener("click", cartAction(host, view));
    const sticky = root.querySelector("#stickyCart");
    if (sticky) window.addEventListener("scroll", () => sticky.classList.toggle("visible", window.scrollY > 680), { passive: true });
  }

  async function mount(host, { assetUrl, view }) {
    const response = await fetch(assetUrl, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`No se pudo cargar ${TEMPLATE_ID}`);
    const documentTemplate = new DOMParser().parseFromString(await response.text(), "text/html");
    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    shadow.replaceChildren();
    const hostStyle = document.createElement("style");
    hostStyle.textContent = `:host { --ink:#313131; --muted:#6a6a6a; --line:#dedede; --cream:#fff8df; --cream-2:#fff3c8; --yellow:#ffcd00; --orange:#d95c08; --dark:#343434; --blue:#1896ff; --shadow:0 16px 38px rgba(20,20,20,.08); --max:1180px; display:block; color:var(--ink); background:#fff; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.42; } :host *, :host *::before, :host *::after { box-sizing:border-box; } :host img, :host video { display:block; max-width:100%; } :host button, :host a { font:inherit; }`;
    shadow.append(hostStyle);
    for (const style of documentTemplate.head.querySelectorAll("style")) shadow.append(style.cloneNode(true));
    for (const node of documentTemplate.body.children) shadow.append(node.cloneNode(true));
    bind(shadow, view, host);
    host.dataset.tiqTemplate = TEMPLATE_ID;
    return shadow;
  }

  window.TiendaIQPinzaPagepilotV1 = Object.freeze({ mount, bind, TEMPLATE_ID });
})();
