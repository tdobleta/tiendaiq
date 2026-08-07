// ============================================================
// COHERENCIA — que los archivos de config no se contradigan entre sí.
//
//   node pruebas/coherencia.js
//
// No mira si el código corre (de eso se ocupa humo.js); mira si dos archivos
// que tienen que decir lo mismo dicen lo mismo. Es la clase de bug que no
// rompe nada al arrancar y aparece semanas después en la tienda de alguien.
// ============================================================

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

let fallos = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const mal = (n, d) => {
  fallos++;
  console.error(`  ✖ ${n}\n      ${d}`);
};

// ---------- el dominio de la app vive en varios archivos ----------
//
// shopify.app.toml lo usa para el OAuth y los webhooks; los dos app embeds lo
// llevan escrito porque corren en el storefront del merchant, donde no hay
// forma de leer una variable de entorno. Si se cambia uno y no los otros, la
// app instala bien pero los widgets piden la config al dominio viejo — y eso
// no se nota hasta que el dominio viejo deja de responder.
function dominiosDe(texto) {
  return new Set((texto.match(/https:\/\/[a-z0-9.-]+/gi) || []).map((u) => u.toLowerCase()));
}

const ARCHIVOS_CON_DOMINIO = [
  "shopify.app.toml",
  "extensions/tiendaiq-widgets/blocks/bundle.liquid"
];

// El dominio de referencia es el `application_url` del toml: es el que Shopify
// tiene cargado en el Partner Dashboard.
const toml = leer("shopify.app.toml");
const principal = toml.match(/^application_url\s*=\s*"([^"]+)"/m)?.[1];

if (!principal) {
  mal("shopify.app.toml declara application_url", "no se encontró la línea application_url");
} else {
  ok(`el dominio de la app es ${principal}`);

  for (const rel of ARCHIVOS_CON_DOMINIO.slice(1)) {
    const usados = [...dominiosDe(leer(rel))];
    const ajenos = usados.filter((u) => !principal.startsWith(u) && !u.startsWith(principal));
    if (ajenos.length) {
      mal(`${rel} apunta al mismo dominio que la app`, `usa ${ajenos.join(", ")} en vez de ${principal}`);
    } else if (!usados.length) {
      mal(`${rel} apunta al mismo dominio que la app`, "no menciona ninguna URL — ¿se borró el fetch de config?");
    } else {
      ok(`${rel} apunta a ${principal}`);
    }
  }

  // El redirect del OAuth tiene que incluir el dominio principal, o la
  // instalación termina en "redirect_uri no autorizada" después de que el
  // merchant ya autorizó.
  if (toml.includes(`${principal}/auth/callback`)) ok("el redirect del OAuth incluye el dominio de la app");
  else mal("el redirect del OAuth incluye el dominio de la app", `falta ${principal}/auth/callback en redirect_urls`);
}

// ---------- los alcances del toml y los del código ----------
//
// auth.js es el que los pide en el OAuth; el toml es el que Shopify tiene
// declarado. Si difieren, el merchant autoriza una cosa y la app espera otra:
// las llamadas fallan con ACCESS_DENIED mucho después de instalar.
const alcancesCodigo = leer("auth.js").match(/const ALCANCES = "([^"]+)"/)?.[1];
const alcancesToml = toml.match(/^scopes\s*=\s*"([^"]+)"/m)?.[1];

if (!alcancesCodigo || !alcancesToml) {
  mal("los alcances se pueden leer de los dos lados", "no se encontró ALCANCES en auth.js o scopes en el toml");
} else {
  const norm = (s) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))].sort();
  const a = norm(alcancesCodigo);
  const b = norm(alcancesToml);
  const soloCodigo = a.filter((x) => !b.includes(x));
  const soloToml = b.filter((x) => !a.includes(x));

  if (soloCodigo.length || soloToml.length) {
    mal(
      "los alcances de auth.js y shopify.app.toml coinciden",
      [
        soloCodigo.length ? `solo en auth.js: ${soloCodigo.join(", ")}` : "",
        soloToml.length ? `solo en el toml: ${soloToml.join(", ")}` : ""
      ].filter(Boolean).join(" · ")
    );
  } else {
    ok(`los ${a.length} alcances coinciden entre auth.js y shopify.app.toml`);
  }
}

// ---------- la versión de API ----------
//
// El cliente GraphQL y el extension usaban versiones distintas y nadie se
// enteró hasta revisarlo a mano.
const apiCliente = leer("shopify.js").match(/const API = "([^"]+)"/)?.[1];
const apiExtension = leer("extensions/tiendaiq-widgets/shopify.extension.toml").match(/api_version\s*=\s*"([^"]+)"/)?.[1];

if (apiCliente && apiExtension && apiCliente !== apiExtension) {
  mal("la versión de API es la misma en el cliente y en el extension", `shopify.js usa ${apiCliente} y el extension ${apiExtension}`);
} else if (apiCliente) {
  ok(`versión de API ${apiCliente} en el cliente y en el extension`);
}

console.log(fallos ? `\n  ${fallos} incoherencia(s)\n` : "");
process.exitCode = fallos ? 1 : 0;
