// ============================================================
// DB — el almacén de tiendas y páginas.
//
// Un solo lugar decide dónde se guarda todo:
//   - Con DATABASE_URL (Render, producción) → Postgres.
//   - Sin DATABASE_URL (tu compu) → archivos, como hasta ahora.
//
// Así el código de arriba (tiendas.js, server.js) no sabe ni le importa
// dónde vive el dato: le pide a estas funciones y listo. El día que quieras
// otra base, se cambia acá y nada más se entera.
// ============================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { env } = require("./shopify");
const { cifrarToken, descifrarToken } = require("./cripto-tokens");
const { TenantContext, requireTenantContext, assertTenant } = require("./src/tenancy/tenant-context");
const { createPostgresPool } = require("./src/platform/postgres/create-pool");
const { withTenantTransaction } = require("./src/platform/postgres/with-tenant-transaction");
const { createPageRepository } = require("./src/platform/postgres/page-repository");
const { verifyTenantIsolation } = require("./src/platform/postgres/verify-tenancy");
const { createJobRepository } = require("./src/platform/postgres/job-repository");
const { createGenerationRepository } = require("./src/platform/postgres/generation-repository");
const { createInboxRepository } = require("./src/platform/postgres/inbox-repository");

// El token vive dentro del JSONB `datos`. Se cifra al escribir y se descifra al
// leer, en esta capa: el resto de la app sigue viendo el token en claro y no se
// entera. Clonar antes de cifrar para no mutar el objeto del caller.
function cifrarDatos(datos) {
  if (!datos || datos.token == null) return datos;
  return { ...datos, token: cifrarToken(datos.token) };
}
function descifrarDatos(datos) {
  if (!datos || datos.token == null) return datos;
  return { ...datos, token: descifrarToken(datos.token) };
}

const USA_PG = !!env.DATABASE_URL;

// ---------- Postgres ----------

let pool = null;
let pageRepository = null;
let jobRepository = null;
let generationRepository = null;
let inboxRepository = null;
async function pg() {
  if (pool) return pool;
  const { Pool } = require("pg");
  pool = createPostgresPool({
    databaseUrl: env.DATABASE_URL,
    caCertificate: env.PG_CA_CERT,
    privateNetwork: env.PG_PRIVATE_NETWORK === "1",
    Pool
  });
  return pool;
}

// ---------- archivos (fallback local) ----------

const DIR_TIENDAS = path.join(__dirname, "tiendas");
const DIR_PAGINAS = path.join(__dirname, "paginas");
const seguro = (s) => String(s).replace(/[^a-z0-9.-]/gi, "_");

