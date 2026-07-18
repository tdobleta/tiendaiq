// ============================================================
// FACTURACIÓN — plan gratis con cupo + plan pro por suscripción Shopify.
//
// Modelo: PAGINAS_GRATIS páginas por mes sin pagar. Al superar el cupo, el
// merchant suscribe el plan pro (Billing API de Shopify, cargo recurrente).
// El cobro lo hace Shopify en la factura del merchant: no hay pasarela propia.
//
// PLAN_TEST=1 crea cargos de prueba (no facturan). Apagar al lanzar en serio.
// ============================================================

const { gql, env } = require("./shopify");
const { leerTienda, guardarTienda } = require("./tiendas");

const PAGINAS_GRATIS = Number(env.PAGINAS_GRATIS || 3);
const PLAN_NOMBRE = "TiendaIQ Pro";
const PLAN_PRECIO = Number(env.PLAN_PRECIO || 19.99);

// Tiendas con Pro de por vida, sin pasar por Billing: la tienda dev, para
// probar sin cupo. Coma-separadas en env si algún día hay más.
const TIENDAS_PRO = (env.TIENDAS_PRO || "emfgq0-he.myshopify.com")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

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
async function estadoPlan(sesion) {
  const t = (await leerTienda(sesion.tienda)) || {};
  const usadas = t.uso?.[mesActual()] || 0;
  let plan =
    t.plan === "pro" || TIENDAS_PRO.includes(sesion.tienda) ? "pro" : "gratis";

  // Si está al límite, re-chequear en Shopify por si suscribió recién.
  if (plan !== "pro" && usadas >= PAGINAS_GRATIS) {
    if (await suscripcionActiva(sesion)) {
      plan = "pro";
      await guardarTienda(sesion.tienda, t.token, { ...t, plan: "pro" });
    }
  }
  return { plan, usadas, limite: plan === "pro" ? null : PAGINAS_GRATIS };
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

// Se llama después de generar con éxito.
async function contarUso(sesion) {
  const t = (await leerTienda(sesion.tienda)) || {};
  const uso = { ...(t.uso || {}) };
  uso[mesActual()] = (uso[mesActual()] || 0) + 1;
  await guardarTienda(sesion.tienda, t.token, { ...t, uso });
}

// Crea la suscripción y devuelve la URL de confirmación de Shopify.
async function crearSuscripcion(sesion, urlApp) {
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
      returnUrl: `${urlApp}/?plan=confirmado`,
      test: env.PLAN_TEST !== "0", // prueba por defecto hasta lanzar
      precio: PLAN_PRECIO
    },
    sesion
  );
  const r = d.appSubscriptionCreate;
  if (r.userErrors?.length) throw new Error("Suscripción: " + JSON.stringify(r.userErrors));
  return r.confirmationUrl;
}

module.exports = { estadoPlan, exigirCupo, contarUso, crearSuscripcion, PAGINAS_GRATIS, PLAN_PRECIO, PLAN_NOMBRE };
