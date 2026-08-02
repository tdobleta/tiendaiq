// ============================================================
// FACTURACIÓN — la lógica de plata.
//
//   node --test pruebas/
//
// Es el módulo donde un bug no rompe nada visible y sale caro: la app cobra de
// menos, cobra de más, o regala el plan pro. Ya pasó una vez — el cargo se
// creaba en modo prueba por defecto y la app nunca facturó hasta que se
// revisó a mano. Esa es la primera prueba de este archivo.
//
// Nada de esto toca Shopify ni la base: ver pruebas/dobles.js.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { montar } = require("./dobles");

const TIENDA = "prueba.myshopify.com";
const SESION = { tienda: TIENDA, token: "shpat_falso" };
const MES = new Date().toISOString().slice(0, 7);

// Respuestas típicas de Shopify a la consulta de suscripciones.
const CON_SUSCRIPCION = {
  currentAppInstallation: { activeSubscriptions: [{ name: "TiendaIQ Pro", status: "ACTIVE", test: false }] }
};
const SIN_SUSCRIPCION = { currentAppInstallation: { activeSubscriptions: [] } };
const SUSCRIPCION_CANCELADA = {
  currentAppInstallation: { activeSubscriptions: [{ name: "TiendaIQ Pro", status: "CANCELLED", test: false }] }
};

const hace = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();

describe("crearSuscripcion — el cargo tiene que ser real", () => {
  // Este es EL bug que ya se coló: `test` estaba en true salvo que una
  // variable dijera lo contrario, así que producción nunca cobró. La regla
  // correcta es al revés: real por defecto, prueba solo si se pide explícito.
  test("sin PLAN_TEST, el cargo es real (test: false)", async () => {
    const { modulo, shopify } = montar("facturacion.js", {
      env: {},
      respuestas: [{ appSubscriptionCreate: { confirmationUrl: "https://x/confirmar", userErrors: [] } }]
    });

    await modulo.crearSuscripcion(SESION, "https://tiendaiq.com");

    assert.equal(shopify.llamadas.length, 1);
    assert.equal(
      shopify.llamadas[0].variables.test,
      false,
      "el cargo salió en modo prueba: la app no le factura nada al merchant"
    );
  });

  test("con PLAN_TEST=1, el cargo es de prueba", async () => {
    const { modulo, shopify } = montar("facturacion.js", {
      env: { PLAN_TEST: "1" },
      respuestas: [{ appSubscriptionCreate: { confirmationUrl: "https://x/confirmar", userErrors: [] } }]
    });

    await modulo.crearSuscripcion(SESION, "https://tiendaiq.com");
    assert.equal(shopify.llamadas[0].variables.test, true);
  });

  test("PLAN_TEST con cualquier otro valor NO desactiva el cobro", async () => {
    // "0", "false", "true", "si" — solo el "1" exacto activa el modo prueba.
    for (const valor of ["0", "false", "true", "si", ""]) {
      const { modulo, shopify } = montar("facturacion.js", {
        env: { PLAN_TEST: valor },
        respuestas: [{ appSubscriptionCreate: { confirmationUrl: "https://x", userErrors: [] } }]
      });
      await modulo.crearSuscripcion(SESION, "https://tiendaiq.com");
      assert.equal(shopify.llamadas[0].variables.test, false, `PLAN_TEST="${valor}" apagó el cobro`);
    }
  });

  test("devuelve la URL de confirmación de Shopify", async () => {
    const { modulo } = montar("facturacion.js", {
      respuestas: [{ appSubscriptionCreate: { confirmationUrl: "https://shopify/confirmar/123", userErrors: [] } }]
    });
    assert.equal(await modulo.crearSuscripcion(SESION, "https://tiendaiq.com"), "https://shopify/confirmar/123");
  });

  test("si Shopify devuelve userErrors, revienta en vez de seguir", async () => {
    const { modulo } = montar("facturacion.js", {
      respuestas: [{ appSubscriptionCreate: { confirmationUrl: null, userErrors: [{ message: "plan inválido" }] } }]
    });
    await assert.rejects(() => modulo.crearSuscripcion(SESION, "https://tiendaiq.com"), /plan inválido/);
  });

  test("el precio y el nombre del plan viajan en la mutación", async () => {
    const { modulo, shopify } = montar("facturacion.js", {
      env: { PLAN_PRECIO: "29.99" },
      respuestas: [{ appSubscriptionCreate: { confirmationUrl: "https://x", userErrors: [] } }]
    });
    await modulo.crearSuscripcion(SESION, "https://tiendaiq.com");
    assert.equal(shopify.llamadas[0].variables.precio, 29.99);
    assert.equal(shopify.llamadas[0].variables.name, "TiendaIQ Pro");
  });
});

