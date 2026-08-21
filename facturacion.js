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
const { urlInicioAppShopify } = require("./shopify-admin-url");
const {
  createSubscriptionRecoveryDiagnostic,
  safeSubscriptionRecoveryDiagnostic
} = require("./src/jobs/subscription-recovery");

function configuracionPaginasGratis(value, { fallback = 3, permitirOverrideTemporal = false } = {}) {
  const presente = value !== undefined;
  const raw = String(value ?? "").trim();
  const parsed = Number(raw);
  // -1 es un interruptor temporal exclusivo de billing de prueba: fuerza el
  // upgrade aun con uso cero. Fuera de PLAN_TEST conserva el fail-closed.
  const valida = raw !== "" && Number.isInteger(parsed) && (
    parsed >= 0 || (permitirOverrideTemporal && parsed === -1)
  );
  return {
    limite: valida ? parsed : fallback,
    origen: valida ? "env" : "default",
    presente,
    valida
  };
}

function parsePaginasGratis(value, fallback = 3, opciones = {}) {
  return configuracionPaginasGratis(value, { fallback, ...opciones }).limite;
}

const CONFIGURACION_PAGINAS_GRATIS = configuracionPaginasGratis(env.PAGINAS_GRATIS, {
  permitirOverrideTemporal: env.PLAN_TEST === "1"
});
const PAGINAS_GRATIS = CONFIGURACION_PAGINAS_GRATIS.limite;
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

function suscripcionSerializable(suscripcion) {
  if (!suscripcion) return null;
  return {
    id: suscripcion.id ? String(suscripcion.id) : null,
    name: suscripcion.name ? String(suscripcion.name) : null,
    status: suscripcion.status ? String(suscripcion.status) : null,
    test: suscripcion.test === true
  };
}

// Shopify puede devolver varias suscripciones activas de la app. El acceso a
// TiendaIQ Pro no se concede por la mera presencia de "alguna" suscripcion:
// debe coincidir con el producto que vendemos y una suscripcion test nunca
// habilita el runtime de cobro real.
function esSuscripcionElegible(suscripcion) {
  if (!suscripcion || suscripcion.status !== "ACTIVE" || suscripcion.name !== PLAN_NOMBRE) {
    return false;
  }
  return suscripcion.test !== true || env.PLAN_TEST === "1";
}

async function suscripcionElegibleActiva(sesion, opciones) {
  return (await consultarSuscripcionesActivas(sesion, opciones))
    .find(esSuscripcionElegible) || null;
}

