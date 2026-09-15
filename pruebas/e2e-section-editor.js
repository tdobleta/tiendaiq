"use strict";

// E2E del flujo vigente de Páginas con IA y del editor por secciones.
// Corre router, almacenamiento, cola, worker, registro, validador y renderer
// reales. Sólo se dobla Shopify/Anthropic en pruebas/e2e/red-falsa.js.

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STORE = "e2e-section-editor.myshopify.com";
const PRODUCT = "gid://shopify/Product/9001";
const PORT = Number(process.env.E2E_PUERTO || 4631);
const BASE = `http://127.0.0.1:${PORT}`;
const E2E_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tiendaiq-section-e2e-"));
const CONTROL = path.join(E2E_DIR, "control.json");
const PROCESSES = [];
let activeProcess = null;
const results = [];

function assert(value, message) {
  if (!value) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

function scenario(name, options = {}) {
  fs.writeFileSync(CONTROL, JSON.stringify({ escenario: name, ia: { modo: "ok" }, shopify: {}, ...options }));
}

async function request(method, route, body) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { raw: raw.slice(0, 300) }; }
  return { status: response.status, json };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch { /* todavía está iniciando */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("El servidor E2E no inició");
}

async function waitForJob(id) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await request("GET", `/api/jobs/${id}`);
    const job = response.json.job;
    if (job && ["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`El job ${id} no terminó`);
}

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || "", ms: Date.now() - started });
    console.log(`✓ ${name}${detail ? ` · ${detail}` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message, ms: Date.now() - started });
    console.error(`✗ ${name}\n  ${error.message}`);
  }
}

function launch() {
  const child = spawn(process.execPath, ["--require", path.join(__dirname, "e2e", "red-falsa.js"), path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DEV_MODE: "1",
      DATABASE_URL: "",
      E2E_DIR,
      SHOPIFY_STORE: STORE,
      SHOPIFY_TOKEN: "shpat_e2e",
      SHOPIFY_CLIENT_ID: "e2e-client-id",
      SHOPIFY_CLIENT_SECRET: "e2e-client-secret",
      ANTHROPIC_API_KEY: "e2e-secret",
      GENERATION_ADMISSION_PAUSED: "0",
      APP_URL: BASE,
      PAGINAS_GRATIS: "50",
      JOB_POLL_MS: "50",
      MODELO_IA: "claude-sonnet-5"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  child.stdout.on("data", (data) => output.push(String(data)));
  child.stderr.on("data", (data) => output.push(String(data)));
  child._output = output;
  activeProcess = child;
  PROCESSES.push(child);
}

function installTestTenant() {
  const directory = path.join(ROOT, "tiendas");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${STORE}.json`), JSON.stringify({
    dominio: STORE,
    token: "shpat_e2e",
    plan: "gratis",
    uso: {}
  }));
}

function debugJobFiles() {
  const root = path.join(ROOT, "jobs");
  if (!fs.existsSync(root)) return "";
  return fs.readdirSync(root)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      try { return fs.readFileSync(path.join(root, entry), "utf8"); } catch { return ""; }
    })
    .filter(Boolean)
    .join("\n")
    .slice(-1600);
}

