"use strict";

const PAGE_SCHEMA_VERSION = 1;

class PageContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "PageContractError";
    this.code = "PAGE_CONTRACT_INVALID";
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validatePageIdentity(record, expectedId) {
  if (!isPlainObject(record)) {
    throw new PageContractError("La pagina debe ser un objeto estructurado");
  }
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw new PageContractError("La pagina requiere un id no vacio");
  }
  if (expectedId && record.id !== expectedId) {
    throw new PageContractError("El id de la pagina no coincide con el registro a persistir");
  }
}

function normalizePageRecord(record, { expectedId } = {}) {
  validatePageIdentity(record, expectedId);
  if (!isPlainObject(record.data)) {
    throw new PageContractError("La pagina requiere data como objeto estructurado");
  }

  // Las paginas anteriores al contrato versionado son v1 por compatibilidad.
  const schemaVersion = record.schema_version ?? PAGE_SCHEMA_VERSION;
  if (!Number.isInteger(schemaVersion) || schemaVersion !== PAGE_SCHEMA_VERSION) {
    throw new PageContractError(`Version de contrato de pagina no soportada: ${schemaVersion}`);
  }

  return {
    ...record,
    schema_version: schemaVersion
  };
}

function normalizeStoredPageRecord(record, { expectedId } = {}) {
  if (!isPlainObject(record)) {
    throw new PageContractError("La pagina debe ser un objeto estructurado");
  }

  const stored = { ...record };
  const id = stored.id ?? expectedId;

  if (
    Object.prototype.hasOwnProperty.call(stored, "data") ||
    Object.prototype.hasOwnProperty.call(stored, "schema_version")
  ) {
    return normalizePageRecord({ ...stored, id }, { expectedId });
  }

  // Las paginas anteriores guardaban el contenido directamente en la raiz.
  // No se las envuelve ni se les agrega metadata: una lectura/escritura de
  // mantenimiento debe preservar exactamente su forma publicada.
  validatePageIdentity({ ...stored, id }, expectedId);
  return stored;
}

module.exports = Object.freeze({
  PAGE_SCHEMA_VERSION,
  PageContractError,
  isPlainObject,
  validatePageIdentity,
  normalizePageRecord,
  normalizeStoredPageRecord
});
