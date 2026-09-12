"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const { DEFINITIONS } = require("./page-pipeline");

const TARGET = path.join(__dirname, "..", "..", "extensions", "tiendaiq-widgets", "snippets", "tiq-product-information-v1.liquid");
const ROUTER_TARGET = path.join(__dirname, "..", "..", "extensions", "tiendaiq-widgets", "snippets", "tiq-section-router.liquid");
const SECTION_CSS_TARGET = path.join(__dirname, "..", "..", "extensions", "tiendaiq-widgets", "assets", "tiq-section-page.css");

function targetFor(definition) {
  return path.join(__dirname, "..", "..", "extensions", "tiendaiq-widgets", "snippets", `tiq-${definition.id}-v${definition.version}.liquid`);
}

// Shopify aplica el límite de 100 KB al contenido Liquid agregado de la
// extensión. Compactamos únicamente los artefactos generados (no la fuente
// canónica) para conservar su hash y, a la vez, publicar sin comentarios ni
// sangrías innecesarias. No se alteran valores ni delimitadores Liquid.
function compactLiquid(source) {
  const compact = String(source)
    .replace(/{%-?\s*comment\s*-?%}[\s\S]*?{%-?\s*endcomment\s*-?%}/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*(?:\r?\n|$)/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  // Delimitadores Liquid aceptan whitespace opcional alrededor de la
  // expresión. Eliminamos sólo ese whitespace (no el que separa palabras
  // dentro de la expresión) para reducir el bundle sin tocar su semántica.
  const compactDelimiters = compact
    .replace(/{{\s*/g, "{{")
    .replace(/\s*}}/g, "}}")
    .replace(/\s*%}/g, "%}");

  // Shopify counts all Liquid inside an extension bundle. Compact only the
  // embedded CSS while protecting Liquid tags, so readable canonical sources
  // can ship below the platform limit without changing rendered values.
  const withCompactCss = compactDelimiters.replace(/<style>([\s\S]*?)<\/style>/gi, (_, body) => {
    const liquid = [];
    const css = body.replace(/({{[\s\S]*?}}|{%[\s\S]*?%})/g, (tag) => {
      liquid.push(tag);
      return `__TIQ_LIQUID_${liquid.length - 1}__`;
    }).replace(/\s+/g, " ")
      .replace(/\s*([{}:;,>+~])\s*/g, "$1")
      .replace(/\s*\(\s*/g, "(")
      .replace(/\s*\)\s*/g, ")")
      .replace(/;}/g, "}")
      .replace(/\b0(?:px|em|rem|%|vh|vw|s|ms)\b/g, "0")
      .replace(/#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3\b/gi, "#$1$2$3")
      .trim();
    return `<style>${css.replace(/__TIQ_LIQUID_(\d+)__/g, (_, index) => liquid[Number(index)])}</style>`;
  });

  const withCompactJavaScript = withCompactCss.replace(/<script>([\s\S]*?)<\/script>/gi, (_, body) => {
    const liquid = [];
    const protectedSource = body.replace(/{{[\s\S]*?}}/g, (tag) => {
      liquid.push(tag);
      return `TIQ_LIQUID_${liquid.length - 1}`;
    });
    try {
      const minified = esbuild.transformSync(protectedSource, {
        minify: true,
        legalComments: "none",
        target: "es2020"
      }).code.trim();
      return `<script>${minified.replace(/TIQ_LIQUID_(\d+)/g, (_, index) => liquid[Number(index)])}</script>`;
    } catch {
      // A future Liquid construct may not be valid JavaScript until Shopify
      // evaluates it. In that case keep the already compacted source intact.
      return `<script>${body.trim()}</script>`;
    }
  });

  // Shopify también cuenta la indentación y los saltos de línea del markup
  // Liquid. Protegemos CSS/JS y compactamos sólo el HTML/Liquid exterior;
  // reducir whitespace no cambia el texto visible porque los espacios
  // internos se conservan como un único espacio.
  const protectedBlocks = [];
  const compactMarkup = withCompactJavaScript.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, (block) => {
    protectedBlocks.push(block);
    return `__TIQ_PROTECTED_BLOCK_${protectedBlocks.length - 1}__`;
  })
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim()
    .replace(/__TIQ_PROTECTED_BLOCK_(\d+)__/g, (_, index) => protectedBlocks[Number(index)]);

  return compactMarkup;
}

