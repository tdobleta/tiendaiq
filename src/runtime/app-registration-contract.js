"use strict";

const crypto = require("crypto");

const REGISTRATION_ID = /^[a-z][a-z0-9-]{2,63}$/;
const CONTRACT_VERSION = 1;

function registrationFingerprint(value) {
  return crypto.createHash("sha256").update(`tiendaiq:shopify-registration:${String(value || "")}`).digest("hex").slice(0, 16);
}

function appRegistrationContract(runtimeEnv = process.env) {
  const id = String(runtimeEnv?.SHOPIFY_APP_REGISTRATION_ID || "").trim().toLowerCase();
  return Object.freeze({
    version: CONTRACT_VERSION,
    id: REGISTRATION_ID.test(id) ? id : null,
    fingerprint: REGISTRATION_ID.test(id) ? registrationFingerprint(id) : null
  });
}

function requireAppRegistration(runtimeEnv = process.env) {
  const registration = appRegistrationContract(runtimeEnv);
  if (!registration.id) {
    const error = new Error("SHOPIFY_APP_REGISTRATION_ID es obligatoria y debe ser un slug estable");
    error.code = "SHOPIFY_APP_REGISTRATION_INVALID";
    throw error;
  }
  return registration;
}

function appRegistrationDiagnostic(registration) {
  return Object.freeze({
    version: CONTRACT_VERSION,
    configured: Boolean(registration?.id),
    fingerprint: registration?.fingerprint || null
  });
}

module.exports = {
  CONTRACT_VERSION,
  appRegistrationContract,
  requireAppRegistration,
  registrationFingerprint,
  appRegistrationDiagnostic
};
