"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  evaluateScopeEquivalence,
  evaluateShopifyCertification,
  queryShopifyCertification,
  queryStorefrontCertification,
  certificationUrlDiagnostic
} = require("../src/shopify/staging-certification");
const { createShopifyCertificationRepository } = require("../src/platform/postgres/shopify-certification-repository");
const { TenantContext } = require("../src/tenancy/tenant-context");

const pageValue = JSON.stringify({ fuente: { shopify_product_id: "gid://shopify/Product/42" }, version: 1 });
const pageHash = crypto.createHash("sha256").update(pageValue).digest("hex");
const RELEASE_SHA = "a".repeat(40);

function fixture(overrides = {}) {
  const base = {
    requiredScopes: ["read_products", "write_products"],
    requiredTopics: ["APP_UNINSTALLED", "APP_SUBSCRIPTIONS_UPDATE"],
    expectedWebhookUrl: "https://staging.example/webhooks",
    shopDomain: "certification.myshopify.com",
    planName: "TiendaIQ Pro",
    planTest: true,
    releaseSha: RELEASE_SHA,
    evidence: {
      publication: {
        pageId: "page-certification",
        productId: "gid://shopify/Product/42",
        jobId: "job-42",
        publicUrl: "https://certification.myshopify.com/products/demo",
        contentHash: pageHash,
        changesPending: false,
        lastJobError: null,
        completedAt: "2026-08-17T12:00:00.000Z",
        jobStatus: "succeeded",
        jobType: "publish-page",
        workerReleaseSha: RELEASE_SHA
      },
      privacy: {
        customers_data_request: { count: 1, completedAt: "2026-08-17T12:01:00.000Z", workerReleaseSha: RELEASE_SHA },
        customers_redact: { count: 1, completedAt: "2026-08-17T12:02:00.000Z", workerReleaseSha: RELEASE_SHA }
      },
    },
    remote: {
      scopes: ["read_products", "write_products"],
      subscriptions: [{ name: "TiendaIQ Pro", status: "ACTIVE", test: true }],
      webhooks: [
        { topic: "APP_UNINSTALLED", uri: "https://staging.example/webhooks" },
        { topic: "APP_SUBSCRIPTIONS_UPDATE", uri: "https://staging.example/webhooks/" }
      ],
      product: {
        id: "gid://shopify/Product/42",
        templateSuffix: "tiendaiq",
        onlineStoreUrl: "https://certification.myshopify.com/products/demo",
        metafield: { id: "gid://shopify/Metafield/1", type: "json", value: pageValue }
      },
      storefront: {
        ok: true,
        status: 200,
        html: true,
        urlMatch: true,
        markers: { data: true, app: true, asset: true },
        bytes: 2048
      }
    }
  };
  return { ...base, ...overrides };
}

test("certifica la tienda activa sin confundirla con shop/redact", () => {
  const result = evaluateShopifyCertification(fixture());
  assert.equal(result.activeStoreOk, true);
  assert.equal(result.scope, "active_store_non_destructive");
  assert.deepEqual(result.errors, []);
  assert.equal(result.destructiveShopRedact.certifiedHere, false);
  assert.equal(result.destructiveShopRedact.blocksFullCertification, true);
  assert.equal(result.complianceWebhooks.certifiedHere, false);
  assert.equal(Object.keys(result.checks).length, 7);
});

test("tolera el read scope implicito por un write scope concedido", () => {
  const comparison = evaluateScopeEquivalence(
    ["read_products", "write_products", "write_online_store_navigation"],
    ["read_products", "write_products", "write_online_store_navigation", "read_online_store_navigation"]
  );
  const result = evaluateShopifyCertification(fixture({
    requiredScopes: ["read_products", "write_products", "write_online_store_navigation"],
    remote: {
      ...fixture().remote,
      scopes: ["read_products", "write_products", "write_online_store_navigation", "read_online_store_navigation"]
    }
  }));

  assert.equal(comparison.ok, true);
  assert.deepEqual(comparison.compatibleReadExtras, ["read_online_store_navigation"]);
  assert.deepEqual(comparison.incompatibleUnexpected, []);
  assert.equal(result.checks.scopes.ok, true);
  assert.deepEqual(result.checks.scopes.compatibleReadExtras, ["read_online_store_navigation"]);
});

