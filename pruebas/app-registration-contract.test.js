"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appRegistrationContract,
  appRegistrationBindingContract,
  requireAppRegistration,
  requireEnforcedAppRegistration,
  appRegistrationDiagnostic
} = require("../src/runtime/app-registration-contract");
const { createAppRegistrationRepository } = require("../src/platform/postgres/app-registration-repository");

test("el contrato normaliza la identidad Shopify y el diagnostico no revela el identificador", () => {
  const registration = appRegistrationContract({ SHOPIFY_APP_REGISTRATION_ID: " TiendaIQ-Staging-01 " });

  assert.equal(registration.id, "tiendaiq-staging-01");
  assert.match(registration.fingerprint, /^[a-f0-9]{16}$/);
  assert.deepEqual(appRegistrationDiagnostic(registration), {
    version: 1,
    configured: true,
    enforced: false,
    fingerprint: registration.fingerprint
  });
  assert.doesNotMatch(JSON.stringify(appRegistrationDiagnostic(registration)), /tiendaiq-staging-01/i);
});

test("el contrato falla cerrado si falta o es invalida la identidad de registro", () => {
  assert.equal(appRegistrationContract({}).id, null);
  assert.equal(appRegistrationContract({ SHOPIFY_APP_REGISTRATION_ID: "client/id" }).id, null);
  assert.throws(
    () => requireAppRegistration({}),
    (error) => error?.code === "SHOPIFY_APP_REGISTRATION_INVALID"
  );
});

test("la fase preparatoria es compatible y la fase enforced exige identidad valida", () => {
  assert.deepEqual(appRegistrationDiagnostic(appRegistrationBindingContract({})), {
    version: 1,
    configured: false,
    enforced: false,
    fingerprint: null
  });
  assert.equal(requireEnforcedAppRegistration({}).enforced, false);
  assert.throws(
    () => requireEnforcedAppRegistration({ SHOPIFY_APP_REGISTRATION_BINDING_ENFORCED: "1" }),
    (error) => error?.code === "SHOPIFY_APP_REGISTRATION_INVALID"
  );
  assert.deepEqual(requireEnforcedAppRegistration({
    SHOPIFY_APP_REGISTRATION_BINDING_ENFORCED: "1",
    SHOPIFY_APP_REGISTRATION_ID: "tiendaiq-staging-01"
  }), {
    version: 1,
    id: "tiendaiq-staging-01",
    fingerprint: appRegistrationContract({ SHOPIFY_APP_REGISTRATION_ID: "tiendaiq-staging-01" }).fingerprint,
    enforced: true
  });
});

test("el repositorio solo invoca las funciones estrechas de binding", async () => {
  const calls = [];
  const repository = createAppRegistrationRepository({
    async query(sql, values) {
      calls.push({ sql, values });
    }
  });

  await repository.assert("tiendaiq-staging-01");
  await repository.bind("tiendaiq-staging-01");

  assert.deepEqual(calls, [
    { sql: "SELECT control_plane.assert_app_registration($1)", values: ["tiendaiq-staging-01"] },
    { sql: "SELECT control_plane.bind_app_registration($1)", values: ["tiendaiq-staging-01"] }
  ]);
});

test("un binding enforced propaga un mismatch de la base sin habilitar side effects", async () => {
  const repository = createAppRegistrationRepository({
    async query(_sql, [registrationId]) {
      if (registrationId !== "tiendaiq-staging-01") throw new Error("la identidad de la app Shopify no coincide con esta base");
    }
  });

  await repository.assert("tiendaiq-staging-01");
  await assert.rejects(
    repository.assert("otra-app-01"),
    /no coincide con esta base/
  );
});

test("la migracion mantiene un singleton fisico, RLS forzado y activacion exclusiva del migrador", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0021_shopify_app_registration_binding.sql"), "utf8");

  assert.match(sql, /singleton boolean PRIMARY KEY DEFAULT true CHECK \(singleton\)/);
  assert.match(sql, /app_registration_binding ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /app_registration_binding FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE POLICY app_registration_binding_migrator[\s\S]*FOR ALL TO tiendaiq_migrator/);
  assert.match(sql, /REVOKE ALL ON TABLE control_plane\.app_registration_binding[\s\S]*tiendaiq_web_runtime, tiendaiq_worker_runtime/);
  assert.doesNotMatch(sql, /FROM PUBLIC, tiendaiq_web, tiendaiq_worker,/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION control_plane\.assert_app_registration\(text\)[\s\S]*tiendaiq_web_runtime, tiendaiq_worker_runtime/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION control_plane\.bind_app_registration\(text\) TO tiendaiq_migrator/);
  assert.match(sql, /ON CONFLICT \(singleton\) DO NOTHING/);
  assert.doesNotMatch(sql, /provider_id|billing_id|subscription_id/i);
});

test("la activacion manual exige una confirmacion y solo informa un diagnostico sanitizado", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "vincular-registro-shopify.js"), "utf8");

  assert.match(source, /APP_REGISTRATION_BIND_CONFIRMATION/);
  assert.match(source, /BIND_ONE_SHOPIFY_APP_REGISTRATION/);
  assert.match(source, /requireAppRegistration\(env\)/);
  assert.match(source, /MIGRATION_DATABASE_URL/);
  assert.match(source, /SELECT control_plane\.bind_app_registration\(\$1\)/);
  assert.match(source, /appRegistrationDiagnostic\(registration\)/);
  assert.doesNotMatch(source, /SHOPIFY_CLIENT_SECRET|SHOPIFY_CLIENT_ID/);
});
