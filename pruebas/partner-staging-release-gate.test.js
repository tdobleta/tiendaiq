"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "release-partner-staging.yml"),
  "utf8"
);

test("Release Partner Staging audita identidad remota sin exigir distribución pública", () => {
  assert.match(workflow, /identity_audit_confirmation:/);
  assert.match(workflow, /PARTNER_STAGING_REMOTE_IDENTITY_AUDITED/);
  assert.match(workflow, /shopify app deploy --config partner-staging/);
  assert.doesNotMatch(workflow, /distribution_confirmation:/);
  assert.doesNotMatch(workflow, /PARTNER_STAGING_PUBLIC_DISTRIBUTION_AUDITED/);
});
