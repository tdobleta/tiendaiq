"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  requiresAppRegistration
} = require("../scripts/probar-readiness-operativa");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function renderService(render, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return render
    .split(/(?=^\s{2}- type:\s*(?:web|worker)\s*$)/m)
    .find((block) => new RegExp(`^\\s*name:\\s*${escaped}\\s*$`, "m").test(block)) || "";
}

function renderedValue(service, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return service.match(new RegExp(`^\\s*- key:\\s*${escaped}\\s*\\r?\\n\\s*value:\\s*"([^"]+)"\\s*$`, "m"))?.[1] || null;
}

test("el bootstrap protegido crea roles, migra y liga producción antes de exigir el binding", () => {
  const workflow = read(".github/workflows/bootstrap-runtime-logins-production.yml");
  const roles = workflow.indexOf("Create isolated PostgreSQL runtime logins for the prelaunch cutover");
  const migrate = workflow.indexOf("Migrate the prelaunch production database after runtime roles exist");
  const bind = workflow.indexOf("Bind the database to the reviewed production Shopify registration");

  assert.match(workflow, /name:\s*Bootstrap and bind production database/);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /group:\s*tiendaiq-production-database-maintenance/);
  assert.match(workflow, /queue:\s*max/);
  assert.match(workflow, /BOOTSTRAP_RUNTIME_LOGINS_PRODUCTION/);
  assert.match(workflow, /ACKNOWLEDGE_PRELAUNCH_DATABASE_CUTOVER/);
  assert.match(workflow, /git fetch origin main --depth=1/);
  assert.match(workflow, /BOOTSTRAP_LEGACY_COMPATIBILITY_ROLES:\s*"1"/);
  assert.match(workflow, /MIGRATION_DATABASE_URL:\s*\$\{\{ secrets\.PRODUCTION_MIGRATION_DATABASE_URL \}\}/);
  assert.match(workflow, /run: npm run db:migrate/);
  assert.match(workflow, /APP_REGISTRATION_BIND_CONFIRMATION:\s*BIND_ONE_SHOPIFY_APP_REGISTRATION/);
  assert.match(workflow, /SHOPIFY_APP_REGISTRATION_ID:\s*tiendaiq-production-v1/);
  assert.match(workflow, /node scripts\/vincular-registro-shopify\.js/);
  assert.doesNotMatch(workflow, /RENDER_PRODUCTION_.*DEPLOY_HOOK/);
  assert.doesNotMatch(workflow, /SHOPIFY_CLIENT_SECRET|SHOPIFY_CLIENT_ID/);
  assert.ok(roles >= 0 && roles < migrate && migrate < bind, "los roles existen antes de migrar y ligar la base");
});

test("el blueprint productivo exige el mismo binding en web y worker", () => {
  const render = read("render.yaml");
  const web = renderService(render, "tiendaiq");
  const worker = renderService(render, "tiendaiq-worker");

  assert.equal(renderedValue(web, "SHOPIFY_APP_REGISTRATION_ID"), "tiendaiq-production-v1");
  assert.equal(renderedValue(worker, "SHOPIFY_APP_REGISTRATION_ID"), "tiendaiq-production-v1");
  assert.equal(renderedValue(web, "SHOPIFY_APP_REGISTRATION_BINDING_ENFORCED"), "1");
  assert.equal(renderedValue(worker, "SHOPIFY_APP_REGISTRATION_BINDING_ENFORCED"), "1");
});

test("el preflight técnico y el rollback no certifican producción sin binding enforced", () => {
  const release = read(".github/workflows/release-production.yml");
  const recovery = read(".github/workflows/recover-production.yml");

  assert.match(release, /OPS_READINESS_PROFILE:\s*technical_preflight/);
  assert.match(release, /OPS_REQUIRE_APP_REGISTRATION:\s*"1"/);
  assert.match(recovery, /OPS_READINESS_PROFILE:\s*rollback/);
  assert.match(recovery, /OPS_REQUIRE_APP_REGISTRATION:\s*"1"/);
  assert.equal(requiresAppRegistration("technical_preflight", ""), false);
  assert.equal(requiresAppRegistration("technical_preflight", "1"), true);
  assert.equal(requiresAppRegistration("rollback", "true"), true);
  assert.equal(requiresAppRegistration("go", ""), true);
});

test("el runbook impide activar enforcement antes del bind y documenta el cierre del gate", () => {
  const runbook = read("docs/runbook-roles-postgres.md");

  assert.match(runbook, /Bootstrap and bind production database/);
  assert.match(runbook, /SHOPIFY_APP_REGISTRATION_BINDING_ENFORCED=1/);
  assert.match(runbook, /solamente.*después del paso anterior/i);
  assert.match(runbook, /binding Shopify configurado y enforced/i);
});