function fileGuardar(dir, clave, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, seguro(clave) + ".json"), JSON.stringify(obj, null, 2));
}
function fileLeer(dir, clave) {
  const r = path.join(dir, seguro(clave) + ".json");
  return fs.existsSync(r) ? JSON.parse(fs.readFileSync(r, "utf8")) : null;
}
function fileBorrar(dir, clave) {
  const r = path.join(dir, seguro(clave) + ".json");
  if (fs.existsSync(r)) fs.unlinkSync(r);
}
function fileBorrarDirectorioSeguro(raiz, clave) {
  const base = path.resolve(raiz);
  const destino = path.resolve(base, seguro(clave));
  if (!destino.startsWith(base + path.sep)) {
    throw new Error("Ruta de tenant fuera del directorio permitido");
  }
  fs.rmSync(destino, { recursive: true, force: true });
}
function fileListar(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

// ============================================================
// API — lo único que ve el resto de la app
// ============================================================

// ---- tiendas ----

async function guardarTiendaDB(dominio, datos) {
  const cifrado = cifrarDatos(datos); // el token va cifrado en reposo
  if (USA_PG) {
    const p = await pg();
    const context = TenantContext.fromShopDomain(dominio, { source: "internal-job" });
    await withTenantTransaction(p, context, async (c, tenant) => {
      await c.query(
        `INSERT INTO control_plane.tenants (id, shop_domain, status, isolation_mode, updated_at)
         VALUES ($1, $1, 'active', 'shared_rls', now())
         ON CONFLICT (id) DO UPDATE
         SET shop_domain = EXCLUDED.shop_domain, status = 'active', updated_at = now()`,
        [tenant.tenantId]
      );
      await c.query(
        `INSERT INTO tiendas (dominio, datos, actualizada) VALUES ($1, $2, now())
         ON CONFLICT (dominio) DO UPDATE SET datos = $2, actualizada = now()`,
        [tenant.tenantId, cifrado]
      );
    });
  } else {
    fileGuardar(DIR_TIENDAS, dominio, cifrado);
  }
}

async function leerTiendaDB(dominio) {
  if (USA_PG) {
    const p = await pg();
    const context = dominio instanceof TenantContext
      ? dominio
      : TenantContext.fromShopDomain(dominio, { source: "internal-job" });
    const r = await withTenantTransaction(p, context, (c, tenant) =>
      c.query(`SELECT datos FROM tiendas WHERE dominio = $1`, [tenant.tenantId])
    );
    return descifrarDatos(r.rows[0]?.datos ?? null);
  }
  const id = dominio instanceof TenantContext ? dominio.tenantId : dominio;
  return descifrarDatos(fileLeer(DIR_TIENDAS, id));
}

async function borrarTiendaDB(dominio) {
  if (USA_PG) {
    const p = await pg();
    const context = TenantContext.fromShopDomain(dominio, { source: "internal-job" });
    await withTenantTransaction(p, context, async (c, tenant) => {
      const id = tenant.tenantId;
      await c.query(`DELETE FROM app_data.publications WHERE tenant_id = $1`, [id]);
      await c.query(`DELETE FROM app_data.page_versions WHERE tenant_id = $1`, [id]);
      await c.query(`DELETE FROM app_data.pages WHERE tenant_id = $1`, [id]);
      await c.query(`DELETE FROM public.paginas WHERE tienda = $1`, [id]);
      await c.query(`DELETE FROM public.estados_oauth WHERE tienda = $1`, [id]);
      await c.query(`DELETE FROM control_plane.usage_reservations WHERE tenant_id = $1`, [id]);
      await c.query(`DELETE FROM control_plane.jobs WHERE tenant_id = $1`, [id]);
      await c.query(`DELETE FROM control_plane.outbox_events WHERE tenant_id = $1`, [id]);
      await c.query(`DELETE FROM control_plane.privacy_requests WHERE tenant_id = $1`, [id]);
      await c.query(`DELETE FROM public.tiendas WHERE dominio = $1`, [id]);
      await c.query(`DELETE FROM control_plane.tenants WHERE id = $1`, [id]);
    });
  } else {
    fileBorrar(DIR_TIENDAS, dominio);
    fileBorrarDirectorioSeguro(DIR_PAGINAS, dominio);
    if (fs.existsSync(DIR_ESTADOS)) {
      for (const archivo of fs.readdirSync(DIR_ESTADOS).filter((f) => f.endsWith(".json"))) {
        const ruta = path.join(DIR_ESTADOS, archivo);
        const estado = JSON.parse(fs.readFileSync(ruta, "utf8"));
        if (estado.tienda === dominio) fs.unlinkSync(ruta);
      }
    }
    for (const dir of [DIR_JOBS, DIR_RESERVAS]) {
      if (!fs.existsSync(dir)) continue;
      for (const archivo of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const ruta = path.join(dir, archivo);
        const value = JSON.parse(fs.readFileSync(ruta, "utf8"));
        if (value.tenantId === dominio) fs.unlinkSync(ruta);
      }
    }
  }
}

async function listarTiendasDB() {
  if (USA_PG) {
    throw new Error("El runtime no puede listar instalaciones; use una tarea administrativa autorizada");
  }
  return fileListar(DIR_TIENDAS).map(descifrarDatos);
}

// Incremento ATÓMICO del uso del mes, con tope. Devuelve el nuevo valor si se
// incrementó, o null si ya estaba en el límite (sin cupo). En un solo UPDATE:
// el WHERE hace el chequeo y el jsonb_set el incremento, bajo el lock de fila de
// Postgres → imposible que dos requests concurrentes se pasen del cupo. `limite`
// null = sin tope (plan pro). No toca el token (queda cifrado).
async function incrementarUsoDB(dominio, mes, limite) {
  if (USA_PG) {
    const p = await pg();
    const context = TenantContext.fromShopDomain(dominio, { source: "internal-job" });
    const set = `jsonb_set(datos, ARRAY['uso', $2], to_jsonb(COALESCE((datos->'uso'->>$2)::int, 0) + 1))`;
    const sql = limite == null
      ? `UPDATE tiendas SET datos = ${set}, actualizada = now() WHERE dominio = $1 RETURNING (datos->'uso'->>$2)::int AS n`
      : `UPDATE tiendas SET datos = ${set}, actualizada = now() WHERE dominio = $1 AND COALESCE((datos->'uso'->>$2)::int, 0) < $3 RETURNING (datos->'uso'->>$2)::int AS n`;
    const r = await withTenantTransaction(p, context, (c, tenant) =>
      c.query(sql, limite == null ? [tenant.tenantId, mes] : [tenant.tenantId, mes, limite])
    );
    return r.rows[0] ? r.rows[0].n : null;
  }
  // Archivos (dev, sin concurrencia): read-modify-write con chequeo.
  const d = fileLeer(DIR_TIENDAS, dominio) || {};
  const actual = (d.uso && d.uso[mes]) || 0;
  if (limite != null && actual >= limite) return null;
  d.uso = { ...(d.uso || {}), [mes]: actual + 1 };
  fileGuardar(DIR_TIENDAS, dominio, d);
  return actual + 1;
}

// Revierte un incremento (si la generación falló después de reservar el cupo).
async function decrementarUsoDB(dominio, mes) {
  if (USA_PG) {
    const p = await pg();
    const context = TenantContext.fromShopDomain(dominio, { source: "internal-job" });
    await withTenantTransaction(p, context, (c, tenant) => c.query(
      `UPDATE tiendas SET datos = jsonb_set(datos, ARRAY['uso', $2], to_jsonb(GREATEST(0, COALESCE((datos->'uso'->>$2)::int, 0) - 1))), actualizada = now() WHERE dominio = $1`,
      [tenant.tenantId, mes]
    ));
    return;
  }
  const d = fileLeer(DIR_TIENDAS, dominio);
  if (!d) return;
  const actual = (d.uso && d.uso[mes]) || 0;
  d.uso = { ...(d.uso || {}), [mes]: Math.max(0, actual - 1) };
  fileGuardar(DIR_TIENDAS, dominio, d);
}

// Actualiza SOLO los campos indicados de una tienda (jsonb_set por clave), sin
// reescribir el objeto entero → dos writers de campos distintos no se pisan
// (fin de los lost updates). No toca el token. `campos` = { plan, plan_verificado, … }.
async function actualizarCamposTiendaDB(dominio, campos) {
  const claves = Object.keys(campos);
  if (!claves.length) return;
  if (USA_PG) {
    const p = await pg();
    const context = TenantContext.fromShopDomain(dominio, { source: "internal-job" });
    let expr = "datos";
    const vals = [context.tenantId];
    let i = 2;
    for (const k of claves) {
      expr = `jsonb_set(${expr}, ARRAY[$${i}], $${i + 1}::jsonb)`;
      vals.push(k, JSON.stringify(campos[k] ?? null));
      i += 2;
    }
    await withTenantTransaction(p, context, (c) =>
      c.query(`UPDATE tiendas SET datos = ${expr}, actualizada = now() WHERE dominio = $1`, vals)
    );
    return;
  }
  const d = fileLeer(DIR_TIENDAS, dominio);
  if (!d) return;
  Object.assign(d, campos);
  fileGuardar(DIR_TIENDAS, dominio, d);
}

// ---- páginas ----

async function guardarPaginaDB(context, id, datos) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    await pageRepository.save(tenant, id, datos);
  } else {
    const dir = path.join(DIR_PAGINAS, seguro(tenant.tenantId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, seguro(id) + ".json"), JSON.stringify(datos, null, 2));
  }
}

