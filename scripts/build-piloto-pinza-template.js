"use strict";

// Rebuilds the distributed fixed-template runtime from the canonical ZIP
// source. This intentionally reuses the audited mounting/binding code from
// the earlier runtime; only the frozen visual source and template identity
// change. Do not hand-edit the generated runtime.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeFixedTemplateSource } = require("./import-fixed-template-source");
const { PILOTO_PINZA_PAGEPILOT_V1 } = require("../src/domain/fixed-template-manifest");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildPilotoPinzaTemplate({ root = path.resolve(__dirname, "..") } = {}) {
  const sourcePath = path.join(root, "template-sources", "piloto-pinzapilot-v1", "index.html");
  const runtimeTemplatePath = path.join(root, "extensions", "tiendaiq-widgets", "assets", "tiq-pinzapilot-v1.js");
  const outputPath = path.join(root, "extensions", "tiendaiq-widgets", "assets", PILOTO_PINZA_PAGEPILOT_V1.sourceFile);
  const source = fs.readFileSync(sourcePath, "utf8");
  const sourceHash = sha256(source);
  if (sourceHash !== PILOTO_PINZA_PAGEPILOT_V1.sourceInputSha256) {
    throw new Error("El ZIP canónico de Piloto Pinza no coincide con la revisión aprobada");
  }
  const artifact = sanitizeFixedTemplateSource(source);
  const artifactHash = sha256(artifact);
  if (artifactHash !== PILOTO_PINZA_PAGEPILOT_V1.sourceSha256) {
    throw new Error("El artefacto sanitizado de Piloto Pinza no coincide con su manifiesto");
  }
  const encoded = Buffer.from(artifact, "utf8").toString("base64");
  const runtime = fs.readFileSync(runtimeTemplatePath, "utf8")
    .replace('const TEMPLATE_ID = "tiendaiq/pinza-pagepilot@1";', 'const TEMPLATE_ID = "piloto/pinza-pagepilot@1";')
    .replace(/const FIXED_TEMPLATE_SOURCE_BASE64 = "[A-Za-z0-9+/=]+";/, `const FIXED_TEMPLATE_SOURCE_BASE64 = "${encoded}";`)
    .replace(/window\.TiendaIQPinzaPagepilotV1/g, "window.TiendaIQPilotoPinzaPagepilotV1");
  if (!runtime.includes('const TEMPLATE_ID = "piloto/pinza-pagepilot@1";') || !runtime.includes(encoded)) {
    throw new Error("No se pudo producir el runtime de Piloto Pinza");
  }
  fs.writeFileSync(outputPath, runtime, "utf8");
  return Object.freeze({ sourcePath, outputPath, sourceHash, artifactHash });
}

if (require.main === module) process.stdout.write(`${JSON.stringify(buildPilotoPinzaTemplate())}\n`);

module.exports = Object.freeze({ buildPilotoPinzaTemplate, sha256 });
