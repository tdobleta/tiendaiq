"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("GraphQL de Shopify tiene timeout y clasifica el fallo como transitorio", async (t) => {
  const originalFetch = global.fetch;
  const originalTimeout = process.env.SHOPIFY_TIMEOUT_MS;
  process.env.SHOPIFY_TIMEOUT_MS = "2500";
  const modulePath = require.resolve("../shopify");
  delete require.cache[modulePath];

  let requestOptions;
  global.fetch = async (url, options) => {
    requestOptions = options;
    const error = new Error("abortado por la prueba");
    error.name = "TimeoutError";
    throw error;
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.SHOPIFY_TIMEOUT_MS;
    else process.env.SHOPIFY_TIMEOUT_MS = originalTimeout;
    delete require.cache[modulePath];
  });

  const { gql, SHOPIFY_TIMEOUT_MS } = require("../shopify");
  await assert.rejects(
    gql("{ shop { id } }", {}, { tienda: "timeout.myshopify.com", token: "token" }),
    (error) => error.code === "SHOPIFY_TIMEOUT" && /2500 ms/.test(error.message)
  );
  assert.equal(SHOPIFY_TIMEOUT_MS, 2500);
  assert.ok(requestOptions.signal instanceof AbortSignal);
});