// Consulta autoritativa y reutilizable para iniciar o reconciliar billing.
async function consultarSuscripcionesActivas(sesion, { signal } = {}) {
  const d = await gql(
    `{ currentAppInstallation { activeSubscriptions { id name status test } } }`,
    {},
    sesion,
    { signal }
  );
  return (d.currentAppInstallation?.activeSubscriptions || [])
    .filter((suscripcion) => suscripcion?.status === "ACTIVE")
    .map(suscripcionSerializable);
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
  // Escritura PARCIAL: no reescribe el registro entero, así no pisa el contador
  // `uso` ni el token (antes, escribir el plan desde este GET podía "devolver"
  // páginas gratis por lost update).
  const marcar = async (nuevo, suscripcion = null) => {
    plan = nuevo;
    await actualizarCamposTienda(sesion.tienda, {
      plan: nuevo,
      plan_verificado: new Date().toISOString(),
      billing_subscription_id: suscripcion?.id || null,
      billing_subscription_name: suscripcion?.name || null,
      billing_subscription_test: suscripcion ? suscripcion.test === true : null
    });
  };

  if (plan === "pro") {
    // El pro cacheado se revalida cada tanto contra Shopify (fuente de verdad):
    // si el merchant canceló, dejó de pagar o venció, baja a gratis.
    const ultima = t.plan_verificado ? Date.parse(t.plan_verificado) : 0;
    if (Date.now() - ultima > HORAS_REVALIDAR * 3600 * 1000) {
      const suscripcion = await suscripcionElegibleActiva(sesion);
      await marcar(suscripcion ? "pro" : "gratis", suscripcion);
    }
  } else if (confirmar || usadas >= PAGINAS_GRATIS) {
    // Al límite: re-chequear por si suscribió recién.
    const suscripcion = await suscripcionElegibleActiva(sesion);
    if (suscripcion) {
      await marcar("pro", suscripcion);
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
  // El payload solo despierta la reconciliacion. No es prueba suficiente para
  // elevar ni degradar el plan: puede pertenecer a otra suscripcion o llegar
  // fuera de orden. currentAppInstallation es la fuente autoritativa.
  const suscripcion = await suscripcionElegibleActiva({ tienda, token: t.token });
  const plan = suscripcion ? "pro" : "gratis";
  await actualizarCamposTienda(tienda, {
    plan,
    plan_verificado: new Date().toISOString(),
    billing_subscription_id: suscripcion?.id || null,
    billing_subscription_name: suscripcion?.name || null,
    billing_subscription_test: suscripcion ? suscripcion.test === true : null
  });
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

function urlRetornoSuscripcion(sesion, urlApp) {
  return urlInicioAppShopify(sesion.tienda, {
    appHandle: env.SHOPIFY_APP_HANDLE,
    query: { plan: "confirmado" }
  });
}

function errorSuscripcionAmbigua(cause, reconciliationError, diagnostic = null) {
  const error = new Error(
    "Shopify pudo haber creado la suscripción, pero no confirmó el resultado; se requiere reconciliación antes de volver a intentar",
    cause ? { cause } : undefined
  );
  error.code = "SHOPIFY_SUBSCRIPTION_AMBIGUOUS";
  error.nonRetryable = true;
  error.ambiguous = true;
  error.skipCompensation = true;
  if (reconciliationError) error.reconciliationError = reconciliationError;
  const previous = safeSubscriptionRecoveryDiagnostic(diagnostic);
  error.safeDiagnostic = createSubscriptionRecoveryDiagnostic({
    mutationAttempted: previous?.mutationAttempted === true || cause != null,
    mutationResponseReceived: previous?.mutationResponseReceived === true,
    confirmationUrlPresent: previous?.confirmationUrlPresent === true,
    subscriptionIdPresent: previous?.subscriptionIdPresent === true,
    subscriptionStatus: previous?.subscriptionStatus,
    activeSubscriptionFound: false,
    reconciliationAttempted: previous?.reconciliationAttempted === true || reconciliationError != null,
    reconciliationFailed: reconciliationError != null
  });
  return error;
}

function isAmbiguousSubscriptionError(error, signal) {
  if (signal?.aborted) return true;
  if (error?.ambiguous === true || error?.code === "SHOPIFY_SUBSCRIPTION_AMBIGUOUS") return true;
  if (["SHOPIFY_TIMEOUT", "ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EPIPE", "UND_ERR_SOCKET"].includes(error?.code)) {
    return true;
  }
  if (["AbortError", "TimeoutError", "TypeError"].includes(error?.name)) return true;
  const status = Number(error?.status);
  if (Number.isFinite(status)) return status === 408 || status >= 500;
  // Un error GraphQL sin respuesta de negocio no permite demostrar que la
  // mutación no se ejecutó. Para billing, la opción segura es reconciliar.
  return error?.nonRetryable !== true;
}

async function reconciliarSuscripcionActiva(sesion, { signal, reconciled = false } = {}) {
  const subscription = await suscripcionElegibleActiva(sesion, { signal });
  if (!subscription) return null;
  return {
    status: "active",
    alreadyActive: true,
    reconciled: reconciled === true,
    confirmationUrl: null,
    subscription
  };
}

async function crearSuscripcionRemota(sesion, urlApp, { signal } = {}) {
  const returnUrl = urlRetornoSuscripcion(sesion, urlApp);
  const d = await gql(
    `mutation($name: String!, $returnUrl: URL!, $test: Boolean!, $precio: Decimal!) {
      appSubscriptionCreate(
        name: $name, returnUrl: $returnUrl, test: $test,
        lineItems: [{ plan: { appRecurringPricingDetails: {
          price: { amount: $precio, currencyCode: USD }, interval: EVERY_30_DAYS
        }}}]
      ) {
        appSubscription { id name status test }
        confirmationUrl
        userErrors { field message }
      }
    }`,
    {
      name: PLAN_NOMBRE,
      returnUrl,
      // Cargo REAL por defecto. El de prueba (no factura) es opt-in explícito
      // con PLAN_TEST=1 — así producción nunca deja de cobrar por olvido.
      test: env.PLAN_TEST === "1",
      precio: PLAN_PRECIO
    },
    sesion,
    { signal }
  );
  const r = d.appSubscriptionCreate;
  if (r?.userErrors?.length) {
    const error = new Error("Suscripción: " + JSON.stringify(r.userErrors));
    error.code = "SHOPIFY_SUBSCRIPTION_REJECTED";
    error.nonRetryable = true;
    throw error;
  }
  if (!r?.confirmationUrl) {
    throw errorSuscripcionAmbigua(null, null, createSubscriptionRecoveryDiagnostic({
      mutationAttempted: true,
      mutationResponseReceived: Boolean(r),
      confirmationUrlPresent: false,
      subscriptionIdPresent: Boolean(r?.appSubscription?.id),
      subscriptionStatus: r?.appSubscription?.status
    }));
  }
  // Intención de suscribirse (embudo). La confirmación de revenue —el merchant
  // aprueba y vuelve por ?plan=confirmado— se trackea aparte (follow-up).
  metrica("suscripcion_iniciada", { tienda: sesion.tienda, test: env.PLAN_TEST === "1" });
  return {
    status: "pending_confirmation",
    alreadyActive: false,
    reconciled: false,
    confirmationUrl: String(r.confirmationUrl),
    subscription: suscripcionSerializable(r.appSubscription)
  };
}

// Núcleo seguro para jobs durables. Antes de crear consulta la fuente de
// verdad; ante un resultado remoto incierto vuelve a consultar y, si no puede
// demostrar que ya está activo, queda terminal para revisión manual.
async function iniciarSuscripcion(sesion, urlApp, { signal } = {}) {
  const existente = await reconciliarSuscripcionActiva(sesion, { signal });
  if (existente) return existente;

  try {
    return await crearSuscripcionRemota(sesion, urlApp, { signal });
  } catch (error) {
    if (!isAmbiguousSubscriptionError(error, signal)) throw error;

    let reconciliada = null;
    let reconciliationError = null;
    try {
      reconciliada = await reconciliarSuscripcionActiva(sesion, { signal, reconciled: true });
    } catch (reconcileError) {
      reconciliationError = reconcileError;
    }
    if (reconciliada) return reconciliada;
    const previous = safeSubscriptionRecoveryDiagnostic(error?.safeDiagnostic);
    throw errorSuscripcionAmbigua(error, reconciliationError, createSubscriptionRecoveryDiagnostic({
      mutationAttempted: true,
      mutationResponseReceived: previous?.mutationResponseReceived === true,
      confirmationUrlPresent: previous?.confirmationUrlPresent === true,
      subscriptionIdPresent: previous?.subscriptionIdPresent === true,
      subscriptionStatus: previous?.subscriptionStatus,
      reconciliationAttempted: true,
      reconciliationFailed: reconciliationError != null
    }));
  }
}

// Export histórico: conserva el contrato de devolver una URL para las rutas
// existentes. La integración durable debe usar iniciarSuscripcion().
async function crearSuscripcion(sesion, urlApp, opciones) {
  const resultado = await crearSuscripcionRemota(sesion, urlApp, opciones);
  return resultado.confirmationUrl;
}

module.exports = {
  estadoPlan, exigirCupo, consumirCupo, revertirCupo, crearSuscripcion, actualizarPlanDesdeWebhook,
  consultarSuscripcionesActivas, crearSuscripcionRemota, errorSuscripcionAmbigua,
  iniciarSuscripcion, isAmbiguousSubscriptionError, reconciliarSuscripcionActiva,
  esSuscripcionElegible, suscripcionElegibleActiva,
  PAGINAS_GRATIS, PLAN_PRECIO, PLAN_NOMBRE, mesActual, parsePaginasGratis,
  configuracionPaginasGratis: CONFIGURACION_PAGINAS_GRATIS
};
