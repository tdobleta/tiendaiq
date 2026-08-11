// ============================================================
// PRUEBA DE HUMO — levanta el server de verdad y le pega.
//
//   node pruebas/humo.js
//
// No reemplaza tests de unidad (todavía no hay). Lo que sí garantiza es que
// un push no deja producción en un estado en el que el proceso ni arranca,
// que es el modo de fallar más caro cuando `main` deploya solo.
//
// Corre sin DATABASE_URL: el almacén cae a archivos y no toca ninguna base.
// ============================================================

const { spawn } = require("child_process");
const path = require("path");

const PUERTO = 4488;
const BASE = `http://localhost:${PUERTO}`;

let fallos = 0;
const ok = (nombre) => console.log(`  ✓ ${nombre}`);
const mal = (nombre, detalle) => {
  fallos++;
  console.error(`  ✖ ${nombre}\n      ${detalle}`);
};

async function esperarVivo(intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {
      /* todavía no levantó */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Cada caso es { nombre, ruta, espera } — el contrato mínimo que no se puede
// romper sin que alguien se entere.
const CASOS = [
  {
    nombre: "/health responde ok",
    ruta: "/health",
    espera: 200
  },
  {
    nombre: "/ready comprueba el almacenamiento",
    ruta: "/ready",
    espera: 200,
    revisar: (cuerpo) => JSON.parse(cuerpo).almacenamiento ? null : "no informó el almacenamiento"
  },
  {
    nombre: "/api/* sin pase de sesión es 401 (no filtra datos de tiendas)",
    ruta: "/api/productos",
    espera: 401
  },
  {
    nombre: "/api/plan sin pase de sesión es 401",
    ruta: "/api/plan",
    espera: 401
  },
  {
    nombre: "/auth sin ?shop es 400",
    ruta: "/auth",
    espera: 400
  },
  {
    nombre: "/auth con ?shop válido redirige a Shopify",
    ruta: "/auth?shop=prueba-humo.myshopify.com",
    espera: 302
  },
  {
    nombre: "/auth/callback con state inventado es 401",
    ruta: "/auth/callback?shop=prueba-humo.myshopify.com&state=inventado&hmac=aa",
    espera: 401
  },
  {
    nombre: "/publico/bundles con shop inválido no revienta",
    ruta: "/publico/bundles?shop=no-es-un-dominio",
    espera: 400
  },
  {
    nombre: "las legales del App Store se sirven",
    ruta: "/privacidad",
    espera: 200,
    // Los datos del titular se completan desde el entorno al servir. Si un
    // marcador llega crudo a la página, quedó a la vista en una URL pública
    // que lee el reviewer de Shopify.
    revisar: (cuerpo) =>
      cuerpo.includes("{{") ? "quedó un marcador {{...}} sin reemplazar" : null
  },
  {
    nombre: "los términos tampoco filtran marcadores",
    ruta: "/terminos",
    espera: 200,
    revisar: (cuerpo) =>
      cuerpo.includes("{{") ? "quedó un marcador {{...}} sin reemplazar" : null
  },
  {
    nombre: "los assets del storefront se sirven desde el extension",
    ruta: "/widgets/tiendaiq-bundle.js",
    espera: 200
  }
];

async function main() {
  console.log("\n  Prueba de humo · TiendaIQ\n");

  const hijo = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    // DATABASE_URL vacío a propósito: almacén en archivos, cero efectos.
    // DEV_MODE apagado: queremos que /api/* exija el pase, que es el caso real.
    env: {
      ...process.env,
      PORT: String(PUERTO),
      APP_URL: BASE,
      DATABASE_URL: "",
      DEV_MODE: "",
      // El callback debe rechazar una firma inválida, no fallar por falta de
      // configuración Shopify en el proceso aislado de esta prueba.
      SHOPIFY_CLIENT_SECRET: "secreto-humo"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let salida = "";
  hijo.stdout.on("data", (d) => (salida += d));
  hijo.stderr.on("data", (d) => (salida += d));

  // Esperar a que el hijo muera de verdad antes de seguir. Salir mientras sus
  // pipes se están cerrando revienta libuv en Windows con un assert, y el
  // proceso termina en 127 aunque las pruebas hayan pasado todas.
  const matar = () =>
    new Promise((resolve) => {
      if (hijo.exitCode !== null || hijo.signalCode !== null) return resolve();
      hijo.once("exit", resolve);
      setTimeout(resolve, 3000).unref(); // no colgarse si no muere
      try {
        hijo.kill();
      } catch {
        resolve(); // ya no estaba
      }
    });

  try {
    if (!await esperarVivo()) {
      mal("el server arranca", `no respondió en ${BASE}/health\n${salida}`);
      return;
    }
    ok("el server arranca");

    for (const c of CASOS) {
      try {
        // redirect: manual — un 302 tiene que verse como 302, no seguirse.
        const r = await fetch(BASE + c.ruta, { redirect: "manual" });
        if (r.status !== c.espera) {
          mal(c.nombre, `esperaba ${c.espera}, vino ${r.status}`);
          continue;
        }
        // Algunos casos además miran el cuerpo, no solo el código.
        const problema = c.revisar ? c.revisar(await r.text()) : null;
        if (problema) mal(c.nombre, problema);
        else ok(c.nombre);
      } catch (e) {
        mal(c.nombre, e.message);
      }
    }
  } finally {
    await matar();
  }
}

main().then(() => {
  console.log(fallos ? `\n  ${fallos} fallo(s)\n` : "\n  todo en orden\n");
  // exitCode en vez de process.exit(): deja que Node cierre sus handles solo.
  process.exitCode = fallos ? 1 : 0;
});
