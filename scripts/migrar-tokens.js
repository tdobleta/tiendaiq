// ============================================================
// Migración: cifra en reposo los tokens de tienda que estén en CLARO.
//
// Idempotente: re-escribe cada tienda pasando por guardarTiendaDB, que cifra el
// token. Los que ya estaban cifrados se descifran al leer y se vuelven a cifrar
// (mismo valor de token, solo cambia el envoltorio) → correrlo N veces es seguro
// y NO desloguea a nadie (el token efectivo no cambia).
//
// Uso (con la env cargada):
//   TOKEN_ENC_KEY="<32 bytes base64>" DATABASE_URL="<...>" node scripts/migrar-tokens.js
//
// Requiere que TOKEN_ENC_KEY esté seteada (si no, cripto-tokens.js pasa el token
// tal cual y la migración no cifra nada → aborta con aviso).
// ============================================================

const { cifradoActivo } = require("../cripto-tokens");
const { listarTiendasDB, guardarTiendaDB, USA_PG } = require("../db");

async function main() {
  if (!cifradoActivo()) {
    console.error("✗ TOKEN_ENC_KEY no está seteada — no hay con qué cifrar. Cargá la env y reintentá.");
    process.exit(1);
  }
  const tiendas = await listarTiendasDB(); // vienen con el token en claro (descifrado al leer)
  let cifradas = 0;
  for (const datos of tiendas) {
    if (!datos || !datos.dominio) continue;
    await guardarTiendaDB(datos.dominio, datos); // guardarTiendaDB cifra el token
    cifradas++;
    console.log("  ✓ " + datos.dominio);
  }
  console.log(`\nListo. ${cifradas} tienda(s) con el token cifrado en reposo (${USA_PG ? "Postgres" : "archivos"}).`);
  process.exit(0);
}

main().catch((e) => { console.error("✗ Migración falló:", e.message); process.exit(1); });
