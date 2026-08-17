"use strict";

const crypto = require("crypto");

function normalizedUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function setOf(values) {
  return new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean));
}

async function readTextLimited(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("storefront_response_too_large");
  if (!response.body?.getReader) {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maxBytes) throw new Error("storefront_response_too_large");
    return body;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("storefront_response_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function queryStorefrontCertification(fetchFn, storefrontUrl, expectedPublishedUrl, { signal, maxBytes = 2_000_000 } = {}) {
  if (typeof fetchFn !== "function") throw new TypeError("Se requiere fetch para verificar el storefront");
  const requested = new URL(String(storefrontUrl || ""));
  const expected = new URL(String(expectedPublishedUrl || ""));
  if (requested.protocol !== "https:" || expected.protocol !== "https:" ||
      normalizedUrl(requested.href) !== normalizedUrl(expected.href)) {
    throw new Error("storefront_url_not_allowed");
  }
  const response = await fetchFn(requested, {
    method: "GET",
    redirect: "follow",
    headers: { Accept: "text/html", "User-Agent": "TiendaIQ-Staging-Certification/1.0" },
    signal
  });
  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  const finalUrl = new URL(String(response.url || requested));
  const urlMatch = normalizedUrl(finalUrl.href) === normalizedUrl(requested.href) &&
    finalUrl.protocol === "https:" && finalUrl.hostname.toLowerCase() === requested.hostname.toLowerCase();
  const html = await readTextLimited(response, maxBytes);
  const markers = {
    data: html.includes("window.TIENDAIQ_DATA ="),
    app: /<div[^>]+id=["']app["'][^>]+data-ssr=/.test(html),
    asset: /<script[^>]+src=["'][^"']*tiendaiq\.js(?:\?[^"']*)?["']/.test(html)
  };
  return {
    ok: response.ok && contentType.includes("text/html") && urlMatch && Object.values(markers).every(Boolean),
    status: Number(response.status) || 0,
    html: contentType.includes("text/html"),
    urlMatch,
    markers,
    bytes: Buffer.byteLength(html, "utf8")
  };
}

async function queryShopifyCertification(gql, session, productId, { signal } = {}) {
  if (typeof gql !== "function") throw new TypeError("Se requiere el cliente GraphQL");
  const installation = await gql(
    `query TiendaIQCertification($topics: [WebhookSubscriptionTopic!]) {
      currentAppInstallation {
        accessScopes { handle }
        activeSubscriptions { name status test }
      }
      webhookSubscriptions(first: 50, topics: $topics) {
        edges { node { topic uri } }
      }
    }`,
    { topics: ["APP_UNINSTALLED", "APP_SUBSCRIPTIONS_UPDATE"] },
    session,
    { signal }
  );

  let product = null;
  if (productId) {
    const productResult = await gql(
      `query TiendaIQCertifiedProduct($id: ID!) {
        product(id: $id) {
          id
          templateSuffix
          onlineStoreUrl
          metafield(namespace: "tiendaiq", key: "pagina") { id type value }
        }
      }`,
      { id: productId },
      session,
      { signal }
    );
    product = productResult?.product || null;
  }

  return {
    scopes: (installation?.currentAppInstallation?.accessScopes || []).map((item) => item?.handle),
    subscriptions: installation?.currentAppInstallation?.activeSubscriptions || [],
    webhooks: (installation?.webhookSubscriptions?.edges || []).map((edge) => edge?.node).filter(Boolean),
    product
  };
}

function evaluateShopifyCertification({
  requiredScopes,
  requiredTopics,
  expectedWebhookUrl,
  planName,
  planTest,
  releaseSha,
  evidence,
  remote
}) {
  const errors = [];
  const expectedScopes = setOf(requiredScopes);
  const actualScopes = setOf(remote?.scopes);
  const missingScopes = [...expectedScopes].filter((scope) => !actualScopes.has(scope));
  const unexpectedScopes = [...actualScopes].filter((scope) => !expectedScopes.has(scope));
  const scopesOk = missingScopes.length === 0 && unexpectedScopes.length === 0;
  if (!scopesOk) errors.push("scopes_not_exact");

  const billingOk = planTest === true && (remote?.subscriptions || []).some((subscription) =>
    subscription?.name === planName && subscription?.status === "ACTIVE" && subscription?.test === true
  );
  if (!billingOk) errors.push("test_billing_not_active");

  const expectedTopics = setOf(requiredTopics);
  const matchingTopics = new Set(
    (remote?.webhooks || [])
      .filter((webhook) => normalizedUrl(webhook?.uri) === normalizedUrl(expectedWebhookUrl))
      .map((webhook) => webhook.topic)
  );
  const webhooksOk = [...expectedTopics].every((topic) => matchingTopics.has(topic));
  if (!webhooksOk) errors.push("operational_webhooks_incomplete");

  const publication = evidence?.publication;
  const product = remote?.product;
  const metafieldValue = String(product?.metafield?.value || "");
  let validJson = false;
  try {
    JSON.parse(metafieldValue);
    validJson = true;
  } catch {}
  const remoteHash = metafieldValue
    ? crypto.createHash("sha256").update(metafieldValue).digest("hex")
    : null;
  const databasePublicationOk = Boolean(
    publication?.productId && publication?.jobId && publication?.jobStatus === "succeeded" &&
    publication?.jobType === "publish-page" && publication?.completedAt &&
    publication?.changesPending === false && publication?.lastJobError === null &&
    /^[a-f0-9]{64}$/.test(publication?.contentHash || "") &&
    /^https:\/\//.test(publication?.publicUrl || "") && publication?.workerReleaseSha === releaseSha
  );
  const shopifyPublicationOk = Boolean(
    databasePublicationOk && product?.id === publication.productId &&
    product?.templateSuffix === "tiendaiq" && product?.onlineStoreUrl &&
    product?.metafield?.id && product?.metafield?.type === "json" && validJson &&
    remoteHash === publication.contentHash &&
    normalizedUrl(product.onlineStoreUrl) === normalizedUrl(publication.publicUrl)
  );
  if (!databasePublicationOk) errors.push("durable_publication_not_verified");
  if (!shopifyPublicationOk) errors.push("shopify_publication_not_verified");

  const storefrontOk = remote?.storefront?.ok === true;
  if (!storefrontOk) errors.push("storefront_not_verified");

  const dataRequestOk = Number(evidence?.privacy?.customers_data_request?.count) > 0 &&
    evidence?.privacy?.customers_data_request?.workerReleaseSha === releaseSha;
  const customerRedactOk = Number(evidence?.privacy?.customers_redact?.count) > 0 &&
    evidence?.privacy?.customers_redact?.workerReleaseSha === releaseSha;
  const privacyOk = dataRequestOk && customerRedactOk;
  if (!privacyOk) errors.push("privacy_webhook_evidence_incomplete");

  return {
    activeStoreOk: errors.length === 0,
    scope: "active_store_non_destructive",
    checks: {
      scopes: { ok: scopesOk, expected: expectedScopes.size, granted: actualScopes.size },
      billing: { ok: billingOk, testMode: planTest === true },
      operationalWebhooks: { ok: webhooksOk, expected: expectedTopics.size, matched: matchingTopics.size },
      publicationDatabase: { ok: databasePublicationOk, recentEvidence: Boolean(publication), releaseMatch: publication?.workerReleaseSha === releaseSha },
      publicationShopify: {
        ok: shopifyPublicationOk,
        contentHashMatch: remoteHash === publication?.contentHash,
        publicUrlMatch: normalizedUrl(product?.onlineStoreUrl) === normalizedUrl(publication?.publicUrl)
      },
      storefront: { ok: storefrontOk, ...(remote?.storefront || {}) },
      privacyDeliveries: { ok: privacyOk, dataRequest: dataRequestOk, customerRedact: customerRedactOk }
    },
    errors,
    destructiveShopRedact: {
      requiredSeparately: true,
      certifiedHere: false,
      blocksFullCertification: true
    },
    complianceWebhooks: {
      requiredSeparately: true,
      certifiedHere: false,
      blocksFullCertification: true,
      verificationSurface: "shopify_dev_dashboard_version_configuration"
    }
  };
}

module.exports = {
  queryShopifyCertification,
  queryStorefrontCertification,
  evaluateShopifyCertification,
  normalizedUrl
};
