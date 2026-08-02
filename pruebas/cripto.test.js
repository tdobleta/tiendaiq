// Cifrado de tokens (cripto-tokens.js). Se fija la clave ANTES de requerir el
// módulo (lee env al cargarse). node --test pruebas/
process.env.TOKEN_ENC_KEY = require("crypto").randomBytes(32).toString("base64");
delete require.cache[require.resolve("../shopify")]; // que shopify.js relea env
delete require.cache[require.resolve("../cripto-tokens")];

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { cifrarToken, descifrarToken, estaCifrado, cifradoActivo } = require("../cripto-tokens");

const TOKEN = "shpat_" + "a".repeat(32);

describe("cripto-tokens — cifrado en reposo de tokens", () => {
  test("cifrado activo con TOKEN_ENC_KEY seteada", () => {
    assert.equal(cifradoActivo(), true);
  });

  test("round-trip: descifrar(cifrar(t)) === t", () => {
    const c = cifrarToken(TOKEN);
    assert.equal(estaCifrado(c), true, "el cifrado lleva prefijo enc:v1:");
    assert.notEqual(c, TOKEN, "el ciphertext difiere del claro");
    assert.equal(descifrarToken(c), TOKEN);
  });

  test("cifrar un valor ya cifrado lo deja igual (idempotente)", () => {
    const c = cifrarToken(TOKEN);
    assert.equal(cifrarToken(c), c);
  });

  test("descifrar un token en claro (legacy) lo devuelve igual", () => {
    assert.equal(descifrarToken(TOKEN), TOKEN);
  });

  test("IV aleatorio: dos cifrados difieren pero descifran igual", () => {
    const a = cifrarToken(TOKEN);
    const b = cifrarToken(TOKEN);
    assert.notEqual(a, b);
    assert.equal(descifrarToken(a), TOKEN);
    assert.equal(descifrarToken(b), TOKEN);
  });

  test("GCM detecta manipulación del ciphertext (lanza al descifrar)", () => {
    const partes = cifrarToken(TOKEN).split(":");
    partes[4] = Buffer.from("otracosa").toString("base64");
    assert.throws(() => descifrarToken(partes.join(":")));
  });

  test("null/undefined pasan sin romper", () => {
    assert.equal(cifrarToken(null), null);
    assert.equal(descifrarToken(undefined), undefined);
  });
});
