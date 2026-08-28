"use strict";

const crypto = require("crypto");

function normalizedUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function publicationUrlFromShopify(product, expectedShop) {
  const primary = String(product?.onlineStoreUrl || "").trim();
  if (primary) return { url: primary, source: "online_store_url" };

  const preview = String(product?.onlineStorePreviewUrl || "").trim();
  const expectedHost = String(expectedShop || "").trim().toLowerCase();
  if (!preview || !expectedHost) return { url: null, source: null };

  try {
    const url = new URL(preview);
    const isExactStagingShop = url.protocol === "https:" &&
      url.host.toLowerCase() === expectedHost &&
      !url.username && !url.password &&
      !url.search && !url.hash;
    return isExactStagingShop
      ? { url: url.href, source: "online_store_preview_url" }
      : { url: null, source: "online_store_preview_url_rejected" };
  } catch {
    return { url: null, source: "online_store_preview_url_rejected" };
  }
}

function certificationUrlDiagnostic(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      present: false,
      valid: false,
      protocol: null,
      host: null,
      path: null,
      search: { present: false, keys: [], signature: null },
      trailingSlash: false,
      normalized: null
    };
  }

  try {
    const url = new URL(raw);
    const path = url.pathname || "/";
    const trailingSlash = path.length > 1 && path.endsWith("/");
    const normalizedPath = trailingSlash ? path.replace(/\/+$/, "") : path;
    const searchKeys = [...new Set([...url.searchParams.keys()].map((key) => key.slice(0, 80)))].sort();
    const search = url.search || "";
    const redactedSearch = searchKeys.length
      ? `?${searchKeys.map((key) => `${encodeURIComponent(key)}=[redacted]`).join("&")}`
      : "";

    return {
      present: true,
      valid: true,
      protocol: url.protocol.toLowerCase(),
      host: url.host.toLowerCase(),
      path,
      search: {
        present: Boolean(search),
        keys: searchKeys,
        signature: search
          ? crypto.createHash("sha256").update(search).digest("hex").slice(0, 16)
          : null
      },
      trailingSlash,
      normalized: `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${normalizedPath}${redactedSearch}`
    };
  } catch {
    return {
      present: true,
      valid: false,
      protocol: null,
      host: null,
      path: null,
      search: { present: false, keys: [], signature: null },
      trailingSlash: false,
      normalized: null
    };
  }
}

function setOf(values) {
  return new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean));
}

function equivalentWriteScope(scope) {
  return scope.startsWith("read_") ? `write_${scope.slice("read_".length)}` : null;
}

