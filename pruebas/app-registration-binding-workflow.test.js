"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("el binding de staging exige SHA actual, entorno protegido y confirmaciones separadas", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "bind-shopify-registration-staging.yml"),
    "utf8"
  );

  assert.match(workflow, /environment:\s*staging/);
  assert.match(workflow, /group:\s*tiendaiq-staging-shopify-registration-binding/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /ref:\s*\$\{\{ inputs\.release_sha \}\}/);
  assert.match(workflow, /git fetch origin main --depth=1/);
  assert.match(workflow, /BIND_ONE_STAGING_SHOPIFY_REGISTRATION/);
  assert.match(workflow, /APP_REGISTRATION_BIND_CONFIRMATION:\s*BIND_ONE_SHOPIFY_APP_REGISTRATION/);
  assert.match(workflow, /SHOPIFY_APP_REGISTRATION_ID:\s*\$\{\{ inputs\.registration_id \}\}/);
  assert.match(workflow, /STAGING_MIGRATION_DATABASE_URL/);
  assert.match(workflow, /node scripts\/vincular-registro-shopify\.js/);
  assert.doesNotMatch(workflow, /SHOPIFY_CLIENT_SECRET|SHOPIFY_CLIENT_ID/);
});
