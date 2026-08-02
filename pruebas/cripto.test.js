// Test del cifrado de tokens (cripto-tokens.js). Corre con una clave de prueba.
process.env.TOKEN_ENC_KEY = require("crypto").randomBytes(32).toString("base64");
delete require.cache[require.resolve("../shopify")]; // que shopify.js relea env
delete require.cache[require.resolve("../cripto-tokens")];
const { cifrarToken, descifrarToken, estaCifrado, cifradoActivo } = require("../cripto-tokens");

let fallos = 0;
const ok = (cond, msg) => { if (!cond) { console.error("  ✗ " + msg); fallos++; } else console.log("  ✓ " + msg); };

const token = "shpat_" + "a".repeat(32);

ok(cifradoActivo(), "cifrado activo con TOKEN_ENC_KEY seteada");

const c = cifrarToken(token);
ok(estaCifrado(c), "el token cifrado tiene el prefijo enc:v1:");
ok(c !== token, "el ciphertext difiere del token en claro");
ok(descifrarToken(c) === token, "round-trip: descifrar(cifrar(t)) === t");

// idempotencia: cifrar algo ya cifrado no lo re-cifra
ok(cifrarToken(c) === c, "cifrar un valor ya cifrado lo deja igual");

// compat: descifrar un token en CLARO lo devuelve tal cual
ok(descifrarToken(token) === token, "descifrar un token en claro (legacy) lo devuelve igual");

// dos cifrados del mismo token dan distinto (IV aleatorio) pero descifran igual
const c2 = cifrarToken(token);
ok(c2 !== c, "IV aleatorio: dos cifrados del mismo token difieren");
ok(descifrarToken(c2) === token, "ambos descifran al mismo token");

// integridad: manipular el ciphertext hace fallar el descifrado (auth tag GCM)
const partes = c.split(":");
partes[4] = Buffer.from("otracosa").toString("base64");
let lanzo = false;
try { descifrarToken(partes.join(":")); } catch { lanzo = true; }
ok(lanzo, "GCM detecta manipulación del ciphertext (lanza al descifrar)");

if (fallos) { console.error(`\n${fallos} fallo(s) en cripto.test.js`); process.exit(1); }
console.log("\n  cripto-tokens: todo en orden");
