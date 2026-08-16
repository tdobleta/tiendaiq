"use strict";

const bundleCore = require("../../bundles");

function permanentError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.nonRetryable = true;
  return error;
}

function syncState(status, job, requestId, error = null) {
  return {
    status,
    job_id: job.id,
    request_id: requestId,
    error: error ? String(error.message || error).slice(0, 500) : null,
    updated_at: new Date().toISOString()
  };
}

function createSyncBundlesHandler({
  sessions,
  bundles = {
    read: bundleCore.leerConfigBundles,
    prepare: bundleCore.prepararConfigBundles,
    save: bundleCore.guardarConfigBundles,
    deleteDiscounts: bundleCore.borrarDescuentos,
    syncDiscounts: bundleCore.sincronizarDescuentos,
    snapshot: bundleCore.snapshotConfigBundles
  },
  metrics = () => {}
} = {}) {
  if (typeof sessions?.get !== "function") {
    throw new TypeError("El handler de bundles requiere sessions.get");
  }
  for (const method of ["read", "prepare", "save", "deleteDiscounts", "syncDiscounts", "snapshot"]) {
    if (typeof bundles?.[method] !== "function") {
      throw new TypeError(`El handler de bundles requiere bundles.${method}`);
    }
  }

  return Object.freeze({
    needsCompensation() {
      return false;
    },

    async run(job, { signal } = {}) {
      const requestId = String(job.payload?.requestId || "");
      const proposed = job.payload?.config;
      const expectedVersion = Number(job.payload?.expectedVersion);
      if (!job?.id || !job?.tenant || !requestId || !proposed) {
        throw permanentError("El job de bundles está incompleto", "BUNDLE_SYNC_JOB_INVALID");
      }

      const current = await bundles.read(job.tenantId);

      // Una segunda reclamación significa que el proceso anterior perdió su
      // lease o murió. La mutación de Shopify pudo ocurrir sin respuesta: no se
      // repite y se deja evidencia durable para reconciliación manual.
      if (Number(job.attempts || 0) > 1) {
        const config = current.sync?.request_id === requestId
          ? current
          : bundles.prepare(current, proposed);
        config.sync = syncState("manual_review", job, requestId, new Error("Ejecución anterior ambigua"));
        await bundles.save(job.tenantId, config);
        throw permanentError(
          "La sincronización anterior quedó ambigua; se requiere reconciliar descuentos antes de reintentar",
          "BUNDLE_SYNC_AMBIGUOUS_RECLAIM"
        );
      }

      if (!Number.isInteger(expectedVersion) || expectedVersion !== Math.max(0, Number(current.version) || 0)) {
        throw permanentError(
          "La configuración de bundles cambió antes de ejecutar el job",
          "BUNDLE_SYNC_VERSION_CONFLICT"
        );
      }

      const config = bundles.prepare(current, proposed);
      const session = await sessions.get(job.tenant);

      config.sync = syncState("running", job, requestId);
      await bundles.save(job.tenantId, config);

      let externalCompleted = false;
      try {
        if (signal?.aborted) throw signal.reason || new Error("Sincronización cancelada");
        const cleanup = await bundles.deleteDiscounts(
          session,
          config.pending_cleanup_ids,
          () => {},
          { signal }
        );
        config.pending_cleanup_ids = cleanup.fallidos;
        await bundles.syncDiscounts(session, config, () => {}, { signal });
        externalCompleted = true;
        config.applied = bundles.snapshot(config);
        config.applied_version = config.version;
        config.sync = syncState("succeeded", job, requestId);
        await bundles.save(job.tenantId, config);
        try {
          metrics("bundles_sincronizados", {
            tienda: job.tenantId,
            job_id: job.id,
            bundles: config.lista.length,
            limpieza_pendiente: config.pending_cleanup_ids.length
          });
        } catch {}
        return { config };
      } catch (cause) {
        const ambiguous = externalCompleted || cause?.ambiguous === true || cause?.code === "JOB_LEASE_LOST";
        config.sync = syncState(ambiguous ? "manual_review" : "failed", job, requestId, cause);
        await bundles.save(job.tenantId, config);
        const error = permanentError(
          ambiguous
            ? "Shopify no confirmó el resultado; se requiere reconciliación antes de reintentar"
            : cause.message,
          ambiguous ? "BUNDLE_SYNC_AMBIGUOUS" : (cause.code || "BUNDLE_SYNC_FAILED"),
          cause
        );
        error.ambiguous = ambiguous;
        throw error;
      }
    }
  });
}

module.exports = { createSyncBundlesHandler, permanentError, syncState };