test("rechaza scopes faltantes o inesperados no equivalentes", () => {
  const missing = evaluateShopifyCertification(fixture({
    remote: { ...fixture().remote, scopes: ["read_products"] }
  }));
  const unexpected = evaluateShopifyCertification(fixture({
    remote: { ...fixture().remote, scopes: ["read_products", "write_products", "read_orders"] }
  }));
  assert.equal(missing.checks.scopes.ok, false);
  assert.equal(unexpected.checks.scopes.ok, false);
  assert.deepEqual(missing.checks.scopes.missing, ["write_products"]);
  assert.deepEqual(unexpected.checks.scopes.unexpected, ["read_orders"]);
});

test("no usa una lectura extra para suplir un write scope requerido", () => {
  const comparison = evaluateScopeEquivalence(
    ["write_online_store_navigation"],
    ["read_online_store_navigation"]
  );

  assert.equal(comparison.ok, false);
  assert.deepEqual(comparison.missing, ["write_online_store_navigation"]);
  assert.deepEqual(comparison.incompatibleUnexpected, ["read_online_store_navigation"]);
});

test("rechaza billing que no sea activo y de prueba", () => {
  const result = evaluateShopifyCertification(fixture({
    remote: {
      ...fixture().remote,
      subscriptions: [{ name: "TiendaIQ Pro", status: "ACTIVE", test: false }]
    }
  }));
  assert.equal(result.checks.billing.ok, false);
  assert.match(result.errors.join(","), /test_billing_not_active/);
});

test("rechaza webhooks operativos ausentes o con callback incorrecto", () => {
  const result = evaluateShopifyCertification(fixture({
    remote: {
      ...fixture().remote,
      webhooks: [{ topic: "APP_UNINSTALLED", uri: "https://otro.example/webhooks" }]
    }
  }));
  assert.equal(result.checks.operationalWebhooks.ok, false);
});

test("rechaza contenido remoto distinto del hash durable", () => {
  const result = evaluateShopifyCertification(fixture({
    remote: {
      ...fixture().remote,
      product: {
        ...fixture().remote.product,
        metafield: { id: "gid://shopify/Metafield/1", type: "json", value: "{\"otro\":true}" }
      }
    }
  }));
  assert.equal(result.checks.publicationDatabase.ok, true);
  assert.equal(result.checks.publicationShopify.ok, false);
  assert.equal(result.checks.publicationShopify.contentHashMatch, false);
});

test("rechaza evidencia durable incompleta o privacidad parcial", () => {
  const durable = evaluateShopifyCertification(fixture({ evidence: { publication: null, privacy: fixture().evidence.privacy } }));
  const privacy = evaluateShopifyCertification(fixture({
    evidence: { publication: fixture().evidence.publication, privacy: { customers_data_request: { count: 1 } } }
  }));
  assert.equal(durable.checks.publicationDatabase.ok, false);
  assert.equal(privacy.checks.privacyDeliveries.ok, false);
});

test("rechaza evidencia de un worker o privacidad de otro release", () => {
  const publication = evaluateShopifyCertification(fixture({
    evidence: {
      ...fixture().evidence,
      publication: { ...fixture().evidence.publication, workerReleaseSha: "b".repeat(40) }
    }
  }));
  const privacy = evaluateShopifyCertification(fixture({
    evidence: {
      ...fixture().evidence,
      privacy: {
        ...fixture().evidence.privacy,
        customers_redact: { ...fixture().evidence.privacy.customers_redact, workerReleaseSha: "b".repeat(40) }
      }
    }
  }));
  assert.equal(publication.checks.publicationDatabase.ok, false);
  assert.equal(privacy.checks.privacyDeliveries.ok, false);
});

test("rechaza URL publica distinta o storefront sin marcadores", () => {
  const wrongUrl = evaluateShopifyCertification(fixture({
    remote: {
      ...fixture().remote,
      product: { ...fixture().remote.product, onlineStoreUrl: "https://certification.myshopify.com/products/otro" }
    }
  }));
  const missingMarkers = evaluateShopifyCertification(fixture({
    remote: { ...fixture().remote, storefront: { ...fixture().remote.storefront, ok: false, markers: { data: true, app: false, asset: true } } }
  }));
  assert.equal(wrongUrl.checks.publicationShopify.publicUrlMatch, false);
  assert.equal(missingMarkers.checks.storefront.ok, false);
});

