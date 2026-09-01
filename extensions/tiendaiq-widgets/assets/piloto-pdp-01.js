(function () {
  "use strict";
  var data = window.PILOTO_PDP01_DATA;
  var product = window.PILOTO_PDP01_PRODUCT;
  var root = document.getElementById("piloto-pdp01");
  if (!data || !product || !root) return;
  var c = data.content || {}, media = c.media || {}, offer = c.offer || {}, firstVariant = product.selectedVariant || product.variants[0];
  var esc = function (value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, function (character) { return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]; }); };
  var image = function (id) { return product.media[id] || ""; };
  var money = function (cents) { if (window.Shopify && typeof window.Shopify.formatMoney === "function") return window.Shopify.formatMoney(cents, product.moneyFormat); return new Intl.NumberFormat(undefined, { style:"currency", currency:product.currency || "USD" }).format((cents || 0) / 100); };
  var selected = firstVariant;
  var heroId = image(media.hero_media_id) ? media.hero_media_id : Object.keys(product.media)[0];
  var gallery = (media.gallery_media_ids || []).filter(function (id) { return image(id); });
  if (!gallery.includes(heroId)) gallery.unshift(heroId);
  var evidence = data.evidence || {};
  var rating = evidence.rating ? '<div class="p01-rating"><span class="p01-stars" aria-hidden="true">★★★★★</span><span>Valoración de <strong>' + esc(evidence.rating.count) + ' clientes</strong></span></div>' : '';
  var thumbs = gallery.map(function (id, index) { return '<button class="p01-thumb ' + (!index ? 'is-active' : '') + '" type="button" data-image="' + esc(id) + '"><img src="' + esc(image(id)) + '" alt="" loading="lazy"></button>'; }).join('');
  var bullets = (c.hero?.bullets || []).map(function (item) { return '<div class="p01-check"><i>✓</i><span>' + esc(item) + '</span></div>'; }).join('');
  function packVariant(pack) { return product.variants.find(function (candidate) { return candidate.adminId === pack.variant_id; }) || selected; }
  function packAvailable(pack) {
    var variant = packVariant(pack);
    return Boolean(variant && variant.available && (variant.inventoryQuantity == null || variant.inventoryQuantity >= pack.quantity));
  }
  var initialPackIndex = Math.max(0, (offer.packs || []).findIndex(packAvailable));
  var hasAvailablePack = (offer.packs || []).some(packAvailable);
  function packCard(pack, index) {
    // El contrato referencia GIDs de Admin API; el formulario de Shopify
    // necesita el ID numérico que Liquid expone para /cart/add.
    var variant = packVariant(pack);
    var available = packAvailable(pack);
    var isSelected = index === initialPackIndex && available;
    var mainImage = image(heroId);
    return '<article class="p01-pack ' + (isSelected ? 'is-selected' : '') + (!available ? ' is-disabled' : '') + '"><label class="p01-pack-head"><input type="radio" name="p01-pack" ' + (isSelected ? 'checked' : '') + (!available ? ' disabled' : '') + ' data-pack="' + esc(pack.id) + '"><img class="p01-product-thumb" src="' + esc(mainImage) + '" alt=""><span><span class="p01-pack-title">' + esc(pack.label) + (pack.badge ? '<em class="p01-pack-badge">' + esc(pack.badge) + '</em>' : '') + '</span><span class="p01-pack-sub">' + esc(available ? pack.subtitle : 'Sin stock suficiente') + '</span></span><span class="p01-pack-price">' + money((variant?.price || 0) * pack.quantity) + '</span></label><div class="p01-pack-line"><img src="' + esc(mainImage) + '" alt=""><b>Incluye ' + esc(pack.quantity) + ' unidad' + (pack.quantity === 1 ? '' : 'es') + ' del producto</b></div></article>';
  }
  var packs = (offer.packs || []).map(packCard).join('');
  var accordions = (offer.accordions || []).map(function (item) { return '<details><summary>' + esc(item.question) + '</summary><div class="p01-answer">' + esc(item.answer) + '</div></details>'; }).join('');
  var testimonial = evidence.testimonial ? '<article class="p01-trust"><div class="p01-avatar">✦</div><div><h2>' + esc(evidence.testimonial.author) + ' <span class="p01-stars">★★★★★</span></h2><p>“' + esc(evidence.testimonial.text) + '”</p></div></article>' : '';
  var guarantee = evidence.guarantee ? '<article class="p01-guarantee"><div class="p01-seal">✓</div><div><h2>' + esc(evidence.guarantee.heading) + '</h2><p>' + esc(evidence.guarantee.body) + '</p></div></article>' : '';
  var whyMedia = image(media.comparison_media_id);
  var why = c.why || {}, points = (why.points || []).map(function (point) { return '<div class="p01-point"><span class="p01-checkmark">✓</span><span>' + esc(point) + '</span></div>'; }).join('');
  var timeline = c.timeline || {}, steps = (timeline.steps || []).map(function (step) { return '<article class="p01-step"><span class="p01-dot"></span><div><span class="p01-step-label">' + esc(step.label) + '</span><h3>' + esc(step.heading) + '</h3><p>' + esc(step.body) + '</p></div></article>'; }).join('');
  var faq = c.faq || {}, faqs = (faq.items || []).map(function (item) { return '<details><summary>' + esc(item.question) + '</summary><div class="p01-answer">' + esc(item.answer) + '</div></details>'; }).join('');
  var communityMedia = image(media.community_media_id);
  root.innerHTML = '<section class="piloto-pdp01" aria-label="Comprar ' + esc(product.title) + '"><div class="p01-wrap"><div class="p01-grid"><div class="p01-gallery"><div class="p01-stage"><img class="p01-main" src="' + esc(image(heroId)) + '" alt="' + esc(product.title) + '">' + (c.hero?.quote ? '<div class="p01-quote">“' + esc(c.hero.quote.text) + '”<b>— ' + esc(c.hero.quote.attribution) + '</b></div>' : '') + '<div class="p01-benefits">' + (c.hero?.bullets || []).slice(0,3).map(function (item) { return '<div class="p01-benefit"><i>✓</i><span>' + esc(item) + '</span></div>'; }).join('') + '</div></div><div class="p01-thumbs">' + thumbs + '</div></div><div class="p01-panel">' + rating + '<h1>' + esc(product.title) + '</h1><div class="p01-price"><span class="p01-current-price">' + money(selected.price) + '</span></div><p class="p01-claim">' + esc(c.hero?.claim) + '</p><div class="p01-checks">' + bullets + '</div><div class="p01-divider">' + esc(offer.heading) + '</div><form class="p01-form" method="post" action="/cart/add"><input name="id" type="hidden" value="' + esc(selected.id) + '"><input name="quantity" type="hidden" value="1"><div class="p01-packs">' + packs + '</div><button class="p01-atc" type="submit"' + (hasAvailablePack ? '' : ' disabled aria-disabled="true"') + '>' + (hasAvailablePack ? 'Agregar al carrito' : 'Sin stock disponible') + '</button></form><p class="p01-live-note">Precio y disponibilidad actualizados desde Shopify.</p>' + testimonial + guarantee + (accordions ? '<div class="p01-details">' + accordions + '</div>' : '') + '</div></div></div><section class="p01-post"><section class="p01-section p01-why"><div class="p01-post-wrap p01-why-grid">' + (whyMedia ? '<div class="p01-media"><img src="' + esc(whyMedia) + '" alt=""></div>' : '') + '<div class="p01-why-copy"><p class="p01-kicker">' + esc(why.eyebrow) + '</p><h2>' + esc(why.heading) + '</h2><p>' + esc(why.body) + '</p><div class="p01-points">' + points + '</div></div></div></section><section class="p01-timeline"><div class="p01-post-wrap"><header class="p01-timeline-head"><h2>' + esc(timeline.heading) + '</h2><p>' + esc(timeline.intro) + '</p></header><div class="p01-steps">' + steps + '</div></div></section><section class="p01-section p01-faq"><div class="p01-post-wrap p01-faq-grid"><header class="p01-faq-intro"><p class="p01-kicker">Información clara</p><h2>' + esc(faq.heading) + '</h2></header><div class="p01-faq-list">' + faqs + '</div></div></section>' + (communityMedia ? '<section class="p01-section p01-community"><div class="p01-post-wrap p01-community-grid"><div class="p01-media p01-community-photo"><img src="' + esc(communityMedia) + '" alt=""></div><div class="p01-community-copy"><p class="p01-kicker">Elegí con información</p><h2>Una decisión <span>más clara</span></h2><p>' + esc(c.hero?.claim) + '</p></div></div></section>' : '') + '</section></section>';
  function currentPack() { return (offer.packs || []).find(function (pack) { return root.querySelector('[data-pack="' + CSS.escape(pack.id) + '"]')?.checked; }) || null; }
  root.querySelectorAll('.p01-thumb').forEach(function (button) { button.addEventListener('click', function () { root.querySelector('.p01-main').src = image(button.dataset.image); root.querySelectorAll('.p01-thumb').forEach(function (item) { item.classList.remove('is-active'); }); button.classList.add('is-active'); }); });
  root.querySelectorAll('[data-pack]').forEach(function (input) { input.addEventListener('change', function () { root.querySelectorAll('.p01-pack').forEach(function (card) { card.classList.remove('is-selected'); }); input.closest('.p01-pack').classList.add('is-selected'); var pack = currentPack(), variant = pack && packVariant(pack); if (!pack || !variant) return; root.querySelector('[name="id"]').value = variant.id; root.querySelector('[name="quantity"]').value = pack.quantity; root.querySelector('.p01-current-price').textContent = money(variant.price * pack.quantity); }); });
}());