describe("estadoPlan — quién tiene pro y quién no", () => {
  test("una tienda nueva arranca en gratis con su cupo entero", async () => {
    const { modulo, shopify } = montar("facturacion.js", {
      env: { PAGINAS_GRATIS: "3" },
      tiendas: { [TIENDA]: { token: "t" } }
    });

    const e = await modulo.estadoPlan(SESION);
    assert.deepEqual(e, { plan: "gratis", usadas: 0, limite: 3 });
    assert.equal(shopify.llamadas.length, 0, "no hace falta preguntarle a Shopify por una tienda sin uso");
  });

  test("el pro recién verificado no se revalida (no gasta llamadas)", async () => {
    const { modulo, shopify } = montar("facturacion.js", {
      tiendas: { [TIENDA]: { token: "t", plan: "pro", plan_verificado: hace(1) } }
    });

    const e = await modulo.estadoPlan(SESION);
    assert.equal(e.plan, "pro");
    assert.equal(e.limite, null, "el pro no tiene tope");
    assert.equal(shopify.llamadas.length, 0);
  });

  test("el pro viejo se revalida y sobrevive si la suscripción sigue activa", async () => {
    const { modulo, shopify } = montar("facturacion.js", {
      tiendas: { [TIENDA]: { token: "t", plan: "pro", plan_verificado: hace(13) } },
      respuestas: [CON_SUSCRIPCION]
    });

    assert.equal((await modulo.estadoPlan(SESION)).plan, "pro");
    assert.equal(shopify.llamadas.length, 1);
  });

  // Este es el otro bug que ya se coló: el pro se cacheaba y no se revalidaba
  // nunca, así que quien cancelaba se quedaba con el plan pago para siempre.
  test("el pro viejo BAJA a gratis si ya no hay suscripción", async () => {
    const { modulo, tiendas } = montar("facturacion.js", {
      tiendas: { [TIENDA]: { token: "t", plan: "pro", plan_verificado: hace(13) } },
      respuestas: [SIN_SUSCRIPCION]
    });

    assert.equal((await modulo.estadoPlan(SESION)).plan, "gratis", "canceló y se quedó con el pro");
    assert.equal(tiendas._almacen[TIENDA].plan, "gratis", "el cambio tiene que quedar guardado");
  });

  test("una suscripción cancelada no cuenta como activa", async () => {
    const { modulo } = montar("facturacion.js", {
      tiendas: { [TIENDA]: { token: "t", plan: "pro", plan_verificado: hace(13) } },
      respuestas: [SUSCRIPCION_CANCELADA]
    });
    assert.equal((await modulo.estadoPlan(SESION)).plan, "gratis");
  });

  test("el que llegó al límite y acaba de suscribir sube a pro sin esperar", async () => {
    const { modulo } = montar("facturacion.js", {
      env: { PAGINAS_GRATIS: "3" },
      tiendas: { [TIENDA]: { token: "t", plan: "gratis", uso: { [MES]: 3 } } },
      respuestas: [CON_SUSCRIPCION]
    });

    assert.equal((await modulo.estadoPlan(SESION)).plan, "pro");
  });

  test("el que está en el límite y no suscribió sigue en gratis", async () => {
    const { modulo } = montar("facturacion.js", {
      env: { PAGINAS_GRATIS: "3" },
      tiendas: { [TIENDA]: { token: "t", plan: "gratis", uso: { [MES]: 3 } } },
      respuestas: [SIN_SUSCRIPCION]
    });
    assert.equal((await modulo.estadoPlan(SESION)).plan, "gratis");
  });

  test("TIENDAS_PRO da pro sin pasar por Shopify", async () => {
    const { modulo, shopify } = montar("facturacion.js", {
      env: { TIENDAS_PRO: `otra.myshopify.com, ${TIENDA}` },
      tiendas: { [TIENDA]: { token: "t" } }
    });

    const e = await modulo.estadoPlan(SESION);
    assert.equal(e.plan, "pro");
    assert.equal(e.limite, null);
    assert.equal(shopify.llamadas.length, 0);
  });

  test("TIENDAS_PRO vacío no le regala pro a nadie", async () => {
    // Hubo un default con la dev store hardcodeada. Sin la variable, nadie
    // tiene que quedar con pro de cortesía.
    const { modulo } = montar("facturacion.js", {
      env: { TIENDAS_PRO: "" },
      tiendas: { [TIENDA]: { token: "t" } }
    });
    assert.equal((await modulo.estadoPlan(SESION)).plan, "gratis");
  });

  test("el uso de meses anteriores no cuenta para el cupo de este mes", async () => {
    const { modulo } = montar("facturacion.js", {
      env: { PAGINAS_GRATIS: "3" },
      tiendas: { [TIENDA]: { token: "t", uso: { "2020-01": 99, [MES]: 1 } } }
    });
    assert.equal((await modulo.estadoPlan(SESION)).usadas, 1);
  });
});

