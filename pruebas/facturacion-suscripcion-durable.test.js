"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { montar } = require("./dobles");

const SESION = { tienda: "prueba.myshopify.com", token: "shpat_falso" };
const ACTIVA = {
  currentAppInstallation: {
    activeSubscriptions: [{
      id: "gid://shopify/AppSubscription/1",
      name: "TiendaIQ Pro",
      status: "ACTIVE",
      test: false
    }]
  }
};
const NINGUNA = { currentAppInstallation: { activeSubscriptions: [] } };

test("la ruta de suscripción usa una única intención activa por tenant", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(
    server,
    /ruta === "\/api\/plan\/suscribir"[\s\S]{0,900}encolarJobExclusivoDB\(sesion\.tenant, \{[\s\S]{0,240}type: "create-subscription"/
  );
});

test("consulta y normaliza solamente suscripciones activas", async () => {
  const { modulo } = montar("facturacion.js", {
    respuestas: [{
      currentAppInstallation: {
        activeSubscriptions: [
          ACTIVA.currentAppInstallation.activeSubscriptions[0],
          { id: "2", name: "vieja", status: "CANCELLED", test: true }
        ]
      }
    }]
  });

  assert.deepEqual(await modulo.consultarSuscripcionesActivas(SESION), [{
    id: "gid://shopify/AppSubscription/1",
    name: "TiendaIQ Pro",
    status: "ACTIVE",
    test: false
  }]);
});

test("no crea otro cargo cuando Shopify ya informa una suscripción activa", async () => {
  const { modulo, shopify } = montar("facturacion.js", { respuestas: [ACTIVA] });

  const result = await modulo.iniciarSuscripcion(SESION, "https://tiendaiq.example");

  assert.equal(result.status, "active");
  assert.equal(result.alreadyActive, true);
  assert.equal(result.confirmationUrl, null);
  assert.equal(result.subscription.id, "gid://shopify/AppSubscription/1");
  assert.equal(shopify.llamadas.length, 1);
  assert.match(shopify.llamadas[0].query, /activeSubscriptions/);
});

test("una suscripción activa ajena no resuelve la intención de TiendaIQ Pro", async () => {
  const { modulo, shopify } = montar("facturacion.js", {
    respuestas: [{
      currentAppInstallation: {
        activeSubscriptions: [{ id: "otro", name: "Plan legado", status: "ACTIVE", test: false }]
      }
    }, {
      appSubscriptionCreate: {
        appSubscription: { id: "pro", name: "TiendaIQ Pro", status: "PENDING", test: false },
        confirmationUrl: "https://shopify.example/confirm/pro",
        userErrors: []
      }
    }]
  });

  const result = await modulo.iniciarSuscripcion(SESION, "https://tiendaiq.example");

  assert.equal(result.status, "pending_confirmation");
  assert.equal(shopify.llamadas.filter((call) => /appSubscriptionCreate/.test(call.query)).length, 1);
});

test("una suscripción test no resuelve billing de producción", async () => {
  const { modulo } = montar("facturacion.js", {
    respuestas: [{
      currentAppInstallation: {
        activeSubscriptions: [{ id: "test", name: "TiendaIQ Pro", status: "ACTIVE", test: true }]
      }
    }]
  });

  assert.equal(await modulo.reconciliarSuscripcionActiva(SESION), null);
});

test("crea una sola vez y devuelve un resultado serializable con confirmationUrl", async () => {
  const { modulo, shopify } = montar("facturacion.js", {
    respuestas: [NINGUNA, {
      appSubscriptionCreate: {
        appSubscription: { id: "gid://shopify/AppSubscription/2", name: "TiendaIQ Pro", status: "PENDING", test: false },
        confirmationUrl: "https://shopify.example/confirm/2",
        userErrors: []
      }
    }]
  });

  const result = await modulo.iniciarSuscripcion(SESION, "https://tiendaiq.example");

  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(result.status, "pending_confirmation");
  assert.equal(result.confirmationUrl, "https://shopify.example/confirm/2");
  assert.equal(result.subscription.id, "gid://shopify/AppSubscription/2");
  assert.equal(shopify.llamadas.filter((call) => /appSubscriptionCreate/.test(call.query)).length, 1);
  assert.match(shopify.llamadas.find((call) => /appSubscriptionCreate/.test(call.query)).query, /appSubscription\s*\{\s*id name status test\s*\}/);
});

test("si la mutación fue ambigua pero ya aparece activa, reconcilia sin duplicar", async () => {
  const timeout = Object.assign(new Error("timeout"), { code: "SHOPIFY_TIMEOUT" });
  const { modulo, shopify } = montar("facturacion.js", {
    respuestas: [NINGUNA, timeout, ACTIVA]
  });

  const result = await modulo.iniciarSuscripcion(SESION, "https://tiendaiq.example");

  assert.equal(result.status, "active");
  assert.equal(result.reconciled, true);
  assert.equal(shopify.llamadas.length, 3);
  assert.equal(shopify.llamadas.filter((call) => /appSubscriptionCreate/.test(call.query)).length, 1);
});

test("si la mutación queda ambigua y no se puede reconciliar, falla terminal sin repetirla", async () => {
  const timeout = Object.assign(new Error("timeout"), { code: "SHOPIFY_TIMEOUT" });
  const { modulo, shopify } = montar("facturacion.js", {
    respuestas: [NINGUNA, timeout, NINGUNA]
  });

  await assert.rejects(
    () => modulo.iniciarSuscripcion(SESION, "https://tiendaiq.example"),
    (error) => error.code === "SHOPIFY_SUBSCRIPTION_AMBIGUOUS"
      && error.nonRetryable === true
      && error.ambiguous === true
      && error.skipCompensation === true
  );
  assert.equal(shopify.llamadas.filter((call) => /appSubscriptionCreate/.test(call.query)).length, 1);
});

test("un HTTP 408 después de enviar billing también se trata como ambiguo", async () => {
  const timeout = Object.assign(new Error("request timeout"), { status: 408 });
  const { modulo, shopify } = montar("facturacion.js", {
    respuestas: [NINGUNA, timeout, NINGUNA]
  });

  await assert.rejects(
    () => modulo.iniciarSuscripcion(SESION, "https://tiendaiq.example"),
    (error) => error.code === "SHOPIFY_SUBSCRIPTION_AMBIGUOUS" && error.nonRetryable === true
  );
  assert.equal(shopify.llamadas.filter((call) => /appSubscriptionCreate/.test(call.query)).length, 1);
});

test("un rechazo de negocio confirmado es terminal pero no ambiguo", async () => {
  const { modulo } = montar("facturacion.js", {
    respuestas: [NINGUNA, {
      appSubscriptionCreate: {
        confirmationUrl: null,
        userErrors: [{ field: ["lineItems"], message: "precio inválido" }]
      }
    }]
  });

  await assert.rejects(
    () => modulo.iniciarSuscripcion(SESION, "https://tiendaiq.example"),
    (error) => error.code === "SHOPIFY_SUBSCRIPTION_REJECTED"
      && error.nonRetryable === true
      && error.ambiguous !== true
  );
});

test("el export histórico crearSuscripcion continúa devolviendo una URL", async () => {
  const { modulo } = montar("facturacion.js", {
    respuestas: [{
      appSubscriptionCreate: {
        appSubscription: { id: "gid://shopify/AppSubscription/3" },
        confirmationUrl: "https://shopify.example/confirm/3",
        userErrors: []
      }
    }]
  });

  assert.equal(
    await modulo.crearSuscripcion(SESION, "https://tiendaiq.example"),
    "https://shopify.example/confirm/3"
  );
});