test("acepta preview de Shopify solo cuando no existe URL primaria y coincide exactamente", () => {
  const result = evaluateShopifyCertification(fixture({
    remote: {
      ...fixture().remote,
      product: {
        ...fixture().remote.product,
        onlineStoreUrl: null,
        onlineStorePreviewUrl: "https://certification.myshopify.com/products/demo"
      }
    }
  }));

  assert.equal(result.checks.publicationShopify.ok, true);
  assert.equal(result.checks.publicationShopify.publicUrlMatch, true);
  assert.equal(result.checks.publicationShopify.publicUrlComparison.source, "online_store_preview_url");
});

test("no usa preview si la URL primaria existe pero difiere", () => {
  const result = evaluateShopifyCertification(fixture({
    remote: {
      ...fixture().remote,
      product: {
        ...fixture().remote.product,
        onlineStoreUrl: "https://certification.myshopify.com/products/otro",
        onlineStorePreviewUrl: "https://certification.myshopify.com/products/demo"
      }
    }
  }));

  assert.equal(result.checks.publicationShopify.ok, false);
  assert.equal(result.checks.publicationShopify.publicUrlMatch, false);
  assert.equal(result.checks.publicationShopify.publicUrlComparison.source, "online_store_url");
});

test("rechaza preview con host, path, query o fragmento distinto", () => {
  const previews = [
    { url: "https://otro.myshopify.com/products/demo", source: "online_store_preview_url_rejected" },
    { url: "https://usuario@certification.myshopify.com/products/demo", source: "online_store_preview_url_rejected" },
    { url: "https://certification.myshopify.com/products/otro", source: "online_store_preview_url" },
    { url: "https://certification.myshopify.com/products/demo?preview=1", source: "online_store_preview_url_rejected" },
    { url: "https://certification.myshopify.com/products/demo#preview", source: "online_store_preview_url_rejected" }
  ];

  for (const { url: onlineStorePreviewUrl, source } of previews) {
    const result = evaluateShopifyCertification(fixture({
      remote: {
        ...fixture().remote,
        product: { ...fixture().remote.product, onlineStoreUrl: null, onlineStorePreviewUrl }
      }
    }));
    assert.equal(result.checks.publicationShopify.ok, false, onlineStorePreviewUrl);
    assert.equal(result.checks.publicationShopify.publicUrlMatch, false, onlineStorePreviewUrl);
    assert.equal(result.checks.publicationShopify.publicUrlComparison.source, source);
  }
});

test("rechaza la publicacion cuando faltan ambas URLs de Shopify", () => {
  const result = evaluateShopifyCertification(fixture({
    remote: {
      ...fixture().remote,
      product: { ...fixture().remote.product, onlineStoreUrl: null, onlineStorePreviewUrl: null }
    }
  }));

  assert.equal(result.checks.publicationShopify.ok, false);
  assert.equal(result.checks.publicationShopify.publicUrlMatch, false);
  assert.equal(result.checks.publicationShopify.publicUrlComparison.source, null);
});

test("diagnostica la diferencia de URL sin exponer valores de query", () => {
  const diagnostic = certificationUrlDiagnostic(
    "https://certification.myshopify.com/products/demo/?variant=42&token=valor-secreto"
  );
  const mismatch = evaluateShopifyCertification(fixture({
    remote: {
      ...fixture().remote,
      product: {
        ...fixture().remote.product,
        onlineStoreUrl: "https://certification.myshopify.com/products/demo/?variant=42&token=valor-secreto"
      }
    }
  }));

  assert.deepEqual(diagnostic, {
    present: true,
    valid: true,
    protocol: "https:",
    host: "certification.myshopify.com",
    path: "/products/demo/",
    search: { present: true, keys: ["token", "variant"], signature: diagnostic.search.signature },
    trailingSlash: true,
    normalized: "https://certification.myshopify.com/products/demo?token=[redacted]&variant=[redacted]"
  });
  assert.equal(JSON.stringify(diagnostic).includes("valor-secreto"), false);
  assert.equal(mismatch.checks.publicationShopify.publicUrlMatch, false);
  assert.deepEqual(
    mismatch.checks.publicationShopify.publicUrlComparison.shopify.search.keys,
    ["token", "variant"]
  );
});

