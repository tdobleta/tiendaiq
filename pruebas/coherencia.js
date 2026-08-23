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
const stagingToml = leer("shopify.app.staging.toml");
const render = leer("render.yaml");
const releaseWorkflow = leer(".github/workflows/release-staging.yml");
const productionReleaseWorkflow = leer(".github/workflows/release-production.yml");
const productionRecoveryWorkflow = leer(".github/workflows/recover-production.yml");
const productionBootstrapWorkflow = leer(".github/workflows/bootstrap-runtime-logins-production.yml");
const capacityWorkflow = leer(".github/workflows/capacity-staging.yml");
const anthropicCapacityWorkflow = leer(".github/workflows/anthropic-capacity-staging.yml");
const opsReadinessWorkflow = leer(".github/workflows/ops-readiness-staging.yml");
const opsReadinessScript = leer("scripts/probar-readiness-operativa.js");
const verificationWorkflow = leer(".github/workflows/verificar.yml");
const launchPlan = leer("docs/plan-lanzamiento-1000-tiendas.md");
const ola1Runbook = leer("docs/runbook-ola-1.md");
const appFrontend = leer("app/app.js");
const principal = toml.match(/^application_url\s*=\s*"([^"]+)"/m)?.[1];

const productionHandle = toml.match(/^handle\s*=\s*"([^"]+)"/m)?.[1];
const stagingHandle = stagingToml.match(/^handle\s*=\s*"([^"]+)"/m)?.[1];
const adminUrlSource = leer("shopify-admin-url.js");
if (!productionHandle || !stagingHandle) {
  mal("producción y staging declaran un App Home handle", "falta handle en un archivo shopify.app*.toml");
} else if (productionHandle === stagingHandle) {
  mal("producción y staging usan handles distintos", `ambos declaran ${productionHandle}`);
} else if (!/SHOPIFY_APP_HANDLE/.test(adminUrlSource) || !/\/apps\/\$\{handleApp\(appHandle\)\}\/app/.test(adminUrlSource)) {
  mal("App Home usa el handle de Shopify", "el backend no construye /apps/{handle}/app");
} else if (/apps\/\$\{env\.SHOPIFY_CLIENT_ID\}/.test(leer("auth.js") + leer("facturacion.js"))) {
  mal("App Home usa el handle de Shopify", "un redirect todavía usa SHOPIFY_CLIENT_ID como slug");
} else {
  ok(`App Home separa los handles ${productionHandle} y ${stagingHandle}`);
}

function servicioRender(nombre) {
  const escaped = nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return render
    .split(/(?=^\s{2}- type:\s*(?:web|worker)\s*$)/m)
    .find((bloque) => new RegExp(`^\\s*name:\\s*${escaped}\\s*$`, "m").test(bloque)) || "";
}

const renderWebService = servicioRender("tiendaiq");
const renderWorkerService = servicioRender("tiendaiq-worker");

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