async function leerPaginaDB(context, id) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    return pageRepository.findById(tenant, id);
  }
  const r = path.join(DIR_PAGINAS, seguro(tenant.tenantId), seguro(id) + ".json");
  return fs.existsSync(r) ? JSON.parse(fs.readFileSync(r, "utf8")) : null;
}

// Devuelve un RESUMEN por página (no el JSONB `datos` entero). Una página con
// IA pesa cientos de KB; una tienda con muchas transfería megabytes por request
// solo para pintar una lista de títulos. Se proyectan en el SQL únicamente los
// campos que consumen las vistas de lista/estado. Para el contenido completo de
// UNA página está leerPaginaDB.
async function listarPaginasDB(context) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    return pageRepository.list(tenant);
  }
  // Archivos (dev): mismo resumen, calculado en memoria.
  return fileListar(path.join(DIR_PAGINAS, seguro(tenant.tenantId))).map((p) => {
    const galeria = p.data?.facetas?.hero?.galeria || [];
    return {
      id: p.id,
      shopify_product_id: p.shopify_product_id || null,
      estado: p.estado,
      url_publica: p.url_publica || null,
      actualizado: p.actualizado || null,
      titulo: p.data?.facetas?.hero?.titulo || null,
      imagen: (galeria.length && p.urls?.[galeria[0]]) || null
    };
  });
}

