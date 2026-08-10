"use strict";

const http = require("http");

const host = process.env.MOCK_LOAD_HOST || "127.0.0.1";
const port = parseInteger(process.env.MOCK_LOAD_PORT || "4322", "MOCK_LOAD_PORT", 1, 65_535);
const delayMs = parseInteger(process.env.MOCK_LOAD_DELAY_MS || "0", "MOCK_LOAD_DELAY_MS", 0, 60_000);
const failEvery = parseInteger(process.env.MOCK_LOAD_FAIL_EVERY || "0", "MOCK_LOAD_FAIL_EVERY", 0, 1_000_000);
const nonLocalAuthorization = "I_UNDERSTAND_THIS_EXPOSES_A_TEST_SERVER";

if (!isLoopback(host) && process.env.ALLOW_NON_LOCAL_LOAD_MOCK !== nonLocalAuthorization) {
  throw new Error(
    `El servidor falso solo escucha en loopback. Para otro host defina ALLOW_NON_LOCAL_LOAD_MOCK=${nonLocalAuthorization}`
  );
}

let requests = 0;
let sessions = 0;
let jobs = 0;

function parseInteger(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}`);
  }
  return parsed;
}

function isLoopback(value) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function respond(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65_536) {
        reject(new Error("body_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    request.on("error", reject);
  });
}

async function handle(request, response) {
  requests += 1;
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (failEvery && requests % failEvery === 0) return respond(response, 503, { error: "synthetic_failure" });

  const url = new URL(request.url, `http://${host}:${port}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return respond(response, 200, { ok: true, synthetic: true, requests, sessions, jobs });
  }
  if (request.headers["x-tiendaiq-load-test"] !== "synthetic") {
    return respond(response, 403, { error: "missing_load_test_marker" });
  }
  if (request.method === "GET" && url.pathname === "/sesion") {
    sessions += 1;
    return respond(response, 200, { ok: true, synthetic: true });
  }
  if (request.method === "POST" && url.pathname === "/jobs") {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return respond(response, 400, { error: error.message });
    }
    if (body.type !== "synthetic-load-job" || body.simulated !== true || !request.headers["idempotency-key"]) {
      return respond(response, 422, { error: "invalid_synthetic_job" });
    }
    jobs += 1;
    return respond(response, 202, { accepted: true, synthetic: true, request_id: body.request_id });
  }
  return respond(response, 404, { error: "not_found" });
}

const server = http.createServer((request, response) => {
  handle(request, response).catch(() => respond(response, 500, { error: "synthetic_server_error" }));
});

server.requestTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(port, host, () => {
  console.log(`Servidor sintetico de carga en http://${host}:${port}`);
  console.log("Rutas: GET /sesion, POST /jobs, GET /health");
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
