"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
// Los contratos se expresan contra texto lógico. Git puede materializar el
// mismo archivo con CRLF en Windows, por lo que normalizamos antes de aplicar
// regex que describen la estructura YAML y no el sistema operativo.
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

test("Partner Staging declara una topología Render aislada y fail-closed", () => {
  const blueprint = read("render.partner-staging.yaml");
  const databaseBlueprint = read("render.partner-staging-db.yaml");

  assert.doesNotMatch(blueprint, /^databases:/m);
  assert.doesNotMatch(blueprint, /name:\s*tiendaiq-partner-staging-db/);
  assert.match(blueprint, /name:\s*tiendaiq-partner-staging-web/);
  assert.match(blueprint, /name:\s*tiendaiq-partner-staging-worker/);
  assert.match(databaseBlueprint, /^databases:/m);
  assert.match(databaseBlueprint, /name:\s*tiendaiq-partner-staging-db/);
  assert.match(databaseBlueprint, /databaseName:\s*tiendaiq_partner_staging/);
  assert.doesNotMatch(databaseBlueprint, /^services:/m);
  assert.doesNotMatch(blueprint, /name:\s*tiendaiq-staging-(?:web|worker|db)/);
  assert.match(blueprint, /SHOPIFY_APP_HANDLE\s*\n\s*value:\s*"tiendaiq-partner-staging"/);
  assert.match(blueprint, /SHOPIFY_APP_REGISTRATION_ID\s*\n\s*value:\s*"tiendaiq-partner-staging-v1"/);
  assert.match(blueprint, /SHOPIFY_APP_REGISTRATION_BINDING_ENFORCED\s*\n\s*value:\s*"1"/);
  assert.match(blueprint, /TOKEN_ENC_KEY\s*\n\s*generateValue:\s*true/);
  assert.match(blueprint, /fromService:\s*\n\s*type:\s*web\s*\n\s*name:\s*tiendaiq-partner-staging-web\s*\n\s*envVarKey:\s*TOKEN_ENC_KEY/);
  assert.match(blueprint, /GENERATION_ADMISSION_PAUSED\s*\n(?:\s*#.*\n)*\s*sync:\s*false/);
  assert.match(
    read("src/generation/admission-control.js"),
    /String\(env\.GENERATION_ADMISSION_PAUSED \|\| ""\)\.trim\(\) !== "0"/
  );
  assert.match(blueprint, /PLAN_TEST\s*\n\s*value:\s*"1"/);
  for (const key of [
    "SHOPIFY_CERTIFICATION_ENABLED",
    "SHOPIFY_CERTIFICATION_SHOP",
    "SHOPIFY_CERTIFICATION_PAGE_ID",
    "SHOPIFY_CERTIFICATION_STOREFRONT_PASSWORD"
  ]) {
    assert.match(
      blueprint,
      new RegExp(`${key}\\s*\\n\\s*sync:\\s*false`),
      `${key} se completa manualmente sólo cuando exista evidencia Partner real`
    );
  }
  assert.match(blueprint, /SHOPIFY_CERTIFICATION_MAX_AGE_HOURS\s*\n\s*value:\s*"24"/);
  const workerBlueprint = blueprint.slice(blueprint.indexOf("- type: worker"));
  assert.match(workerBlueprint, /PLAN_TEST\s*\n\s*value:\s*"1"/);
  assert.doesNotMatch(blueprint, /ANTHROPIC_API_KEY\s*\n\s*value:/);
  assert.doesNotMatch(blueprint, /SHOPIFY_CLIENT_SECRET\s*\n\s*value:/);
});

test("la app Partner y los workflows usan el mismo runtime e identidad aislados", () => {
  const app = read("shopify.app.partner-staging.toml");
  const blueprint = read("render.partner-staging.yaml");
  const bootstrap = read(".github/workflows/bootstrap-partner-staging.yml");
  const release = read(".github/workflows/release-partner-staging.yml");
  const readiness = read(".github/workflows/ops-readiness-partner-staging.yml");

  assert.match(app, /application_url\s*=\s*"https:\/\/tiendaiq-partner-staging-web\.onrender\.com"/);
  assert.match(app, /uri\s*=\s*"https:\/\/tiendaiq-partner-staging-web\.onrender\.com\/webhooks"/);
  assert.match(app, /https:\/\/tiendaiq-partner-staging-web\.onrender\.com\/auth\/callback/);
  assert.doesNotMatch(app, /tiendaiq-staging-web\.onrender\.com/);

  const appClientId = app.match(/^client_id\s*=\s*"([^"]+)"/m)?.[1];
  const renderClientId = blueprint.match(/SHOPIFY_CLIENT_ID\s*\n\s*value:\s*"([^"]+)"/m)?.[1];
  assert.equal(appClientId, "84c005c4433b94ed2d8b6b0729e6de54");
  assert.equal(renderClientId, appClientId);

  for (const workflow of [bootstrap, release, readiness]) {
    assert.match(workflow, /environment:\s*partner-staging/);
    assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
    assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);
    assert.doesNotMatch(workflow, /secrets\.STAGING_(?:MIGRATION_DATABASE_URL|OPS_STATUS_TOKEN|SHOPIFY_APP_AUTOMATION_TOKEN)/);
    assert.doesNotMatch(workflow, /PRODUCTION_/);
  }
  assert.match(bootstrap, /BOOTSTRAP_PARTNER_STAGING_DATABASE/);
  assert.match(bootstrap, /PARTNER_STAGING_MIGRATION_DATABASE_URL/);
  assert.match(bootstrap, /BOOTSTRAP_LEGACY_COMPATIBILITY_ROLES: "1"/);
  assert.match(bootstrap, /SHOPIFY_APP_REGISTRATION_ID:\s*tiendaiq-partner-staging-v1/);
  assert.match(bootstrap, /node scripts\/vincular-registro-shopify\.js/);
  assert.doesNotMatch(bootstrap, /RENDER_PARTNER_STAGING/);

  assert.match(release, /DEPLOY_REVIEWED_PARTNER_STAGING/);
  assert.match(release, /PARTNER_STAGING_REMOTE_IDENTITY_AUDITED/);
  assert.doesNotMatch(release, /PARTNER_STAGING_PUBLIC_DISTRIBUTION_AUDITED/);
  assert.match(release, /RENDER_PARTNER_STAGING_WEB_DEPLOY_HOOK/);
  assert.match(release, /RENDER_PARTNER_STAGING_WORKER_DEPLOY_HOOK/);
  assert.match(release, /PARTNER_STAGING_SHOPIFY_APP_AUTOMATION_TOKEN/);
  assert.match(release, /npm install --global @shopify\/cli@4\.1\.0/);
  assert.ok(
    release.indexOf("npm install --global @shopify/cli@4.1.0") < release.indexOf("shopify app deploy --config partner-staging"),
    "instala Shopify CLI antes de publicar componentes Partner Staging"
  );
  assert.match(release, /shopify app deploy --config partner-staging --allow-updates/);
  assert.match(release, /https:\/\/tiendaiq-partner-staging-web\.onrender\.com\/ready/);
  assert.match(readiness, /CHECK_STAGING_OPS_READINESS/);
  assert.match(readiness, /PARTNER_STAGING_OPS_STATUS_TOKEN/);
  assert.match(readiness, /require_generation_admission_open/);
  assert.match(readiness, /OPS_REQUIRE_GENERATION_ADMISSION_OPEN/);
  assert.match(readiness, /https:\/\/tiendaiq-partner-staging-web\.onrender\.com/);
  assert.match(release, /GITHUB_STEP_SUMMARY/);
  assert.match(release, /partner-staging-ops-readiness\.log/);
  assert.match(release, /max_attempts=30/);
  assert.match(release, /for attempt in \$\(seq 1 "\$max_attempts"\)/);
});