if (/environment:\s*production/.test(productionReleaseWorkflow) &&
    /DEPLOY_REVIEWED_PRODUCTION/.test(productionReleaseWorkflow) &&
    /PRODUCTION_MIGRATION_DATABASE_URL/.test(productionReleaseWorkflow) &&
    /RENDER_PRODUCTION_WEB_DEPLOY_HOOK/.test(productionReleaseWorkflow) &&
    /RENDER_PRODUCTION_WORKER_DEPLOY_HOOK/.test(productionReleaseWorkflow) &&
    /PRODUCTION_OPS_STATUS_TOKEN/.test(productionReleaseWorkflow) &&
    /CHECK_PRODUCTION_OPS_READINESS/.test(productionReleaseWorkflow) &&
    /https:\/\/tiendaiq\.com\/ready/.test(productionReleaseWorkflow) &&
    /ready\.ok===true&&ready\.release===process\.env\.EXPECTED_SHA/.test(productionReleaseWorkflow) &&
    /git rev-parse origin\/main/.test(productionReleaseWorkflow) &&
    /data-urlencode "ref=\$\{\{ steps\.release\.outputs\.sha \}\}"/.test(productionReleaseWorkflow) &&
    /MIGRATIONS_ARE_BACKWARD_COMPATIBLE/.test(productionReleaseWorkflow) &&
    /queue:\s*max/.test(productionReleaseWorkflow) &&
    /--connect-timeout 5 --max-time 20/.test(productionReleaseWorkflow) &&
    /actions\/upload-artifact@[a-f0-9]{40}/.test(productionReleaseWorkflow) &&
    /name:\s*production-rollback-state-\$\{\{ github\.run_attempt \}\}/.test(productionReleaseWorkflow) &&
    /run_attempt:Number\(process\.env\.RELEASE_ATTEMPT\)/.test(productionReleaseWorkflow) &&
    /workflow_run:/.test(productionRecoveryWorkflow) &&
    /workflows:\s*\["Release production"\]/.test(productionRecoveryWorkflow) &&
    /queue:\s*max/.test(productionRecoveryWorkflow) &&
    /environment:\s*production-recovery/.test(productionRecoveryWorkflow) &&
    /actions\/download-artifact@[a-f0-9]{40}/.test(productionRecoveryWorkflow) &&
    /run-id:\s*\$\{\{ github\.event\.workflow_run\.id \}\}/.test(productionRecoveryWorkflow) &&
    /production-rollback-state-\$\{\{ github\.event\.workflow_run\.run_attempt \}\}/.test(productionRecoveryWorkflow) &&
    /jobs\?filter=latest&per_page=100/.test(productionRecoveryWorkflow) &&
    /un deploy de aplicacion comenzo pero falta el estado de rollback/.test(productionRecoveryWorkflow) &&
    /state\.release_sha !== process\.env\.TRIGGER_SHA/.test(productionRecoveryWorkflow) &&
    /state\.run_attempt !== Number\(process\.env\.TRIGGER_ATTEMPT\)/.test(productionRecoveryWorkflow) &&
    /Request rollback for web and worker before installing tooling/.test(productionRecoveryWorkflow) &&
    /--connect-timeout 5 --max-time 20/.test(productionRecoveryWorkflow) &&
    /ROLLBACK_READINESS_DEADLINE_SECONDS:\s*"900"/.test(productionRecoveryWorkflow) &&
    /data-urlencode "ref=\$PREVIOUS_SHA"/.test(productionRecoveryWorkflow) &&
    /EXPECTED_RELEASE_SHA:\s*\$\{\{ steps\.state\.outputs\.previous_sha \}\}/.test(productionRecoveryWorkflow) &&
    /OPS_READINESS_PROFILE:\s*rollback/.test(productionRecoveryWorkflow) &&
    /Rollback certificado: web y worker/.test(productionRecoveryWorkflow) &&
    !/PRODUCTION_MIGRATION_DATABASE_URL/.test(productionRecoveryWorkflow)) {
  ok("produccion se promueve por un workflow protegido, inmutable y verificable");
} else {
  mal(
    "produccion se promueve por un workflow protegido, inmutable y verificable",
    "debe migrar y desplegar el SHA exacto, persistir su rollback antes del deploy y certificar web y worker desde una recuperacion independiente"
  );
}

if (/environment:\s*production/.test(productionBootstrapWorkflow) &&
    /BOOTSTRAP_RUNTIME_LOGINS_PRODUCTION/.test(productionBootstrapWorkflow) &&
    /ACKNOWLEDGE_PRELAUNCH_DATABASE_CUTOVER/.test(productionBootstrapWorkflow) &&
    /PRODUCTION_MIGRATION_DATABASE_URL/.test(productionBootstrapWorkflow) &&
    /PRODUCTION_WEB_RUNTIME_LOGIN_PASSWORD/.test(productionBootstrapWorkflow) &&
    /PRODUCTION_WORKER_RUNTIME_LOGIN_PASSWORD/.test(productionBootstrapWorkflow) &&
    /git rev-parse origin\/main/.test(productionBootstrapWorkflow) &&
    /group:\s*tiendaiq-production-database-maintenance/.test(productionBootstrapWorkflow) &&
    /queue:\s*max/.test(productionBootstrapWorkflow) &&
    !/RENDER_PRODUCTION_.*DEPLOY_HOOK/.test(productionBootstrapWorkflow) &&
    !/WEB_RUNTIME_LOGIN_PASSWORD/.test(productionReleaseWorkflow)) {
  ok("el alta prelaunch de logins esta separada y serializada con el despliegue");
} else {
  mal(
    "el alta prelaunch de logins esta separada y serializada con el despliegue",
    "debe exigir doble confirmacion, compartir el lock de mantenimiento y no mutar credenciales durante releases"
  );
}

