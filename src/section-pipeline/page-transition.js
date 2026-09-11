"use strict";

const { SectionContractError } = require("./section-contract");
const { resolveSection, validatePage } = require("./page-pipeline");

function clone(value) {
  return structuredClone(value);
}

function revisionOf(page) {
  const revision = Number(page?.revision ?? 0);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new SectionContractError("La revisión de la página no es válida");
  }
  return revision;
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function descriptorKey(section) {
  return `${section.definition.id}@${section.definition.version}`;
}

function blockStructure(section) {
  return (section.instance.blocks || []).map((block) => ({ id: block.id, type: block.type }));
}

function assertServerOwnedFields(persisted, candidate) {
  for (const field of ["productId", "productSnapshot", "evidence", "copy_slots_v1"]) {
    if (!sameValue(persisted[field], candidate[field])) {
      throw new SectionContractError(`El editor no puede modificar ${field}`);
    }
  }
}

function assertLockedFields(persisted, candidate) {
  const previousById = new Map(persisted.sections.map((section) => [section.id, section]));
  for (const next of candidate.sections) {
    const previous = previousById.get(next.id);
    if (!previous) continue;
    const definition = resolveSection(previous.definition);
    const locked = definition?.lockedFields || {};
    for (const field of locked.section || []) {
      if (!sameValue(previous.instance.settings?.[field], next.instance.settings?.[field])) {
        throw new SectionContractError(`${previous.label} controla el campo ${field} desde Shopify`);
      }
    }
    const previousBlocks = new Map((previous.instance.blocks || []).map((block) => [block.id, block]));
    for (const nextBlock of next.instance.blocks || []) {
      const previousBlock = previousBlocks.get(nextBlock.id);
      if (!previousBlock) continue;
      for (const field of locked.blocks?.[previousBlock.type] || []) {
        if (!sameValue(previousBlock.settings?.[field], nextBlock.settings?.[field])) {
          throw new SectionContractError(`${previous.label} controla el campo ${field} desde Shopify`);
        }
      }
    }
  }
}

function assertCapabilities(persisted, candidate) {
  const previousById = new Map(persisted.sections.map((section) => [section.id, section]));
  const nextById = new Map(candidate.sections.map((section) => [section.id, section]));
  const counts = new Map();
  for (const section of candidate.sections) {
    const key = descriptorKey(section);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  for (const previous of persisted.sections) {
    const definition = resolveSection(previous.definition);
    const next = nextById.get(previous.id);
    if (!next && definition?.capabilities.deletable === false) {
      throw new SectionContractError(`${previous.label} es obligatoria y no se puede eliminar`);
    }
    if (!next) continue;
    if (descriptorKey(previous) !== descriptorKey(next)) {
      throw new SectionContractError("Una instancia no puede cambiar de tipo o versión");
    }
    if (definition?.capabilities.editableStructure !== true && !sameValue(blockStructure(previous), blockStructure(next))) {
      throw new SectionContractError(`La estructura interna de ${previous.label} está protegida`);
    }
    const previousPosition = persisted.sections.indexOf(previous);
    const nextPosition = candidate.sections.indexOf(next);
    if (previousPosition !== nextPosition && definition?.capabilities.reorderable === false) {
      throw new SectionContractError(`${previous.label} no se puede reordenar`);
    }
  }

  for (const section of candidate.sections) {
    const key = descriptorKey(section);
    const previous = previousById.get(section.id);
    if (previous) continue;
    const definition = resolveSection(section.definition);
    if (definition?.capabilities.allowMultipleInstances === false && counts.get(key) > 1) {
      throw new SectionContractError(`${section.label} admite una sola instancia`);
    }
  }
}

function applyPageTransition({ persisted, candidate, expectedRevision }) {
  const current = validatePage(persisted);
  const submitted = validatePage(candidate);
  const currentRevision = revisionOf(current);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== currentRevision) {
    const error = new SectionContractError("La página cambió en otra sesión. Recargá antes de guardar para no perder cambios.");
    error.code = "SECTION_PAGE_REVISION_CONFLICT";
    throw error;
  }
  if (revisionOf(submitted) !== currentRevision) {
    throw new SectionContractError("La revisión enviada no coincide con el borrador abierto");
  }

  assertServerOwnedFields(current, submitted);
  assertLockedFields(current, submitted);
  assertCapabilities(current, submitted);

  const { tree: _derivedTree, ...document } = clone(submitted);
  return validatePage({ ...document, revision: currentRevision + 1 });
}

module.exports = Object.freeze({ applyPageTransition, revisionOf });