// ---- estados de OAuth ----
//
// El `state` ata el callback de Shopify a una instalación que arrancamos
// nosotros. Antes vivía en un Map en memoria: cada reinicio de Render (y el
// free tier duerme el proceso) borraba los pendientes, y el merchant que
// venía del "Instalar" se comía un "state inválido" sin explicación. Con más
// de una instancia fallaba siempre, porque el callback podía caer en otra.
//
// De un solo uso: se borra al leerlo, exista o no.

const DIR_ESTADOS = path.join(__dirname, "estados");
const DIR_JOBS = path.join(__dirname, "jobs");
const DIR_RESERVAS = path.join(__dirname, "reservas-uso");
const DIR_INBOX = path.join(__dirname, "webhook-inbox");

async function guardarEstadoDB(estado, tienda, venceMs) {
  if (USA_PG) {
    const p = await pg();
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.oauth_state', $1, true)", [estado]);
      await client.query("SELECT set_config('app.oauth_shop', $1, true)", [tienda]);
      await client.query(
        `INSERT INTO estados_oauth (estado, tienda, vence) VALUES ($1, $2, to_timestamp($3 / 1000.0))
         ON CONFLICT (estado) DO NOTHING`,
        [estado, tienda, venceMs]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } else {
    fileGuardar(DIR_ESTADOS, estado, { estado, tienda, vence: venceMs });
  }
}

// Devuelve { tienda } si el estado existía y no venció; null en cualquier otro
// caso. Siempre lo borra: un state se usa una vez.
async function consumirEstadoDB(estado) {
  if (!estado) return null;
  if (USA_PG) {
    const p = await pg();
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.oauth_state', $1, true)", [estado]);
      const r = await client.query(
        `DELETE FROM estados_oauth WHERE estado = $1 RETURNING tienda, vence >= now() AS vigente`,
        [estado]
      );
      await client.query("COMMIT");
      return r.rows[0]?.vigente ? { tienda: r.rows[0].tienda } : null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  const e = fileLeer(DIR_ESTADOS, estado);
  fileBorrar(DIR_ESTADOS, estado);
  return e && e.vence > Date.now() ? { tienda: e.tienda } : null;
}

// ---- jobs durables ----

async function encolarJobDB(context, options) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.enqueue(tenant, options);
  }

  const existing = options.idempotencyKey
    ? fileListar(DIR_JOBS).find((job) =>
        job.tenantId === tenant.tenantId &&
        job.type === options.type &&
        job.idempotencyKey === options.idempotencyKey
      )
    : null;
  if (existing) return existing;

  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    tenantId: tenant.tenantId,
    type: options.type,
    payload: options.payload || {},
    status: "queued",
    attempts: 0,
    maxAttempts: Math.max(1, Number(options.maxAttempts) || 5),
    runAfter: now,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    result: null,
    idempotencyKey: options.idempotencyKey || null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };
  fileGuardar(DIR_JOBS, job.id, job);
  return job;
}