if (/release_sha:/.test(releaseWorkflow) &&
    /DEPLOY_REVIEWED_STAGING/.test(releaseWorkflow) &&
    /\^\[a-f0-9\]\{40\}\$/.test(releaseWorkflow) &&
    /git rev-parse origin\/main/.test(releaseWorkflow) &&
    /data-urlencode "ref=\$\{\{ steps\.release\.outputs\.sha \}\}"/.test(releaseWorkflow) &&
    /tiendaiq-staging-web\.onrender\.com\/ready/.test(releaseWorkflow) &&
    /ready\.release===process\.env\.EXPECTED_SHA/.test(releaseWorkflow) &&
    /Wait for the complete operational release gate/.test(releaseWorkflow) &&
    /EXPECTED_RELEASE_SHA:\s*\$\{\{ steps\.release\.outputs\.sha \}\}/.test(releaseWorkflow) &&
    /npm run ops:readiness/.test(releaseWorkflow) &&
    /Authorization:\s*`Bearer \$\{token\}`/.test(opsReadinessScript) &&
    /worker\.release \|\| ""/.test(opsReadinessScript) &&
    /timeout-minutes:\s*40/.test(releaseWorkflow) &&
    /node-version:\s*"22"/.test(releaseWorkflow) &&
    /npm install --global @shopify\/cli@4\.1\.0/.test(releaseWorkflow) &&
    /SHOPIFY_APP_AUTOMATION_TOKEN:\s*\$\{\{ secrets\.STAGING_SHOPIFY_APP_AUTOMATION_TOKEN \}\}/.test(releaseWorkflow) &&
    /SHOPIFY_CLI_NO_ANALYTICS:\s*"1"/.test(releaseWorkflow) &&
    /shopify app deploy --config staging --allow-updates --source-control-url "\$COMMIT_URL"/.test(releaseWorkflow) &&
    releaseWorkflow.indexOf("Wait for the deployed web readiness gate") < releaseWorkflow.indexOf("Deploy Shopify staging app components for the reviewed SHA") &&
    releaseWorkflow.indexOf("Deploy Shopify staging app components for the reviewed SHA") < releaseWorkflow.indexOf("Wait for the complete operational release gate") &&
    /RENDER_GIT_COMMIT/.test(leer("server.js"))) {
  ok("el release fija el SHA revisado, publica Shopify y espera readiness de staging");
} else {
  mal(
    "el release fija el SHA revisado, publica Shopify y espera readiness de staging",
    "debe validar un SHA completo en main, desplegar Render y la app Shopify del mismo ref, y esperar /ready"
  );
}

if (/release_sha:/.test(productionReleaseWorkflow) &&
    /node-version:\s*"22"/.test(productionReleaseWorkflow) &&
    /npm install --global @shopify\/cli@4\.1\.0/.test(productionReleaseWorkflow) &&
    /SHOPIFY_APP_AUTOMATION_TOKEN:\s*\$\{\{ secrets\.PRODUCTION_SHOPIFY_APP_AUTOMATION_TOKEN \}\}/.test(productionReleaseWorkflow) &&
    /SHOPIFY_CLI_NO_ANALYTICS:\s*"1"/.test(productionReleaseWorkflow) &&
    /shopify app deploy --allow-updates --source-control-url "\$COMMIT_URL"/.test(productionReleaseWorkflow) &&
    productionReleaseWorkflow.indexOf("Wait for the deployed production web readiness gate") < productionReleaseWorkflow.indexOf("Deploy Shopify production app components for the reviewed SHA") &&
    productionReleaseWorkflow.indexOf("Deploy Shopify production app components for the reviewed SHA") < productionReleaseWorkflow.indexOf("Wait for the production technical preflight gate")) {
  ok("el release de produccion publica Shopify con el mismo SHA revisado");
} else {
  mal(
    "el release de produccion publica Shopify con el mismo SHA revisado",
    "debe fijar Node 22, CLI Shopify pinneada, token productivo y despliegue antes del preflight"
  );
}

