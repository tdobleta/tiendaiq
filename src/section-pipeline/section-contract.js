"use strict";

const crypto = require("node:crypto");

class SectionContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "SectionContractError";
    this.code = "SECTION_CONTRACT_INVALID";
    this.status = 422;
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function schemaFromLiquid(source) {
  const match = String(source || "").match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  if (!match) throw new SectionContractError("La sección no contiene un schema de Shopify");
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new SectionContractError(`El schema Shopify no es JSON válido: ${error.message}`);
  }
}

function assertUniqueIds(settings, where) {
  const seen = new Set();
  for (const setting of settings || []) {
    if (["header", "paragraph"].includes(setting.type)) continue;
    if (!setting.id) throw new SectionContractError(`${where}: hay un control sin id`);
    if (seen.has(setting.id)) throw new SectionContractError(`${where}: id duplicado ${setting.id}`);
    seen.add(setting.id);
  }
}

function validateSchema(schema) {
  if (!schema || typeof schema !== "object" || !schema.name) {
    throw new SectionContractError("El schema necesita un nombre");
  }
  assertUniqueIds(schema.settings, "settings");
  const blockTypes = new Set();
  for (const block of schema.blocks || []) {
    if (!block.type || blockTypes.has(block.type)) {
      throw new SectionContractError(`Tipo de bloque inválido o duplicado: ${block.type || "vacío"}`);
    }
    blockTypes.add(block.type);
    assertUniqueIds(block.settings, `blocks.${block.type}`);
  }
  return schema;
}

function editorContract(schema) {
  const groups = [];
  let current = { id: "general", label: "General", fields: [] };
  for (const setting of schema.settings || []) {
    if (setting.type === "header") {
      if (current.fields.length) groups.push(current);
      current = {
        id: `group-${groups.length + 1}`,
        label: setting.content,
        fields: []
      };
    } else if (setting.type !== "paragraph") {
      current.fields.push(clone(setting));
    }
  }
  if (current.fields.length) groups.push(current);
  return Object.freeze({
    groups: Object.freeze(groups),
    blocks: Object.freeze((schema.blocks || []).map((block) => Object.freeze({
      type: block.type,
      name: block.name,
      limit: block.limit ?? null,
      fields: Object.freeze(clone(block.settings || []))
    })))
  });
}

function defaultsFrom(settings) {
  return Object.fromEntries((settings || [])
    .filter((setting) => setting.id && Object.hasOwn(setting, "default"))
    .map((setting) => [setting.id, clone(setting.default)]));
}

function defaultInstance(schema) {
  const preset = schema.presets?.[0] || {};
  return {
    settings: { ...defaultsFrom(schema.settings), ...clone(preset.settings || {}) },
    blocks: (preset.blocks || []).map((block, index) => {
      const definition = (schema.blocks || []).find((entry) => entry.type === block.type);
      if (!definition) throw new SectionContractError(`El preset usa el bloque desconocido ${block.type}`);
      return {
        id: `block-${index + 1}`,
        type: block.type,
        settings: { ...defaultsFrom(definition.settings), ...clone(block.settings || {}) }
      };
    })
  };
}

function createSectionDefinition({ id, version, source, adaptation }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !Number.isInteger(version) || version < 1) {
    throw new SectionContractError("La identidad de la sección es inválida");
  }
  const schema = validateSchema(schemaFromLiquid(source));
  const sourceSha256 = sha256(source);
  const editor = editorContract(schema);
  const seed = defaultInstance(schema);
  return Object.freeze({
    id, version, source, sourceSha256, schema: Object.freeze(schema), editor, seed: Object.freeze(seed),
    adapt(product, research = {}) {
      const before = sourceSha256;
      const result = adaptation({ product: clone(product || {}), research: clone(research || {}), seed: clone(seed) });
      if (sha256(source) !== before) throw new SectionContractError("La adaptación intentó modificar el diseño de la sección");
      return validateInstance({ definition: this, instance: result });
    }
  });
}

function validateInstance({ definition, instance }) {
  const allowedSettings = new Set((definition.schema.settings || []).map((setting) => setting.id).filter(Boolean));
  for (const key of Object.keys(instance?.settings || {})) {
    if (!allowedSettings.has(key)) throw new SectionContractError(`Setting no autorizado: ${key}`);
  }
  const blockMap = new Map((definition.schema.blocks || []).map((block) => [block.type, block]));
  for (const block of instance?.blocks || []) {
    const blockDefinition = blockMap.get(block.type);
    if (!blockDefinition) throw new SectionContractError(`Bloque no autorizado: ${block.type}`);
    const allowed = new Set((blockDefinition.settings || []).map((setting) => setting.id).filter(Boolean));
    for (const key of Object.keys(block.settings || {})) {
      if (!allowed.has(key)) throw new SectionContractError(`${block.type}: setting no autorizado ${key}`);
    }
    if (block.binding != null) {
      const keys = Object.keys(block.binding);
      if (keys.some((key) => !["variantId", "quantity"].includes(key))) {
        throw new SectionContractError(`${block.type}: conexión interna no autorizada`);
      }
      if (block.binding.variantId != null && !/^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/.test(String(block.binding.variantId))) {
        throw new SectionContractError(`${block.type}: variante Shopify inválida`);
      }
      if (block.binding.quantity != null && (!Number.isInteger(block.binding.quantity) || block.binding.quantity < 1 || block.binding.quantity > 99)) {
        throw new SectionContractError(`${block.type}: cantidad inválida`);
      }
    }
  }
  return Object.freeze(clone(instance));
}

module.exports = Object.freeze({
  SectionContractError,
  createSectionDefinition,
  defaultInstance,
  editorContract,
  schemaFromLiquid,
  sha256,
  validateInstance
});