async function leerJobDB(context, id) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.get(tenant, id);
  }
  const job = fileLeer(DIR_JOBS, id);
  return job?.tenantId === tenant.tenantId ? job : null;
}

async function reclamarJobDB(workerId, leaseSeconds = 300, jobTypes = null) {
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.claim(workerId, leaseSeconds, jobTypes);
  }
  const now = Date.now();
  const staleBefore = now - Math.max(30, Number(leaseSeconds) || 300) * 1000;
  const candidate = fileListar(DIR_JOBS)
    .filter((job) =>
      (!Array.isArray(jobTypes) || !jobTypes.length || jobTypes.includes(job.type)) &&
      ((job.status === "queued" && Date.parse(job.runAfter) <= now) ||
      (job.status === "running" && Date.parse(job.lockedAt) < staleBefore))
    )
    .sort((a, b) => String(a.runAfter).localeCompare(String(b.runAfter)) || String(a.createdAt).localeCompare(String(b.createdAt)))[0];
  if (!candidate) return null;
  candidate.status = "running";
  candidate.attempts += 1;
  candidate.lockedAt = new Date().toISOString();
  candidate.lockedBy = workerId;
  candidate.updatedAt = candidate.lockedAt;
  fileGuardar(DIR_JOBS, candidate.id, candidate);
  return {
    ...candidate,
    tenant: TenantContext.fromShopDomain(candidate.tenantId, { source: "internal-job", requestId: candidate.id })
  };
}

async function estadoColaDB(workerId = "queue-metrics") {
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.stats(workerId);
  }
  const grouped = new Map();
  const now = Date.now();
  for (const job of fileListar(DIR_JOBS).filter((item) => ["queued", "running", "failed"].includes(item.status))) {
    const state = grouped.get(job.type) || { type: job.type, queued: 0, running: 0, failed: 0, oldestQueuedSeconds: 0 };
    state[job.status] += 1;
    if (job.status === "queued") {
      state.oldestQueuedSeconds = Math.max(state.oldestQueuedSeconds, Math.max(0, (now - Date.parse(job.createdAt)) / 1000));
    }
    grouped.set(job.type, state);
  }
  return [...grouped.values()].sort((a, b) => a.type.localeCompare(b.type));
}

async function completarJobDB(context, job, result) {
  const tenant = assertTenant(context, job.tenantId);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.succeed(tenant, job, result);
  }
  const stored = fileLeer(DIR_JOBS, job.id);
  if (!stored || stored.tenantId !== tenant.tenantId || stored.status !== "running" || stored.lockedBy !== job.lockedBy) return null;
  stored.status = "succeeded";
  stored.result = result || {};
  stored.lastError = null;
  stored.lockedAt = null;
  stored.lockedBy = null;
  stored.completedAt = new Date().toISOString();
  stored.updatedAt = stored.completedAt;
  fileGuardar(DIR_JOBS, stored.id, stored);
  return stored;
}

async function renovarLeaseJobDB(context, job) {
  const tenant = assertTenant(context, job.tenantId);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.renew(tenant, job);
  }
  const stored = fileLeer(DIR_JOBS, job.id);
  if (!stored || stored.tenantId !== tenant.tenantId || stored.status !== "running" || stored.lockedBy !== job.lockedBy) return null;
  stored.lockedAt = new Date().toISOString();
  stored.updatedAt = stored.lockedAt;
  fileGuardar(DIR_JOBS, stored.id, stored);
  return stored;
}