function evaluateScopeEquivalence(requiredScopes, grantedScopes) {
  const expected = setOf(requiredScopes);
  const granted = setOf(grantedScopes);
  const missing = [...expected].filter((scope) => !granted.has(scope));
  const unexpected = [...granted].filter((scope) => !expected.has(scope));
  const compatibleReadExtras = unexpected.filter((scope) => {
    const writeScope = equivalentWriteScope(scope);
    return writeScope && expected.has(writeScope) && granted.has(writeScope);
  });
  const incompatibleUnexpected = unexpected.filter((scope) => !compatibleReadExtras.includes(scope));

  return {
    ok: missing.length === 0 && incompatibleUnexpected.length === 0,
    expected,
    granted,
    missing,
    unexpected,
    compatibleReadExtras,
    incompatibleUnexpected
  };
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

function storefrontMarkers(html) {
  return {
    data: html.includes("window.TIENDAIQ_DATA ="),
    app: /<div[^>]+id=["']app["'][^>]+data-ssr=/.test(html),
    asset: /<script[^>]+src=["'][^"']*tiendaiq\.js(?:\?[^"']*)?["']/.test(html)
  };
}

async function inspectStorefrontResponse(response, requested, maxBytes) {
  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  const finalUrl = new URL(String(response.url || requested));
  const urlMatch = normalizedUrl(finalUrl.href) === normalizedUrl(requested.href) &&
    finalUrl.protocol === "https:" && finalUrl.hostname.toLowerCase() === requested.hostname.toLowerCase();
  const html = await readTextLimited(response, maxBytes);
  const markers = storefrontMarkers(html);
  return {
    ok: response.ok && contentType.includes("text/html") && urlMatch && Object.values(markers).every(Boolean),
    status: Number(response.status) || 0,
    html: contentType.includes("text/html"),
    urlMatch,
    markers,
    bytes: Buffer.byteLength(html, "utf8")
  };
}

function cookieHeaderFrom(response) {
  const headers = response?.headers;
  const values = typeof headers?.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers?.get?.("set-cookie")].filter(Boolean);
  return values
    .flatMap((value) => String(value || "").split(/,(?=[^;,=\s]+=[^;,]+)/))
    .map((value) => value.split(";", 1)[0].trim())
    .filter((value) => /^[^=;\s]+=[^;\r\n]+$/.test(value))
    .join("; ");
}

function passwordMayBeUsedFor({ password, passwordShopDomain, requested }) {
  const allowedHost = String(passwordShopDomain || "").trim().toLowerCase();
  return Boolean(password && allowedHost && requested.protocol === "https:" && requested.hostname.toLowerCase() === allowedHost);
}

async function queryStorefrontCertification(fetchFn, storefrontUrl, expectedPublishedUrl, {
  signal,
  maxBytes = 2_000_000,
  storefrontPassword,
  passwordShopDomain
} = {}) {
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
  const initial = await inspectStorefrontResponse(response, requested, maxBytes);
  if (initial.ok || !passwordMayBeUsedFor({ password: storefrontPassword, passwordShopDomain, requested })) {
    return { ...initial, authenticated: false };
  }

  // The password is only submitted to the configured Partner shop. Its
  // process-local cookie never appears in the certification response or logs.
  const passwordUrl = new URL("/password", requested.origin);
  const loginResponse = await fetchFn(passwordUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "text/html",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "TiendaIQ-Staging-Certification/1.0"
    },
    body: new URLSearchParams({
      form_type: "storefront_password",
      password: String(storefrontPassword),
      return_url: `${requested.pathname}${requested.search}`
    }).toString(),
    signal
  });
  const cookie = cookieHeaderFrom(loginResponse);
  if (!cookie) return { ...initial, authenticated: false, authenticationAttempted: true };

  const authenticatedResponse = await fetchFn(requested, {
    method: "GET",
    redirect: "manual",
    headers: {
      Accept: "text/html",
      Cookie: cookie,
      "User-Agent": "TiendaIQ-Staging-Certification/1.0"
    },
    signal
  });
  return {
    ...(await inspectStorefrontResponse(authenticatedResponse, requested, maxBytes)),
    authenticated: true,
    authenticationAttempted: true
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
          onlineStorePreviewUrl
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
  shopDomain,
  planName,
  planTest,
  releaseSha,
  evidence,
  remote
}) {
  const errors = [];
  const scopeComparison = evaluateScopeEquivalence(requiredScopes, remote?.scopes);
  const scopesOk = scopeComparison.ok;
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
  const shopifyPublicationUrl = publicationUrlFromShopify(product, shopDomain);
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
    product?.templateSuffix === "tiendaiq" && shopifyPublicationUrl.url &&
    product?.metafield?.id && product?.metafield?.type === "json" && validJson &&
    remoteHash === publication.contentHash &&
    normalizedUrl(shopifyPublicationUrl.url) === normalizedUrl(publication.publicUrl)
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
      scopes: {
        ok: scopesOk,
        expected: scopeComparison.expected.size,
        granted: scopeComparison.granted.size,
        missing: scopeComparison.missing,
        unexpected: scopeComparison.incompatibleUnexpected,
        compatibleReadExtras: scopeComparison.compatibleReadExtras
      },
      billing: { ok: billingOk, testMode: planTest === true },
      operationalWebhooks: { ok: webhooksOk, expected: expectedTopics.size, matched: matchingTopics.size },
      publicationDatabase: { ok: databasePublicationOk, recentEvidence: Boolean(publication), releaseMatch: publication?.workerReleaseSha === releaseSha },
      publicationShopify: {
        ok: shopifyPublicationOk,
        contentHashMatch: remoteHash === publication?.contentHash,
        publicUrlMatch: normalizedUrl(shopifyPublicationUrl.url) === normalizedUrl(publication?.publicUrl),
        publicUrlComparison: {
          persisted: certificationUrlDiagnostic(publication?.publicUrl),
          shopify: certificationUrlDiagnostic(shopifyPublicationUrl.url),
          source: shopifyPublicationUrl.source
        }
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
  evaluateScopeEquivalence,
  queryShopifyCertification,
  queryStorefrontCertification,
  evaluateShopifyCertification,
  publicationUrlFromShopify,
  certificationUrlDiagnostic,
  normalizedUrl
};