async function main() {
  scenario("section-editor-happy-path");
  installTestTenant();
  launch();
  await waitForServer();

  let firstPageId;
  let firstPage;
  let firstRequestId = crypto.randomUUID();

  await check("el selector de creación expone sólo la plantilla activa", async () => {
    const { status, json } = await request("GET", "/api/page-templates");
    equal(status, 200, "status");
    equal(json.templates.length, 1, "plantillas activas");
    equal(json.templates[0].id, "section-page-v1", "estilo de creación");
    assert(json.templates[0].creationEnabled !== false, "la plantilla visible no está habilitada");
  });

  await check("crear una página devuelve un identificador de página independiente del producto", async () => {
    const response = await request("POST", "/api/paginas", { producto_id: PRODUCT, idioma: "es", angulo: "rutina", estilo: "section-page-v1", request_id: firstRequestId });
    equal(response.status, 202, `status${response.status === 500 ? ` · ${activeProcess?._output.join("").slice(-1200)}` : ""}`);
    firstPageId = response.json.job.pageId;
    assert(firstPageId && firstPageId !== "9001", "la página no puede usar el id del producto");
    const job = await waitForJob(response.json.job.id);
    equal(job.status, "succeeded", `estado del job${job.error ? ` · ${job.error}` : ""}${job.status === "failed" ? ` · ${debugJobFiles()}` : ""}`);
    equal(job.pageId, firstPageId, "job.pageId");
  });

  await check("la página generada nace con una sola sección base y datos reales", async () => {
    const response = await request("GET", `/api/paginas/${firstPageId}`);
    equal(response.status, 200, "status");
    firstPage = response.json.data.section_page;
    equal(firstPage.sections.length, 1, "secciones iniciales");
    equal(firstPage.sections[0].definition.id, "product-information", "sección base");
    equal(firstPage.productSnapshot.title, "Lampara Aurora 360 RGB Rotating Night Light For Bedroom", "título real");
    equal(firstPage.productSnapshot.variants[0].price, "41.95", "precio real");
    assert(firstPage.copy_slots_v1?.version === 1, "faltan slots de copy versionados");
  });

  await check("el mismo producto admite otra página independiente", async () => {
    const response = await request("POST", "/api/paginas", { producto_id: PRODUCT, idioma: "es", angulo: "regalo", estilo: "section-page-v1", request_id: crypto.randomUUID() });
    equal(response.status, 202, "status");
    assert(response.json.job.pageId && response.json.job.pageId !== firstPageId, "las páginas se mezclaron");
  });

  await check("repetir request_id es idempotente y cambiar la intención se rechaza", async () => {
    const same = await request("POST", "/api/paginas", { producto_id: PRODUCT, idioma: "es", angulo: "rutina", estilo: "section-page-v1", request_id: firstRequestId });
    assert([200, 202].includes(same.status), "el reintento no fue idempotente");
    const collision = await request("POST", "/api/paginas", { producto_id: PRODUCT, idioma: "es", angulo: "otra intención", estilo: "section-page-v1", request_id: firstRequestId });
    equal(collision.status, 409, "colisión de intención");
    equal(collision.json.code, "GENERATION_INTENT_COLLISION", "código de colisión");
  });

  let inserted;
  await check("instanciar una sección usa el registro y devuelve una composición editable", async () => {
    const response = await request("POST", `/api/paginas/${firstPageId}/sections/instantiate`, {
      definition: { id: "image-with-text", version: 1 }, occurrence: 1
    });
    equal(response.status, 200, "status");
    inserted = { id: `section-e2e-${crypto.randomUUID()}`, label: "Imagen con texto", definition: { id: "image-with-text", version: 1 }, instance: response.json.instance };
    assert(inserted.instance && inserted.instance.settings, "la sección no tiene configuración editable");
  });

  await check("guardar inserta la sección en la posición solicitada", async () => {
    const candidate = structuredClone(firstPage);
    candidate.sections.splice(1, 0, inserted);
    const response = await request("PUT", `/api/paginas/${firstPageId}`, { section_page: candidate, expected_revision: firstPage.revision });
    equal(response.status, 200, "status");
    equal(response.json.section_page.sections[1].definition.id, "image-with-text", "posición insertada");
    firstPage = response.json.section_page;
    equal(firstPage.revision, candidate.revision + 1, "revisión después de insertar");
  });

  await check("reordenar y guardar mueve la sección en el documento canónico", async () => {
    const candidate = structuredClone(firstPage);
    const [section] = candidate.sections.splice(1, 1);
    candidate.sections.push(section);
    const response = await request("PUT", `/api/paginas/${firstPageId}`, { section_page: candidate, expected_revision: firstPage.revision });
    equal(response.status, 200, "status");
    equal(response.json.section_page.sections.at(-1).definition.id, "image-with-text", "posición final");
    firstPage = response.json.section_page;
  });

  await check("recargar conserva el orden y la edición", async () => {
    const response = await request("GET", `/api/paginas/${firstPageId}`);
    const page = response.json.data.section_page;
    equal(response.status, 200, "status");
    equal(page.sections.at(-1).definition.id, "image-with-text", "orden persistido");
    assert(page.sections.at(-1).instance.settings.heading, "la sección persistida perdió su contenido");
  });

  await check("un guardado con revisión vieja no pisa cambios", async () => {
    const stale = structuredClone(firstPage);
    stale.sections.at(-1).instance.settings.heading = "Cambio concurrente";
    const response = await request("PUT", `/api/paginas/${firstPageId}`, { section_page: stale, expected_revision: 0 });
    equal(response.status, 409, "conflicto de revisión");
  });

  await check("la vista previa usa el mismo documento validado", async () => {
    const response = await request("POST", `/api/paginas/${firstPageId}/section-preview`, { section_page: firstPage });
    equal(response.status, 200, "status");
    assert(response.json.html.includes("tiq-"), "la vista previa no renderizó secciones TiendaIQ");
    assert(response.json.html.includes("Lampara Aurora"), "la vista previa perdió el producto real");
  });

  await check("el contrato del editor no ofrece agregar bloques internos", async () => {
    const source = fs.readFileSync(path.join(ROOT, "app", "section-editor.js"), "utf8");
    assert(!source.includes("data-block-add"), "apareció el flujo eliminado de agregar bloque");
    assert(source.includes("data-section-drag"), "faltan controles de arrastre de secciones");
    assert(source.includes("sectionDropIndex"), "faltan destinos explícitos de inserción");
  });
}

async function finish() {
  for (const child of PROCESSES) child.kill();
  for (const dir of ["tiendas", "paginas", "jobs", "reservas-uso"]) {
    const root = path.join(ROOT, dir);
    if (!fs.existsSync(root)) continue;
    const entries = fs.readdirSync(root);
    for (const entry of entries) {
      const target = path.join(root, entry);
      if (entry.includes(STORE) || target.includes(STORE)) fs.rmSync(target, { recursive: true, force: true });
    }
  }
  fs.rmSync(E2E_DIR, { recursive: true, force: true });
}

main()
  .catch((error) => {
    console.error(`E2E detenido: ${error.stack || error.message}`);
    results.push({ name: "arranque E2E", ok: false, detail: error.message });
  })
  .finally(async () => {
    await finish();
    const passed = results.filter((result) => result.ok).length;
    console.log(`\nE2E editor por secciones: ${passed}/${results.length} comprobaciones en verde`);
    if (passed !== results.length) process.exitCode = 1;
  });
