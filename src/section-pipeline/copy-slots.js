"use strict";

const { SectionContractError } = require("./section-contract");

const EVIDENCE_KINDS = new Set(["shopify_description", "shopify_media", "shopify_product"]);

function normalizedTarget(target, where = "copy_slots_v1.target") {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new SectionContractError(`${where}: destino inválido`);
  }
  const sectionId = String(target.section_id || "");
  const field = String(target.field || "");
  const occurrence = target.occurrence ?? 1;
  const hasBlockType = target.block_type != null || target.block_index != null || target.block_id != null;
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(sectionId)
    || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(field)
    || !Number.isInteger(occurrence) || occurrence < 1 || occurrence > 12) {
    throw new SectionContractError(`${where}: destino inválido`);
  }
  const hasStableBlockId = target.block_id != null;
  const hasLegacyBlockIndex = target.block_index != null;
  if (hasBlockType && (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(String(target.block_type || ""))
    || (hasStableBlockId && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(String(target.block_id)))
    || (!hasStableBlockId && (!Number.isInteger(target.block_index) || target.block_index < 0 || target.block_index > 49))
    || (hasLegacyBlockIndex && (!Number.isInteger(target.block_index) || target.block_index < 0 || target.block_index > 49)))) {
    throw new SectionContractError(`${where}: bloque de destino inválido`);
  }
  return {
    section_id: sectionId,
    occurrence,
    ...(hasBlockType ? {
      block_type: String(target.block_type),
      ...(hasStableBlockId ? { block_id: String(target.block_id) } : {}),
      ...(hasLegacyBlockIndex ? { block_index: target.block_index } : {})
    } : {}),
    field
  };
}

function normalizedEvidence(evidence, where) {
  if (evidence == null) return [];
  if (!Array.isArray(evidence) || evidence.length > 4) {
    throw new SectionContractError(`${where}: evidencia inválida`);
  }
  return evidence.map((entry, index) => {
    const kind = String(entry?.kind || "");
    const reference = String(entry?.reference || "").trim();
    if (!EVIDENCE_KINDS.has(kind) || !reference || reference.length > 200) {
      throw new SectionContractError(`${where}[${index}]: evidencia inválida`);
    }
    return { kind, reference };
  });
}

function normalizePersistedCopySlots(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.slots)) {
    throw new SectionContractError("section_page.copy_slots_v1 no cumple el contrato v1");
  }
  if (value.slots.length > 64 || (value.skipped != null && (!Array.isArray(value.skipped) || value.skipped.length > 64))) {
    throw new SectionContractError("section_page.copy_slots_v1 supera el límite permitido");
  }
  const seen = new Set();
  const slots = value.slots.map((slot, index) => {
    const target = normalizedTarget(slot?.target, `copy_slots_v1.slots[${index}].target`);
    const key = targetKey(target);
    if (seen.has(key)) throw new SectionContractError(`copy_slots_v1 contiene un destino duplicado: ${key}`);
    seen.add(key);
    const text = String(slot?.value || "").trim();
    if (!text || text.length > 1200) throw new SectionContractError(`copy_slots_v1.slots[${index}].value inválido`);
    const provenance = slot?.provenance;
    if (provenance != null && (typeof provenance !== "object" || Array.isArray(provenance))) {
      throw new SectionContractError(`copy_slots_v1.slots[${index}].provenance inválido`);
    }
    return {
      target,
      value: text,
      evidence: normalizedEvidence(slot?.evidence, `copy_slots_v1.slots[${index}].evidence`),
      ...(provenance ? {
        provenance: {
          source: String(provenance.source || "unknown").slice(0, 40),
          contract: String(provenance.contract || "copy_slots_v1").slice(0, 40),
          prompt_version: String(provenance.prompt_version || "unknown").slice(0, 80),
          ...(provenance.generated_at ? { generated_at: String(provenance.generated_at).slice(0, 80) } : {})
        }
      } : {})
    };
  });
  const skipped = (value.skipped || []).map((entry, index) => ({
    target: entry?.target == null ? null : normalizedTarget(entry.target, `copy_slots_v1.skipped[${index}].target`),
    reason: String(entry?.reason || "desconocido").slice(0, 80)
  }));
  return Object.freeze({ version: 1, slots: Object.freeze(slots), skipped: Object.freeze(skipped) });
}

function persistCopySlots(value, { generatedAt = null, promptVersion = "copy-slots-v1" } = {}) {
  const normalized = normalizePersistedCopySlots(value);
  if (!normalized) return null;
  return Object.freeze({
    version: 1,
    slots: Object.freeze(normalized.slots.map((slot) => ({
      ...slot,
      provenance: {
        source: "ai",
        contract: "copy_slots_v1",
        prompt_version: String(promptVersion).slice(0, 80),
        ...(generatedAt ? { generated_at: String(generatedAt).slice(0, 80) } : {})
      }
    }))),
    skipped: normalized.skipped
  });
}

function targetKey(target = {}) {
  return [
    target.section_id,
    target.occurrence || 1,
    target.block_type || "section",
    target.block_id ?? target.block_index ?? "section",
    target.field
  ].join("/");
}

function readCopySlot(research, target) {
  const slots = research?.copy_slots_v1?.slots;
  if (Array.isArray(slots)) {
    const wanted = targetKey(target);
    const legacyWanted = target?.block_id == null
      ? null
      : targetKey({ ...target, block_id: undefined });
    const match = slots.find((slot) => {
      if (typeof slot?.value !== "string") return false;
      const key = targetKey(slot.target);
      return key === wanted || (legacyWanted && key === legacyWanted);
    });
    if (match) return match.value;
  }
  return null;
}

module.exports = Object.freeze({ normalizePersistedCopySlots, persistCopySlots, readCopySlot, targetKey });