describe("exigirCupo — el portero antes de generar", () => {
  test("deja pasar al que tiene cupo", async () => {
    const { modulo } = montar("facturacion.js", {
      env: { PAGINAS_GRATIS: "3" },
      tiendas: { [TIENDA]: { token: "t", uso: { [MES]: 2 } } }
    });
    assert.equal((await modulo.exigirCupo(SESION)).usadas, 2);
  });

  test("frena con 402 al que agotó el cupo", async () => {
    const { modulo } = montar("facturacion.js", {
      env: { PAGINAS_GRATIS: "3" },
      tiendas: { [TIENDA]: { token: "t", plan: "gratis", uso: { [MES]: 3 } } },
      respuestas: [SIN_SUSCRIPCION]
    });

    await assert.rejects(
      () => modulo.exigirCupo(SESION),
      (e) => {
        assert.equal(e.status, 402, "el frontend distingue el 402 para ofrecer la suscripción");
        assert.equal(e.actualizar, true);
        assert.match(e.message, /3 páginas gratis/);
        return true;
      }
    );
  });

  test("el pro nunca se queda sin cupo", async () => {
    const { modulo } = montar("facturacion.js", {
      env: { PAGINAS_GRATIS: "3" },
      tiendas: { [TIENDA]: { token: "t", plan: "pro", plan_verificado: hace(1), uso: { [MES]: 500 } } }
    });
    assert.equal((await modulo.exigirCupo(SESION)).plan, "pro");
  });
});

