"use strict";

function targetKey(target = {}) {
  return [
    target.section_id,
    target.occurrence || 1,
    target.block_type || "section",
    target.block_index ?? "section",
    target.field
  ].join("/");
}

function readCopySlot(research, target) {
  const slots = research?.copy_slots_v1?.slots;
  if (Array.isArray(slots)) {
    const wanted = targetKey(target);
    const match = slots.find((slot) => targetKey(slot?.target) === wanted && typeof slot?.value === "string");
    if (match) return match.value;
  }
  return null;
}

module.exports = Object.freeze({ readCopySlot, targetKey });
