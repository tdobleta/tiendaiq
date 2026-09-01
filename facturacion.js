// ============================================================
// FACTURACIÓN — plan gratis con cupo + plan pro por suscripción Shopify.
//
// Modelo: PAGINAS_GRATIS páginas por mes sin pagar. Al superar el cupo, el
// merchant suscribe el plan pro (Billing API de Shopify, cargo recurrente).
// El cobro lo hace Shopify en la factura del merchant: no hay pasarela propia.
//
// PLAN_TEST=1 crea cargos de PRUEBA (no facturan). Sin esa variable, los
// cargos son reales: producción cobra por defecto.
// ============================================================

const { gql, env } = require("./shopify");
const { leerTienda, actualizarCamposTienda, consumirCupoTienda, revertirCupoTienda } = require("./tiendas");
const { metrica } = require("./monitoreo");

const PAGINAS_GRATIS = Number(env.PAGINAS_GRATIS) || 3; // NaN/vacío → 3
const PLAN_NOMBRE = "TiendaIQ Pro";
const PLAN_PRECIO = Number(env.PLAN_PRECIO || 19.99);

// Tiendas con Pro de por vida, sin pasar por Billing (para probar sin cupo).
// SOLO desde env: sin default hardcodeado, para no regalar Pro a una tienda
// fija desde el código de producción.
const TIENDAS_PRO = (env.TIENDAS_PRO || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

// Cada cuánto re-preguntarle a Shopify si el "pro" cacheado sigue vivo. Sin
// esto, un merchant que cancela se queda con Pro para siempre.
const HORAS_REVALIDAR = 12;

const mesActual = () => new Date().toISOString().slice(0, 7); // "2026-07"

// ¿Tiene una suscripción activa en Shopify? (fuente de verdad)
async function suscripcionActiva(sesion) {
  const d = await gql(
    `{ currentAppInstallation { activeSubscriptions { name status test } } }`,
    {},
    sesion
  );
  return (d.currentAppInstallation?.activeSubscriptions || []).some(
    (s) => s.status === "ACTIVE"
  );
}

// Estado de plan para la UI y para el chequeo de cupo.
async function estadoPlan(sesion, { confirmar = false } = {}) {
  const t = (await leerTienda(sesion.tienda)) || {};
  const usadas = t.uso?.[mesActual()] || 0;

  // Cortesía por env: no pasa por Billing ni se revalida.
  if (TIENDAS_PRO.includes(sesion.tienda)) {
    return { plan: "pro", usadas, limite: null };
  }

  let plan = t.plan === "pro" ? "pro" : "gratis";
  // Escritura PARCIAL (solo plan/plan_verificado): no reescribe el registro
  // entero, así no pisa el contador `uso` ni el token (antes, escribir el plan
  // desde este GET podía "devolver" páginas gratis por lost update).
  const marcar = async (nuevo) => {
    plan = nuevo;
    await actualizarCamposTienda(sesion.tienda, { plan: nuevo, plan_verificado: new Date().toISOString() });
  };

  if (plan === "pro") {
    // El pro cacheado se revalida cada tanto contra Shopify (fuente de verdad):
    // si el merchant canceló, dejó de pagar o venció, baja a gratis.
    const ultima = t.plan_verificado ? Date.parse(t.plan_verificado) : 0;
    if (Date.now() - ultima > HORAS_REVALIDAR * 3600 * 1000) {
      await marcar((await suscripcionActiva(sesion)) ? "pro" : "gratis");
    }
  } else if (confirmar || usadas >= PAGINAS_GRATIS) {
    // Al límite: re-chequear por si suscribió recién.
    if (await suscripcionActiva(sesion)) {
      await marcar("pro");
      if (confirmar) metrica("suscripcion_confirmada", { tienda: sesion.tienda });
    }
  }

  return { plan, usadas, limite: plan === "pro" ? null : PAGINAS_GRATIS };
}

// Webhook app_subscriptions/update: Shopify avisa cuando cambia el estado de
// la suscripción (activa, cancelada, vencida, congelada). Es la vía rápida
// para bajar el plan; la revalidación de arriba es la red de seguridad.
async function actualizarPlanDesdeWebhook(tienda, payload) {
  const estado = payload?.app_subscription?.status;
  if (!estado) return null;
  const t = (await leerTienda(tienda)) || {};
  if (!t.token) return null;
  const plan = estado === "ACTIVE" ? "pro" : "gratis";
  await actualizarCamposTienda(tienda, { plan, plan_verificado: new Date().toISOString() });
  return plan;
}

// Se llama antes de generar: tira 402 si no le queda cupo.
async function exigirCupo(sesion) {
  const e = await estadoPlan(sesion);
  if (e.plan !== "pro" && e.usadas >= e.limite) {
    const err = new Error(
      `Usaste las ${e.limite} páginas gratis de este mes. Pasate a ${PLAN_NOMBRE} para generar sin límite.`
    );
    err.status = 402;
    err.actualizar = true;
    throw err;
  }
  return e;
}

// Reserva ATÓMICA una página del cupo ANTES de generar. Un solo UPDATE con
// chequeo+incremento bajo lock de fila → N requests concurrentes no se pasan del
// cupo. Tira 402 si no queda. Reemplaza a exigirCupo+contarUso (que eran
// read-modify-write no atómicos, y dejaban generar de más en ráfaga).
async function consumirCupo(sesion) {
  const e = await estadoPlan(sesion);
  // Pro = sin tope: cuenta el uso pero NUNCA tira 402 (aunque el incremento no
  // matchee por algún borde de datos, un pro no puede quedar sin cupo).
  if (e.plan === "pro") {
    await consumirCupoTienda(sesion.tienda, mesActual(), null);
    return { ...e, usadas: e.usadas + 1 };
  }
  const n = await consumirCupoTienda(sesion.tienda, mesActual(), PAGINAS_GRATIS);
  if (n === null) {
    // Mensaje con el número real (nunca "null"): usa la constante, no e.limite.
    const err = new Error(
      `Usaste las ${PAGINAS_GRATIS} páginas gratis de este mes. Pasate a ${PLAN_NOMBRE} para generar sin límite.`
    );
    err.status = 402;
    err.actualizar = true;
    throw err;
  }
  return { ...e, usadas: n };
}

// Devuelve la página reservada si la generación falló después (compensación).
async function revertirCupo(sesion) {
  await revertirCupoTienda(sesion.tienda, mesActual());
}

// Crea la suscripción y devuelve la URL de confirmación de Shopify.
async function crearSuscripcion(sesion, urlApp) {
  const handle = sesion.tienda.replace(".myshopify.com", "");
  const returnUrl = env.SHOPIFY_CLIENT_ID
    ? `https://admin.shopify.com/store/${handle}/apps/${env.SHOPIFY_CLIENT_ID}?plan=confirmado`
    : `${urlApp}/?plan=confirmado`;
  const d = await gql(
    `mutation($name: String!, $returnUrl: URL!, $test: Boolean!, $precio: Decimal!) {
      appSubscriptionCreate(
        name: $name, returnUrl: $returnUrl, test: $test,
        lineItems: [{ plan: { appRecurringPricingDetails: {
          price: { amount: $precio, currencyCode: USD }, interval: EVERY_30_DAYS
        }}}]
      ) { confirmationUrl userErrors { message } }
    }`,
    {
      name: PLAN_NOMBRE,
      returnUrl,
      // Cargo REAL por defecto. El de prueba (no factura) es opt-in explícito
      // con PLAN_TEST=1 — así producción nunca deja de cobrar por olvido.
      test: env.PLAN_TEST === "1",
      precio: PLAN_PRECIO
    },
    sesion
  );
  const r = d.appSubscriptionCreate;
  if (r.userErrors?.length) throw new Error("Suscripción: " + JSON.stringify(r.userErrors));
  // Intención de suscribirse (embudo). La confirmación de revenue —el merchant
  // aprueba y vuelve por ?plan=confirmado— se trackea aparte (follow-up).
  metrica("suscripcion_iniciada", { tienda: sesion.tienda, test: env.PLAN_TEST === "1" });
  return r.confirmationUrl;
}

module.exports = {
  estadoPlan, exigirCupo, consumirCupo, revertirCupo, crearSuscripcion, actualizarPlanDesdeWebhook,
  PAGINAS_GRATIS, PLAN_PRECIO, PLAN_NOMBRE, mesActual
};
