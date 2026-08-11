"use strict";

const os = require("os");
const {
  reclamarJobDB,
  renovarLeaseJobDB,
  completarJobDB,
  fallarJobDB,
  estadoColaDB,
  leerPaginaDB,
  guardarPaginaDB,
  leerReservaGeneracionDB,
  finalizarGeneracionDB,
  liberarReservaGeneracionDB,
  reclamarWebhookDB,
  completarWebhookDB,
  fallarWebhookDB,
  redactarInboxTiendaDB,
  registrarPrivacidadWebhookDB,
  depurarInboxDB
} = require("../../db");
const { sesionDe, borrarTienda } = require("../../tiendas");
const { actualizarPlanDesdeWebhook } = require("../../facturacion");
const { publicarPagina } = require("../../publicar");
const { crearPagina } = require("../../adaptador");
const { reportarError, metrica } = require("../../monitoreo");
const { createJobRunner } = require("./job-runner");
const { createPublishPageHandler } = require("./publish-page-handler");
const { createGeneratePageHandler } = require("./generate-page-handler");
const { createWebhookHandlers } = require("../webhooks/handlers");

function boundedInteger(value, fallback, min = 1, max = 32) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function createRuntime({
  workerId = `${os.hostname()}:${process.pid}`,
  generationConcurrency = boundedInteger(process.env.JOB_GENERATION_CONCURRENCY, 2),
  publicationConcurrency = boundedInteger(process.env.JOB_PUBLICATION_CONCURRENCY, 2),
  webhookConcurrency = boundedInteger(process.env.WEBHOOK_CONCURRENCY, 1),
  pollMs = boundedInteger(process.env.JOB_POLL_MS, 1000, 50, 60000),
  leaseSeconds = boundedInteger(process.env.JOB_LEASE_SECONDS, 300, 30, 3600)
} = {}) {
  const publishPage = createPublishPageHandler({
    sessions: { get: sesionDe },
    pages: {
      get: leerPaginaDB,
      async save(context, page) {
        page.actualizado = new Date().toISOString();
        await guardarPaginaDB(context, page.id, page);
        return page;
      }
    },
    publish: publicarPagina,
    metrics: metrica
  });
  const generatePage = createGeneratePageHandler({
    sessions: { get: sesionDe },
    generations: {
      getReservation: leerReservaGeneracionDB,
      finalize: finalizarGeneracionDB,
      release: liberarReservaGeneracionDB
    },
    pages: { get: leerPaginaDB },
    generate: crearPagina,
    metrics: metrica
  });

  const jobRepository = {
    claim: reclamarJobDB,
    renew: renovarLeaseJobDB,
    succeed: completarJobDB,
    fail: fallarJobDB
  };
  const generationRunners = Array.from({ length: generationConcurrency }, (_, index) => createJobRunner({
    workerId: `${workerId}:generate:${index + 1}`,
    jobTypes: ["generate-page"],
    leaseSeconds,
    pollMs,
    repository: jobRepository,
    handlers: { "generate-page": generatePage },
    reportError: reportarError,
    metrics: metrica
  }));
  const publicationRunners = Array.from({ length: publicationConcurrency }, (_, index) => createJobRunner({
    workerId: `${workerId}:publish:${index + 1}`,
    jobTypes: ["publish-page"],
    leaseSeconds,
    pollMs,
    repository: jobRepository,
    handlers: { "publish-page": publishPage },
    reportError: reportarError,
    metrics: metrica
  }));
  const webhookHandlers = createWebhookHandlers({
    stores: { delete: borrarTienda },
    billing: { update: actualizarPlanDesdeWebhook },
    inbox: {
      redactShop: redactarInboxTiendaDB,
      recordPrivacy: registrarPrivacidadWebhookDB
    },
    metrics: metrica
  });
  const webhookRunners = Array.from({ length: webhookConcurrency }, (_, index) => createJobRunner({
    workerId: `${workerId}:webhooks:${index + 1}`,
    leaseSeconds: 120,
    pollMs,
    repository: {
      claim: reclamarWebhookDB,
      succeed: completarWebhookDB,
      fail: fallarWebhookDB
    },
    handlers: webhookHandlers,
    reportError: reportarError,
    metrics: metrica
  }));
  const allRunners = [...generationRunners, ...publicationRunners, ...webhookRunners];

  let maintenanceTimer = null;
  let queueMetricsTimer = null;
  const maintenanceWorkerId = `${workerId}:maintenance`;
  async function maintainInbox() {
    try {
      const removed = await depurarInboxDB(maintenanceWorkerId);
      if (removed.processed || removed.privacy) metrica("inbox_depurado", removed);
    } catch (error) {
      reportarError(error, { tipo: "inbox-maintenance", workerId: maintenanceWorkerId });
    }
  }

  async function reportQueue() {
    try {
      const lanes = await estadoColaDB(`${workerId}:queue-metrics`);
      metrica("cola_estado", { worker_id: workerId, lanes });
    } catch (error) {
      reportarError(error, { tipo: "queue-metrics", workerId });
    }
  }

  return Object.freeze({
    start() {
      allRunners.forEach((runner) => runner.start());
      metrica("worker_capacidad", {
        worker_id: workerId,
        generaciones: generationConcurrency,
        publicaciones: publicationConcurrency,
        webhooks: webhookConcurrency
      });
      if (!maintenanceTimer) {
        maintenanceTimer = setInterval(maintainInbox, 6 * 60 * 60 * 1000);
        maintenanceTimer.unref?.();
      }
      if (!queueMetricsTimer) {
        queueMetricsTimer = setInterval(reportQueue, 60 * 1000);
        queueMetricsTimer.unref?.();
      }
    },
    async stop() {
      if (maintenanceTimer) clearInterval(maintenanceTimer);
      maintenanceTimer = null;
      if (queueMetricsTimer) clearInterval(queueMetricsTimer);
      queueMetricsTimer = null;
      await Promise.all(allRunners.map((runner) => runner.stop()));
    },
    async processJobsOnce() {
      for (const runner of [...generationRunners, ...publicationRunners]) {
        if (await runner.processOnce()) return true;
      }
      return false;
    },
    async processWebhooksOnce() {
      for (const runner of webhookRunners) {
        if (await runner.processOnce()) return true;
      }
      return false;
    }
  });
}

module.exports = { boundedInteger, createRuntime };
