"use strict";

class PageWritePolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "PageWritePolicyError";
    this.code = "PAGE_WRITE_CONTRACT_CONFLICT";
    this.status = 409;
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

// The persisted descriptor is authoritative. A client cannot switch a page
// between the section-page transition and a legacy generic data write merely
// by choosing a different request shape.
function assertCompatiblePageWrite({ persistedData, body }) {
  if (!persistedData || typeof persistedData !== "object") return;
  if (!hasOwn(persistedData, "section_page")) return;
  if (!hasOwn(body, "section_page")) {
    throw new PageWritePolicyError(
      "Esta página usa el editor por secciones. Guardala enviando section_page para conservar sus reglas y revisión."
    );
  }
}

module.exports = Object.freeze({ PageWritePolicyError, assertCompatiblePageWrite });
