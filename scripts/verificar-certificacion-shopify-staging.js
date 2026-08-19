"use strict";

let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  try {
    const evidence = JSON.parse(body);
    const expectedRelease = String(process.env.EXPECTED_RELEASE_SHA || "");
    const expectedChecks = [
      "scopes",
      "billing",
      "operationalWebhooks",
      "publicationDatabase",
      "publicationShopify",
      "storefront",
      "privacyDeliveries"
    ];
    const actualChecks = Object.keys(evidence?.checks || {}).sort();
    const valid = evidence?.activeStoreOk === true &&
      evidence?.scope === "active_store_non_destructive" &&
      evidence?.release === expectedRelease &&
      JSON.stringify(actualChecks) === JSON.stringify([...expectedChecks].sort()) &&
      expectedChecks.every((name) => evidence.checks[name]?.ok === true) &&
      evidence?.destructiveShopRedact?.requiredSeparately === true &&
      evidence?.destructiveShopRedact?.certifiedHere === false &&
      evidence?.destructiveShopRedact?.blocksFullCertification === true &&
      evidence?.complianceWebhooks?.requiredSeparately === true &&
      evidence?.complianceWebhooks?.certifiedHere === false &&
      evidence?.complianceWebhooks?.blocksFullCertification === true;

    if (!valid) {
      console.error("La evidencia Shopify activa no satisface el contrato protegido");
      const errorCode = String(evidence?.error || "").replace(/[^a-z0-9_.:-]/gi, "");
      if (errorCode) console.error(`error=${errorCode}`);
      if (Array.isArray(evidence?.errors) && evidence.errors.length > 0) {
        const errors = evidence.errors
          .map((item) => String(item || "").replace(/[^a-z0-9_.:-]/gi, ""))
          .filter(Boolean);
        if (errors.length > 0) console.error(`errors=${errors.join(",")}`);
      }
      const checks = Object.entries(evidence?.checks || {})
        .map(([name, check]) => `${name}:${check?.ok === true ? "ok" : "fail"}`);
      if (checks.length > 0) console.error(`checks=${checks.join(",")}`);
      throw new Error("Contrato protegido incompleto");
    }
    console.log(`Shopify staging activo y preflight HTML del storefront verificados para release ${expectedRelease}`);
    console.log("La instalacion o reinstalacion OAuth completa sigue siendo evidencia E2E separada");
    console.log("La version desplegada de los compliance webhooks sigue siendo evidencia separada en Shopify Dev Dashboard");
    console.log("shop/redact sigue siendo un gate destructivo separado; el release completo permanece bloqueado hasta certificarlo");
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
});
