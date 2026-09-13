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
        if (node.previewSuffixes != null && (!Array.isArray(node.previewSuffixes)
          || !node.previewSuffixes.length
          || node.previewSuffixes.some((suffix) => !/^__[a-z0-9-]{1,80}$/.test(suffix)))) {
          throw new SectionContractError(`${where}.${node.id}: selector de vista previa inválido`);
        }
      } else if (node.previewSuffixes != null) {
        throw new SectionContractError(`${where}.${node.id}: sólo un control editable puede señalar la vista previa`);
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

function normalizeCopySlots(schema, copySlots = {}) {
  const settings = new Set((schema.settings || []).filter((item) => item.id).map((item) => item.id));
  const blockSettings = new Map((schema.blocks || []).map((block) => [block.type, new Set((block.settings || []).filter((item) => item.id).map((item) => item.id))]));
  const normalizeFields = (fields, where, allowed) => {
    if (!Array.isArray(fields) || new Set(fields).size !== fields.length || fields.some((field) => !allowed.has(field))) {
      throw new SectionContractError(`${where}: slot de copy desconocido o duplicado`);
    }
    return Object.freeze([...fields]);
  };
  const blocks = Object.fromEntries(Object.entries(copySlots.blocks || {}).map(([type, fields]) => {
    const allowed = blockSettings.get(type);
    if (!allowed) throw new SectionContractError(`copySlots.blocks.${type}: bloque desconocido`);
    return [type, normalizeFields(fields, `copySlots.blocks.${type}`, allowed)];
  }));
  return Object.freeze({
    section: normalizeFields(copySlots.section || [], "copySlots.section", settings),
    blocks: Object.freeze(blocks)
  });
}

function normalizeContentSources(schema, contentSources = {}) {
  const settings = new Set((schema.settings || []).filter((item) => item.id).map((item) => item.id));
  const blockSettings = new Map((schema.blocks || []).map((block) => [block.type, new Set((block.settings || []).filter((item) => item.id).map((item) => item.id))]));
  const allowedSources = new Set(["shopify", "template"]);
  const normalizeFields = (fields, where, allowed) => {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new SectionContractError(`${where}: mapa de origen inválido`);
    }
    const entries = Object.entries(fields);
    if (entries.some(([field, source]) => !allowed.has(field) || !allowedSources.has(source))) {
      throw new SectionContractError(`${where}: campo u origen desconocido`);
    }
    return Object.freeze(Object.fromEntries(entries));
  };
  const blocks = Object.fromEntries(Object.entries(contentSources.blocks || {}).map(([type, fields]) => {
    const allowed = blockSettings.get(type);
    if (!allowed) throw new SectionContractError(`contentSources.blocks.${type}: bloque desconocido`);
    return [type, normalizeFields(fields, `contentSources.blocks.${type}`, allowed)];
  }));
  return Object.freeze({
    section: normalizeFields(contentSources.section || {}, "contentSources.section", settings),
    blocks: Object.freeze(blocks)
  });
}

