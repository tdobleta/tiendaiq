"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");
const { env } = require("../shopify");
const { TenantContext } = require("../src/tenancy/tenant-context");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");
const { createPageRepository } = require("../src/platform/postgres/page-repository");
const { createJobRepository } = require("../src/platform/postgres/job-repository");
const { createGenerationRepository } = require("../src/platform/postgres/generation-repository");
const { createInboxRepository } = require("../src/platform/postgres/inbox-repository");
const { verifyTenantIsolation } = require("../src/platform/postgres/verify-tenancy");
const { withTenantTransaction } = require("../src/platform/postgres/with-tenant-transaction");

const WEB_RUNTIME_ROLE = "tiendaiq_web_runtime";
const WORKER_RUNTIME_ROLE = "tiendaiq_worker_runtime";

async function main() {
  if (env.ALLOW_RLS_TEST !== "1") {
    throw new Error("Definí ALLOW_RLS_TEST=1 para autorizar la fila señuelo en staging");
  }
  const databaseUrl = env.TEST_DATABASE_URL || env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Falta TEST_DATABASE_URL o DATABASE_URL");
  const workerDatabaseUrl = env.TEST_WORKER_DATABASE_URL;
  if (!workerDatabaseUrl) throw new Error("Falta TEST_WORKER_DATABASE_URL");

  const webPool = createPostgresPool({
    databaseUrl,
    caCertificate: env.PG_CA_CERT,
    runtimeRole: WEB_RUNTIME_ROLE,
    Pool
  });
  const workerPool = createPostgresPool({
    databaseUrl: workerDatabaseUrl,
    caCertificate: env.PG_CA_CERT,
    runtimeRole: WORKER_RUNTIME_ROLE,
    Pool
  });
  const suffix = crypto.randomBytes(6).toString("hex");
  const tenantA = TenantContext.fromShopDomain(`rls-a-${suffix}.myshopify.com`, { source: "internal-job" });
  const tenantB = TenantContext.fromShopDomain(`rls-b-${suffix}.myshopify.com`, { source: "internal-job" });
  const pageId = `rls-${suffix}`;
  const appPageId = `app-rls-${suffix}`;
  const outboxId = crypto.randomUUID();
  const oauthState = crypto.randomBytes(16).toString("hex");
  const marker = { id: pageId, marker: suffix };
  const reservationId = crypto.randomUUID();
  let inserted = false;
  let tenantsInserted = false;
  let queuedJob = null;
  let generationPressureJob = null;
  let inboxEvent = null;
  let controlPlaneInserted = false;

  try {
    await verifyTenantIsolation(webPool);
    for (const tenant of [tenantA, tenantB]) {
      await withTenantTransaction(webPool, tenant, async (client) => {
        await client.query(
          `INSERT INTO control_plane.tenants (id, shop_domain) VALUES ($1, $1)
           ON CONFLICT (id) DO NOTHING`,
          [tenant.tenantId]
        );
        await client.query(
          `INSERT INTO public.tiendas (dominio, datos) VALUES ($1, $2)
           ON CONFLICT (dominio) DO UPDATE SET datos = EXCLUDED.datos`,
          [tenant.tenantId, { dominio: tenant.tenantId, marker: `${suffix}:${tenant.tenantId}` }]
        );
      });
    }
    tenantsInserted = true;

    const storeForB = await withTenantTransaction(webPool, tenantB, (client) =>
      client.query("SELECT dominio FROM public.tiendas WHERE dominio = $1", [tenantA.tenantId])
    );
    const tenantsForB = await withTenantTransaction(webPool, tenantB, (client) =>
      client.query("SELECT id FROM control_plane.tenants WHERE id = $1", [tenantA.tenantId])
    );
    const storesWithoutContext = await webPool.query("SELECT dominio FROM public.tiendas");
    const tenantsWithoutContext = await webPool.query("SELECT id FROM control_plane.tenants");
    if (storeForB.rows.length || tenantsForB.rows.length || storesWithoutContext.rows.length || tenantsWithoutContext.rows.length) {
      throw new Error("Fuga RLS: el registro de instalaciones quedo visible transversalmente");
    }

    await withTenantTransaction(webPool, tenantA, async (client) => {
      await client.query(
        `INSERT INTO app_data.pages (tenant_id, id, product_gid)
         VALUES ($1, $2, $3)`,
        [tenantA.tenantId, appPageId, "gid://shopify/Product/1"]
      );
      await client.query(
        `INSERT INTO control_plane.outbox_events (id, tenant_id, type, payload)
         VALUES ($1, $2, 'rls_probe', $3)`,
        [outboxId, tenantA.tenantId, { marker: suffix }]
      );
    });
    controlPlaneInserted = true;
    const appPageForB = await withTenantTransaction(webPool, tenantB, (client) =>
      client.query("SELECT id FROM app_data.pages WHERE id = $1", [appPageId])
    );
    const outboxForB = await withTenantTransaction(webPool, tenantB, (client) =>
      client.query("SELECT id FROM control_plane.outbox_events WHERE id = $1", [outboxId])
    );
    if (appPageForB.rows.length || outboxForB.rows.length) {
      throw new Error("Fuga RLS: tenant B pudo leer app_data u outbox de tenant A");
    }

    const oauthClient = await webPool.connect();
    try {
      await oauthClient.query("BEGIN");
      await oauthClient.query("SELECT set_config('app.oauth_state', $1, true)", [oauthState]);
      await oauthClient.query("SELECT set_config('app.oauth_shop', $1, true)", [tenantA.tenantId]);
      await oauthClient.query(
        "INSERT INTO public.estados_oauth (estado, tienda, vence) VALUES ($1, $2, now() + interval '5 minutes')",
        [oauthState, tenantA.tenantId]
      );
      await oauthClient.query("COMMIT");
    } finally {
      await oauthClient.query("ROLLBACK").catch(() => {});
      oauthClient.release();
    }
    const wrongOauthClient = await webPool.connect();
    try {
      await wrongOauthClient.query("BEGIN");
      await wrongOauthClient.query("SELECT set_config('app.oauth_state', $1, true)", [`wrong-${suffix}`]);
      const deleted = await wrongOauthClient.query(
        "DELETE FROM public.estados_oauth WHERE estado = $1",
        [oauthState]
      );
      if (deleted.rowCount) throw new Error("Fuga RLS: un state OAuth distinto consumio la instalacion");
      await wrongOauthClient.query("ROLLBACK");
    } finally {
      await wrongOauthClient.query("ROLLBACK").catch(() => {});
      wrongOauthClient.release();
    }
    const pages = createPageRepository(webPool);
    await pages.save(tenantA, pageId, marker);
    inserted = true;

    const visibleForA = await pages.findById(tenantA, pageId);
    const visibleForB = await pages.findById(tenantB, pageId);
    const visibleWithoutContext = await webPool.query(
      "SELECT datos FROM public.paginas WHERE id = $1",
      [pageId]
    );

    if (visibleForA?.marker !== suffix) throw new Error("Tenant A no pudo leer su fila señuelo");
    if (visibleForB !== null) throw new Error("Fuga RLS: tenant B pudo leer la fila de tenant A");
    if (visibleWithoutContext.rows.length) throw new Error("Fuga RLS: una consulta sin contexto pudo leer la fila");

    const jobs = createJobRepository(webPool);
    queuedJob = await jobs.enqueue(tenantA, {
      type: "rls-probe",
      payload: { marker: suffix },
      idempotencyKey: `rls:${suffix}`
    });
    await withTenantTransaction(webPool, tenantA, (client) => client.query(
      `INSERT INTO control_plane.usage_reservations
         (id, tenant_id, job_id, operation_type, idempotency_key, period)
       VALUES ($1, $2, $3, 'rls_probe', $4, $5)`,
      [reservationId, tenantA.tenantId, queuedJob.id, `rls:${suffix}`, new Date().toISOString().slice(0, 7)]
    ));

    if (await jobs.get(tenantB, queuedJob.id)) throw new Error("Fuga RLS: tenant B pudo leer el job de tenant A");
    const reservationForB = await withTenantTransaction(webPool, tenantB, (client) =>
      client.query("SELECT id FROM control_plane.usage_reservations WHERE id = $1", [reservationId])
    );
    const jobsWithoutContext = await webPool.query("SELECT id FROM control_plane.jobs WHERE id = $1", [queuedJob.id]);
    const usageWithoutContext = await webPool.query("SELECT id FROM control_plane.usage_reservations WHERE id = $1", [reservationId]);
    if (reservationForB.rows.length) throw new Error("Fuga RLS: tenant B pudo leer la reserva de tenant A");
    if (jobsWithoutContext.rows.length || usageWithoutContext.rows.length) {
      throw new Error("Fuga RLS: una consulta sin contexto pudo leer control_plane");
    }

    const spoofedWorker = await webPool.connect();
    try {
      await spoofedWorker.query("BEGIN");
      await spoofedWorker.query("SELECT set_config('app.worker_id', 'worker-falso', true)");
      const spoofed = await spoofedWorker.query("SELECT id FROM control_plane.jobs WHERE id = $1", [queuedJob.id]);
      if (spoofed.rows.length) throw new Error("Fuga RLS: web falsificó la capacidad del worker");
    } finally {
      await spoofedWorker.query("ROLLBACK").catch(() => {});
      spoofedWorker.release();
    }

    let ddlDenied = false;
    try {
      await webPool.query("ALTER TABLE public.paginas DISABLE ROW LEVEL SECURITY");
    } catch (error) {
      ddlDenied = /owner|permission|permiso|propietario/i.test(String(error.message));
    }
    if (!ddlDenied) throw new Error("El rol web pudo alterar la protección RLS");

    for (const [label, pool] of [["web", webPool], ["worker", workerPool]]) {
      let auditDenied = false;
      try {
        await pool.query("SELECT id FROM control_plane.compensation_recovery_audit LIMIT 1");
      } catch (error) {
        auditDenied = /permission|permiso/i.test(String(error.message));
      }
      if (!auditDenied) throw new Error(`El rol ${label} pudo leer la auditoria de recuperacion`);

      let recoveryDenied = false;
      try {
        await pool.query(
          "SELECT * FROM control_plane.requeue_compensation_dead_letter($1, $2, $3, $4, $5)",
          [crypto.randomUUID(), crypto.randomUUID(), "rls-probe", "Motivo de prueba de permisos runtime", "rls-probe"]
        );
      } catch (error) {
        recoveryDenied = /permission|permiso/i.test(String(error.message));
      }
      if (!recoveryDenied) throw new Error(`El rol ${label} pudo ejecutar recuperacion administrativa`);
    }

    const workerJobs = createJobRepository(workerPool);
    const claimed = await workerJobs.claim("rls-worker", 30);
    if (claimed?.id !== queuedJob.id) throw new Error("El rol worker no pudo reclamar el job");
    const queueStats = await workerJobs.stats("rls-worker-metrics");
    const probeStats = queueStats.find((item) => item.type === "rls-probe");
    if (!probeStats || probeStats.running < 1) throw new Error("El worker no pudo observar la capacidad de su cola");

    generationPressureJob = await jobs.enqueue(tenantA, {
      type: "generate-page",
      payload: { synthetic: true },
      idempotencyKey: `pressure:${suffix}`
    });
    const pressure = await webPool.query(
      "SELECT queued, running, oldest_queued_seconds FROM control_plane.generation_queue_pressure()"
    );
    if (Number(pressure.rows[0]?.queued || 0) < 1) {
      throw new Error("El rol web no pudo leer la presion agregada de generacion");
    }
    const generations = createGenerationRepository(webPool);
    await generations.enqueue(tenantB, {
      payload: { synthetic: true },
      idempotencyKey: `global-limit:${suffix}`,
      period: new Date().toISOString().slice(0, 7),
      limit: null,
      maxPending: 2,
      maxGlobalPending: 1
    }).then(
      () => { throw new Error("La admision global permitio superar el limite"); },
      (error) => {
        if (error.code !== "GENERATION_QUEUE_SATURATED") throw error;
      }
    );
    await generations.enqueue(tenantA, {
      payload: { synthetic: true },
      idempotencyKey: `tenant-limit:${suffix}`,
      period: new Date().toISOString().slice(0, 7),
      limit: null,
      maxPending: 1,
      maxGlobalPending: 120
    }).then(
      () => { throw new Error("La admision por tenant permitio superar el limite"); },
      (error) => {
        if (error.code !== "TENANT_GENERATION_LIMIT") throw error;
      }
    );

    const inbox = createInboxRepository(webPool);
    const workerInbox = createInboxRepository(workerPool);
    ({ event: inboxEvent } = await inbox.receive({
      id: crypto.randomUUID(),
      shopDomain: tenantA.shopDomain,
      topic: "customers/data_request",
      payloadHash: suffix,
      payload: { customer_ref: suffix },
      apiVersion: "2026-07"
    }));
    await workerInbox.recordPrivacy("rls-worker", {
      event: inboxEvent,
      type: "customers_data_request",
      tenantReference: tenantA.tenantId,
      subjectHash: suffix
    });
    const inboxForB = await withTenantTransaction(webPool, tenantB, (client) =>
      client.query("SELECT id FROM control_plane.inbox_events WHERE id = $1", [inboxEvent.id])
    );
    const privacyForB = await withTenantTransaction(webPool, tenantB, (client) =>
      client.query("SELECT id FROM control_plane.privacy_requests WHERE webhook_id = $1", [inboxEvent.id])
    );
    const inboxWithoutContext = await webPool.query("SELECT id FROM control_plane.inbox_events WHERE id = $1", [inboxEvent.id]);
    if (inboxForB.rows.length || privacyForB.rows.length || inboxWithoutContext.rows.length) {
      throw new Error("Fuga RLS: tenant B o una consulta sin contexto pudo leer el inbox");
    }

    console.log("  RLS, roles y admisión de cola verificados en registro, OAuth, app_data, jobs, outbox, inbox y privacidad");
  } finally {
    try {
      if (inserted) {
        await withTenantTransaction(webPool, tenantA, (client) =>
          client.query("DELETE FROM public.paginas WHERE tienda = $1 AND id = $2", [tenantA.tenantId, pageId])
        );
      }
      if (queuedJob) {
        await withTenantTransaction(webPool, tenantA, (client) =>
          client.query("DELETE FROM control_plane.usage_reservations WHERE tenant_id = $1 AND job_id = $2", [tenantA.tenantId, queuedJob.id])
        );
        await withTenantTransaction(webPool, tenantA, (client) =>
          client.query("DELETE FROM control_plane.jobs WHERE tenant_id = $1 AND id = $2", [tenantA.tenantId, queuedJob.id])
        );
      }
      if (generationPressureJob) {
        await withTenantTransaction(webPool, tenantA, (client) =>
          client.query("DELETE FROM control_plane.jobs WHERE tenant_id = $1 AND id = $2", [tenantA.tenantId, generationPressureJob.id])
        );
      }
      if (inboxEvent) {
        await withTenantTransaction(webPool, tenantA, (client) =>
          client.query("DELETE FROM control_plane.privacy_requests WHERE webhook_id = $1", [inboxEvent.id])
        );
        await withTenantTransaction(webPool, tenantA, (client) =>
          client.query("DELETE FROM control_plane.inbox_events WHERE id = $1", [inboxEvent.id])
        );
      }
      if (controlPlaneInserted) {
        await withTenantTransaction(webPool, tenantA, async (client) => {
          await client.query("DELETE FROM control_plane.outbox_events WHERE id = $1", [outboxId]);
          await client.query("DELETE FROM app_data.pages WHERE tenant_id = $1 AND id = $2", [tenantA.tenantId, appPageId]);
          await client.query("DELETE FROM public.estados_oauth WHERE estado = $1", [oauthState]);
        });
      }
      if (tenantsInserted) {
        for (const tenant of [tenantA, tenantB]) {
          await withTenantTransaction(webPool, tenant, async (client) => {
            await client.query("DELETE FROM public.tiendas WHERE dominio = $1", [tenant.tenantId]);
            await client.query("DELETE FROM control_plane.tenants WHERE id = $1", [tenant.tenantId]);
          });
        }
      }
    } finally {
      await Promise.all([webPool.end(), workerPool.end()]);
    }
  }
}

main().catch((error) => {
  console.error(`  prueba RLS fallida: ${error.message}`);
  process.exitCode = 1;
});