test("la capacidad Partner Staging nunca puede reutilizar el destino o secretos legacy", () => {
  const workflow = read(".github/workflows/capacity-partner-staging.yml");

  assert.match(workflow, /environment:\s*partner-staging/);
  assert.match(workflow, /release_sha:/);
  assert.match(workflow, /ref:\s*\$\{\{ inputs\.release_sha \}\}/);
  assert.match(workflow, /git fetch origin main --depth=1/);
  assert.match(workflow, /RUN_PARTNER_STAGING_QUEUE_CAPACITY/);
  assert.match(workflow, /CLEAN_PARTNER_STAGING_QUEUE_CAPACITY/);
  assert.match(workflow, /cleanup_tenants:/);
  assert.match(workflow, /CLEANUP_TENANTS/);
  assert.match(workflow, /\$CLEANUP_TENANTS" -le 2000/);
  assert.doesNotMatch(workflow, /export LOAD_TENANTS=2000/);
  assert.match(workflow, /https:\/\/tiendaiq-partner-staging-web\.onrender\.com\/ready/);
  assert.match(workflow, /PARTNER_STAGING_WEB_DATABASE_URL/);
  assert.match(workflow, /PARTNER_STAGING_WORKER_DATABASE_URL/);
  assert.match(workflow, /ALLOW_REMOTE_QUEUE_LOAD_TEST/);
  assert.match(workflow, /npm run carga:cola/);
  assert.match(workflow, /sanitizar-evidencia-capacidad\.js/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.doesNotMatch(workflow, /tiendaiq-staging-web\.onrender\.com/);
  assert.doesNotMatch(workflow, /secrets\.STAGING_/);
  assert.doesNotMatch(workflow, /MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(workflow, /PRODUCTION_/);
  assert.doesNotMatch(workflow, /ANTHROPIC|SHOPIFY|billing/i);
});