describe("consumirCupo — reserva ATÓMICA de cupo (sin regalar páginas)", () => {
  test("reserva una página: incrementa el uso del mes", async () => {
    const { modulo, tiendas } = montar("facturacion.js", {
      tiendas: { [TIENDA]: { token: "t", uso: { [MES]: 1 } } } // gratis, 1 < 3
    });
    const e = await modulo.consumirCupo(SESION);
    assert.equal(tiendas._almacen[TIENDA].uso[MES], 2);
    assert.equal(e.usadas, 2);
  });

  test("arranca el contador si el mes no existía", async () => {
    const { modulo, tiendas } = montar("facturacion.js", { tiendas: { [TIENDA]: { token: "t" } } });
    await modulo.consumirCupo(SESION);
    assert.equal(tiendas._almacen[TIENDA].uso[MES], 1);
  });

  test("tira 402 al límite y NO incrementa (no se pasa del cupo)", async () => {
    const { modulo, tiendas } = montar("facturacion.js", {
      tiendas: { [TIENDA]: { token: "t", uso: { [MES]: 3 } } }, // gratis, 3 >= 3
      respuestas: [SIN_SUSCRIPCION] // al límite, estadoPlan re-chequea la suscripción
    });
    await assert.rejects(() => modulo.consumirCupo(SESION), (err) => err.status === 402);
    assert.equal(tiendas._almacen[TIENDA].uso[MES], 3, "al límite no debe incrementar");
  });

  test("plan pro (cortesía por env): reserva SIN tope", async () => {
    const { modulo, tiendas } = montar("facturacion.js", {
      env: { TIENDAS_PRO: TIENDA },
      tiendas: { [TIENDA]: { token: "t", uso: { [MES]: 99 } } }
    });
    const e = await modulo.consumirCupo(SESION);
    assert.equal(e.plan, "pro");
    assert.equal(tiendas._almacen[TIENDA].uso[MES], 100);
  });

  test("no pisa el token ni el resto del registro", async () => {
    const { modulo, tiendas } = montar("facturacion.js", {
      env: { TIENDAS_PRO: TIENDA },
      tiendas: { [TIENDA]: { token: "shpat_importante", plan: "pro", cod: { activo: true } } }
    });
    await modulo.consumirCupo(SESION);
    const t = tiendas._almacen[TIENDA];
    assert.equal(t.token, "shpat_importante", "perder el token deja la tienda muerta");
    assert.deepEqual(t.cod, { activo: true });
  });

  test("revertirCupo devuelve la página reservada (si la generación falla)", async () => {
    const { modulo, tiendas } = montar("facturacion.js", {
      tiendas: { [TIENDA]: { token: "t", uso: { [MES]: 2 } } }
    });
    await modulo.revertirCupo(SESION);
    assert.equal(tiendas._almacen[TIENDA].uso[MES], 1);
  });
});

describe("actualizarPlanDesdeWebhook — la vía rápida cuando cambia el plan", () => {
  test("ACTIVE sube a pro", async () => {
    const { modulo, tiendas } = montar("facturacion.js", { tiendas: { [TIENDA]: { token: "t", plan: "gratis" } } });

    assert.equal(await modulo.actualizarPlanDesdeWebhook(TIENDA, { app_subscription: { status: "ACTIVE" } }), "pro");
    assert.equal(tiendas._almacen[TIENDA].plan, "pro");
  });

  test("cualquier estado que no sea ACTIVE baja a gratis", async () => {
    for (const estado of ["CANCELLED", "EXPIRED", "FROZEN", "DECLINED", "PENDING"]) {
      const { modulo } = montar("facturacion.js", {
        tiendas: { [TIENDA]: { token: "t", plan: "pro" } }
      });
      assert.equal(
        await modulo.actualizarPlanDesdeWebhook(TIENDA, { app_subscription: { status: estado } }),
        "gratis",
        `${estado} dejó el plan en pro`
      );
    }
  });

  test("un payload sin estado no toca nada", async () => {
    const { modulo, tiendas } = montar("facturacion.js", { tiendas: { [TIENDA]: { token: "t", plan: "pro" } } });

    assert.equal(await modulo.actualizarPlanDesdeWebhook(TIENDA, {}), null);
    assert.equal(tiendas._almacen[TIENDA].plan, "pro", "un webhook raro no puede degradar a nadie");
  });

  test("una tienda desconocida no crea un registro fantasma", async () => {
    const { modulo, tiendas } = montar("facturacion.js", { tiendas: {} });

    assert.equal(await modulo.actualizarPlanDesdeWebhook("nadie.myshopify.com", { app_subscription: { status: "ACTIVE" } }), null);
    assert.deepEqual(Object.keys(tiendas._almacen), []);
  });

  test("guarda la fecha de verificación para que la revalidación cuente desde ahora", async () => {
    const { modulo, tiendas } = montar("facturacion.js", { tiendas: { [TIENDA]: { token: "t" } } });

    await modulo.actualizarPlanDesdeWebhook(TIENDA, { app_subscription: { status: "ACTIVE" } });
    const t = tiendas._almacen[TIENDA];
    assert.ok(t.plan_verificado, "sin fecha, la próxima lectura revalida al pedo");
    assert.ok(Date.now() - Date.parse(t.plan_verificado) < 5000);
  });
});