test("verifica el HTML real del storefront sin devolver su contenido", async () => {
  const html = '<script>window.TIENDAIQ_DATA = {}</script><div id="app" data-ssr="1"></div><script src="/assets/tiendaiq.js?v=1"></script>';
  const result = await queryStorefrontCertification(async () => ({
    ok: true,
    status: 200,
    url: "https://certification.myshopify.com/products/demo",
    headers: { get(name) { return name === "content-type" ? "text/html; charset=utf-8" : null; } },
    body: null,
    async text() { return html; }
  }), "https://certification.myshopify.com/products/demo", "https://certification.myshopify.com/products/demo");
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, "body"), false);
});

test("verifica una Development Store protegida sin exponer la contraseña ni la cookie", async () => {
  const url = "https://certification.myshopify.com/products/demo";
  const storefrontHtml = '<script>window.TIENDAIQ_DATA = {}</script><div id="app" data-ssr="1"></div><script src="/assets/tiendaiq.js"></script>';
  const calls = [];
  const fetchFn = async (receivedUrl, options) => {
    calls.push({ url: String(receivedUrl), options });
    if (calls.length === 1) {
      return {
        ok: true, status: 200, url,
        headers: { get(name) { return name === "content-type" ? "text/html" : null; } },
        body: null, async text() { return "<title>Password</title>"; }
      };
    }
    if (calls.length === 2) {
      return {
        ok: false, status: 302, url: "https://certification.myshopify.com/password",
        headers: { get(name) { return name === "set-cookie" ? "_shopify=private-cookie; Path=/; HttpOnly" : null; } }
      };
    }
    return {
      ok: true, status: 200, url,
      headers: { get(name) { return name === "content-type" ? "text/html" : null; } },
      body: null, async text() { return storefrontHtml; }
    };
  };
  const result = await queryStorefrontCertification(fetchFn, url, url, {
    storefrontPassword: "password-only-for-test",
    passwordShopDomain: "certification.myshopify.com"
  });

  assert.equal(result.ok, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.authenticationAttempted, true);
  assert.equal(JSON.stringify(result).includes("password-only-for-test"), false);
  assert.equal(JSON.stringify(result).includes("private-cookie"), false);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, "https://certification.myshopify.com/password");
  assert.match(calls[1].options.body, /password=password-only-for-test/);
  assert.equal(calls[2].options.headers.Cookie, "_shopify=private-cookie");
});

test("nunca envía una contraseña de storefront a un dominio distinto de la tienda configurada", async () => {
  const url = "https://certification.myshopify.com/products/demo";
  let calls = 0;
  const result = await queryStorefrontCertification(async () => {
    calls += 1;
    return {
      ok: true, status: 200, url,
      headers: { get(name) { return name === "content-type" ? "text/html" : null; } },
      body: null, async text() { return "<title>Password</title>"; }
    };
  }, url, url, {
    storefrontPassword: "password-only-for-test",
    passwordShopDomain: "another.myshopify.com"
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.authenticated, false);
});

test("admite un dominio personalizado solo cuando coincide con la URL durable", async () => {
  const html = '<script>window.TIENDAIQ_DATA = {}</script><div id="app" data-ssr="1"></div><script src="/assets/tiendaiq.js"></script>';
  const url = "https://tienda.example/products/demo";
  const result = await queryStorefrontCertification(async () => ({
    ok: true,
    status: 200,
    url,
    headers: { get(name) { return name === "content-type" ? "text/html" : null; } },
    body: null,
    async text() { return html; }
  }), url, url);
  assert.equal(result.ok, true);
  await assert.rejects(
    queryStorefrontCertification(async () => { throw new Error("no debe ejecutarse"); }, url, "https://otro.example/products/demo"),
    /storefront_url_not_allowed/
  );
});

test("consulta Shopify con la sesion resuelta y devuelve solo el contrato necesario", async () => {
  const session = { tienda: "certification.myshopify.com", token: "token-secreto" };
  const calls = [];
  const gql = async (query, variables, receivedSession, options) => {
    calls.push({ query, variables, receivedSession, options });
    if (query.includes("currentAppInstallation")) {
      return {
        currentAppInstallation: {
          accessScopes: [{ handle: "read_products" }],
          activeSubscriptions: [{ name: "TiendaIQ Pro", status: "ACTIVE", test: true }]
        },
        webhookSubscriptions: { edges: [{ node: { topic: "APP_UNINSTALLED", uri: "https://staging/webhooks" } }] }
      };
    }
    return { product: { id: "gid://shopify/Product/42", metafield: { type: "json", value: "{}" } } };
  };

  const result = await queryShopifyCertification(gql, session, "gid://shopify/Product/42", { signal: "signal" });
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.receivedSession === session), true);
  assert.equal(calls.every((call) => call.options.signal === "signal"), true);
  assert.deepEqual(result.scopes, ["read_products"]);
  assert.equal(Object.hasOwn(result, "token"), false);
  assert.match(calls[1].query, /onlineStorePreviewUrl/);
});

