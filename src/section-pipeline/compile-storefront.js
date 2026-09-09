"use strict";

const fs = require("node:fs");
const path = require("node:path");
const productInformation = require("./product-information-v1");

const TARGET = path.join(__dirname, "..", "..", "extensions", "tiendaiq-widgets", "snippets", "tiq-product-information-v1.liquid");

function compileSection(source, sourceSha256) {
  const withoutSchema = String(source).replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}\s*$/, "");
  const compiled = withoutSchema
    .replace(/section\.settings/g, "tiq_section.instance.settings")
    .replace(/section\.blocks/g, "tiq_section.instance.blocks")
    .replace(/section\.id/g, "tiq_section.id")
    .replace(/{{\s*block\.shopify_attributes\s*}}/g, 'data-tiq-block-id="{{ block.id | escape }}"');
  return `{% comment %} GENERATED from product-information@1 · ${sourceSha256}. Do not edit. {% endcomment %}\n${compiled.trimEnd()}\n`;
}

function build({ write = true } = {}) {
  const output = compileSection(productInformation.source, productInformation.sourceSha256);
  if (write) {
    fs.mkdirSync(path.dirname(TARGET), { recursive: true });
    fs.writeFileSync(TARGET, output, "utf8");
  }
  return { output, target: TARGET };
}

function verify() {
  const { output, target } = build({ write: false });
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output) {
    throw new Error("La sección publicada no coincide con la fuente canónica. Ejecutá npm run construir:secciones.");
  }
  return target;
}

if (require.main === module) {
  if (process.argv.includes("--verify")) verify();
  else build();
}

module.exports = Object.freeze({ TARGET, build, compileSection, verify });
