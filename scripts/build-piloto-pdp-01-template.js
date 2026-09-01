"use strict";

// Regenera el runtime distribuido de Piloto 01 desde la fuente canónica: la
// página de producto que el merchant diseñó y aprobó. El binder no se toca
// acá; sólo se reemplaza el artefacto saneado que el runtime monta.
// No editar a mano el blob del runtime.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeFixedTemplateSource } = require("./import-fixed-template-source");
const { PILOTO_PDP_01_V1 } = require("../src/domain/fixed-template-manifest");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Git conserva la fuente aprobada con LF, mientras que un checkout de Windows
// puede materializarla con CRLF. El fingerprint visual debe identificar el
// mismo HTML y no el sistema operativo que ejecutó el build.
function canonicalSource(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

function buildPilotoPdp01Template({ root = path.resolve(__dirname, "..") } = {}) {
  const sourcePath = path.join(root, "template-sources", "piloto-pdp-01", "index.html");
  const runtimePath = path.join(root, "extensions", "tiendaiq-widgets", "assets", PILOTO_PDP_01_V1.sourceFile);

  const source = canonicalSource(fs.readFileSync(sourcePath, "utf8"));
  const sourceHash = sha256(source);
  if (sourceHash !== PILOTO_PDP_01_V1.sourceInputSha256) {
    throw new Error("La fuente canónica de Piloto 01 no coincide con la revisión aprobada");
  }

  const artifact = sanitizeFixedTemplateSource(source);
  const artifactHash = sha256(artifact);
  if (artifactHash !== PILOTO_PDP_01_V1.sourceSha256) {
    throw new Error("El artefacto saneado de Piloto 01 no coincide con su manifiesto");
  }
  // Ningún asset puede quedar apuntando a la tienda de origen.
  if (/https?:\/\/cdn\.shopify\.com/i.test(artifact) || /<script/i.test(artifact)) {
    throw new Error("El artefacto de Piloto 01 conserva scripts o assets remotos");
  }

  const encoded = Buffer.from(artifact, "utf8").toString("base64");
  const runtime = fs.readFileSync(runtimePath, "utf8")
    .replace(/const FIXED_TEMPLATE_SOURCE_BASE64 = "[^"]*";/, `const FIXED_TEMPLATE_SOURCE_BASE64 = "${encoded}";`);

  if (!runtime.includes(encoded)) {
    throw new Error("No se pudo incrustar el artefacto en el runtime de Piloto 01");
  }
  fs.writeFileSync(runtimePath, runtime, "utf8");
  return Object.freeze({ sourcePath, runtimePath, sourceHash, artifactHash, artifactLength: artifact.length });
}

if (require.main === module) process.stdout.write(`${JSON.stringify(buildPilotoPdp01Template())}\n`);

module.exports = Object.freeze({ buildPilotoPdp01Template, sha256, canonicalSource });
