"use strict";

const os = require("os");
const {
  reclamarJobDB,
  renovarLeaseJobDB,
  completarJobDB,
  fallarJobDB,
  reclamarCompensacionJobDB,
  renovarCompensacionJobDB,
  completarCompensacionJobDB,
  fallarCompensacionJobDB,
  estadoColaDB,
  leerPaginaDB,
  guardarPaginaDB,
  marcarPublicacionFallidaDB,
  checkpointAvatarPublicacionDB,
  completarPublicacionPaginaDB,
  completarDespublicacionPaginaDB,
  leerReservaGeneracionDB,
  finalizarGeneracionDB,
  liberarReservaGeneracionDB,
  reclamarWebhookDB,
  renovarLeaseWebhookDB,
  completarWebhookDB,
  fallarWebhookDB,
  redactarInboxTiendaDB,
  registrarPrivacidadWebhookDB,
  depurarInboxDB
} = require("../../db");
const { sesionDe, borrarTienda } = require("../../tiendas");
const billing = require("../../facturacion");
const { publicarPagina, despublicarPagina } = require("../../publicar");
const { crearPagina, editarTexto } = require("../../adaptador");
const { reportarError, metrica } = require("../../monitoreo");
const { createJobRunner } = require("./job-runner");
const { createCompensationRunner } = require("./compensation-runner");
const { createPublishPageHandler } = require("./publish-page-handler");
const { createUnpublishPageHandler } = require("./unpublish-page-handler");
const { createGeneratePageHandler } = require("./generate-page-handler");
const { createEditTextHandler } = require("./edit-text-handler");
const { createInstallNicheContentHandler } = require("./install-niche-content-handler");
const { createCreateSubscriptionHandler } = require("./create-subscription-handler");
const { createSyncBundlesHandler } = require("./sync-bundles-handler");
const { createWebhookHandlers } = require("../webhooks/handlers");

function boundedInteger(value, fallback, min = 1, max = 32) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function createRuntime({
  workerId = `${os.hostname()}:${process.pid}`,
  releaseSha = null,
  generationConcurrency = boundedInteger(process.env.JOB_GENERATION_CONCURRENCY, 2),
  publicationConcurrency = boundedInteger(process.env.JOB_PUBLICATION_CONCURRENCY, 2),
  webhookConcurrency = boundedInteger(process.env.WEBHOOK_CONCURRENCY, 1),
  pollMs = boundedInteger(process.env.JOB_POLL_MS, 1000, 50, 60000),
  leaseSeconds = boundedInteger(process.env.JOB_LEASE_SECONDS, 300, 30, 3600)
} = {}) {
  if (!/^[a-f0-9]{40}$/.test(String(releaseSha || ""))) {
    throw new TypeError("El runtime requiere releaseSha completo");
  }
  const publishPage = createPublishPageHandler({
    sessions: { get: sesionDe },
    pages: {
      get: leerPaginaDB,
      async save(context, page) {
        page.actualizado = new Date().toISOString();
        await guardarPaginaDB(context, page.id, page);
        return page;
      },
      checkpointAvatar: checkpointAvatarPublicacionDB,
      completePublication: completarPublicacionPaginaDB,
      markPublicationFailed: marcarPublicacionFallidaDB
    },
    publish: publicarPagina,
    metrics: metrica
  });
  const unpublishPage = createUnpublishPageHandler({
    sessions: { get: sesionDe },
    pages: {
      get: leerPaginaDB,
      completeUnpublication: completarDespublicacionPaginaDB,
      markPublicationFailed: marcarPublicacionFallidaDB
    },
    unpublish: despublicarPagina,
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
  const editText = createEditTextHandler({ edit: editarTexto, metrics: metrica });
  const installNicheContent = createInstallNicheContentHandler({
    sessions: { get: sesionDe },
    metrics: metrica
  });
  const createSubscription = createCreateSubscriptionHandler({
    sessions: { get: sesionDe },
    billing,
    metrics: metrica
  });
  const syncBundles = createSyncBundlesHandler({
    sessions: { get: sesionDe },
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
    releaseSha,
    jobTypes: ["generate-page", "edit-text"],
    leaseSeconds,
    pollMs,
    repository: jobRepository,
    handlers: { "generate-page": generatePage, "edit-text": editText },
    reportError: reportarError,
    metrics: metrica
  }));
  const publicationRunners = Array.from({ length: publicationConcurrency }, (_, index) => createJobRunner({
    workerId: `${workerId}:publish:${index + 1}`,
    releaseSha,
    jobTypes: ["publish-page", "unpublish-page", "install-niche-content", "create-subscription", "sync-bundles"],
    leaseSeconds,
    pollMs,
    repository: jobRepository,
    handlers: {
      "publish-page": publishPage,
      "unpublish-page": unpublishPage,
      "install-niche-content": installNicheContent,
      "create-subscription": createSubscription,
      "sync-bundles": syncBundles
    },
    reportError: reportarError,
    metrics: metrica
  }));
  const compensationRunner = createCompensationRunner({
    workerId: `${workerId}:compensate:1`,
    jobTypes: ["generate-page", "publish-page", "unpublish-page"],
    leaseSeconds,
    pollMs,
    repository: {
      claimCompensation: reclamarCompensacionJobDB,
      renewCompensation: renovarCompensacionJobDB,
      completeCompensation: completarCompensacionJobDB,
      failCompensation: fallarCompensacionJobDB
    },
    handlers: {
      "generate-page": generatePage,
      "publish-page": publishPage,
      "unpublish-page": unpublishPage
    },
    reportError: reportarError,
    metrics: metrica,
    maxAttempts: boundedInteger(process.env.JOB_COMPENSATION_MAX_ATTEMPTS, 8, 1, 100)
  });
  const webhookHandlers = createWebhookHandlers({
    stores: { delete: borrarTienda },
    billing: { update: billing.actualizarPlanDesdeWebhook },
    inbox: {
      redactShop: redactarInboxTiendaDB,
      recordPrivacy: registrarPrivacidadWebhookDB
    },
    metrics: metrica
  });
  const webhookRunners = Array.from({ length: webhookConcurrency }, (_, index) => createJobRunner({
    workerId: `${workerId}:webhooks:${index + 1}`,
    releaseSha,
    leaseSeconds: 120,
    pollMs,
    repository: {
      claim: reclamarWebhookDB,
      renew: renovarLeaseWebhookDB,
      succeed: completarWebhookDB,
      fail: fallarWebhookDB
    },
    handlers: webhookHandlers,
    reportError: reportarError,
    metrics: metrica
  }));
  const allRunners = [...generationRunners, ...publicationRunners, compensationRunner, ...webhookRunners];

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
      for (const runner of [...generationRunners, ...publicationRunners, compensationRunner]) {
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
