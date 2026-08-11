"use strict";

const http = require("http");
const https = require("https");
const { randomUUID } = require("crypto");
const { performance } = require("perf_hooks");

const LIMITS = Object.freeze({
  sessions: 2_000,
  jobs: 1_000,
  concurrency: 2_000,
  timeoutMs: 60_000,
  rampUpMs: 300_000
});

const DEFAULTS = Object.freeze({
  baseUrl: "http://127.0.0.1:4322",
  sessionPath: "/sesion",
  jobPath: "/jobs",
  sessions: 100,
  jobs: 50,
  concurrency: 25,
  timeoutMs: 5_000,
  rampUpMs: 1_000,
  maxErrorRate: 0.01,
  maxP95Ms: 1_000,
  minRps: 0
});

const REMOTE_AUTHORIZATION = "I_UNDERSTAND_THIS_GENERATES_TRAFFIC";
const FORBIDDEN_HEADERS = new Set(["connection", "content-length", "host", "transfer-encoding"]);
const BUSINESS_ROUTES = [
  /^\/api\/productos(?:\/|$)/,
  /^\/api\/paginas(?:\/|$)/,
  /^\/api\/texto\/editar(?:\/|$)/,
  /^\/api\/imagen(?:\/|$)/,
  /^\/api\/bundles(?:\/|$)/,
  /^\/api\/nicho(?:\/|$)/,
  /^\/api\/plan(?:\/|$)/
];

function usage() {
  return `
Uso:
  node scripts/carga-local.js [opciones]

Opciones:
  --base-url URL          Servidor objetivo (default: ${DEFAULTS.baseUrl})
  --session-path PATH     Endpoint sintetico de sesion (default: ${DEFAULTS.sessionPath})
  --job-path PATH         Endpoint sintetico de jobs (default: ${DEFAULTS.jobPath})
  --sessions N            Requests de sesion, 0-${LIMITS.sessions} (default: ${DEFAULTS.sessions})
  --jobs N                Envios de jobs, 0-${LIMITS.jobs} (default: ${DEFAULTS.jobs})
  --concurrency N         Requests simultaneos, 1-${LIMITS.concurrency} (default: ${DEFAULTS.concurrency})
  --timeout-ms N          Timeout individual, 100-${LIMITS.timeoutMs} (default: ${DEFAULTS.timeoutMs})
  --ramp-up-ms N          Distribuye inicios, 0-${LIMITS.rampUpMs} (default: ${DEFAULTS.rampUpMs})
  --max-error-rate N      Fraccion permitida, 0-1 (default: ${DEFAULTS.maxErrorRate})
  --max-p95-ms N          P95 global maximo (default: ${DEFAULTS.maxP95Ms})
  --min-rps N             Throughput global minimo; 0 lo desactiva (default: ${DEFAULTS.minRps})
  --json                  Imprime solo el resultado JSON
  --dry-run               Valida y muestra la configuracion sin enviar trafico
  --help                  Muestra esta ayuda

Variables opcionales:
  LOAD_TEST_AUTHORIZATION   Valor completo de Authorization para el endpoint sintetico
  LOAD_TEST_HEADERS_JSON    Objeto JSON de headers adicionales, sin Host ni Content-Length

Proteccion remota:
  Todo host no local requiere:
  ALLOW_NON_LOCAL_LOAD_TEST=${REMOTE_AUTHORIZATION}
`;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, json: false, dryRun: false };
  const names = new Map([
    ["--base-url", "baseUrl"],
    ["--session-path", "sessionPath"],
    ["--job-path", "jobPath"],
    ["--sessions", "sessions"],
    ["--jobs", "jobs"],
    ["--concurrency", "concurrency"],
    ["--timeout-ms", "timeoutMs"],
    ["--ramp-up-ms", "rampUpMs"],
    ["--max-error-rate", "maxErrorRate"],
    ["--max-p95-ms", "maxP95Ms"],
    ["--min-rps", "minRps"]
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === "--help") return { help: true };
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const key = names.get(argument);
    if (!key) throw new Error(`Opcion desconocida: ${argument}`);
    if (i + 1 >= argv.length) throw new Error(`Falta el valor de ${argument}`);
    options[key] = argv[i + 1];
    i += 1;
  }

  options.sessions = integer(options.sessions, "sessions", 0, LIMITS.sessions);
  options.jobs = integer(options.jobs, "jobs", 0, LIMITS.jobs);
  options.concurrency = integer(options.concurrency, "concurrency", 1, LIMITS.concurrency);
  options.timeoutMs = integer(options.timeoutMs, "timeout-ms", 100, LIMITS.timeoutMs);
  options.rampUpMs = integer(options.rampUpMs, "ramp-up-ms", 0, LIMITS.rampUpMs);
  options.maxP95Ms = number(options.maxP95Ms, "max-p95-ms", 1, LIMITS.timeoutMs);
  options.maxErrorRate = number(options.maxErrorRate, "max-error-rate", 0, 1);
  options.minRps = number(options.minRps, "min-rps", 0, Number.MAX_SAFE_INTEGER);

  if (options.sessions + options.jobs === 0) throw new Error("Debe solicitar al menos una sesion o un job");
  options.concurrency = Math.min(options.concurrency, options.sessions + options.jobs);
  return options;
}