const workerSource = leer("worker.js");
if (/await Promise\.race/.test(workerSource) &&
    /verificarWorkerDB/.test(workerSource) &&
    workerSource.indexOf("verificar()") < workerSource.indexOf("crearRuntime({") &&
    workerSource.indexOf("crearRuntime({") < workerSource.indexOf("activeRuntime.start()") &&
    workerSource.indexOf("activeRuntime.start()") < workerSource.indexOf("registrarHeartbeat(heartbeat)") &&
    /Worker detenido por preflight fallido/.test(workerSource)) {
  ok("el worker falla cerrado antes de iniciar sus runners");
} else {
  mal(
    "el worker falla cerrado antes de iniciar sus runners",
    "debe verificar PostgreSQL y el rol worker antes de crear el runtime"
  );
}

if (/environment:\s*staging/.test(capacityWorkflow) &&
    /release_sha:/.test(capacityWorkflow) &&
    /ref:\s*\$\{\{ inputs\.release_sha \}\}/.test(capacityWorkflow) &&
    /git fetch origin main --depth=1/.test(capacityWorkflow) &&
    /EXPECTED_RELEASE_SHA/.test(capacityWorkflow) &&
    /\/ready/.test(capacityWorkflow) &&
    /STAGING_WEB_DATABASE_URL/.test(capacityWorkflow) &&
    /STAGING_WORKER_DATABASE_URL/.test(capacityWorkflow) &&
    /RUN_STAGING_QUEUE_CAPACITY/.test(capacityWorkflow) &&
    /npm run carga:cola/.test(capacityWorkflow) &&
    !/STAGING_MIGRATION_DATABASE_URL/.test(capacityWorkflow)) {
  ok("la capacidad de staging usa un commit revisado y credenciales runtime");
} else {
  mal(
    "la capacidad de staging usa un commit revisado y credenciales runtime",
    "el workflow manual debe fijar un SHA de main desplegado en staging, exigir confirmacion y no usar la credencial migradora"
  );
}

if (/environment:\s*staging/.test(anthropicCapacityWorkflow) &&
    /release_sha:/.test(anthropicCapacityWorkflow) &&
    /ref:\s*\$\{\{ inputs\.release_sha \}\}/.test(anthropicCapacityWorkflow) &&
    /git fetch origin main --depth=1/.test(anthropicCapacityWorkflow) &&
    /EXPECTED_RELEASE_SHA/.test(anthropicCapacityWorkflow) &&
    /\/ready/.test(anthropicCapacityWorkflow) &&
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
    "el workflow debe fijar un SHA de main desplegado en staging, usar la clave de staging y exigir doble autorizacion sin credenciales migradoras"
  );
}

if (/environment:\s*staging/.test(opsReadinessWorkflow) &&
    /ref:\s*\$\{\{ inputs\.release_sha \}\}/.test(opsReadinessWorkflow) &&
    /CHECK_STAGING_OPS_READINESS/.test(opsReadinessWorkflow) &&
    /EXPECTED_RELEASE_SHA/.test(opsReadinessWorkflow) &&
    /STAGING_OPS_STATUS_TOKEN/.test(opsReadinessWorkflow) &&
    /OPS_MAX_WORKER_AGE_SECONDS/.test(opsReadinessWorkflow) &&
    /certification_mode/.test(opsReadinessWorkflow) &&
    /technical_preflight/.test(opsReadinessWorkflow) &&
    /OPS_READINESS_PROFILE/.test(opsReadinessWorkflow) &&
    /npm run ops:readiness/.test(opsReadinessWorkflow) &&
    !/STAGING_WORKER_DATABASE_URL/.test(opsReadinessWorkflow) &&
    !/STAGING_MIGRATION_DATABASE_URL/.test(opsReadinessWorkflow)) {
  ok("la readiness operativa de staging usa commit revisado y el endpoint operativo autenticado");
} else {
  mal(
    "la readiness operativa de staging usa commit revisado, credencial worker y token de ops",
    "el workflow debe validar /ready, /ops/status, cola durable, worker y SHA sin credenciales de base"
  );
}

