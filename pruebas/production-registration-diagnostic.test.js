"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { appendRegistrationSummary, readBoundRegistration } = require("../scripts/diagnosticar-registro-shopify-vinculado");

const root = path.join(__dirname, "..");

test("el diagnostico productivo sólo lee el binding y devuelve la identidad no secreta", async () => {
  let ended = false;
  class FakePool {
    constructor() {}
    async query(sql) {
      assert.match(sql, /^SELECT registration_id FROM control_plane\.app_registration_binding/);
      return { rows: [{ registration_id: "tiendaiq-legacy-production-v1" }] };
    }
    async end() { ended = true; }
  }

  const result = await readBoundRegistration({ databaseUrl: "postgresql://example", PoolImplementation: FakePool });
  assert.equal(result.registrationId, "tiendaiq-legacy-production-v1");
  assert.match(result.diagnostic.fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(ended, true);
});

test("el resumen de GitHub sólo publica el identificador interno no secreto", () => {
  const summaryPath = path.join(os.tmpdir(), `tiendaiq-registration-summary-${process.pid}.md`);
  try {
    appendRegistrationSummary({
      registrationId: "tiendaiq-legacy-production-v1",
      diagnostic: { fingerprint: "1234567890abcdef" }
    }, summaryPath);
    const summary = fs.readFileSync(summaryPath, "utf8");
    assert.match(summary, /Shopify registration binding/);
    assert.match(summary, /tiendaiq-legacy-production-v1/);
    assert.match(summary, /1234567890abcdef/);
    assert.doesNotMatch(summary, /MIGRATION_DATABASE_URL|SHOPIFY_API_SECRET|password/i);
  } finally {
    fs.rmSync(summaryPath, { force: true });
  }
});

test("el workflow diagnostico queda protegido, serializado y no despliega ni modifica la base", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "diagnose-production-shopify-registration.yml"), "utf8");

  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /group:\s*tiendaiq-production-database-maintenance/);
  assert.match(workflow, /queue:\s*max/);
  assert.match(workflow, /DIAGNOSE_PRODUCTION_SHOPIFY_REGISTRATION/);
  assert.match(workflow, /MIGRATION_DATABASE_URL:\s*\$\{\{ secrets\.PRODUCTION_MIGRATION_DATABASE_URL \}\}/);
  assert.match(workflow, /node scripts\/diagnosticar-registro-shopify-vinculado\.js/);
  assert.doesNotMatch(workflow, /db:migrate|vincular-registro|DEPLOY_HOOK|shopify app deploy/);
});