async function fallarJobDB(context, job, error, retryDelaySeconds) {
  const tenant = assertTenant(context, job.tenantId);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.fail(tenant, job, error, retryDelaySeconds);
  }
  const stored = fileLeer(DIR_JOBS, job.id);
  if (!stored || stored.tenantId !== tenant.tenantId || stored.status !== "running" || stored.lockedBy !== job.lockedBy) return null;
  const terminal = Number(stored.attempts) >= Number(stored.maxAttempts);
  stored.status = terminal ? "failed" : "queued";
  stored.runAfter = terminal
    ? stored.runAfter
    : new Date(Date.now() + Math.max(1, retryDelaySeconds) * 1000).toISOString();
  stored.lastError = String(error?.message || error).slice(0, 1000);
  stored.lockedAt = null;
  stored.lockedBy = null;
  stored.completedAt = terminal ? new Date().toISOString() : null;
  stored.updatedAt = new Date().toISOString();
  fileGuardar(DIR_JOBS, stored.id, stored);
  return stored;
}

// ---- generaciones con reserva de uso ----

async function encolarGeneracionDB(context, options) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    generationRepository ||= createGenerationRepository(p);
    return generationRepository.enqueue(tenant, options);
  }

  const existing = fileListar(DIR_JOBS).find((job) =>
    job.tenantId === tenant.tenantId &&
    job.type === "generate-page" &&
    job.idempotencyKey === options.idempotencyKey
  );
  if (existing) {
    return { job: existing, reservation: fileListar(DIR_RESERVAS).find((r) => r.jobId === existing.id) || null };
  }

  const activeGenerations = fileListar(DIR_JOBS).filter((job) =>
    job.type === "generate-page" && ["queued", "running"].includes(job.status)
  );
  const globalLimit = Math.max(1, Number(options.maxGlobalPending) || 120);
  if (activeGenerations.length >= globalLimit) {
    const error = new Error("La capacidad de generacion esta temporalmente completa. Reintenta en un minuto.");
    error.status = 503;
    error.code = "GENERATION_QUEUE_SATURATED";
    error.retryAfter = 60;
    error.expose = true;
    throw error;
  }
  const tenantLimit = Math.max(1, Number(options.maxPending) || 2);
  if (activeGenerations.filter((job) => job.tenantId === tenant.tenantId).length >= tenantLimit) {
    const error = new Error("Ya tenes generaciones en proceso. Espera a que termine una antes de crear otra.");
    error.status = 429;
    error.code = "TENANT_GENERATION_LIMIT";
    error.retryAfter = 30;
    error.expose = true;
    throw error;
  }

  const shop = fileLeer(DIR_TIENDAS, tenant.tenantId);
  if (!shop) throw new Error("El tenant no existe en el registro de tiendas");
  const current = Number(shop.uso?.[options.period] || 0);
  if (options.limit != null && current >= Number(options.limit)) {
    const error = new Error(`Usaste las ${options.limit} páginas gratis de este mes. Pasate a TiendaIQ Pro para generar sin límite.`);
    error.status = 402;
    error.actualizar = true;
    throw error;
  }

  const now = new Date().toISOString();
  const reservationId = crypto.randomUUID();
  const job = {
    id: crypto.randomUUID(),
    tenantId: tenant.tenantId,
    type: "generate-page",
    payload: { ...(options.payload || {}), reservationId },
    status: "queued",
    attempts: 0,
    maxAttempts: Math.max(1, Number(options.maxAttempts) || 3),
    runAfter: now,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    result: null,
    idempotencyKey: options.idempotencyKey,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };
  const reservation = {
    id: reservationId,
    tenantId: tenant.tenantId,
    jobId: job.id,
    operationType: "page_generation",
    idempotencyKey: options.idempotencyKey,
    period: options.period,
    units: 1,
    quotaLimit: options.limit == null ? null : Number(options.limit),
    status: "reserved",
    lastError: null,
    createdAt: now,
    updatedAt: now,
    committedAt: null,
    releasedAt: null
  };
  shop.uso = { ...(shop.uso || {}), [options.period]: current + 1 };
  fileGuardar(DIR_TIENDAS, tenant.tenantId, shop);
  fileGuardar(DIR_RESERVAS, reservation.id, reservation);
  fileGuardar(DIR_JOBS, job.id, job);
  return { job, reservation, used: current + 1 };
}