if (/Cola durable y limpieza sobre PostgreSQL real/.test(verificationWorkflow) &&
    /ALLOW_QUEUE_LOAD_TEST:\s*"1"/.test(verificationWorkflow) &&
    /TEST_WORKER_DATABASE_URL/.test(verificationWorkflow) &&
    /EXPECTED_RELEASE_SHA:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/.test(verificationWorkflow) &&
    /npm run carga:cola/.test(verificationWorkflow)) {
  ok("CI ejecuta la cola y su limpieza contra PostgreSQL real");
} else {
  mal(
    "CI ejecuta la cola y su limpieza contra PostgreSQL real",
    "la verificacion debe ejercitar el probe con credenciales web y worker separadas"
  );
}

if (!/key:\s*ANTHROPIC_API_KEY/.test(renderWebService)) {
  ok("la web no recibe la credencial de generacion de IA");
} else {
  mal(
    "la web no recibe la credencial de generacion de IA",
    "server.js solo debe admitir y encolar; ANTHROPIC_API_KEY pertenece al worker"
  );
}

if (!/key:\s*SHOPIFY_CLIENT_(?:ID|SECRET)/.test(renderWorkerService)) {
  ok("el worker no recibe credenciales de la app Shopify");
} else {
  mal(
    "el worker no recibe credenciales de la app Shopify",
    "OAuth y verificacion de webhooks pertenecen a la web; el worker usa tokens de tienda cifrados"
  );
}

