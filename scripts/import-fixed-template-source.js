"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PINZA_PAGEPILOT_V1 } = require("../src/domain/fixed-template-manifest");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sourceFingerprint(source) {
  return sha256(source);
}

function sanitizeFixedTemplateSource(source) {
  // The source DOM and CSS remain intact. Scripts and external media do not:
  // behavior is owned by TiendaIQ and media must come from the merchant's
  // Shopify catalog, not another product's CDN.
  const withoutRemoteAssets = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\s(?:src|poster|data-image)=(['"])https?:\/\/[^'"]*\1/gi, ' data-tiq-remote-asset="removed"')
    // Alt text from a third-party source can contain the original product name.
    // The runtime writes merchant-product alt text after mounting.
    .replace(/\salt=(['"])[\s\S]*?\1/gi, ' alt=""')
    .replace(/<title>[\s\S]*?<\/title>/i, "<title>TiendaIQ fixed template</title>");

  const bodyStart = withoutRemoteAssets.search(/<body\b[^>]*>/i);
  const bodyEnd = withoutRemoteAssets.search(/<\/body>/i);
  if (bodyStart === -1 || bodyEnd === -1) return withoutRemoteAssets;

  const beforeBody = withoutRemoteAssets.slice(0, bodyStart);
  const bodyTagEnd = withoutRemoteAssets.indexOf(">", bodyStart) + 1;
  const body = withoutRemoteAssets.slice(bodyTagEnd, bodyEnd)
    // Preserve the visual scaffolding but never ship copied product marketing
    // as a default. TiendaIQ fills the visible slots from the merchant record.
    .replace(/>([^<]*[A-Za-zÁÉÍÓÚáéíóúÑñ][^<]*)</g, (match, content) => {
      const compact = content.replace(/\s+/g, " ").trim();
      if (!compact || compact.includes("{") || compact.includes("}")) return match;
      if (/^[★☆‹›+×⊙✓\s\d.,:%$]+$/.test(compact)) return match;
      return `>${content.replace(compact, "Contenido del producto")}<`;
    })
    .replace(/[ \t]+\r?\n/g, "\n");
  const afterBody = withoutRemoteAssets.slice(bodyEnd);
  return `${beforeBody}${withoutRemoteAssets.slice(bodyStart, bodyTagEnd)}${body}${afterBody}`;
}

function importSource({ sourcePath, outputPath }) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const fingerprint = sourceFingerprint(source);
  if (fingerprint !== PINZA_PAGEPILOT_V1.sourceSha256) {
    throw new Error("La fuente de la plantilla no coincide con la revisión aprobada");
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, sanitizeFixedTemplateSource(source), "utf8");
  return { fingerprint, outputPath };
}

if (require.main === module) {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) {
    throw new Error("Uso: node scripts/import-fixed-template-source.js <source.html> <output.html>");
  }
  const result = importSource({ sourcePath, outputPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = Object.freeze({ sha256, sourceFingerprint, sanitizeFixedTemplateSource, importSource });