function integer(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}`);
  }
  return parsed;
}

function number(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} debe ser un numero entre ${min} y ${max}`);
  }
  return parsed;
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

function validatePath(value, name) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    throw new Error(`${name} debe ser una ruta absoluta del mismo servidor`);
  }
  const pathname = new URL(value, "http://local.invalid").pathname;
  if (BUSINESS_ROUTES.some((pattern) => pattern.test(pathname))) {
    throw new Error(`${name} apunta a una ruta de negocio (${pathname}). Use un endpoint sintetico sin efectos externos.`);
  }
}

function loadHeaders() {
  let extra = {};
  if (process.env.LOAD_TEST_HEADERS_JSON) {
    try {
      extra = JSON.parse(process.env.LOAD_TEST_HEADERS_JSON);
    } catch {
      throw new Error("LOAD_TEST_HEADERS_JSON no contiene JSON valido");
    }
    if (!extra || Array.isArray(extra) || typeof extra !== "object") {
      throw new Error("LOAD_TEST_HEADERS_JSON debe ser un objeto JSON");
    }
  }

  const headers = {};
  for (const [rawName, rawValue] of Object.entries(extra)) {
    const name = rawName.toLowerCase();
    if (FORBIDDEN_HEADERS.has(name)) throw new Error(`Header no permitido: ${rawName}`);
    if (typeof rawValue !== "string") throw new Error(`El header ${rawName} debe tener un valor string`);
    headers[name] = rawValue;
  }
  if (process.env.LOAD_TEST_AUTHORIZATION) headers.authorization = process.env.LOAD_TEST_AUTHORIZATION;
  return headers;
}

