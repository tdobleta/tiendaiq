(function (global) {
  "use strict";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const icon = {
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16v5M16.5 18.5h5"/></svg>',
    page: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    bundle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l9-4 9 4-9 4zM3 8v8l9 4 9-4V8M12 12v8"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.4a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.2.9-1.2 1.8M12 17h.01"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>'
  };
  const status = (value) => value === "publicada" ? "Publicada" : "Borrador";
  const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));

  function mount({ root, data, actions }) {
    const pages = [...(data.pages || [])].sort((a, b) => String(b.actualizado || "").localeCompare(String(a.actualizado || "")));
    const created = Number(data.created) || 0;
    const published = Number(data.published) || 0;
    const bundles = Number(data.activeBundles) || 0;
    const usage = clamp(data.usagePercent);
    const steps = [
      { done: created > 0, title: "Creá tu primera página con IA", text: "Elegí un producto real de tu catálogo.", action: "create" },
      { done: published > 0, title: "Publicá en la tienda", text: "Revisá el borrador antes de activarlo.", action: "pages" },
      { done: bundles > 0, title: "Armá un bundle", text: "Ofrecé más valor por volumen.", action: "bundles" }
    ];
    const done = steps.filter((item) => item.done).length;
    const setupPercent = Math.round(done * 100 / steps.length);
    const actionMap = { create: actions.create, pages: actions.pages, bundles: actions.bundles, inspiration: actions.inspiration, plan: actions.plan, support: actions.support, legal: actions.legal };
    const stepMarkup = steps.map((step, index) => `<button class="tiq-pp-step${step.done ? " is-done" : ""}${index === done && !step.done ? " is-current" : ""}" type="button" data-action="${step.action}"><span class="tiq-pp-step__mark">${step.done ? icon.check : ""}</span><span><strong>${step.title}</strong><small>${step.text}</small></span></button>`).join("");
    const milestoneMarkup = [
      [created > 0, "Primera página creada"], [published > 0, "Primera página publicada"], [bundles > 0, "Primer bundle activo"]
    ].map(([complete, label]) => `<div class="tiq-pp-milestone${complete ? " is-done" : ""}"><span></span><strong>${label}</strong><b>${complete ? "Listo" : "0/1"}</b></div>`).join("");
    const recent = pages.slice(0, 3);
    const pagesMarkup = recent.length ? `<div class="tiq-pp-page-list">${recent.map((page) => `<button type="button" class="tiq-pp-page" data-action="pages"><span class="tiq-pp-page__image">${page.imagen ? `<img src="${esc(page.imagen)}" alt="">` : icon.page}</span><span class="tiq-pp-page__copy"><strong>${esc(page.titulo || "Página sin título")}</strong><small>${status(page.estado)}</small></span><span class="tiq-pp-page__arrow">${icon.arrow}</span></button>`).join("")}</div>` : `<div class="tiq-pp-empty"><span>${icon.page}</span><strong>Todavía no hay páginas creadas</strong><p>Elegí un producto y generá la primera versión para revisarla.</p><button class="tiq-pp-button tiq-pp-button--dark" type="button" data-action="create">${icon.spark}Crear página de producto con IA</button></div>`;

    root.innerHTML = `<div class="tiq-pp-home">
      <header class="tiq-pp-header">
        <div class="tiq-pp-greeting"><h1>👋 Buenos días</h1><span class="tiq-pp-plan">${data.isPro ? "Pro" : "Inicial"}</span><p><i></i>Sincronizado con Shopify</p></div>
        <div class="tiq-pp-header-actions"><button class="tiq-pp-button" type="button" data-action="inspiration">${icon.play}Ver inspiración</button><button class="tiq-pp-button" type="button" data-action="pages">${icon.page}Ver mis páginas</button><button class="tiq-pp-button tiq-pp-button--dark" type="button" data-action="create">${icon.spark}Crear página de producto con IA</button></div>
      </header>
      <div class="tiq-pp-layout">
        <aside class="tiq-pp-rail">
          <section class="tiq-pp-card tiq-pp-onboarding"><header><h2>Primeros pasos</h2><b>${done} de ${steps.length} completados</b></header><div class="tiq-pp-progress-label"><span>Tus próximos pasos</span><strong>${setupPercent}%</strong></div><div class="tiq-pp-progress" role="progressbar" aria-label="Primeros pasos completados" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${setupPercent}"><i style="width:${setupPercent}%"></i></div><div class="tiq-pp-step-list">${stepMarkup}</div></section>
          <section class="tiq-pp-card tiq-pp-milestones"><header><h2>Hitos</h2><b>${done} de 3 completados</b></header><p>Se actualizan cuando tu tienda avanza.</p>${milestoneMarkup}</section>
          <section class="tiq-pp-card tiq-pp-plan-card"><span class="tiq-pp-plan-card__mark">${icon.spark}</span><h2>Tu plan TiendaIQ</h2><p>${data.isPro ? "Tenés acceso ilimitado a generaciones." : `${data.used} de ${data.limit} generaciones usadas este período.`}</p><div class="tiq-pp-usage"><i style="width:${usage}%"></i></div>${data.isPro ? "" : '<button type="button" data-action="plan">Ver opciones de plan' + icon.arrow + "</button>"}</section>
        </aside>
        <main class="tiq-pp-main">
          <section class="tiq-pp-performance" aria-label="Resumen de TiendaIQ"><div class="tiq-pp-performance__lead"><span>TiendaIQ en tu tienda</span><strong>${created}</strong><b>${created === 1 ? "página creada" : "páginas creadas"}</b></div><div class="tiq-pp-performance__numbers"><div><span>Páginas publicadas</span><strong>${published}</strong></div><div><span>Bundles activos</span><strong>${bundles}</strong></div><div><span>Uso del plan</span><strong>${data.isPro ? "Ilimitado" : `${usage}%`}</strong></div></div></section>
          <section class="tiq-pp-insights"><article class="tiq-pp-card tiq-pp-funnel"><header><h2>Flujo de publicación</h2><span>En tiempo real</span></header><div class="tiq-pp-funnel__art" aria-hidden="true"><i></i><i></i><i></i><b></b></div><strong>${created ? "Tu flujo ya está en marcha" : "Tu primer flujo empieza acá"}</strong><p>${created ? "Cada página queda en borrador hasta que la revisás y la publicás." : "Creá una página de producto con IA para empezar a revisarla."}</p><button type="button" data-action="${created ? "pages" : "create"}">${created ? "Ver mis páginas" : "Crear mi primera página"}${icon.arrow}</button></article><article class="tiq-pp-card tiq-pp-pages-card"><header><h2>Páginas de producto</h2><button type="button" data-action="pages">Ver todas</button></header>${pagesMarkup}</article></section>
          <section class="tiq-pp-callout"><div><span class="tiq-pp-callout__tag">LISTO PARA REVISAR</span><h2>Convertí tu próximo producto en una página clara y vendible.</h2><p>La IA propone la estructura y el copy. Vos mantenés la última decisión antes de publicar.</p><button class="tiq-pp-button tiq-pp-button--dark" type="button" data-action="create">${icon.spark}Crear página con IA</button></div><img src="/portadas/portada-paginas.png" alt="Editor de páginas de producto de TiendaIQ" loading="lazy"></section>
          <section class="tiq-pp-tools" aria-labelledby="tiq-pp-tools-title"><h2 id="tiq-pp-tools-title">Qué podés hacer con TiendaIQ</h2><div class="tiq-pp-tool-grid"><article class="tiq-pp-tool"><div class="tiq-pp-tool__media"><img src="/portadas/portada-paginas.png" alt="" loading="lazy"></div><h3>Páginas con IA</h3><p>Convertí un producto real en un borrador editable.</p><button type="button" data-action="create">Crear página${icon.arrow}</button></article><article class="tiq-pp-tool"><div class="tiq-pp-tool__media tiq-pp-tool__media--bundle"><span>${icon.bundle}</span><i>10% OFF</i><b>Bundles sincronizados</b></div><h3>Bundles y descuentos</h3><p>Armá ofertas por volumen que Shopify puede aplicar.</p><button type="button" data-action="bundles">Gestionar bundles${icon.arrow}</button></article><article class="tiq-pp-tool"><div class="tiq-pp-tool__media"><img src="/portadas/portada-tienda.png" alt="" loading="lazy"></div><h3>Inspiración</h3><p>Revisá ejemplos para orientar tu próxima página.</p><button type="button" data-action="inspiration">Ver inspiración${icon.arrow}</button></article></div></section>
          <footer class="tiq-pp-help"><article><span>${icon.page}</span><div><h3>¿Dónde sigo?</h3><p>Revisá las páginas que ya generaste.</p></div><button type="button" data-action="pages">Abrir páginas</button></article><article><span>${icon.help}</span><div><h3>¿Necesitás ayuda?</h3><p>Te respondemos por el canal de soporte.</p></div><button type="button" data-action="support">Contactar soporte</button></article><article><span>${icon.external}</span><div><h3>Privacidad y términos</h3><p>Conocé cómo opera TiendaIQ.</p></div><button type="button" data-action="legal">Ver información</button></article></footer>
        </main>
      </div>
    </div>`;
    root.querySelectorAll("[data-action]").forEach((element) => { const action = actionMap[element.dataset.action]; if (action) element.addEventListener("click", action); });
  }
  global.TiendaIQPagePilotHome = Object.freeze({ mount });
})(window);