if (!/editarTexto/.test(leer("server.js")) &&
    !/TEXT_EDIT_CONCURRENCY/.test(renderWebService) &&
    /type:\s*"edit-text"/.test(leer("server.js")) &&
    /maxAttempts:\s*1/.test(leer("server.js")) &&
    /createEditTextHandler/.test(leer("src/jobs/runtime.js")) &&
    /"edit-text": editText/.test(leer("src/jobs/runtime.js")) &&
    /Number\(job\.attempts\) > 1/.test(leer("src/jobs/edit-text-handler.js")) &&
    /request_id: pending\.requestId/.test(appFrontend) &&
    /esperarJob\(pending\.jobId/.test(appFrontend) &&
    /const EDICION_TEXTO_IA_DISPONIBLE = false/.test(appFrontend)) {
  ok("la edicion IA es durable, costo-segura y permanece oculta hasta certificar staging");
} else {
  mal(
    "la edicion IA es durable, costo-segura y permanece oculta hasta certificar staging",
    "web solo debe encolar con idempotencia; worker ejecuta un intento y el navegador espera el job con la bandera apagada"
  );
}

if (/key:\s*ANTHROPIC_API_KEY/.test(renderWorkerService)) {
  ok("el worker recibe la credencial de generación de IA");
} else {
  mal("el worker recibe la credencial de generación de IA", "falta ANTHROPIC_API_KEY en tiendaiq-worker");
}

if (/key:\s*GENERATION_ADMISSION_PAUSED\s+value:\s*"1"/.test(render) &&
    /key:\s*GENERATION_ADMISSION_RETRY_AFTER_SECONDS\s+value:\s*"[0-9]+"/.test(render) &&
    /generationAdmissionPause\(env\)/.test(leer("server.js"))) {
  ok("Render declara una compuerta de pausa para nuevas generaciones");
} else {
  mal(
    "Render declara una compuerta de pausa para nuevas generaciones",
    "web debe arrancar con GENERATION_ADMISSION_PAUSED=1, Retry-After configurable y server.js debe aplicarlo antes de encolar"
  );
}

const serverSource = leer("server.js");
if (/key:\s*OPS_STATUS_TOKEN\s+sync:\s*false/.test(renderWebService) &&
    /url\.pathname === "\/ops\/status"/.test(serverSource) &&
    /estadoColaDB\("ops-status"\)/.test(serverSource) &&
    /safeEqual\(req\.headers\.authorization/.test(serverSource) &&
    /billing:\s*\{\s*planTest/.test(serverSource) &&
    /legal:\s*\{\s*complete/.test(serverSource)) {
  ok("la web expone estado operativo agregado solo con token");
} else {
  mal(
    "la web expone estado operativo agregado solo con token",
    "Render debe declarar OPS_STATUS_TOKEN y server.js debe proteger /ops/status antes de devolver cola"
  );
}

if (/key:\s*EMAIL_SOPORTE\s+sync:\s*false/.test(renderWebService) &&
    /key:\s*RAZON_SOCIAL\s+sync:\s*false/.test(renderWebService) &&
    /key:\s*DOMICILIO\s+sync:\s*false/.test(renderWebService) &&
    /legalesIncompletos/.test(serverSource)) {
  ok("Render declara las legales publicas requeridas por Shopify");
} else {
  mal(
    "Render declara las legales publicas requeridas por Shopify",
    "web debe recibir EMAIL_SOPORTE, RAZON_SOCIAL y DOMICILIO sin escribirlos en codigo"
  );
}

if (/SUSCRIPCION_PENDIENTE/.test(appFrontend) &&
    /pending\.jobId/.test(appFrontend) &&
    /body:\s*\{ request_id: pending\.requestId \}/.test(appFrontend) &&
    /error\?\.terminal === true \|\| error\?\.status === 404/.test(appFrontend)) {
  ok("el navegador reanuda la misma intencion durable de billing tras una recarga");
} else {
  mal(
    "el navegador reanuda la misma intencion durable de billing tras una recarga",
    "debe persistir requestId/jobId, reutilizar el job y limpiar solo ante un resultado terminal"
  );
}

const bundlesSource = leer("bundles.js");
const bundlesHandler = leer("src/jobs/sync-bundles-handler.js");
const jobsRuntime = leer("src/jobs/runtime.js");
if (/type:\s*"sync-bundles"/.test(serverSource) &&
    /encolarJobExclusivoDB/.test(serverSource) &&
    /actual\.sync\?\.status === "manual_review"/.test(serverSource) &&
    /return json\(res, 423/.test(serverSource) &&
    /configAplicadaBundles\(await leerConfigBundles/.test(serverSource) &&
    /createSyncBundlesHandler/.test(bundlesHandler) &&
    /"sync-bundles": syncBundles/.test(jobsRuntime) &&
    /BUNDLES_PENDIENTE/.test(appFrontend) &&
    /expected_version: pending\.expectedVersion/.test(appFrontend) &&
    /sync\?\.status === "manual_review"/.test(appFrontend) &&
    /function configAplicadaBundles/.test(bundlesSource)) {
  ok("bundles sincroniza descuentos mediante un job durable y publica solo estado confirmado");
} else {
  mal(
    "bundles sincroniza descuentos mediante un job durable y publica solo estado confirmado",
    "web debe encolar con version/idempotencia, bloquear ambigüedad, worker debe ejecutar y storefront debe leer applied"
  );
}

// ---------- salida operativa ----------

const puntosOla1 = [
  ["release revisado y readiness", /Release staging[\s\S]*\/ready[\s\S]*release/i],
  ["preflight operativo de staging", /Ops readiness staging[\s\S]*\/ready[\s\S]*cola durable/i],
  ["aislamiento RLS en readiness", /RLS[\s\S]*BYPASSRLS[\s\S]*capacidad worker/i],
  ["capacidad de cola durable", /Capacity staging[\s\S]*1\.000 tenants[\s\S]*1\.000 jobs/i],
  ["capacidad real de Anthropic", /Anthropic capacity staging[\s\S]*perfil 8[\s\S]*perfil 50/i],
  ["Shopify E2E con billing y privacidad", /Shopify OAuth[\s\S]*billing[\s\S]*webhooks de privacidad/i],
  ["canary por olas", /50 tiendas[\s\S]*200 tiendas[\s\S]*1\.000 tiendas/i],
  ["alertas automaticas", /Alertas obligatorias[\s\S]*\/ready[\s\S]*\/ops\/status[\s\S]*Conexiones PostgreSQL[\s\S]*Anthropic[\s\S]*Shopify/i],
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
