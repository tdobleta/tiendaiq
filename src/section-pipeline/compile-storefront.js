"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DEFINITIONS } = require("./page-pipeline");

const TARGET = path.join(__dirname, "..", "..", "extensions", "tiendaiq-widgets", "snippets", "tiq-product-information-v1.liquid");
const ROUTER_TARGET = path.join(__dirname, "..", "..", "extensions", "tiendaiq-widgets", "snippets", "tiq-section-router.liquid");

function targetFor(definition) {
  return path.join(__dirname, "..", "..", "extensions", "tiendaiq-widgets", "snippets", `tiq-${definition.id}-v${definition.version}.liquid`);
}

function compileSection(source, sourceSha256, descriptor = "product-information@1") {
  const withoutSchema = String(source).replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}\s*$/, "");
  const compiled = withoutSchema
    .replace(/section\.settings/g, "tiq_section.instance.settings")
    .replace(/section\.blocks/g, "tiq_section.instance.blocks")
    .replace(/section\.id/g, "tiq_section.id")
    .replace(/{{\s*block\.shopify_attributes\s*}}/g, 'data-tiq-block-id="{{ block.id | escape }}"');
  return `{% comment %} GENERATED from ${descriptor} · ${sourceSha256}. Do not edit. {% endcomment %}\n${compiled.trimEnd()}\n`;
}

function compileRouter(definitions = DEFINITIONS) {
  const branches = definitions.map((definition, index) => {
    const condition = `${index === 0 ? "if" : "elsif"} tiq_section.definition.id == '${definition.id}' and tiq_section.definition.version == ${definition.version}`;
    return `  {%- ${condition} -%}\n    {% render 'tiq-${definition.id}-v${definition.version}', tiq_section: tiq_section, product: product %}`;
  }).join("\n");
  return `{% comment %} GENERATED section router. Do not edit. {% endcomment %}\n${branches}\n  {%- endif -%}\n`;
}

function build({ write = true } = {}) {
  const artifacts = DEFINITIONS.map((definition) => ({
    definition,
    target: targetFor(definition),
    output: compileSection(definition.source, definition.sourceSha256, `${definition.id}@${definition.version}`)
  }));
  const router = { target: ROUTER_TARGET, output: compileRouter() };
  if (write) {
    for (const artifact of artifacts) {
      fs.mkdirSync(path.dirname(artifact.target), { recursive: true });
      fs.writeFileSync(artifact.target, artifact.output, "utf8");
    }
    fs.writeFileSync(router.target, router.output, "utf8");
  }
  const primary = artifacts.find((artifact) => artifact.target === TARGET) || artifacts[0];
  return { output: primary.output, target: primary.target, artifacts, router };
}

function verify() {
  const { artifacts, router } = build({ write: false });
  for (const { output, target } of artifacts) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output) {
      throw new Error(`La sección publicada ${path.basename(target)} no coincide con la fuente canónica. Ejecutá npm run construir:secciones.`);
    }
  }
  if (!fs.existsSync(router.target) || fs.readFileSync(router.target, "utf8") !== router.output) {
    throw new Error("El router de secciones publicado no coincide con el registro. Ejecutá npm run construir:secciones.");
  }
  return [...artifacts.map((artifact) => artifact.target), router.target];
}

if (require.main === module) {
  if (process.argv.includes("--verify")) verify();
  else build();
}

module.exports = Object.freeze({ ROUTER_TARGET, TARGET, build, compileRouter, compileSection, targetFor, verify });