test("lee evidencia bajo TenantContext y fija la pagina exacta dentro de la transaccion", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM public.paginas")) {
        return { rows: [{
          page_id: "page-certification",
          shopify_product_id: "gid://shopify/Product/42",
          job_id: "job-42",
          public_url: "https://certification.myshopify.com/products/demo",
          content_hash: pageHash,
          changes_pending: "false",
          last_job_error: null,
          completed_at: new Date("2026-08-17T12:00:00.000Z"),
          job_status: "succeeded",
          job_type: "publish-page",
          worker_release_sha: RELEASE_SHA
        }] };
      }
      if (sql.includes("FROM control_plane.privacy_requests")) {
        return { rows: [
          { type: "customers_data_request", completed_at: new Date("2026-08-17T12:01:00.000Z"), evidence_count: 1, worker_release_sha: RELEASE_SHA },
          { type: "customers_redact", completed_at: new Date("2026-08-17T12:02:00.000Z"), evidence_count: 1, worker_release_sha: RELEASE_SHA }
        ] };
      }
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE" }); }
  };
  const pool = { async connect() { calls.push({ sql: "CONNECT" }); return client; } };
  const repository = createShopifyCertificationRepository(pool);
  const tenant = TenantContext.fromShopDomain("certification.myshopify.com", { source: "internal-job" });
  const since = new Date("2026-08-17T00:00:00.000Z");

  const evidence = await repository.read(tenant, { since, pageId: "page-certification", releaseSha: RELEASE_SHA });

  assert.equal(evidence.publication.pageId, "page-certification");
  assert.equal(evidence.privacy.customers_redact.count, 1);
  const tenantConfig = calls.find((call) => call.sql.includes?.("set_config('app.tenant_id'"));
  const certificationConfig = calls.find((call) => call.sql.includes?.("set_config('app.certification_evidence'"));
  const publication = calls.find((call) => call.sql.includes?.("FROM public.paginas"));
  assert.deepEqual(tenantConfig.params, ["certification.myshopify.com"]);
  assert.deepEqual(certificationConfig.params, ["certification.myshopify.com"]);
  assert.deepEqual(publication.params, ["certification.myshopify.com", since, "page-certification", RELEASE_SHA]);
  assert.match(publication.sql, /j\.worker_release_sha = \$4/);
  assert.match(publication.sql, /j\.id::text = p\.datos->>'last_completed_job_id'/);
  assert.doesNotMatch(publication.sql, /result\s*->/);
  const privacy = calls.find((call) => call.sql.includes?.("FROM control_plane.privacy_requests"));
  assert.match(privacy.sql, /JOIN control_plane\.inbox_events e/);
  assert.match(privacy.sql, /e\.tenant_id IS NULL/);
  assert.match(privacy.sql, /pr\.tenant_id = e\.shop_domain/);
  assert.match(privacy.sql, /e\.tenant_id = pr\.tenant_id/);
  assert.match(privacy.sql, /e\.status = 'processed'/);
  assert.match(privacy.sql, /e\.worker_release_sha = \$4/);
  assert.deepEqual(calls.filter((call) => ["BEGIN", "COMMIT", "RELEASE"].includes(call.sql)).map((call) => call.sql), [
    "BEGIN", "COMMIT", "RELEASE"
  ]);
});

test("rechaza un contexto fabricado antes de abrir PostgreSQL", async () => {
  let connections = 0;
  const repository = createShopifyCertificationRepository({ async connect() { connections += 1; } });
  await assert.rejects(
    repository.read({ tenantId: "certification.myshopify.com" }, {
      since: new Date("2026-08-17T00:00:00.000Z"),
      pageId: "page-certification",
      releaseSha: RELEASE_SHA
    }),
    /TenantContext/
  );
  assert.equal(connections, 0);
});
