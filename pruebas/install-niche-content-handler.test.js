"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createInstallNicheContentHandler
} = require("../src/jobs/install-niche-content-handler");

const tenant = Object.freeze({ tenantId: "niche.myshopify.com" });

function job(overrides = {}) {
  return {
    id: "job-install-1",
    type: "install-niche-content",
    tenant,
    tenantId: tenant.tenantId,
    payload: {},
    ...overrides
  };
}

describe("InstallNicheContentHandler", () => {
  test("instala con la sesion tenant, propaga el signal y devuelve JSON durable", async () => {
    const controller = new AbortController();
    const session = { tienda: tenant.tenantId, token: "token" };
    const metricCalls = [];
    let received;
    const handler = createInstallNicheContentHandler({
      sessions: {
        async get(context) {
          assert.equal(context, tenant);
          return session;
        }
      },
      async install(receivedSession, options) {
        received = { receivedSession, options };
        return [
          { handle: "about", accion: "creada", omitted: undefined },
          { handle: "main-menu", accion: "menu-fallo", error: "scope ausente" }
        ];
      },
      metrics(name, properties) {
        metricCalls.push({ name, properties });
      }
    });

    const result = await handler.run(job(), { signal: controller.signal });

    assert.equal(received.receivedSession, session);
    assert.equal(received.options.signal, controller.signal);
    assert.deepEqual(result, {
      installed: true,
      actionCount: 2,
      warningCount: 1,
      actions: [
        { handle: "about", accion: "creada" },
        { handle: "main-menu", accion: "menu-fallo", error: "scope ausente" }
      ]
    });
    assert.doesNotThrow(() => JSON.stringify(result));
    assert.deepEqual(metricCalls, [{
      name: "contenido_nicho_instalado",
      properties: {
        tienda: tenant.tenantId,
        job_id: "job-install-1",
        acciones: 2,
        avisos: 1
      }
    }]);
  });

  test("un aborto previo no abre sesion ni ejecuta efectos Shopify", async () => {
    const controller = new AbortController();
    const reason = new Error("lease perdido");
    reason.code = "JOB_LEASE_LOST";
    controller.abort(reason);
    let sessionReads = 0;
    let installCalls = 0;
    const handler = createInstallNicheContentHandler({
      sessions: { async get() { sessionReads += 1; return {}; } },
      async install() { installCalls += 1; return []; }
    });

    await assert.rejects(handler.run(job(), { signal: controller.signal }), (error) => error === reason);
    assert.equal(sessionReads, 0);
    assert.equal(installCalls, 0);
  });

  test("un aborto durante el efecto prevalece sobre su resultado", async () => {
    const controller = new AbortController();
    const reason = new Error("apagado del worker");
    reason.code = "JOB_LEASE_LOST";
    const handler = createInstallNicheContentHandler({
      sessions: { async get() { return {}; } },
      async install() {
        controller.abort(reason);
        return [{ handle: "about", accion: "creada" }];
      }
    });

    await assert.rejects(handler.run(job(), { signal: controller.signal }), (error) => error === reason);
  });

  test("clasifica 4xx permanentes y conserva errores transitorios", async () => {
    const permanent = new Error("scope invalido");
    permanent.status = 403;
    const permanentHandler = createInstallNicheContentHandler({
      sessions: { async get() { return {}; } },
      async install() { throw permanent; }
    });

    await assert.rejects(
      permanentHandler.run(job()),
      (error) => error === permanent && error.nonRetryable === true && error.status === 403
    );

    const transient = new Error("limite temporal");
    transient.status = 429;
    transient.retryAfter = 17;
    const transientHandler = createInstallNicheContentHandler({
      sessions: { async get() { return {}; } },
      async install() { throw transient; }
    });

    await assert.rejects(
      transientHandler.run(job()),
      (error) => error === transient && error.nonRetryable !== true && error.retryAfter === 17
    );
  });

  test("rechaza jobs, sesiones y resultados que no pueden completarse", async (t) => {
    await t.test("job sin contexto tenant", async () => {
      const handler = createInstallNicheContentHandler({
        sessions: { async get() { throw new Error("no debe ejecutarse"); } }
      });
      await assert.rejects(
        handler.run(job({ tenant: null })),
        (error) => error.code === "INSTALL_NICHE_CONTENT_JOB_INVALID" && error.nonRetryable === true
      );
    });

    await t.test("sesion ausente", async () => {
      let installCalls = 0;
      const handler = createInstallNicheContentHandler({
        sessions: { async get() { return null; } },
        async install() { installCalls += 1; return []; }
      });
      await assert.rejects(
        handler.run(job()),
        (error) => error.code === "INSTALL_NICHE_CONTENT_SESSION_MISSING" && error.nonRetryable === true
      );
      assert.equal(installCalls, 0);
    });

    await t.test("resultado no serializable", async () => {
      const circular = [];
      circular.push(circular);
      const handler = createInstallNicheContentHandler({
        sessions: { async get() { return {}; } },
        async install() { return circular; }
      });
      await assert.rejects(
        handler.run(job()),
        (error) => error.code === "INSTALL_NICHE_CONTENT_RESULT_INVALID" && error.nonRetryable === true
      );
    });
  });
});
