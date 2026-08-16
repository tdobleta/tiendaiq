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

test("Shopify clasifica 422 como permanente y 429 con Retry-After", async (t) => {
  const originalFetch = global.fetch;
  const modulePath = require.resolve("../shopify");
  delete require.cache[modulePath];
  const responses = [
    new Response("invalido", { status: 422 }),
    new Response("limite", { status: 429, headers: { "Retry-After": "17" } })
  ];
  global.fetch = async () => responses.shift();
  t.after(() => {
    global.fetch = originalFetch;
    delete require.cache[modulePath];
  });

  const { gql } = require("../shopify");
  const session = { tienda: "retry.myshopify.com", token: "token" };
  await assert.rejects(gql("{ shop { id } }", {}, session), (error) => (
    error.status === 422 && error.nonRetryable === true
  ));
  await assert.rejects(gql("{ shop { id } }", {}, session), (error) => (
    error.status === 429 && error.nonRetryable === false && error.retryAfter === 17
  ));
});