function validate(options) {
  let baseUrl;
  try {
    baseUrl = new URL(options.baseUrl);
  } catch {
    throw new Error("base-url no es una URL valida");
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error("base-url solo admite http o https");
  if (baseUrl.username || baseUrl.password) throw new Error("No incluya credenciales en base-url; use variables de headers");
  if (baseUrl.search || baseUrl.hash) throw new Error("base-url no puede incluir query ni fragmento");
  if (!isLoopback(baseUrl.hostname) && process.env.ALLOW_NON_LOCAL_LOAD_TEST !== REMOTE_AUTHORIZATION) {
    throw new Error(
      `Destino no local bloqueado. Defina ALLOW_NON_LOCAL_LOAD_TEST=${REMOTE_AUTHORIZATION} solo con autorizacion del entorno.`
    );
  }
  validatePath(options.sessionPath, "session-path");
  validatePath(options.jobPath, "job-path");
  const sessionUrl = new URL(options.sessionPath, baseUrl);
  const jobUrl = new URL(options.jobPath, baseUrl);
  if (sessionUrl.origin !== baseUrl.origin || jobUrl.origin !== baseUrl.origin) {
    throw new Error("Las rutas deben conservar el origen de base-url");
  }
  return { baseUrl, sessionUrl, jobUrl, headers: loadHeaders() };
}

function buildTasks(sessions, jobs) {
  const total = sessions + jobs;
  const tasks = [];
  let jobsAdded = 0;
  let sessionsAdded = 0;
  for (let index = 0; index < total; index += 1) {
    const targetJobs = Math.floor(((index + 1) * jobs) / total);
    if (jobsAdded < targetJobs) {
      jobsAdded += 1;
      tasks.push({ kind: "job", sequence: jobsAdded });
    } else {
      sessionsAdded += 1;
      tasks.push({ kind: "session", sequence: sessionsAdded });
    }
  }
  return tasks;
}

function delay(ms) {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function requestOnce({ url, method, headers, body, timeoutMs, agent }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const transport = url.protocol === "https:" ? https : http;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, latencyMs: performance.now() - started });
    };

    const request = transport.request(url, { method, headers, agent }, (response) => {
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 1_048_576) request.destroy(new Error("response_too_large"));
      });
      response.on("end", () => {
        const status = response.statusCode || 0;
        finish({ ok: status >= 200 && status < 300, status, errorType: status >= 200 && status < 300 ? null : "http" });
      });
      response.on("error", (error) => finish({ ok: false, status: response.statusCode || 0, errorType: error.message }));
    });

    request.setTimeout(timeoutMs, () => {
      const error = new Error("timeout");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", (error) => {
      finish({ ok: false, status: 0, errorType: error.code === "ETIMEDOUT" ? "timeout" : "network" });
    });
    if (body) request.write(body);
    request.end();
  });
}

function requestForTask(task, config, runId, agent) {
  const sessionId = `load-session-${String(task.sequence).padStart(4, "0")}`;
  const common = {
    accept: "application/json",
    "user-agent": "TiendaIQ-Local-Load-Test/1.0",
    "x-tiendaiq-load-test": "synthetic",
    "x-load-test-run-id": runId,
    "x-load-test-session-id": sessionId,
    ...config.headers
  };

  if (task.kind === "session") {
    return requestOnce({
      url: config.sessionUrl,
      method: "GET",
      headers: common,
      body: null,
      timeoutMs: config.options.timeoutMs,
      agent
    });
  }

  const requestId = randomUUID();
  const body = JSON.stringify({
    type: "synthetic-load-job",
    request_id: requestId,
    session_id: sessionId,
    sequence: task.sequence,
    simulated: true
  });
  return requestOnce({
    url: config.jobUrl,
    method: "POST",
    headers: {
      ...common,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "idempotency-key": `load:${runId}:${requestId}`
    },
    body,
    timeoutMs: config.options.timeoutMs,
    agent
  });
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(records) {
  const latencies = records.map((record) => record.latencyMs);
  const errors = records.filter((record) => !record.ok);
  const statusCounts = {};
  const errorCounts = {};
  for (const record of records) {
    const status = record.status ? String(record.status) : "none";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (record.errorType) errorCounts[record.errorType] = (errorCounts[record.errorType] || 0) + 1;
  }
  return {
    total: records.length,
    ok: records.length - errors.length,
    errors: errors.length,
    errorRate: records.length ? errors.length / records.length : 0,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : 0,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.length ? Math.max(...latencies) : 0
    },
    statusCounts,
    errorCounts
  };
}

