"use strict";

const crypto = require("crypto");

function text(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

// La huella representa la intención que crea una página. Mantiene el orden de
// las claves fijo para que una repetición legítima produzca exactamente el
// mismo valor, sin guardar copy, secretos ni datos innecesarios.
function generationIntentFingerprint({ producto_id, idioma = "es", angulo = "", estilo = "section-page-v1" } = {}) {
  const intent = {
    producto_id: text(producto_id),
    idioma: text(idioma, "es"),
    angulo: text(angulo),
    estilo: text(estilo, "section-page-v1")
  };
  return crypto.createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

module.exports = Object.freeze({ generationIntentFingerprint });
