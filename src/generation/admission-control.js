"use strict";

const DEFAULT_RETRY_AFTER_SECONDS = 60;

function retryAfterSeconds(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 5 && parsed <= 3600
    ? parsed
    : DEFAULT_RETRY_AFTER_SECONDS;
}

function generationAdmissionPause(env = process.env) {
  const paused = String(env.GENERATION_ADMISSION_PAUSED || "").trim() !== "0";
  return {
    paused,
    retryAfter: retryAfterSeconds(env.GENERATION_ADMISSION_RETRY_AFTER_SECONDS),
    code: "GENERATION_ADMISSION_PAUSED",
    message: "Las generaciones estan temporalmente en pausa. Reintenta en unos minutos."
  };
}

module.exports = { generationAdmissionPause, retryAfterSeconds };