async function run(options, target) {
  const tasks = buildTasks(options.sessions, options.jobs);
  const runId = randomUUID();
  const records = [];
  const started = performance.now();
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: options.concurrency });
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: options.concurrency });
  const agent = target.baseUrl.protocol === "https:" ? httpsAgent : httpAgent;
  let cursor = 0;

  const config = { ...target, options };
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      const scheduledAt = started + ((options.rampUpMs * index) / Math.max(1, tasks.length - 1));
      await delay(scheduledAt - performance.now());
      const task = tasks[index];
      const result = await requestForTask(task, config, runId, agent);
      records.push({ ...result, kind: task.kind });
    }
  }

  try {
    await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
  } finally {
    httpAgent.destroy();
    httpsAgent.destroy();
  }

  const durationMs = performance.now() - started;
  const overall = summarize(records);
  const sessions = summarize(records.filter((record) => record.kind === "session"));
  const jobs = summarize(records.filter((record) => record.kind === "job"));
  const rps = durationMs > 0 ? records.length / (durationMs / 1_000) : 0;
  const violations = [];
  if (overall.errorRate > options.maxErrorRate) {
    violations.push(`error rate ${(overall.errorRate * 100).toFixed(2)}% > ${(options.maxErrorRate * 100).toFixed(2)}%`);
  }
  if (overall.latencyMs.p95 > options.maxP95Ms) {
    violations.push(`p95 ${overall.latencyMs.p95.toFixed(1)} ms > ${options.maxP95Ms} ms`);
  }
  if (options.minRps > 0 && rps < options.minRps) {
    violations.push(`throughput ${rps.toFixed(1)} rps < ${options.minRps} rps`);
  }

  return {
    passed: violations.length === 0,
    runId,
    target: target.baseUrl.origin,
    configuration: {
      sessions: options.sessions,
      jobs: options.jobs,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      rampUpMs: options.rampUpMs
    },
    durationMs,
    rps,
    overall,
    sessions,
    jobs,
    thresholds: {
      maxErrorRate: options.maxErrorRate,
      maxP95Ms: options.maxP95Ms,
      minRps: options.minRps
    },
    violations
  };
}

function round(value) {
  return Number(value.toFixed(2));
}

function printable(result) {
  const copy = JSON.parse(JSON.stringify(result));
  copy.durationMs = round(copy.durationMs);
  copy.rps = round(copy.rps);
  for (const group of [copy.overall, copy.sessions, copy.jobs]) {
    group.errorRate = round(group.errorRate);
    for (const key of Object.keys(group.latencyMs)) group.latencyMs[key] = round(group.latencyMs[key]);
  }
  return copy;
}

function printHuman(result) {
  const status = result.passed ? "APROBADA" : "RECHAZADA";
  const line = (name, stats) => {
    const latency = stats.latencyMs;
    console.log(
      `  ${name.padEnd(9)} total=${stats.total} ok=${stats.ok} errores=${stats.errors} ` +
      `p50=${latency.p50.toFixed(1)}ms p95=${latency.p95.toFixed(1)}ms p99=${latency.p99.toFixed(1)}ms`
    );
  };
  console.log(`\nCarga ${status}`);
  console.log(`  destino=${result.target} duracion=${result.durationMs.toFixed(1)}ms throughput=${result.rps.toFixed(1)} rps`);
  line("total", result.overall);
  line("sesiones", result.sessions);
  line("jobs", result.jobs);
  console.log(`  estados=${JSON.stringify(result.overall.statusCounts)} errores=${JSON.stringify(result.overall.errorCounts)}`);
  console.log(
    `  umbrales=error<=${(result.thresholds.maxErrorRate * 100).toFixed(2)}% ` +
    `p95<=${result.thresholds.maxP95Ms}ms min-rps=${result.thresholds.minRps || "off"}`
  );
  if (result.violations.length) result.violations.forEach((violation) => console.log(`  FALLO: ${violation}`));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage().trim());
    return;
  }
  const target = validate(options);
  if (options.dryRun) {
    const safe = {
      baseUrl: target.baseUrl.origin,
      sessionUrl: target.sessionUrl.href,
      jobUrl: target.jobUrl.href,
      sessions: options.sessions,
      jobs: options.jobs,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      rampUpMs: options.rampUpMs,
      customHeaderNames: Object.keys(target.headers)
    };
    console.log(options.json ? JSON.stringify(safe) : `Configuracion valida:\n${JSON.stringify(safe, null, 2)}`);
    return;
  }

  const result = await run(options, target);
  if (options.json) console.log(JSON.stringify(printable(result)));
  else printHuman(result);
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Carga no ejecutada: ${error.message}`);
  process.exitCode = 2;
});
