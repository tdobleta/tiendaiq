"use strict";

const ORIGIN = "https://tiendaiq-partner-staging-web.onrender.com";
const CONFIRMATION = "CLEAN_PARTNER_STAGING_QUEUE_CAPACITY";

function command(env = process.env) {
  const runId = String(env.LOAD_CLEANUP_RUN_ID || "").trim().toLowerCase();
  const tenants = Number(env.CLEANUP_TENANTS);
  const token = String(env.OPS_STATUS_TOKEN || "").trim();
  if (!/^[a-f0-9]{12}$/.test(runId)) throw new Error("LOAD_CLEANUP_RUN_ID invalido");
  if (!Number.isInteger(tenants) || tenants < 1 || tenants > 2000) throw new Error("CLEANUP_TENANTS invalido");
  if (token.length < 32) throw new Error("OPS_STATUS_TOKEN invalido");
  return { runId, tenants, token };
}

async function request(url, options, fetchFn = fetch) {
  const response = await fetchFn(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10_000) });
  let body = {};
  try { body = await response.json(); } catch {}
  return { status: response.status, body };
}

async function cleanupRemote(config, { fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const query = new URLSearchParams({ run_id: config.runId, tenants: String(config.tenants) });
  const url = `${ORIGIN}/ops/capacity-cleanup?${query}`;
  const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
  const start = await request(url, {
    method: "POST", headers, body: JSON.stringify({ confirmation: CONFIRMATION })
  }, fetchFn);
  if (start.status !== 202 || !/^[a-f0-9-]{36}$/i.test(String(start.body?.jobId || ""))) {
    throw new Error("No se pudo iniciar limpieza remota");
  }
  const statusUrl = `${url}&job_id=${encodeURIComponent(start.body.jobId)}`;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await request(statusUrl, { headers: { Authorization: `Bearer ${config.token}` } }, fetchFn);
    if (status.status === 200 && status.body?.completed === true && status.body?.tenantsDeleted === config.tenants) {
      return { passed: true, mode: "cleanup", runId: config.runId, tenantsDeleted: config.tenants };
    }
    if (status.status !== 202) throw new Error("Limpieza remota no completada");
    await sleep(2000);
  }
  throw new Error("La limpieza remota excedio el plazo");
}

if (require.main === module) {
  cleanupRemote(command()).then((result) => console.log(JSON.stringify(result))).catch(() => { process.exitCode = 2; });
}

module.exports = { ORIGIN, CONFIRMATION, command, cleanupRemote };