async function leerReservaGeneracionDB(context, id) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    generationRepository ||= createGenerationRepository(p);
    return generationRepository.getReservation(tenant, id);
  }
  const reservation = fileLeer(DIR_RESERVAS, id);
  return reservation?.tenantId === tenant.tenantId ? reservation : null;
}

async function finalizarGeneracionDB(context, { reservationId, pageId, page }) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    generationRepository ||= createGenerationRepository(p);
    return generationRepository.finalize(tenant, { reservationId, pageId, page });
  }
  const reservation = await leerReservaGeneracionDB(tenant, reservationId);
  if (!reservation) throw new Error("La reserva de generación no existe");
  if (reservation.status === "released") {
    const error = new Error("La reserva de generación ya fue liberada");
    error.nonRetryable = true;
    throw error;
  }
  if (reservation.status === "committed") return reservation;
  await guardarPaginaDB(tenant, pageId, page);
  reservation.status = "committed";
  reservation.lastError = null;
  reservation.committedAt = new Date().toISOString();
  reservation.updatedAt = reservation.committedAt;
  fileGuardar(DIR_RESERVAS, reservation.id, reservation);
  return reservation;
}

async function liberarReservaGeneracionDB(context, reservationId, error) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    generationRepository ||= createGenerationRepository(p);
    return generationRepository.release(tenant, reservationId, error);
  }
  const reservation = await leerReservaGeneracionDB(tenant, reservationId);
  if (!reservation || reservation.status !== "reserved") return reservation;
  const shop = fileLeer(DIR_TIENDAS, tenant.tenantId);
  if (shop) {
    const current = Number(shop.uso?.[reservation.period] || 0);
    shop.uso = { ...(shop.uso || {}), [reservation.period]: Math.max(0, current - reservation.units) };
    fileGuardar(DIR_TIENDAS, tenant.tenantId, shop);
  }
  reservation.status = "released";
  reservation.lastError = String(error?.message || error || "").slice(0, 1000);
  reservation.releasedAt = new Date().toISOString();
  reservation.updatedAt = reservation.releasedAt;
  fileGuardar(DIR_RESERVAS, reservation.id, reservation);
  return reservation;
}

// ---- inbox durable de webhooks ----

async function recibirWebhookDB(input) {
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.receive(input);
  }
  const existing = fileLeer(DIR_INBOX, input.id);
  if (existing) {
    if (existing.shopDomain !== input.shopDomain || existing.payloadHash !== input.payloadHash) {
      throw new Error("El webhook id llegó con otra tienda o payload");
    }
    return { event: existing, inserted: false };
  }
  const now = new Date().toISOString();
  const event = {
    id: input.id,
    tenantId: input.shopDomain,
    shopDomain: input.shopDomain,
    topic: input.topic,
    payloadHash: input.payloadHash,
    payload: input.payload || {},
    status: "received",
    attempts: 0,
    maxAttempts: 8,
    runAfter: now,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    apiVersion: input.apiVersion || null,
    receivedAt: now,
    processedAt: null,
    updatedAt: now
  };
  fileGuardar(DIR_INBOX, event.id, event);
  return { event, inserted: true };
}

async function reclamarWebhookDB(workerId, leaseSeconds = 120) {
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.claim(workerId, leaseSeconds);
  }
  const now = Date.now();
  const staleBefore = now - Math.max(30, Number(leaseSeconds) || 120) * 1000;
  const event = fileListar(DIR_INBOX)
    .filter((item) =>
      (item.status === "received" && Date.parse(item.runAfter) <= now) ||
      (item.status === "processing" && Date.parse(item.lockedAt) < staleBefore)
    )
    .sort((a, b) => String(a.runAfter).localeCompare(String(b.runAfter)) || String(a.receivedAt).localeCompare(String(b.receivedAt)))[0];
  if (!event) return null;
  event.status = "processing";
  event.attempts += 1;
  event.lockedAt = new Date().toISOString();
  event.lockedBy = workerId;
  event.updatedAt = event.lockedAt;
  fileGuardar(DIR_INBOX, event.id, event);
  return {
    ...event,
    type: event.topic,
    tenant: TenantContext.fromShopDomain(event.shopDomain, { source: "webhook", requestId: event.id })
  };
}

