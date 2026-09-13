"use strict";

// Las páginas son recursos propios de la app. El GID de Shopify identifica al
// producto de origen, pero no puede ser la clave primaria de una página:
// un mismo producto puede tener varios borradores, variantes y publicaciones.
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pageIdFromCreationRequest(requestId) {
  const normalized = String(requestId || "").trim().toLowerCase();
  if (!REQUEST_ID.test(normalized)) return null;
  // El request_id es idempotente: reintentar la misma acción vuelve al mismo
  // recurso. Una acción nueva recibe otro UUID y por eso crea otra página.
  return `page-${normalized}`;
}

module.exports = Object.freeze({
  REQUEST_ID,
  pageIdFromCreationRequest
});
