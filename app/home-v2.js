(function (global) {
  "use strict";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  const icons = {
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    pages: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    bundle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l9-4 9 4-9 4zM3 8v8l9 4 9-4V8M12 12v8"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16v5M16.5 18.5h5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    publish: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M4 20h16"/></svg>',
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>'
  };

  function statusLabel(status) {
    return status === "publicada" ? "Publicada" : "Borrador";
  }

  function mount({ root, data, actions }) {
    document.body.classList.add("tiq-v2-home-active");

    const recent = [...(data.pages || [])]
      .sort((a, b) => String(b.actualizado || "").localeCompare(String(a.actualizado || "")))
      .slice(0, 4);
    const usageText = data.isPro
      ? "Uso ilimitado"
      : `${data.used} de ${data.limit} generaciones usadas`;
    const nextAction = data.published > 0
      ? { title: "Optimizá otra página", text: "Elegí un producto y generá una nueva versión lista para revisar.", id: "v2-create" }
      : data.created > 0
        ? { title: "Publicá tu primera página", text: "Tu borrador ya existe. Revisalo y activalo en la tienda.", id: "v2-pages" }
        : { title: "Creá tu primera página", text: "Empezá con un producto real de tu catálogo.", id: "v2-create" };

    const recentMarkup = recent.length
      ? recent.map((page) => `
          <button class="tiq-v2-row" type="button" data-action="pages">
            <span class="tiq-v2-row__thumb">${page.imagen ? `<img src="${esc(page.imagen)}" alt="">` : icons.pages}</span>
            <span class="tiq-v2-row__copy">
              <strong>${esc(page.titulo || "Página sin título")}</strong>
              <small>${statusLabel(page.estado)}</small>
            </span>
            <span class="tiq-v2-row__arrow">${icons.arrow}</span>
          </button>`).join("")
      : `<div class="tiq-v2-empty"><span>${icons.pages}</span><p>Todavía no hay páginas. Tu primer producto puede estar listo para revisar hoy.</p></div>`;

    root.innerHTML = `
      <div class="tiq-v2-home">
        <section class="tiq-v2-hero" aria-labelledby="tiq-v2-title">
          <div class="tiq-v2-eyebrow"><span></span>TiendaIQ · workspace de crecimiento</div>
          <h1 id="tiq-v2-title">De producto a página publicada,<br><em>sin perder el control.</em></h1>
          <p>Generá, revisá y publicá experiencias de producto desde Shopify. La IA propone; vos aprobás lo que ve el cliente.</p>
          <div class="tiq-v2-actions">
            <button class="tiq-v2-button tiq-v2-button--primary" id="v2-create" type="button">${icons.spark}<span>Crear página con IA</span>${icons.arrow}</button>
            <button class="tiq-v2-button" id="v2-pages" type="button">${icons.pages}<span>Ver mis páginas</span></button>
          </div>
        </section>

        ${data.outOfQuota ? `
          <section class="tiq-v2-notice" aria-label="Límite del plan">
            <div><strong>Alcanzaste el límite del plan actual.</strong><span>Actualizá el plan para seguir generando páginas.</span></div>
            <button class="tiq-v2-button tiq-v2-button--small" id="v2-plan" type="button">Actualizar plan${icons.arrow}</button>
          </section>` : ""}

        <section class="tiq-v2-console" aria-label="Estado de TiendaIQ">
          <header class="tiq-v2-console__bar">
            <div class="tiq-v2-console__brand"><img src="/marca/iq.svg" alt="" width="22" height="22"><span>Control de tienda</span></div>
            <span class="tiq-v2-live"><i></i>Sincronizado con Shopify</span>
          </header>
          <div class="tiq-v2-metrics">
            <div><span>Páginas</span><strong>${data.created}</strong></div>
            <div><span>Publicadas</span><strong>${data.published}</strong></div>
            <div><span>Bundles activos</span><strong>${data.activeBundles}</strong></div>
            <div>
              <span>Plan</span>
              <strong>${esc(data.planName)}</strong>
              ${data.isPro ? "" : '<button class="tiq-v2-plan-link" type="button" data-action="plan">Actualizar plan</button>'}
            </div>
          </div>
          <div class="tiq-v2-console__main">
            <div class="tiq-v2-next">
              <span class="tiq-v2-label">Siguiente acción</span>
              <h2>${nextAction.title}</h2>
              <p>${nextAction.text}</p>
              <button class="tiq-v2-text-action" type="button" data-action="${nextAction.id === "v2-pages" ? "pages" : "create"}">Continuar${icons.arrow}</button>
            </div>
            <figure class="tiq-v2-product-shot">
              <img src="/portadas/portada-paginas.png" alt="Vista del generador de páginas de producto de TiendaIQ">
            </figure>
          </div>
          <footer class="tiq-v2-usage">
            <span>${usageText}</span>
            <div role="progressbar" aria-label="Uso mensual" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${data.usagePercent}"><i style="width:${data.usagePercent}%"></i></div>
          </footer>
        </section>

        <section class="tiq-v2-section" aria-labelledby="tiq-v2-tools-title">
          <div class="tiq-v2-section__head">
            <span class="tiq-v2-label">Herramientas</span>
            <h2 id="tiq-v2-tools-title">Dos flujos. Un solo lugar para operar.</h2>
            <p>La página atrae. El bundle mejora la oferta. Ambos se gestionan con datos reales de Shopify.</p>
          </div>
          <div class="tiq-v2-tools">
            <article class="tiq-v2-tool">
              <div class="tiq-v2-tool__copy"><span>${icons.pages}</span><h3>Páginas de producto con IA</h3><p>Copy, estructura y medios en un borrador editable. Nada se publica sin revisión.</p><button type="button" data-action="create">Crear página${icons.arrow}</button></div>
              <div class="tiq-v2-tool__media"><img src="/portadas/portada-paginas.png" alt="Generador de páginas de TiendaIQ" loading="lazy"></div>
            </article>
            <article class="tiq-v2-tool">
              <div class="tiq-v2-tool__copy"><span>${icons.bundle}</span><h3>Bundles y descuentos</h3><p>Configuraciones por volumen sincronizadas con descuentos reales de Shopify.</p><button type="button" data-action="bundles">Gestionar bundles${icons.arrow}</button></div>
              <div class="tiq-v2-bundle-demo" aria-hidden="true"><div><span>Comprá 1</span><strong>Precio normal</strong></div><div class="is-selected"><span>Comprá 2 <b>10% OFF</b></span><strong>Mejor opción</strong></div><div><span>Comprá 3 <b>15% OFF</b></span><strong>Más ahorro</strong></div></div>
            </article>
          </div>
        </section>

        <section class="tiq-v2-section tiq-v2-section--split" aria-labelledby="tiq-v2-edge-title">
          <div class="tiq-v2-section__head tiq-v2-section__head--left"><span class="tiq-v2-label">Arquitectura de confianza</span><h2 id="tiq-v2-edge-title">Velocidad para vender. Límites para no improvisar.</h2><p>Los controles críticos viven en el sistema, no en la memoria del equipo.</p></div>
          <div class="tiq-v2-capabilities">
            <article><span>${icons.shield}</span><div><h3>Aislamiento por tienda</h3><p>La identidad firmada de Shopify define el tenant de cada operación.</p></div></article>
            <article><span>${icons.spark}</span><div><h3>IA con revisión</h3><p>El contenido se genera como datos estructurados y queda en borrador.</p></div></article>
            <article><span>${icons.publish}</span><div><h3>Publicación reversible</h3><p>Theme app extension y metafields, sin escribir archivos del theme.</p></div></article>
          </div>
        </section>

        <section class="tiq-v2-operations" aria-labelledby="tiq-v2-operations-title">
          <div class="tiq-v2-recent"><div class="tiq-v2-panel-head"><div><span class="tiq-v2-label">Actividad</span><h2 id="tiq-v2-operations-title">Páginas recientes</h2></div><button type="button" data-action="pages">Ver todas${icons.arrow}</button></div>${recentMarkup}</div>
          <aside class="tiq-v2-help"><span class="tiq-v2-help__icon">${icons.video}</span><span class="tiq-v2-label">Aprender con ejemplos</span><h2>Estudiá anuncios que ya captaron atención.</h2><p>Usá la biblioteca como referencia creativa, no como fuente de afirmaciones.</p><button class="tiq-v2-button" type="button" data-action="inspiration">Ver inspiración${icons.arrow}</button></aside>
        </section>

        <footer class="tiq-v2-footer"><span>TiendaIQ opera dentro de Shopify.</span><nav><button type="button" data-action="support">Soporte${icons.external}</button><button type="button" data-action="legal">Privacidad y términos${icons.external}</button></nav></footer>
      </div>`;

    const actionMap = {
      create: actions.create,
      pages: actions.pages,
      bundles: actions.bundles,
      inspiration: actions.inspiration,
      plan: actions.plan,
      support: actions.support,
      legal: actions.legal
    };
    root.querySelectorAll("[data-action]").forEach((element) => {
      const action = actionMap[element.dataset.action];
      if (action) element.addEventListener("click", action);
    });
    root.querySelector("#v2-create")?.addEventListener("click", actions.create);
    root.querySelector("#v2-pages")?.addEventListener("click", actions.pages);
    root.querySelector("#v2-plan")?.addEventListener("click", actions.plan);
  }

  global.TiendaIQHomeV2 = Object.freeze({ mount });
})(window);