function compileSection(source, sourceSha256, descriptor = "product-information@1") {
  const withoutSchema = String(source).replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}\s*$/, "");
  const sourceWithoutExternalCss = descriptor === "product-information@1"
    ? withoutSchema.replace(/<style>[\s\S]*?<\/style>\s*/i, "")
    : withoutSchema;
  const compiled = compactLiquid(sourceWithoutExternalCss
    .replace(/section\.settings/g, "tiq_section.instance.settings")
    .replace(/section\.blocks/g, "tiq_section.instance.blocks")
    .replace(/section\.id/g, "tiq_section.id")
    .replace(/{{\s*block\.shopify_attributes\s*}}/g, 'data-tiq-block-id="{{ block.id | escape }}"'));
  return `{% comment %}gen ${descriptor} ${sourceSha256}{% endcomment %}\n${compiled.trimEnd()}\n`;
}

function compileSectionCss(definition) {
  if (!definition || definition.id !== "product-information") return "";
  const match = String(definition.source).match(/<style>([\s\S]*?)<\/style>/i);
  if (!match) return "";
  const token = "\\{\\{\\s*section_dom_id\\s*\\}\\}";
  const prefix = "product-hero-";
  const classSuffix = (value) => `[class^="${prefix}"][class$="__${value}"]`;
  const idSuffix = (value) => `[id^="${prefix}"][id$="__${value}"]`;
  const css = match[1]
    .replace(new RegExp(`#${token}__([a-z0-9_-]+)`, "gi"), (_, value) => idSuffix(value))
    .replace(new RegExp(`\\.${token}__([a-z0-9_-]+)`, "gi"), (_, value) => classSuffix(value))
    .replace(new RegExp(`#${token}`, "gi"), `[id^="${prefix}"]`)
    .replace(new RegExp(`\\{\\{\\s*section_dom_id\\s*\\}\\}-urgency-float`, "gi"), "tiq-product-information-urgency-float")
    .replace(/\{\{\s*section\.settings\.image_fit\s*\}\}/g, "var(--hero-image-fit)");
  const compact = compactLiquid(`<style>${css}</style>`);
  return `${compact.replace(/^<style>|<\/style>$/g, "").trim()}\n`;
}

function compileRouter(definitions = DEFINITIONS) {
  const branches = definitions.map((definition, index) => {
    const condition = `${index === 0 ? "if" : "elsif"} tiq_section.definition.id == '${definition.id}' and tiq_section.definition.version == ${definition.version}`;
    return `  {%- ${condition} -%}\n    {% render 'tiq-${definition.id}-v${definition.version}', tiq_section: tiq_section, product: product %}`;
  }).join("\n");
  return `{% comment %}gen router{% endcomment %}\n${branches}\n  {%- endif -%}\n`;
}

function build({ write = true } = {}) {
  const artifacts = DEFINITIONS.map((definition) => ({
    definition,
    target: targetFor(definition),
    output: compileSection(definition.source, definition.sourceSha256, `${definition.id}@${definition.version}`)
  }));
  const router = { target: ROUTER_TARGET, output: compileRouter() };
  const sectionCss = { target: SECTION_CSS_TARGET, output: compileSectionCss(DEFINITIONS.find((definition) => definition.id === "product-information")) };
  if (write) {
    for (const artifact of artifacts) {
      fs.mkdirSync(path.dirname(artifact.target), { recursive: true });
      fs.writeFileSync(artifact.target, artifact.output, "utf8");
    }
    fs.writeFileSync(router.target, router.output, "utf8");
    fs.writeFileSync(sectionCss.target, sectionCss.output, "utf8");
  }
  const primary = artifacts.find((artifact) => artifact.target === TARGET) || artifacts[0];
  return { output: primary.output, target: primary.target, artifacts, router, sectionCss };
}

function verify() {
  const { artifacts, router, sectionCss } = build({ write: false });
  for (const { output, target } of artifacts) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output) {
      throw new Error(`La sección publicada ${path.basename(target)} no coincide con la fuente canónica. Ejecutá npm run construir:secciones.`);
    }
  }
  if (!fs.existsSync(router.target) || fs.readFileSync(router.target, "utf8") !== router.output) {
    throw new Error("El router de secciones publicado no coincide con el registro. Ejecutá npm run construir:secciones.");
  }
  if (!fs.existsSync(sectionCss.target) || fs.readFileSync(sectionCss.target, "utf8") !== sectionCss.output) {
    throw new Error("El CSS externo de la página por secciones no coincide con la fuente. Ejecutá npm run construir:secciones.");
  }
  return [...artifacts.map((artifact) => artifact.target), router.target, sectionCss.target];
}

if (require.main === module) {
  if (process.argv.includes("--verify")) verify();
  else build();
}

module.exports = Object.freeze({ ROUTER_TARGET, SECTION_CSS_TARGET, TARGET, build, compileRouter, compileSection, compileSectionCss, targetFor, verify });
