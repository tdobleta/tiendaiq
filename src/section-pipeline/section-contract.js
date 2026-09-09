"use strict";

const crypto = require("node:crypto");
const { sanear, urlSegura } = require("../../nucleo/resolver");

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

function validateOutline(schema, outline) {
  const settingIds = new Set((schema.settings || []).filter((item) => item.id).map((item) => item.id));
  const blockTypes = new Set((schema.blocks || []).map((item) => item.type));
  const usedIds = new Set();
  const usedBlockTypes = new Set();

  function visit(nodes, where = "editor.outline") {
    if (!Array.isArray(nodes)) throw new SectionContractError(`${where}: debe ser una lista`);
    for (const node of nodes) {
      if (!node || typeof node !== "object" || !/^[a-z0-9][a-z0-9-]*$/.test(node.id || "") || !node.label) {
        throw new SectionContractError(`${where}: nodo editorial inválido`);
      }
      if (usedIds.has(node.id)) throw new SectionContractError(`${where}: id duplicado ${node.id}`);
      usedIds.add(node.id);
      const modes = [Array.isArray(node.children), Array.isArray(node.fields), Boolean(node.blockType)].filter(Boolean).length;
      if (modes !== 1) throw new SectionContractError(`${where}.${node.id}: debe declarar children, fields o blockType`);
      if (Array.isArray(node.fields)) {
        for (const fieldId of node.fields) {
          if (!settingIds.has(fieldId)) throw new SectionContractError(`${where}.${node.id}: setting desconocido ${fieldId}`);
        }
      }
      if (node.blockType) {
        if (!blockTypes.has(node.blockType)) throw new SectionContractError(`${where}.${node.id}: bloque desconocido ${node.blockType}`);
        if (usedBlockTypes.has(node.blockType)) throw new SectionContractError(`${where}: bloque repetido ${node.blockType}`);
        usedBlockTypes.add(node.blockType);
      }
      if (Array.isArray(node.children)) visit(node.children, `${where}.${node.id}.children`);
    }
  }

  visit(outline || []);
  return clone(outline || []);
}

function editorContract(schema, outline = []) {
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
    }))),
    outline: Object.freeze(validateOutline(schema, outline))
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

function createSectionDefinition({ id, version, source, adaptation, outline = [] }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !Number.isInteger(version) || version < 1) {
    throw new SectionContractError("La identidad de la sección es inválida");
  }
  const schema = validateSchema(schemaFromLiquid(source));
  const sourceSha256 = sha256(source);
  const editor = editorContract(schema, outline);
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

function normalizeValue(setting, value, where) {
  if (value == null) return value;
  switch (setting.type) {
    case "checkbox":
      if (typeof value !== "boolean") throw new SectionContractError(`${where}: debe ser verdadero o falso`);
      return value;
    case "range": {
      const number = Number(value);
      if (!Number.isFinite(number) || number < setting.min || number > setting.max) {
        throw new SectionContractError(`${where}: número fuera del rango permitido`);
      }
      return number;
    }
    case "select":
      if (!(setting.options || []).some((option) => option.value === value)) {
        throw new SectionContractError(`${where}: opción no permitida`);
      }
      return value;
    case "color":
      if (typeof value !== "string" || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) {
        throw new SectionContractError(`${where}: color inválido`);
      }
      return value;
    case "url": {
      if (typeof value !== "string" || value.length > 2048) throw new SectionContractError(`${where}: enlace inválido`);
      if (value && !value.startsWith("#") && !value.startsWith("shopify://") && !urlSegura(value)) {
        throw new SectionContractError(`${where}: enlace no permitido`);
      }
      return value;
    }
    case "image_picker":
      if (value === "" || value === null) return value;
      if (typeof value !== "string" || value.length > 2048 || (!value.startsWith("shopify://") && !urlSegura(value, { media: true }))) {
        throw new SectionContractError(`${where}: imagen no permitida`);
      }
      return value;
    case "richtext":
      if (typeof value !== "string" || value.length > 40000) throw new SectionContractError(`${where}: texto enriquecido inválido`);
      return sanear(value);
    case "textarea":
      if (typeof value !== "string" || value.length > 20000) throw new SectionContractError(`${where}: texto inválido`);
      return value;
    default:
      if (typeof value !== "string" || value.length > 5000) throw new SectionContractError(`${where}: texto inválido`);
      return value;
  }
}

function normalizeSettings(definitions, values, where) {
  const definitionMap = new Map((definitions || []).filter((item) => item.id).map((item) => [item.id, item]));
  const normalized = {};
  for (const [key, value] of Object.entries(values || {})) {
    const setting = definitionMap.get(key);
    if (!setting) throw new SectionContractError(`Setting no autorizado: ${key}`);
    normalized[key] = normalizeValue(setting, value, `${where}.${key}`);
  }
  return normalized;
}

function validateInstance({ definition, instance }) {
  const settings = normalizeSettings(definition.schema.settings, instance?.settings, "section");
  const blockMap = new Map((definition.schema.blocks || []).map((block) => [block.type, block]));
  const blocks = (instance?.blocks || []).map((block) => {
    const blockDefinition = blockMap.get(block.type);
    if (!blockDefinition) throw new SectionContractError(`Bloque no autorizado: ${block.type}`);
    const normalizedBlock = { ...block, settings: normalizeSettings(blockDefinition.settings, block.settings, block.type) };
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
    return normalizedBlock;
  });
  return Object.freeze(clone({ settings, blocks }));
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
