(() => {
  "use strict";
  // The in-app preview has no Shopify Liquid context.  Keep only the current
  // preview document in that iframe's session storage, then restart once so
  // the exact storefront renderer is what the merchant sees in the app too.
  const previewMode = /[?&]app=1/.test(location.search);
  const previewKey = "piloto-pdp-01-preview";
  // Firma del contenido que ya está pintado en este iframe.
  //
  // El editor reenvía el documento en CADA `onload` del iframe
  // (app/app.js -> marco.onload -> repintarPreview). Sin esta comparación el
  // listener de abajo se dispara a sí mismo: carga -> el padre postea ->
  // location.reload() -> carga -> el padre postea -> ... El merchant sólo
  // alcanzaba a ver la primera imagen del hero antes de cada reinicio.
  //
  // Recargamos únicamente cuando el contenido cambió de verdad.
  const sign = (payload) => JSON.stringify([payload?.data?.piloto_pdp_01 ?? null, payload?.urls ?? {}]);
  let rendered = null;

  if (previewMode && !window.TIENDAIQ_DATA) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(previewKey) || "null");
      if (cached?.data) {
        rendered = sign(cached);
        window.TIENDAIQ_DATA = cached.data;
        window.TIENDAIQ_URLS = cached.urls || {};
        const source = cached.data?.piloto_pdp_01?.source_fields;
        window.TIENDAIQ_PRODUCT_TITLE = source?.title || "Vista previa";
        window.TIENDAIQ_VARIANTS = (source?.variants || []).map((variant) => ({ id: String(variant.id).split("/").pop(), adminId: variant.id, available: true, money: "" }));
      }
    } catch {}
  }

  if (previewMode) {
    window.addEventListener("message", (event) => {
      if (!event.data?.tiendaiq || !event.data?.data?.piloto_pdp_01) return;
      const incoming = sign(event.data);
      if (incoming === rendered) return;
      rendered = incoming;
      sessionStorage.setItem(previewKey, JSON.stringify({ data: event.data.data, urls: event.data.urls || {} }));
      location.reload();
    });
  }
  const data = window.TIENDAIQ_DATA;
  const documentData = data?.piloto_pdp_01;
  const root = document.getElementById("piloto-pdp-01");
  if (!root || !documentData?.content) return;
  const c = documentData.content;
  const e = documentData.evidence || {};
  const variants = Array.isArray(window.TIENDAIQ_VARIANTS) ? window.TIENDAIQ_VARIANTS : [];
  const urls = window.TIENDAIQ_URLS || {};
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[ch]));
  const image = (id) => urls[id] || "";
  const variantFor = (pack) => variants.find((variant) => variant.adminId === pack.variant_id) || null;
  const canBuyPack = (pack) => Boolean(pack?.variant?.available) && (!pack.variant.inventoryTracked || Number(pack.variant.inventoryQuantity) >= pack.quantity);
  const money = (variant, quantity) => {
    if (!variant?.money) return "";
    if (quantity === 1 || !Number.isFinite(Number(variant.price))) return variant.money;
    try {
      return new Intl.NumberFormat(document.documentElement.lang || undefined, {
        style: "currency", currency: variant.currency || window.Shopify?.currency?.active || "USD"
      }).format((Number(variant.price) * quantity) / 100);
    } catch { return variant.money; }
  };
  const packs = (c.offer?.packs || []).map((pack) => ({ ...pack, variant: variantFor(pack) })).filter((pack) => pack.variant);
  let active = packs.find(canBuyPack) || packs[0] || null;
  const gallery = [...new Set([c.media?.hero_media_id, ...(c.media?.gallery_media_ids || [])].filter((id) => image(id)))];
  const proof = e.testimonial?.text && e.testimonial?.author ? `<aside class="p01__proof"><q>${esc(e.testimonial.text)}</q><cite>— ${esc(e.testimonial.author)}</cite></aside>` : "";
  root.innerHTML = `<main class="p01"><div class="p01__wrap"><section class="p01__hero"><div class="p01__gallery"><img class="p01__main-image" data-main src="${esc(image(gallery[0]))}" alt=""><div class="p01__thumbs">${gallery.map((id, index) => `<button class="p01__thumb ${index === 0 ? "is-active" : ""}" type="button" data-image="${esc(id)}"><img src="${esc(image(id))}" alt=""></button>`).join("")}</div></div><div class="p01__summary">${e.rating ? `<div class="p01__rating"><span class="p01__stars" aria-label="${esc(e.rating.value)} de 5 estrellas">★★★★★</span><strong>${esc(e.rating.value)}/5 · ${esc(e.rating.count)} valoraciones</strong></div>` : ""}<h1>${esc(window.TIENDAIQ_PRODUCT_TITLE || "")}</h1><p class="p01__price" data-price></p><p class="p01__claim">${esc(c.hero.claim)}</p><ul class="p01__bullets">${(c.hero.bullets || []).map((bullet) => `<li>${esc(bullet)}</li>`).join("")}</ul><div class="p01__divider">${esc(c.offer.heading)}</div><div class="p01__packs">${packs.map((pack) => `<button type="button" class="p01__pack" data-pack="${esc(pack.id)}" ${canBuyPack(pack) ? "" : "disabled"}><span class="p01__pack-title">${esc(pack.label)}</span><span class="p01__pack-sub">${esc(pack.subtitle)}</span><span class="p01__pack-price">${esc(money(pack.variant, pack.quantity))}</span></button>`).join("")}</div><button class="p01__buy" type="button" data-buy>Agregar al carrito</button><p class="p01__safe">Compra procesada con Shopify</p></div></section></div><section class="p01__section"><div class="p01__wrap"><div class="p01__story">${image(c.media?.comparison_media_id) ? `<img class="p01__story-image" src="${esc(image(c.media.comparison_media_id))}" alt="">` : ""}<div><p class="p01__eyebrow">${esc(c.why.eyebrow)}</p><h2>${esc(c.why.heading)}</h2><p class="p01__body">${esc(c.why.body)}</p><ul class="p01__points">${(c.why.points || []).map((point) => `<li>${esc(point)}</li>`).join("")}</ul></div></div></div></section>${proof}<section class="p01__section p01__journey"><div class="p01__wrap"><div class="p01__center"><h2>${esc(c.timeline.heading)}</h2><p class="p01__body">${esc(c.timeline.intro)}</p></div><div class="p01__timeline">${(c.timeline.steps || []).map((step) => `<article class="p01__step"><span class="p01__step-label">${esc(step.label)}</span><h3>${esc(step.heading)}</h3><p>${esc(step.body)}</p></article>`).join("")}</div></div></section><section class="p01__section"><div class="p01__wrap"><div class="p01__faq"><h2>${esc(c.faq.heading)}</h2>${(c.faq.items || []).map((item) => `<details><summary>${esc(item.question)}</summary><p>${esc(item.answer)}</p></details>`).join("")}</div></div></section></main>`;
  const selected = () => active?.variant;
  const update = () => { root.querySelectorAll("[data-pack]").forEach((node) => node.classList.toggle("is-active", node.dataset.pack === active?.id)); const variant = selected(); root.querySelector("[data-price]").textContent = active ? money(variant, active.quantity) : ""; const buy = root.querySelector("[data-buy]"); const available = canBuyPack(active); buy.disabled = !available; buy.textContent = available ? "Agregar al carrito" : "Sin stock"; };
  root.querySelectorAll("[data-image]").forEach((button) => button.addEventListener("click", () => { root.querySelector("[data-main]").src = image(button.dataset.image); root.querySelectorAll("[data-image]").forEach((node) => node.classList.toggle("is-active", node === button)); }));
  root.querySelectorAll("[data-pack]").forEach((button) => button.addEventListener("click", () => { active = packs.find((pack) => pack.id === button.dataset.pack) || active; update(); }));
  root.querySelector("[data-buy]").addEventListener("click", async () => { const variant = selected(); if (!canBuyPack(active)) return; const button = root.querySelector("[data-buy]"); button.disabled = true; try { const response = await fetch("/cart/add.js", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ items: [{ id: Number(variant.id), quantity: active.quantity }] }) }); if (!response.ok) throw new Error("cart"); window.location.assign("/cart"); } catch { button.disabled = false; button.textContent = "No se pudo agregar. Probá otra vez"; } });
  update();
})();