async function completarWebhookDB(context, event) {
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.succeed(context, event);
  }
  const stored = fileLeer(DIR_INBOX, event.id);
  if (!stored || stored.status !== "processing" || stored.lockedBy !== event.lockedBy) return null;
  stored.status = "processed";
  stored.processedAt = new Date().toISOString();
  stored.updatedAt = stored.processedAt;
  stored.lockedAt = null;
  stored.lockedBy = null;
  stored.lastError = null;
  fileGuardar(DIR_INBOX, stored.id, stored);
  return stored;
}

async function fallarWebhookDB(context, event, error, retryDelaySeconds) {
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.fail(context, event, error, retryDelaySeconds);
  }
  const stored = fileLeer(DIR_INBOX, event.id);
  if (!stored || stored.status !== "processing" || stored.lockedBy !== event.lockedBy) return null;
  const terminal = Number(stored.attempts) >= Number(stored.maxAttempts);
  stored.status = terminal ? "failed" : "received";
  if (!terminal) stored.runAfter = new Date(Date.now() + Math.max(1, retryDelaySeconds) * 1000).toISOString();
  stored.lastError = String(error?.message || error).slice(0, 1000);
  stored.updatedAt = new Date().toISOString();
  stored.lockedAt = null;
  stored.lockedBy = null;
  fileGuardar(DIR_INBOX, stored.id, stored);
  return stored;
}

async function redactarInboxTiendaDB(workerId, shopDomain, preserveEventId) {
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.redactShop(workerId, shopDomain, preserveEventId);
  }
  for (const event of fileListar(DIR_INBOX).filter((item) => item.shopDomain === shopDomain)) {
    event.tenantId = null;
    event.payload = event.id === preserveEventId ? { redacted: true } : {};
    event.updatedAt = new Date().toISOString();
    fileGuardar(DIR_INBOX, event.id, event);
  }
}

async function registrarPrivacidadWebhookDB(workerId, options) {
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.recordPrivacy(workerId, options);
  }
  return null;
}

async function depurarInboxDB(workerId, options = {}) {
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.purge(workerId, options);
  }
  const now = Date.now();
  const processedBefore = now - Math.max(1, Number(options.processedDays) || 30) * 86400000;
  let processed = 0;
  for (const event of fileListar(DIR_INBOX)) {
    const removeProcessed = event.status === "processed" && Date.parse(event.processedAt) < processedBefore;
    if (!removeProcessed) continue;
    fileBorrar(DIR_INBOX, event.id);
    processed += 1;
  }
  return { processed, privacy: 0 };
}

async function verificarAlmacenamientoDB() {
  if (!USA_PG) return { tipo: "archivos" };
  const p = await pg();
  await p.query("SELECT 1");
  const aislamiento = await verifyTenantIsolation(p);
  return { tipo: "postgres", aislamiento };
}

async function cerrarAlmacenamientoDB() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  pageRepository = null;
  jobRepository = null;
  generationRepository = null;
  inboxRepository = null;
  await activePool.end();
}

module.exports = {
  USA_PG,
  guardarTiendaDB, leerTiendaDB, borrarTiendaDB, listarTiendasDB,
  incrementarUsoDB, decrementarUsoDB, actualizarCamposTiendaDB,
  guardarPaginaDB, leerPaginaDB, listarPaginasDB,
  guardarEstadoDB, consumirEstadoDB,
  encolarJobDB, leerJobDB, reclamarJobDB, renovarLeaseJobDB, completarJobDB, fallarJobDB,
  estadoColaDB,
  encolarGeneracionDB, leerReservaGeneracionDB, finalizarGeneracionDB, liberarReservaGeneracionDB,
  recibirWebhookDB, reclamarWebhookDB, completarWebhookDB, fallarWebhookDB,
  redactarInboxTiendaDB, registrarPrivacidadWebhookDB, depurarInboxDB,
  verificarAlmacenamientoDB, cerrarAlmacenamientoDB
};
