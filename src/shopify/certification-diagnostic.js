"use strict";

function certificationConfigurationDiagnostic({ shop, pageId, planTest, releaseSha } = {}) {
  const missingConfiguration = [];
  if (!shop) missingConfiguration.push("SHOPIFY_CERTIFICATION_SHOP");
  if (!pageId) missingConfiguration.push("SHOPIFY_CERTIFICATION_PAGE_ID");
  if (planTest !== true) missingConfiguration.push("PLAN_TEST");
  if (!/^[a-f0-9]{40}$/.test(String(releaseSha || ""))) missingConfiguration.push("RENDER_GIT_COMMIT");
  return Object.freeze({
    configured: missingConfiguration.length === 0,
    missingConfiguration,
    testBillingEnabled: planTest === true,
    releaseConfigured: /^[a-f0-9]{40}$/.test(String(releaseSha || ""))
  });
}

module.exports = { certificationConfigurationDiagnostic };
