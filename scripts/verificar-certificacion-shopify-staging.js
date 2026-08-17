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

    if (!valid) throw new Error("La evidencia Shopify activa no satisface el contrato protegido");
    console.log(`Shopify staging activo y preflight HTML del storefront verificados para release ${expectedRelease}`);
    console.log("La instalacion o reinstalacion OAuth completa sigue siendo evidencia E2E separada");
    console.log("La version desplegada de los compliance webhooks sigue siendo evidencia separada en Shopify Dev Dashboard");
    console.log("shop/redact sigue siendo un gate destructivo separado; el release completo permanece bloqueado hasta certificarlo");
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
});
