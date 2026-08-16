"use strict";

const { montarContenidoNicho } = require("../../contenido");

const NON_RETRYABLE_STATUSES = new Set([
  400, 401, 402, 403, 404, 405, 406, 410, 411, 413, 414, 415, 422
]);

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  throw signal.reason || new Error("Instalacion de contenido cancelada");
}

function permanentError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.nonRetryable = true;
  return error;
}

function classifyInstallError(value) {
  const error = value instanceof Error ? value : new Error(String(value));
  if (error.nonRetryable || !NON_RETRYABLE_STATUSES.has(Number(error.status))) return error;

  try {
    error.nonRetryable = true;
    return error;
  } catch {
    const classified = permanentError(error.message, error.code, error);
    classified.status = error.status;
    classified.retryAfter = error.retryAfter;
    return classified;
  }
}

function serializableActions(value) {
  if (!Array.isArray(value)) {
    throw permanentError(
      "La instalacion de contenido devolvio un resultado invalido",
      "INSTALL_NICHE_CONTENT_RESULT_INVALID"
    );
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (cause) {
    throw permanentError(
      "La instalacion de contenido devolvio un resultado no serializable",
      "INSTALL_NICHE_CONTENT_RESULT_INVALID",
      cause
    );
  }
}

function createInstallNicheContentHandler({
  sessions,
  install = montarContenidoNicho,
  metrics = () => {}
} = {}) {
  if (typeof sessions?.get !== "function") {
    throw new TypeError("El handler de contenido requiere sessions.get");
  }
  if (typeof install !== "function") {
    throw new TypeError("El handler de contenido requiere install");
  }
  if (typeof metrics !== "function") {
    throw new TypeError("El handler de contenido requiere metrics");
  }

  return Object.freeze({
    async run(job, { signal } = {}) {
      if (!job?.id || !job?.tenant) {
        throw permanentError(
          "El job de contenido de nicho esta incompleto",
          "INSTALL_NICHE_CONTENT_JOB_INVALID"
        );
      }

      abortIfNeeded(signal);

      try {
        const session = await sessions.get(job.tenant);
        abortIfNeeded(signal);
        if (!session) {
          throw permanentError(
            "La tienda del job de contenido no tiene una sesion instalada",
            "INSTALL_NICHE_CONTENT_SESSION_MISSING"
          );
        }

        const actions = serializableActions(await install(session, { signal }));
        abortIfNeeded(signal);

        const warnings = actions.filter((action) => Boolean(action?.error)).length;
        metrics("contenido_nicho_instalado", {
          tienda: job.tenantId,
          job_id: job.id,
          acciones: actions.length,
          avisos: warnings
        });

        return {
          installed: true,
          actionCount: actions.length,
          warningCount: warnings,
          actions
        };
      } catch (error) {
        abortIfNeeded(signal);
        throw classifyInstallError(error);
      }
    }
  });
}

module.exports = {
  createInstallNicheContentHandler,
  classifyInstallError,
  serializableActions
};
