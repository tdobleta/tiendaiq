"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

test("Rollback Partner Staging es manual, inmutable y no revierte migraciones", () => {
  const workflow = read(".github/workflows/rollback-partner-staging.yml");

  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.match(workflow, /rollback_sha:/);
  assert.match(workflow, /ROLLBACK_REVIEWED_PARTNER_STAGING/);
  assert.match(workflow, /PARTNER_STAGING_REMOTE_IDENTITY_AUDITED/);
  assert.match(workflow, /PARTNER_STAGING_MIGRATIONS_ARE_BACKWARD_COMPATIBLE/);
  assert.match(workflow, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(workflow, /git merge-base --is-ancestor "\$ACTUAL_SHA" origin\/main/);
  assert.match(workflow, /environment:\s*partner-staging/);
  assert.match(workflow, /group:\s*tiendaiq-partner-staging-database-maintenance/);
  assert.match(workflow, /queue:\s*max/);
  assert.match(workflow, /RENDER_PARTNER_STAGING_WEB_DEPLOY_HOOK/);
  assert.match(workflow, /RENDER_PARTNER_STAGING_WORKER_DEPLOY_HOOK/);
  assert.match(workflow, /data-urlencode "ref=\$\{\{ steps\.rollback\.outputs\.sha \}\}"/);
  assert.match(workflow, /tiendaiq-partner-staging-web\.onrender\.com\/ready/);
  assert.match(workflow, /ready\.release===process\.env\.EXPECTED_SHA/);
  assert.match(workflow, /PARTNER_STAGING_SHOPIFY_APP_AUTOMATION_TOKEN/);
  assert.match(workflow, /shopify app deploy --config partner-staging --allow-updates --source-control-url "\$COMMIT_URL"/);
  assert.match(workflow, /EXPECTED_RELEASE_SHA:\s*\$\{\{ steps\.rollback\.outputs\.sha \}\}/);
  assert.match(workflow, /OPS_READINESS_PROFILE:\s*rollback/);
  assert.match(workflow, /partner-staging-rollback-readiness\.log/);
  assert.doesNotMatch(workflow, /npm run db:migrate/);
  assert.doesNotMatch(workflow, /PARTNER_STAGING_MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(workflow, /secrets\.STAGING_/);
  assert.doesNotMatch(workflow, /secrets\.PRODUCTION_/);
});

test("el runbook limita el rollback Partner a aplicación compatible y evidencia reproducible", () => {
  const runbook = read("docs/runbook-rollback-partner-staging.md");

  for (const phrase of [
    "ROLLBACK_REVIEWED_PARTNER_STAGING",
    "PARTNER_STAGING_REMOTE_IDENTITY_AUDITED",
    "PARTNER_STAGING_MIGRATIONS_ARE_BACKWARD_COMPATIBLE",
    "origin/main",
    "no revierte migraciones",
    "web y worker",
    "partner-staging",
    "Shopify",
    "No ejecutar"
  ]) {
    assert.match(runbook, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
