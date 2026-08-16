"use strict";

const MODES = new Set(["rewrite", "shorter", "longer"]);

function invalidJob(message) {
  const error = new Error(message);
  error.nonRetryable = true;
  return error;
}

function validatePayload(payload = {}) {
  const value = {
    texto: String(payload.texto || ""),
    instrucciones: String(payload.instrucciones || ""),
    modo: String(payload.modo || "rewrite"),
    idioma: String(payload.idioma || "es"),
    contexto: String(payload.contexto || "")
  };
  if (value.texto.length > 10_000) throw invalidJob("El texto supera el límite permitido");
  if (value.instrucciones.length > 2_000) throw invalidJob("Las instrucciones superan el límite permitido");
  if (value.contexto.length > 15_000) throw invalidJob("El contexto supera el límite permitido");
  if (!MODES.has(value.modo)) throw invalidJob("El modo de edición no es válido");
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(value.idioma)) {
    throw invalidJob("El idioma de edición no es válido");
  }
  return value;
}

function createEditTextHandler({ edit, metrics = () => {} }) {
  if (typeof edit !== "function") throw new TypeError("El handler requiere el adaptador de edición");
  return Object.freeze({
    async run(job, { signal } = {}) {
      if (Number(job.attempts) > 1) {
        throw invalidJob(
          "La edición tiene un intento de proveedor sin resultado durable; no se repetirá automáticamente"
        );
      }
      const payload = validatePayload(job.payload);
      const startedAt = Date.now();
      const texto = await edit({ ...payload, signal });
      metrics("texto_editado", {
        tienda: job.tenantId,
        job_id: job.id,
        segundos: (Date.now() - startedAt) / 1000
      });
      return { texto };
    }
  });
}

module.exports = { MODES, createEditTextHandler, validatePayload };
