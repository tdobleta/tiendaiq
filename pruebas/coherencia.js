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
const render = leer("render.yaml");
const releaseWorkflow = leer(".github/workflows/release-staging.yml");
const capacityWorkflow = leer(".github/workflows/capacity-staging.yml");
const anthropicCapacityWorkflow = leer(".github/workflows/anthropic-capacity-staging.yml");
const verificationWorkflow = leer(".github/workflows/verificar.yml");
const launchPlan = leer("docs/plan-lanzamiento-1000-tiendas.md");
const ola1Runbook = leer("docs/runbook-ola-1.md");
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

// ---------- webhooks obligatorios de privacidad ----------

const complianceTopics = ["customers/data_request", "customers/redact", "shop/redact"];
const complianceDeclarados = toml.match(/compliance_topics\s*=\s*\[([^\]]+)\]/)?.[1] || "";
const faltanCompliance = complianceTopics.filter((topic) => !complianceDeclarados.includes(`"${topic}"`));
if (faltanCompliance.length || !/\[\[webhooks\.subscriptions\]\]/.test(toml)) {
  mal("Shopify recibe los tres webhooks obligatorios de privacidad", `faltan o usan sintaxis antigua: ${faltanCompliance.join(", ") || "subscriptions"}`);
} else if (!/uri\s*=\s*"https:\/\/tiendaiq\.com\/webhooks"/.test(toml)) {
  mal("los webhooks de privacidad apuntan al ingress durable", "la suscripcion no usa https://tiendaiq.com/webhooks");
} else {
  ok("Shopify recibe los tres webhooks obligatorios de privacidad");
}

// ---------- despliegue y migraciones ----------

if (!/preDeployCommand:/.test(render) && /ALLOW_ROLE_BOOTSTRAP/.test(releaseWorkflow) && /npm run db:migrate/.test(releaseWorkflow) && /environment:\s*staging/.test(releaseWorkflow)) {
  ok("el release de staging migra con una aprobación separada del runtime");
} else {
  mal("el release de staging migra con una aprobación separada del runtime", "el workflow manual debe preparar roles, migrar y Render no debe recibir preDeployCommand");
}

if (/healthCheckPath:\s*\/ready/.test(render)) {
  ok("Render espera readiness de almacenamiento y aislamiento");
} else {
  mal("Render espera readiness de almacenamiento y aislamiento", "healthCheckPath debe apuntar a /ready");
}

if (/key:\s*PG_PRIVATE_NETWORK\s+value:\s*"1"/.test(render)) {
  ok("Render declara la red privada de PostgreSQL");
} else {
  mal("Render declara la red privada de PostgreSQL", "falta PG_PRIVATE_NETWORK=1 para las URLs internas");
}

if (/key:\s*PG_RUNTIME_ROLE\s+value:\s*"tiendaiq_web_runtime"/.test(render) &&
    /key:\s*PG_RUNTIME_ROLE\s+value:\s*"tiendaiq_worker_runtime"/.test(render)) {
  ok("Render activa roles PostgreSQL aislados por proceso");
} else {
  mal("Render activa roles PostgreSQL aislados por proceso", "web y worker deben declarar PG_RUNTIME_ROLE distinto");
}

const runtimeUrls = render.match(/- key:\s*DATABASE_URL\s+sync:\s*false/g) || [];
const migrationUrls = render.match(/- key:\s*MIGRATION_DATABASE_URL\s+sync:\s*false/g) || [];
if (runtimeUrls.length === 2 && migrationUrls.length === 0 &&
    /STAGING_MIGRATION_DATABASE_URL/.test(releaseWorkflow) &&
    !/- key:\s*DATABASE_URL\s+fromDatabase:/.test(render)) {
  ok("Render no expone la credencial migradora a web ni worker");
} else {
  mal(
    "Render no expone la credencial migradora a web ni worker",
    "web y worker deben usar DATABASE_URL secretas; la credencial dueña sólo va en el entorno staging de GitHub"
  );
}

if (/type:\s*worker[\s\S]*name:\s*tiendaiq-worker[\s\S]*startCommand:\s*npm run worker/.test(render)) {
  ok("Render ejecuta generación y publicaciones en un worker separado");
} else {
  mal("Render ejecuta las publicaciones en un worker separado", "falta el servicio tiendaiq-worker");
}

if (/RENDER_STAGING_WEB_DEPLOY_HOOK/.test(releaseWorkflow) && /RENDER_STAGING_WORKER_DEPLOY_HOOK/.test(releaseWorkflow)) {
  ok("web y worker se despliegan solo después de la migración de staging");
} else {
  mal("web y worker se despliegan solo después de la migración de staging", "el workflow debe disparar ambos deploy hooks después de migrar");
}

if (/release_sha:/.test(releaseWorkflow) &&
    /DEPLOY_REVIEWED_STAGING/.test(releaseWorkflow) &&
    /\^\[a-f0-9\]\{40\}\$/.test(releaseWorkflow) &&
    /git rev-parse origin\/main/.test(releaseWorkflow) &&
    /data-urlencode "ref=\$\{\{ steps\.release\.outputs\.sha \}\}"/.test(releaseWorkflow) &&
    /tiendaiq-staging-web\.onrender\.com\/ready/.test(releaseWorkflow) &&
    /ready\.release===process\.env\.EXPECTED_SHA/.test(releaseWorkflow) &&
    /RENDER_GIT_COMMIT/.test(leer("server.js"))) {
  ok("el release fija el SHA revisado y espera readiness de staging");
} else {
  mal(
    "el release fija el SHA revisado y espera readiness de staging",
    "debe validar un SHA completo en main, desplegar ese ref y esperar /ready"
  );
}