function normalizeLockedFields(schema, lockedFields = {}) {
  const settings = new Set((schema.settings || []).filter((item) => item.id).map((item) => item.id));
  const blockSettings = new Map((schema.blocks || []).map((block) => [
    block.type,
    new Set((block.settings || []).filter((item) => item.id).map((item) => item.id))
  ]));
  const normalizeFields = (fields, where, allowed) => {
    if (!Array.isArray(fields) || new Set(fields).size !== fields.length || fields.some((field) => !allowed.has(field))) {
      throw new SectionContractError(`${where}: campo protegido desconocido o duplicado`);
    }
    return Object.freeze([...fields]);
  };
  const blocks = Object.fromEntries(Object.entries(lockedFields.blocks || {}).map(([type, fields]) => {
    const allowed = blockSettings.get(type);
    if (!allowed) throw new SectionContractError(`lockedFields.blocks.${type}: bloque desconocido`);
    return [type, normalizeFields(fields, `lockedFields.blocks.${type}`, allowed)];
  }));
  return Object.freeze({
    section: normalizeFields(lockedFields.section || [], "lockedFields.section", settings),
    blocks: Object.freeze(blocks)
  });
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function assertAdaptationScope(seed, result, copySlots, contentSources) {
  const allowedSectionFields = new Set([
    ...(copySlots.section || []),
    ...Object.keys(contentSources.section || {})
  ]);
  for (const key of new Set([
    ...Object.keys(seed?.settings || {}),
    ...Object.keys(result?.settings || {})
  ])) {
    if (!sameValue(seed?.settings?.[key], result?.settings?.[key]) && !allowedSectionFields.has(key)) {
      throw new SectionContractError(`La adaptación modificó un campo de sección no autorizado: ${key}`);
    }
  }

  const seedBlocks = seed?.blocks || [];
  const resultBlocks = result?.blocks || [];
  if (seedBlocks.length !== resultBlocks.length) {
    throw new SectionContractError("La adaptación no puede cambiar la cantidad de bloques");
  }
  for (let index = 0; index < seedBlocks.length; index += 1) {
    const before = seedBlocks[index];
    const after = resultBlocks[index];
    if (before.id !== after?.id || before.type !== after?.type) {
      throw new SectionContractError("La adaptación no puede cambiar la estructura de bloques");
    }
    const allowedBlockFields = new Set([
      ...(copySlots.blocks?.[before.type] || []),
      ...Object.keys(contentSources.blocks?.[before.type] || {})
    ]);
    for (const key of new Set([
      ...Object.keys(before.settings || {}),
      ...Object.keys(after?.settings || {})
    ])) {
      if (!sameValue(before.settings?.[key], after?.settings?.[key]) && !allowedBlockFields.has(key)) {
        throw new SectionContractError(`La adaptación modificó un campo de bloque no autorizado: ${before.type}.${key}`);
      }
    }
  }
}

function createSectionDefinition({ id, version, source, adaptation, outline = [], catalog = {}, capabilities = {}, copySlots = {}, contentSources = {}, lockedFields = {} }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !Number.isInteger(version) || version < 1) {
    throw new SectionContractError("La identidad de la sección es inválida");
  }
  const schema = validateSchema(schemaFromLiquid(source));
  const sourceSha256 = sha256(source);
  const editor = editorContract(schema, outline);
  const seed = defaultInstance(schema);
  const normalizedCopySlots = normalizeCopySlots(schema, copySlots);
  const normalizedContentSources = normalizeContentSources(schema, contentSources);
  const normalizedLockedFields = normalizeLockedFields(schema, lockedFields);
  const normalizedCatalog = Object.freeze({
    scale: catalog.scale === "block" ? "block" : "section",
    category: String(catalog.category || "Contenido"),
    description: String(catalog.description || ""),
    thumbnail: String(catalog.thumbnail || "generic")
  });
  const normalizedCapabilities = Object.freeze({
    editableContent: capabilities.editableContent !== false,
    editableStyles: capabilities.editableStyles !== false,
    editableStructure: capabilities.editableStructure === true,
    minBlocks: Number.isInteger(capabilities.minBlocks) ? Math.max(0, Math.min(50, capabilities.minBlocks)) : 0,
    duplicable: capabilities.duplicable !== false,
    deletable: capabilities.deletable !== false,
    reorderable: capabilities.reorderable !== false,
    protected: capabilities.protected === true,
    allowMultipleInstances: capabilities.allowMultipleInstances !== false,
    responsive: Object.freeze([...(capabilities.responsive || [])])
  });
  return Object.freeze({
    id, version, source, sourceSha256, schema: Object.freeze(schema), editor, seed: Object.freeze(seed),
    copySlots: normalizedCopySlots,
    contentSources: normalizedContentSources,
    lockedFields: normalizedLockedFields,
    catalog: normalizedCatalog,
    capabilities: normalizedCapabilities,
    adapt(product, research = {}, idioma = "es", context = {}) {
      const before = sourceSha256;
      const result = adaptation({
        product: clone(product || {}),
        research: clone(research || {}),
        seed: clone(seed),
        idioma,
        occurrence: Number.isInteger(context?.occurrence) && context.occurrence > 0 ? context.occurrence : 1,
        instanceId: context?.instanceId ? String(context.instanceId) : null
      });
      if (sha256(source) !== before) throw new SectionContractError("La adaptación intentó modificar el diseño de la sección");
      assertAdaptationScope(seed, result, normalizedCopySlots, normalizedContentSources);
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
  const outlineById = new Map();
  const indexOutline = (nodes) => (nodes || []).forEach((node) => {
    outlineById.set(node.id, node);
    indexOutline(node.children);
  });
  indexOutline(definition.editor?.outline);
  if (!Array.isArray(instance?.blocks)) throw new SectionContractError("La instancia necesita una lista de bloques");
  const schemaMaximum = Number.isInteger(definition.schema.max_blocks) ? definition.schema.max_blocks : 50;
  const maximum = Math.min(50, schemaMaximum);
  if (instance.blocks.length > maximum) {
    throw new SectionContractError(`La sección admite como máximo ${maximum} bloques`);
  }
  const blockIds = new Set();
  const blockCounts = new Map();
  const blocks = (instance?.blocks || []).map((block) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(String(block?.id || ""))) {
      throw new SectionContractError("Cada bloque necesita un identificador válido");
    }
    if (blockIds.has(block.id)) throw new SectionContractError(`Identificador de bloque duplicado: ${block.id}`);
    blockIds.add(block.id);
    const blockDefinition = blockMap.get(block.type);
    if (!blockDefinition) throw new SectionContractError(`Bloque no autorizado: ${block.type}`);
    if (block.parentId != null) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(String(block.parentId))) {
        throw new SectionContractError(`${block.type}: destino editorial inválido`);
      }
      const outlineNode = outlineById.get(block.parentId);
      const descendantTypes = new Set();
      const collectBlockTypes = (node) => {
        if (node?.blockType) descendantTypes.add(node.blockType);
        for (const child of node?.children || []) collectBlockTypes(child);
      };
      collectBlockTypes(outlineNode);
      if (!outlineNode || !descendantTypes.has(block.type)) {
        throw new SectionContractError(`${block.type}: destino editorial no compatible`);
      }
    }
    const count = (blockCounts.get(block.type) || 0) + 1;
    blockCounts.set(block.type, count);
    if (Number.isInteger(blockDefinition.limit) && count > blockDefinition.limit) {
      throw new SectionContractError(`${blockDefinition.name || block.type}: supera el límite de ${blockDefinition.limit}`);
    }
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
  const minimum = Number.isInteger(definition.capabilities?.minBlocks) ? definition.capabilities.minBlocks : 0;
  if (blocks.length < minimum) {
    throw new SectionContractError(`La sección necesita al menos ${minimum} bloque${minimum === 1 ? "" : "s"}`);
  }
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
