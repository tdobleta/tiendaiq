"use strict";

// This contract intentionally contains only behavioral, non-secret settings
// needed by the billing job. Web publishes its expected view and the worker
// records its effective view in the heartbeat, so test billing cannot silently
// become real billing because two Render services drifted apart.

const CONTRACT_VERSION = 1;
const HANDLE = /^[a-z0-9][a-z0-9-]*$/;

function billingRuntimeContract(runtimeEnv = process.env) {
  const appHandle = String(runtimeEnv?.SHOPIFY_APP_HANDLE || "").trim().toLowerCase();
  return Object.freeze({
    version: CONTRACT_VERSION,
    planTest: String(runtimeEnv?.PLAN_TEST || "") === "1",
    appHandle: HANDLE.test(appHandle) ? appHandle : null
  });
}

function billingRuntimeCompatible(expected, observed) {
  return Boolean(
    expected && observed &&
    expected.version === CONTRACT_VERSION &&
    observed.version === CONTRACT_VERSION &&
    expected.planTest === observed.planTest &&
    expected.appHandle &&
    expected.appHandle === observed.appHandle &&
    observed.configured === true &&
    Number(observed.activeWorkers) >= 1 &&
    Number(observed.versionVariants) === 1 &&
    Number(observed.planTestVariants) === 1 &&
    Number(observed.appHandleVariants) === 1
  );
}

module.exports = {
  CONTRACT_VERSION,
  billingRuntimeContract,
  billingRuntimeCompatible
};