const workerSource = leer("worker.js");
if (/await Promise\.race/.test(workerSource) &&
    /verificarWorkerDB/.test(workerSource) &&
    workerSource.indexOf("verificar()") < workerSource.indexOf("crearRuntime()") &&
    /Worker detenido por preflight fallido/.test(workerSource)) {
  ok("el worker falla cerrado antes de iniciar sus runners");
} else {
  mal(
    "el worker falla cerrado antes de iniciar sus runners",
    "debe verificar PostgreSQL y el rol worker antes de crear el runtime"
  );
}

if (/environment:\s*staging/.test(capacityWorkflow) &&
    /ref:\s*\$\{\{ github\.sha \}\}/.test(capacityWorkflow) &&
    /STAGING_WEB_DATABASE_URL/.test(capacityWorkflow) &&
    /STAGING_WORKER_DATABASE_URL/.test(capacityWorkflow) &&
    /RUN_STAGING_QUEUE_CAPACITY/.test(capacityWorkflow) &&
    /npm run carga:cola/.test(capacityWorkflow) &&
    !/STAGING_MIGRATION_DATABASE_URL/.test(capacityWorkflow)) {
  ok("la capacidad de staging usa un commit revisado y credenciales runtime");
} else {
  mal(
    "la capacidad de staging usa un commit revisado y credenciales runtime",
    "el workflow manual debe fijar github.sha, exigir confirmacion y no usar la credencial migradora"
  );
}

if (/environment:\s*staging/.test(anthropicCapacityWorkflow) &&
    /ref:\s*\$\{\{ github\.sha \}\}/.test(anthropicCapacityWorkflow) &&
    /STAGING_ANTHROPIC_API_KEY/.test(anthropicCapacityWorkflow) &&
    /AI_CAPACITY_CONCURRENCY:\s*"8"/.test(anthropicCapacityWorkflow) &&
    /AUTHORIZE_PAID_ANTHROPIC_STAGING_\$\{PROFILE\}/.test(anthropicCapacityWorkflow) &&
    /I_AUTHORIZE_PAID_ANTHROPIC_STAGING_CAPACITY/.test(anthropicCapacityWorkflow) &&
    /npm run carga:anthropic|node scripts\/probar-capacidad-anthropic\.js/.test(anthropicCapacityWorkflow) &&
    !/STAGING_MIGRATION_DATABASE_URL/.test(anthropicCapacityWorkflow)) {
  ok("la capacidad de Anthropic exige staging, autorizacion paga y techo de concurrencia");
} else {
  mal(
    "la capacidad de Anthropic exige staging, autorizacion paga y techo de concurrencia",
    "el workflow debe fijar el commit, usar la clave de staging y exigir doble autorizacion sin credenciales migradoras"
  );
}

if (/Cola durable y limpieza sobre PostgreSQL real/.test(verificationWorkflow) &&
    /ALLOW_QUEUE_LOAD_TEST:\s*"1"/.test(verificationWorkflow) &&
    /TEST_WORKER_DATABASE_URL/.test(verificationWorkflow) &&
    /npm run carga:cola/.test(verificationWorkflow)) {
  ok("CI ejecuta la cola y su limpieza contra PostgreSQL real");
} else {
  mal(
    "CI ejecuta la cola y su limpieza contra PostgreSQL real",
    "la verificacion debe ejercitar el probe con credenciales web y worker separadas"
  );
}

if (/type:\s*worker[\s\S]*key:\s*ANTHROPIC_API_KEY/.test(render)) {
  ok("el worker recibe la credencial de generación de IA");
} else {
  mal("el worker recibe la credencial de generación de IA", "falta ANTHROPIC_API_KEY en tiendaiq-worker");
}

// ---------- salida operativa ----------

const puntosOla1 = [
  ["release revisado y readiness", /Release staging[\s\S]*\/ready[\s\S]*release/i],
  ["aislamiento RLS en readiness", /RLS[\s\S]*BYPASSRLS[\s\S]*capacidad worker/i],
  ["capacidad de cola durable", /Capacity staging[\s\S]*1\.000 tenants[\s\S]*1\.000 jobs/i],
  ["capacidad real de Anthropic", /Anthropic capacity staging[\s\S]*perfil 8[\s\S]*perfil 50/i],
  ["Shopify E2E con billing y privacidad", /Shopify OAuth[\s\S]*billing[\s\S]*webhooks de privacidad/i],
  ["canary por olas", /50 tiendas[\s\S]*200 tiendas[\s\S]*1\.000 tiendas/i],
  ["alertas automaticas", /Alertas obligatorias[\s\S]*\/ready[\s\S]*Conexiones PostgreSQL[\s\S]*Anthropic[\s\S]*Shopify/i],
  ["demanda excedente sin cobro indebido", /Demanda excedente[\s\S]*Retry-After[\s\S]*No se reserva cupo ni se cobra/i],
  ["pausa por cola vieja", /Pausar nuevas generaciones[\s\S]*10 minutos/i],
  ["registro de evidencia", /Registro de evidencia[\s\S]*SHA[\s\S]*Workflow[\s\S]*Resultado/i]
];

const faltanOla1 = puntosOla1.filter(([, patron]) => !patron.test(ola1Runbook)).map(([nombre]) => nombre);
if (!launchPlan.includes("docs/runbook-ola-1.md")) {
  mal("el plan de 1.000 tiendas referencia el runbook de Ola 1", "falta enlazar docs/runbook-ola-1.md desde el plan principal");
} else if (faltanOla1.length) {
  mal("el runbook de Ola 1 cubre los gates operativos", `faltan: ${faltanOla1.join(", ")}`);
} else {
  ok("el plan de lanzamiento tiene runbook operativo de Ola 1");
}

console.log(fallos ? `\n  ${fallos} incoherencia(s)\n` : "");
process.exitCode = fallos ? 1 : 0;
