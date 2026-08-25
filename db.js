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
const { cifrarToken, descifrarToken, cifrarTokenConAAD, descifrarTokenConAAD } = require("./cripto-tokens");
const { TenantContext, requireTenantContext, assertTenant } = require("./src/tenancy/tenant-context");
const { createPostgresPool } = require("./src/platform/postgres/create-pool");
const { withTenantTransaction } = require("./src/platform/postgres/with-tenant-transaction");
const { createPageRepository } = require("./src/platform/postgres/page-repository");
const { verifyTenantIsolation, verifyWorkerIsolation } = require("./src/platform/postgres/verify-tenancy");
const { createJobRepository } = require("./src/platform/postgres/job-repository");
const { createGenerationRepository } = require("./src/platform/postgres/generation-repository");
const { createInboxRepository } = require("./src/platform/postgres/inbox-repository");
const { createShopifyCertificationRepository } = require("./src/platform/postgres/shopify-certification-repository");
const { createAppRegistrationRepository } = require("./src/platform/postgres/app-registration-repository");
const { createShopifyCredentialRepository } = require("./src/platform/postgres/shopify-credential-repository");
const {
  appRegistrationBindingContract,
  requireEnforcedAppRegistration,
  appRegistrationDiagnostic
} = require("./src/runtime/app-registration-contract");
const {
  normalizeStoredPageRecord
} = require("./src/domain/page-contract");

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
let shopifyCertificationRepository = null;
let appRegistrationRepository = null;
let shopifyCredentialRepository = null;
async function pg() {
  if (pool) return pool;
  const { Pool } = require("pg");
  pool = createPostgresPool({
    databaseUrl: env.DATABASE_URL,
    caCertificate: env.PG_CA_CERT,
    privateNetwork: env.PG_PRIVATE_NETWORK === "1",
    runtimeRole: env.PG_RUNTIME_ROLE,
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

function esWorkerRuntime() {
  return env.PG_RUNTIME_ROLE === "tiendaiq_worker_runtime";
}

function aadCredencialShopify(tenantId, field) {
  return `shopify-offline:${tenantId}:${field}`;
}

// Los refresh tokens viven fuera del JSON histórico de tiendas. Este borde
// impide que el worker los lea incluso si por error un caller pide una sesión
// completa: PostgreSQL concede únicamente las columnas de access al worker.
async function guardarCredencialShopifyDB(dominio, credential) {
  const context = dominio instanceof TenantContext
    ? dominio
    : TenantContext.fromShopDomain(dominio, { source: "internal-job" });
  if (!credential?.accessToken || !credential?.refreshToken || !credential.accessExpiresAt || !credential.refreshExpiresAt) {
    throw new TypeError("La credencial Shopify expiring requiere access, refresh y expiraciones");
  }
  if (USA_PG) {
    if (esWorkerRuntime()) throw new Error("El worker no puede persistir refresh credentials de Shopify");
    const p = await pg();
    shopifyCredentialRepository ||= createShopifyCredentialRepository(p);
    return shopifyCredentialRepository.saveInstallation(context, {
      accessCiphertext: cifrarTokenConAAD(credential.accessToken, aadCredencialShopify(context.tenantId, "access")),
      accessExpiresAt: credential.accessExpiresAt,
      refreshCiphertext: cifrarTokenConAAD(credential.refreshToken, aadCredencialShopify(context.tenantId, "refresh")),
      refreshExpiresAt: credential.refreshExpiresAt
    });
  }
  const current = fileLeer(DIR_TIENDAS, context.tenantId) || {};
  fileGuardar(DIR_TIENDAS, context.tenantId, {
    ...current,
    shopify_offline_credential: {
      accessToken: credential.accessToken,
      accessExpiresAt: credential.accessExpiresAt,
      refreshToken: credential.refreshToken,
      refreshExpiresAt: credential.refreshExpiresAt,
      credentialVersion: Number(current.shopify_offline_credential?.credentialVersion || 0) + 1,
      refreshState: "active"
    }
  });
  return null;
}

// Una instalación no existe hasta que su metadata y sus credenciales expiring
// quedaron juntas. Separar estas escrituras deja una tienda fantasma que no
// puede resolver sesión ni volver a hacer token exchange de forma segura.
async function guardarInstalacionExpiringDB(dominio, datos, credential) {
  const context = dominio instanceof TenantContext
    ? dominio
    : TenantContext.fromShopDomain(dominio, { source: "internal-job" });
  if (!credential?.accessToken || !credential?.refreshToken || !credential.accessExpiresAt || !credential.refreshExpiresAt) {
    throw new TypeError("La instalación expiring requiere access, refresh y expiraciones");
  }
  const registro = cifrarDatos({ ...datos, token: null });
  if (USA_PG) {
    if (esWorkerRuntime()) throw new Error("El worker no puede persistir instalaciones Shopify");
    const p = await pg();
    await withTenantTransaction(p, context, async (client, tenant) => {
      await client.query(
        `INSERT INTO control_plane.tenants (id, shop_domain, status, isolation_mode, updated_at)
         VALUES ($1, $1, 'active', 'shared_rls', now())
         ON CONFLICT (id) DO UPDATE
         SET shop_domain = EXCLUDED.shop_domain, status = 'active', updated_at = now()`,
        [tenant.tenantId]
      );
      await client.query(
        `INSERT INTO public.tiendas (dominio, datos, actualizada) VALUES ($1, $2, now())
         ON CONFLICT (dominio) DO UPDATE SET datos = EXCLUDED.datos, actualizada = now()`,
        [tenant.tenantId, registro]
      );
      await client.query(
        `INSERT INTO control_plane.shopify_offline_credentials
           (tenant_id, access_ciphertext, access_expires_at, refresh_ciphertext, refresh_expires_at, credential_version, refresh_state, reauth_required_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, 'active', NULL, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           access_ciphertext = EXCLUDED.access_ciphertext,
           access_expires_at = EXCLUDED.access_expires_at,
           refresh_ciphertext = EXCLUDED.refresh_ciphertext,
           refresh_expires_at = EXCLUDED.refresh_expires_at,
           credential_version = control_plane.shopify_offline_credentials.credential_version + 1,
           refresh_state = 'active', refresh_lease_id = NULL, refresh_lease_until = NULL,
           reauth_required_at = NULL, last_refresh_failure_code = NULL, updated_at = now()`,
        [
          tenant.tenantId,
          cifrarTokenConAAD(credential.accessToken, aadCredencialShopify(tenant.tenantId, "access")), credential.accessExpiresAt,
          cifrarTokenConAAD(credential.refreshToken, aadCredencialShopify(tenant.tenantId, "refresh")), credential.refreshExpiresAt
        ]
      );
    });
    return;
  }
  // Archivo local: un único archivo JSON hace que la operación sea atómica a
  // nivel de registro (el modo no-Postgres nunca se usa en runtimes públicos).
  fileGuardar(DIR_TIENDAS, context.tenantId, {
    ...registro,
    shopify_offline_credential: {
      accessToken: credential.accessToken,
      accessExpiresAt: credential.accessExpiresAt,
      refreshToken: credential.refreshToken,
      refreshExpiresAt: credential.refreshExpiresAt,
      credentialVersion: 1,
      refreshState: "active"
    }
  });
}

async function leerCredencialShopifyDB(dominio, { includeRefresh = false } = {}) {
  const context = dominio instanceof TenantContext
    ? dominio
    : TenantContext.fromShopDomain(dominio, { source: "internal-job" });
  if (includeRefresh && esWorkerRuntime()) throw new Error("El worker no puede leer refresh credentials de Shopify");
  if (USA_PG) {
    const p = await pg();
    shopifyCredentialRepository ||= createShopifyCredentialRepository(p);
    const row = await shopifyCredentialRepository.get(context, { includeRefresh });
    if (!row) return null;
    return {
      ...row,
      accessToken: descifrarTokenConAAD(row.accessCiphertext, aadCredencialShopify(context.tenantId, "access")),
      ...(includeRefresh ? {
        refreshToken: descifrarTokenConAAD(row.refreshCiphertext, aadCredencialShopify(context.tenantId, "refresh"))
      } : {})
    };
  }
  const row = fileLeer(DIR_TIENDAS, context.tenantId)?.shopify_offline_credential;
  if (!row) return null;
  const { refreshToken, ...publicRow } = row;
  return includeRefresh ? row : publicRow;
}

async function adquirirLeaseRefreshShopifyDB(dominio, credentialVersion) {
  if (!USA_PG || esWorkerRuntime()) return null;
  const context = dominio instanceof TenantContext ? dominio : TenantContext.fromShopDomain(dominio, { source: "internal-job" });
  const p = await pg();
  shopifyCredentialRepository ||= createShopifyCredentialRepository(p);
  const row = await shopifyCredentialRepository.acquireRefreshLease(context, credentialVersion);
  if (!row) return null;
  return {
    ...row,
    accessToken: descifrarTokenConAAD(row.accessCiphertext, aadCredencialShopify(context.tenantId, "access")),
    refreshToken: descifrarTokenConAAD(row.refreshCiphertext, aadCredencialShopify(context.tenantId, "refresh"))
  };
}

async function completarRefreshShopifyDB(dominio, lease, credential) {
  if (!USA_PG || esWorkerRuntime()) throw new Error("Solo el web puede completar un refresh Shopify");
  const context = dominio instanceof TenantContext ? dominio : TenantContext.fromShopDomain(dominio, { source: "internal-job" });
  const p = await pg();
  shopifyCredentialRepository ||= createShopifyCredentialRepository(p);
  return shopifyCredentialRepository.completeRefresh(context, {
    credentialVersion: lease.credentialVersion,
    leaseId: lease.refreshLeaseId,
    accessCiphertext: cifrarTokenConAAD(credential.accessToken, aadCredencialShopify(context.tenantId, "access")),
    accessExpiresAt: credential.accessExpiresAt,
    refreshCiphertext: cifrarTokenConAAD(credential.refreshToken, aadCredencialShopify(context.tenantId, "refresh")),
    refreshExpiresAt: credential.refreshExpiresAt
  });
}

async function fallarRefreshShopifyDB(dominio, lease, { code, reauthRequired = false } = {}) {
  if (!USA_PG || esWorkerRuntime()) return;
  const context = dominio instanceof TenantContext ? dominio : TenantContext.fromShopDomain(dominio, { source: "internal-job" });
  const p = await pg();
  shopifyCredentialRepository ||= createShopifyCredentialRepository(p);
  await shopifyCredentialRepository.failRefresh(context, {
    credentialVersion: lease.credentialVersion,
    leaseId: lease.refreshLeaseId,
    code,
    reauthRequired
  });
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
  const page = normalizeStoredPageRecord(datos, { expectedId: id });
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    await pageRepository.save(tenant, id, page);
  } else {
    const dir = path.join(DIR_PAGINAS, seguro(tenant.tenantId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, seguro(id) + ".json"), JSON.stringify(page, null, 2));
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
  if (!fs.existsSync(r)) return null;

  return normalizeStoredPageRecord(JSON.parse(fs.readFileSync(r, "utf8")), {
    expectedId: id
  });
}

async function marcarPublicacionFallidaDB(context, id, activeJobId, errorMessage) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    return pageRepository.markPublicationFailed(tenant, id, activeJobId, errorMessage);
  }
  const current = await leerPaginaDB(tenant, id);
  if (!current || current.active_job_id !== activeJobId) return null;
  current.estado = "necesita_atencion";
  current.active_job_id = null;
  current.last_job_error = String(errorMessage || "Fallo terminal").slice(0, 500);
  current.actualizado = new Date().toISOString();
  await guardarPaginaDB(tenant, id, current);
  return current;
}

async function encolarPublicacionDB(context, id, options = {}) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    return pageRepository.enqueuePublication(tenant, id, options);
  }

  const page = await leerPaginaDB(tenant, id);
  if (!page) return null;
  if (page.active_job_id) {
    const active = await leerJobDB(tenant, page.active_job_id);
    if (active && ["queued", "running"].includes(active.status)) {
      return { page, job: active, reused: true };
    }
  }
  const jobIdempotency = `publish:${id}:${crypto.randomUUID()}`;
  const job = await encolarJobDB(tenant, {
    type: "publish-page",
    payload: { pageId: id },
    idempotencyKey: jobIdempotency,
    maxAttempts: options.maxAttempts || 3
  });
  const updatedPage = {
    ...page,
    estado: "publicando",
    active_job_id: job.id,
    last_job_error: null
  };
  await guardarPaginaDB(tenant, id, updatedPage);
  return { page: updatedPage, job, reused: false };
}

async function encolarDespublicacionDB(context, id, options = {}) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    return pageRepository.enqueueUnpublication(tenant, id, options);
  }
  const page = await leerPaginaDB(tenant, id);
  if (!page) return null;
  if (page.active_job_id) {
    const active = await leerJobDB(tenant, page.active_job_id);
    if (active && ["queued", "running"].includes(active.status)) {
      return active.type === "unpublish-page"
        ? { page, job: active, reused: true, conflict: false }
        : { page, job: active, reused: false, conflict: true };
    }
  }
  const job = await encolarJobDB(tenant, {
    type: "unpublish-page",
    payload: { pageId: id },
    idempotencyKey: `unpublish-page:${id}:${crypto.randomUUID()}`,
    maxAttempts: options.maxAttempts || 3
  });
  const updatedPage = { ...page, estado: "despublicando", active_job_id: job.id, last_job_error: null };
  await guardarPaginaDB(tenant, id, updatedPage);
  return { page: updatedPage, job, reused: false, conflict: false };
}

async function checkpointAvatarPublicacionDB(context, id, activeJobId, previousAvatar, uploadedAvatar) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    return pageRepository.checkpointPublicationAvatar(tenant, id, activeJobId, previousAvatar, uploadedAvatar);
  }
  const page = await leerPaginaDB(tenant, id);
  if (!page || page.active_job_id !== activeJobId) return null;
  const review = page.data?.facetas?.hero?.resena_destacada;
  if (!review || review.avatar !== previousAvatar) return { page, skipped: true };
  review.avatar = uploadedAvatar;
  await guardarPaginaDB(tenant, id, page);
  return { page, replayed: false };
}

async function completarPublicacionPaginaDB(context, id, activeJobId, result) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    return pageRepository.completePublication(tenant, id, activeJobId, result);
  }
  const page = await leerPaginaDB(tenant, id);
  if (!page) return null;
  if (page.last_completed_job_id === activeJobId) return { page, replayed: true };
  if (page.active_job_id !== activeJobId) return null;
  const review = page.data?.facetas?.hero?.resena_destacada;
  if (review && result.publishedAvatar !== result.originalAvatar && review.avatar === result.originalAvatar) {
    review.avatar = result.publishedAvatar;
  }
  page.estado = "publicada";
  page.url_publica = result.url;
  page.active_job_id = null;
  page.last_completed_job_id = activeJobId;
  page.last_job_error = null;
  page.published_content_hash = result.publishedHash;
  page.cambios_sin_publicar = crypto.createHash("sha256").update(JSON.stringify(page.data || {})).digest("hex") !== result.publishedHash;
  await guardarPaginaDB(tenant, id, page);
  return { page, replayed: false };
}

async function completarDespublicacionPaginaDB(context, id, activeJobId) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    pageRepository ||= createPageRepository(p);
    return pageRepository.completeUnpublication(tenant, id, activeJobId);
  }
  const page = await leerPaginaDB(tenant, id);
  if (!page) return null;
  if (page.last_completed_job_id === activeJobId) return { page, replayed: true };
  if (page.active_job_id !== activeJobId) return null;
  page.estado = "borrador";
  page.url_publica = null;
  page.active_job_id = null;
  page.last_completed_job_id = activeJobId;
  page.last_job_error = null;
  await guardarPaginaDB(tenant, id, page);
  return { page, replayed: false };
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
    leaseExpiresAt: null,
    lockedBy: null,
    lastError: null,
    result: null,
    idempotencyKey: options.idempotencyKey || null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    compensationStatus: null,
    compensationAttempts: 0,
    compensationRunAfter: null,
    compensationLockedAt: null,
    compensationLockedBy: null,
    compensationLastError: null,
    compensatedAt: null
  };
  fileGuardar(DIR_JOBS, job.id, job);
  return job;
}

async function encolarJobExclusivoDB(context, options) {
  const tenant = requireTenantContext(context);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.enqueueExclusive(tenant, options);
  }

  const active = fileListar(DIR_JOBS).find((job) =>
    job.tenantId === tenant.tenantId &&
    job.type === options.type &&
    ["queued", "running"].includes(job.status)
  );
  if (active) return active;
  if (options.type === "create-subscription") {
    const blocked = fileListar(DIR_JOBS).find((job) =>
      job.tenantId === tenant.tenantId && job.type === options.type && job.status === "failed" &&
    (job.result?.diagnostic?.kind === "shopify_subscription_recovery" ||
      String(job.lastError || "").startsWith("Shopify pudo haber creado la suscripción, pero no confirmó el resultado"))
    );
    if (blocked && !options.allowSubscriptionRecovery) return blocked;
  }
  return encolarJobDB(tenant, options);
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

function leaseVencido(expiraEn, bloqueadoEn, compatibilidadSegundos, ahora = Date.now()) {
  const expiry = expiraEn
    ? Date.parse(expiraEn)
    : bloqueadoEn
      ? Date.parse(bloqueadoEn) + compatibilidadSegundos * 1000
      : Number.NEGATIVE_INFINITY;
  return !Number.isFinite(expiry) || expiry < ahora;
}

async function reclamarJobDB(workerId, releaseSha, leaseSeconds = 300, jobTypes = null) {
  const normalizedReleaseSha = String(releaseSha || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalizedReleaseSha)) {
    throw new TypeError("El claim requiere el SHA completo del worker");
  }
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.claim(workerId, normalizedReleaseSha, leaseSeconds, jobTypes);
  }
  const now = Date.now();
  const candidate = fileListar(DIR_JOBS)
    .filter((job) =>
      (!Array.isArray(jobTypes) || !jobTypes.length || jobTypes.includes(job.type)) &&
      ((job.status === "queued" && Date.parse(job.runAfter) <= now) ||
      (job.status === "running" && leaseVencido(job.leaseExpiresAt, job.lockedAt, 300, now)))
    )
    .sort((a, b) => String(a.runAfter).localeCompare(String(b.runAfter)) || String(a.createdAt).localeCompare(String(b.createdAt)))[0];
  if (!candidate) return null;
  candidate.status = "running";
  candidate.attempts += 1;
  candidate.lockedAt = new Date().toISOString();
  candidate.leaseExpiresAt = new Date(now + Math.max(30, Number(leaseSeconds) || 300) * 1000).toISOString();
  candidate.lockedBy = workerId;
  candidate.workerReleaseSha = normalizedReleaseSha;
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
    const state = grouped.get(job.type) || {
      type: job.type,
      queued: 0,
      running: 0,
      failed: 0,
      failedRecent: 0,
      staleRunning: 0,
      compensationPending: 0,
      compensationDeadLetter: 0,
      staleCompensation: 0,
      oldestQueuedSeconds: 0,
      oldestCompensationSeconds: 0
    };
    state[job.status] += 1;
    if (job.status === "queued") {
      state.oldestQueuedSeconds = Math.max(state.oldestQueuedSeconds, Math.max(0, (now - Date.parse(job.createdAt)) / 1000));
    }
    if (["pending", "running"].includes(job.compensationStatus)) {
      state.compensationPending += 1;
      state.oldestCompensationSeconds = Math.max(
        state.oldestCompensationSeconds,
        Math.max(0, (now - Date.parse(job.completedAt || job.updatedAt || job.createdAt)) / 1000)
      );
    }
    if (job.compensationStatus === "dead_letter") state.compensationDeadLetter += 1;
    if (job.status === "running" && leaseVencido(job.leaseExpiresAt, job.lockedAt, 300, now)) {
      state.staleRunning += 1;
    }
    if (job.compensationStatus === "running" && leaseVencido(
      job.compensationLeaseExpiresAt,
      job.compensationLockedAt,
      300,
      now
    )) {
      state.staleCompensation += 1;
    }
    grouped.set(job.type, state);
  }
  return [...grouped.values()].sort((a, b) => a.type.localeCompare(b.type));
}

async function registrarHeartbeatWorkerDB(heartbeat) {
  if (!USA_PG) throw new Error("El heartbeat del worker requiere PostgreSQL");
  const p = await pg();
  jobRepository ||= createJobRepository(p);
  return jobRepository.recordHeartbeat(heartbeat);
}

async function estadoWorkerDB() {
  if (!USA_PG) return null;
  const p = await pg();
  jobRepository ||= createJobRepository(p);
  return jobRepository.workerStatus();
}

async function estadoBillingWorkerDB() {
  if (!USA_PG) return null;
  const p = await pg();
  jobRepository ||= createJobRepository(p);
  return jobRepository.billingWorkerStatus();
}

async function estadoInboxDB() {
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.stats();
  }
  const now = Date.now();
  const status = {
    received: 0,
    processing: 0,
    failed: 0,
    failedRecent: 0,
    staleProcessing: 0,
    oldestReceivedSeconds: 0
  };
  for (const event of fileListar(DIR_INBOX)) {
    if (event.status === "received") {
      status.received += 1;
      status.oldestReceivedSeconds = Math.max(
        status.oldestReceivedSeconds,
        Math.max(0, (now - Date.parse(event.runAfter || event.receivedAt)) / 1000)
      );
    }
    if (event.status === "processing") {
      status.processing += 1;
      if (Date.parse(event.lockedAt) < now - 3 * 60 * 1000) status.staleProcessing += 1;
    }
    if (event.status === "failed") {
      status.failed += 1;
      if (Date.parse(event.updatedAt) >= now - 15 * 60 * 1000) status.failedRecent += 1;
    }
  }
  return status;
}

async function completarJobDB(context, job, result) {
  const tenant = assertTenant(context, job.tenantId);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.succeed(tenant, job, result);
  }
  const stored = fileLeer(DIR_JOBS, job.id);
  if (!stored || stored.tenantId !== tenant.tenantId || stored.status !== "running" ||
      stored.lockedBy !== job.lockedBy || stored.workerReleaseSha !== job.workerReleaseSha) return null;
  stored.status = "succeeded";
  stored.result = result || {};
  stored.lastError = null;
  stored.lockedAt = null;
  stored.leaseExpiresAt = null;
  stored.lockedBy = null;
  stored.completedAt = new Date().toISOString();
  stored.updatedAt = stored.completedAt;
  fileGuardar(DIR_JOBS, stored.id, stored);
  return stored;
}

async function renovarLeaseJobDB(context, job, leaseSeconds = 300) {
  const tenant = assertTenant(context, job.tenantId);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.renew(tenant, job, leaseSeconds);
  }
  const stored = fileLeer(DIR_JOBS, job.id);
  if (!stored || stored.tenantId !== tenant.tenantId || stored.status !== "running" ||
      stored.lockedBy !== job.lockedBy || stored.workerReleaseSha !== job.workerReleaseSha) return null;
  stored.lockedAt = new Date().toISOString();
  stored.leaseExpiresAt = new Date(Date.now() + Math.max(30, Number(leaseSeconds) || 300) * 1000).toISOString();
  stored.updatedAt = stored.lockedAt;
  fileGuardar(DIR_JOBS, stored.id, stored);
  return stored;
}

async function fallarJobDB(context, job, error, retryDelaySeconds, needsCompensation = false) {
  const tenant = assertTenant(context, job.tenantId);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.fail(tenant, job, error, retryDelaySeconds, needsCompensation);
  }
  const stored = fileLeer(DIR_JOBS, job.id);
  if (!stored || stored.tenantId !== tenant.tenantId || stored.status !== "running" ||
      stored.lockedBy !== job.lockedBy || stored.workerReleaseSha !== job.workerReleaseSha) return null;
  const terminal = Number(stored.attempts) >= Number(stored.maxAttempts);
  stored.status = terminal ? "failed" : "queued";
  stored.runAfter = terminal
    ? stored.runAfter
    : new Date(Date.now() + Math.max(1, retryDelaySeconds) * 1000).toISOString();
  stored.lastError = String(error?.message || error).slice(0, 1000);
  if (error?.safeDiagnostic?.kind === "shopify_subscription_recovery") {
    stored.result = { diagnostic: error.safeDiagnostic };
  }
  stored.lockedAt = null;
  stored.leaseExpiresAt = null;
  stored.lockedBy = null;
  if (!terminal) stored.workerReleaseSha = null;
  stored.completedAt = terminal ? new Date().toISOString() : null;
  if (terminal && needsCompensation === true) {
    stored.compensationStatus = "pending";
    stored.compensationRunAfter = new Date().toISOString();
    stored.compensationLastError = null;
  }
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
    leaseExpiresAt: null,
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

function withProviderState(reservation, providerState) {
  if (!reservation) return null;
  Object.defineProperty(reservation, "providerState", {
    value: providerState || null,
    enumerable: false,
    configurable: true
  });
  return reservation;
}

function providerFailure(error) {
  return {
    code: error?.code || error?.name || null,
    message: String(error?.message || error || "Estado ambiguo del proveedor").slice(0, 1000),
    requestId: error?.request_id || error?.requestId || null,
    retryAfter: Number.isFinite(Number(error?.retryAfter)) ? Number(error.retryAfter) : null
  };
}

async function transicionarProveedorGeneracionDB(context, reservationId, command = {}) {
  const tenant = requireTenantContext(context);
  const action = command.action;
  if (!reservationId || !command.jobId || !action) throw new TypeError("La transición del proveedor está incompleta");

  if (USA_PG) {
    const p = await pg();
    return withTenantTransaction(p, tenant, async (client) => {
      const result = await client.query(
        `SELECT r.status AS reservation_status, j.status AS job_status, j.payload
           FROM control_plane.usage_reservations r
           JOIN control_plane.jobs j
             ON j.tenant_id = r.tenant_id AND j.id = r.job_id
          WHERE r.tenant_id = $1 AND r.id = $2 AND j.id = $3
          FOR UPDATE OF r, j`,
        [tenant.tenantId, reservationId, command.jobId]
      );
      const row = result.rows[0];
      if (!row) throw new Error("La reserva o el job de generación no existe");
      const payload = row.payload || {};
      const current = payload.providerAttempt || null;
      const now = new Date().toISOString();

      if (action === "begin") {
        if (row.reservation_status !== "reserved") {
          return { started: false, state: row.reservation_status, attemptId: current?.attemptId || null };
        }
        if (current?.state === "provider_in_flight") {
          const ambiguous = {
            ...current,
            state: "ambiguous",
            ambiguousAt: now,
            failure: { code: "RECOVERED_IN_FLIGHT", message: "Se recuperó un intento sin resultado durable", requestId: null, retryAfter: null }
          };
          await client.query(
            `UPDATE control_plane.jobs
                SET payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{providerAttempt}', $3::jsonb, true),
                    updated_at = now()
              WHERE tenant_id = $1 AND id = $2`,
            [tenant.tenantId, command.jobId, ambiguous]
          );
          return { started: false, state: "ambiguous", attemptId: ambiguous.attemptId };
        }
        if (current?.state === "ambiguous") {
          return { started: false, state: "ambiguous", attemptId: current.attemptId };
        }
        const next = {
          state: "provider_in_flight",
          attemptId: crypto.randomUUID(),
          startedAt: now
        };
        await client.query(
          `UPDATE control_plane.jobs
              SET payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{providerAttempt}', $3::jsonb, true),
                  updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, command.jobId, next]
        );
        return { started: true, state: next.state, attemptId: next.attemptId };
      }

      if (action === "ambiguous") {
        if (current?.state === "ambiguous" && current.attemptId === command.attemptId) {
          return { changed: false, state: "ambiguous", attemptId: current.attemptId };
        }
        if (current?.state !== "provider_in_flight" || current.attemptId !== command.attemptId) {
          return { changed: false, state: current?.state || null, attemptId: current?.attemptId || null };
        }
        const ambiguous = {
          ...current,
          state: "ambiguous",
          ambiguousAt: now,
          failure: providerFailure(command.error)
        };
        await client.query(
          `UPDATE control_plane.jobs
              SET payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{providerAttempt}', $3::jsonb, true),
                  updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, command.jobId, ambiguous]
        );
        return { changed: true, state: "ambiguous", attemptId: ambiguous.attemptId };
      }

      if (action === "clear") {
        if (current?.state !== "provider_in_flight" || current.attemptId !== command.attemptId) {
          return { changed: false, state: current?.state || null, attemptId: current?.attemptId || null };
        }
        await client.query(
          `UPDATE control_plane.jobs
              SET payload = coalesce(payload, '{}'::jsonb) - 'providerAttempt', updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, command.jobId]
        );
        return { changed: true, state: null, attemptId: command.attemptId };
      }

      if (action === "authorize_retry") {
        if (row.reservation_status !== "reserved" || current?.state !== "ambiguous") {
          throw new Error("Solo se puede reintentar una generación reservada y ambigua");
        }
        if (row.job_status !== "failed") throw new Error("El job debe estar fallido antes de reconciliarlo");
        const authorized = {
          ...current,
          state: "retry_authorized",
          reconciledAt: now,
          reconciliationReason: String(command.reason || "Reintento autorizado manualmente").slice(0, 1000)
        };
        await client.query(
          `UPDATE control_plane.jobs
              SET payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{providerAttempt}', $3::jsonb, true),
                  status = 'queued', attempts = 0, run_after = now(),
                  locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
                  last_error = NULL, completed_at = NULL,
                  compensation_status = NULL, compensation_attempts = 0,
                  compensation_run_after = NULL, compensation_locked_at = NULL,
                  compensation_lease_expires_at = NULL, compensation_locked_by = NULL,
                  compensation_last_error = NULL,
                  compensated_at = NULL, updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, command.jobId, authorized]
        );
        return { changed: true, state: "retry_authorized", attemptId: current.attemptId };
      }

      throw new TypeError(`Transición de proveedor desconocida: ${action}`);
    });
  }

  const reservation = fileLeer(DIR_RESERVAS, reservationId);
  const job = fileLeer(DIR_JOBS, command.jobId);
  if (!reservation || reservation.tenantId !== tenant.tenantId || !job || job.tenantId !== tenant.tenantId || reservation.jobId !== job.id) {
    throw new Error("La reserva o el job de generación no existe");
  }
  const current = job.payload?.providerAttempt || null;
  const now = new Date().toISOString();
  if (action === "begin") {
    if (reservation.status !== "reserved") return { started: false, state: reservation.status, attemptId: current?.attemptId || null };
    if (current?.state === "provider_in_flight") {
      job.payload.providerAttempt = {
        ...current,
        state: "ambiguous",
        ambiguousAt: now,
        failure: { code: "RECOVERED_IN_FLIGHT", message: "Se recuperó un intento sin resultado durable", requestId: null, retryAfter: null }
      };
      fileGuardar(DIR_JOBS, job.id, job);
      return { started: false, state: "ambiguous", attemptId: current.attemptId };
    }
    if (current?.state === "ambiguous") return { started: false, state: "ambiguous", attemptId: current.attemptId };
    const next = { state: "provider_in_flight", attemptId: crypto.randomUUID(), startedAt: now };
    job.payload = { ...(job.payload || {}), providerAttempt: next };
    fileGuardar(DIR_JOBS, job.id, job);
    return { started: true, state: next.state, attemptId: next.attemptId };
  }
  if (action === "ambiguous") {
    if (current?.state === "ambiguous" && current.attemptId === command.attemptId) return { changed: false, state: "ambiguous", attemptId: current.attemptId };
    if (current?.state !== "provider_in_flight" || current.attemptId !== command.attemptId) return { changed: false, state: current?.state || null, attemptId: current?.attemptId || null };
    job.payload.providerAttempt = { ...current, state: "ambiguous", ambiguousAt: now, failure: providerFailure(command.error) };
    fileGuardar(DIR_JOBS, job.id, job);
    return { changed: true, state: "ambiguous", attemptId: current.attemptId };
  }
  if (action === "clear") {
    if (current?.state !== "provider_in_flight" || current.attemptId !== command.attemptId) return { changed: false, state: current?.state || null, attemptId: current?.attemptId || null };
    delete job.payload.providerAttempt;
    fileGuardar(DIR_JOBS, job.id, job);
    return { changed: true, state: null, attemptId: command.attemptId };
  }
  if (action === "authorize_retry") {
    if (reservation.status !== "reserved" || current?.state !== "ambiguous") throw new Error("Solo se puede reintentar una generación reservada y ambigua");
    if (job.status !== "failed") throw new Error("El job debe estar fallido antes de reconciliarlo");
    job.payload.providerAttempt = {
      ...current,
      state: "retry_authorized",
      reconciledAt: now,
      reconciliationReason: String(command.reason || "Reintento autorizado manualmente").slice(0, 1000)
    };
    Object.assign(job, {
      status: "queued", attempts: 0, runAfter: now, lockedAt: null, leaseExpiresAt: null,
      lockedBy: null, lastError: null, completedAt: null,
      compensationStatus: null, compensationAttempts: 0, compensationRunAfter: null,
      compensationLockedAt: null, compensationLeaseExpiresAt: null,
      compensationLockedBy: null, compensationLastError: null,
      compensatedAt: null, updatedAt: now
    });
    fileGuardar(DIR_JOBS, job.id, job);
    return { changed: true, state: "retry_authorized", attemptId: current.attemptId };
  }
  throw new TypeError(`Transición de proveedor desconocida: ${action}`);
}

async function leerReservaGeneracionDB(context, id, options = null) {
  const tenant = requireTenantContext(context);
  if (options?.providerTransition) {
    return transicionarProveedorGeneracionDB(tenant, id, options.providerTransition);
  }
  if (USA_PG) {
    const p = await pg();
    generationRepository ||= createGenerationRepository(p);
    jobRepository ||= createJobRepository(p);
    const reservation = await generationRepository.getReservation(tenant, id);
    if (!reservation) return null;
    const job = await jobRepository.get(tenant, reservation.jobId);
    return withProviderState(reservation, job?.payload?.providerAttempt);
  }
  const reservation = fileLeer(DIR_RESERVAS, id);
  if (reservation?.tenantId !== tenant.tenantId) return null;
  const job = fileLeer(DIR_JOBS, reservation.jobId);
  return withProviderState(reservation, job?.payload?.providerAttempt);
}

async function reconciliarGeneracionAmbiguaDB(context, reservationId, { action, reason = "" } = {}) {
  const tenant = requireTenantContext(context);
  const reservation = await leerReservaGeneracionDB(tenant, reservationId);
  if (!reservation) throw new Error("La reserva de generación no existe");
  if (reservation.providerState?.state !== "ambiguous") throw new Error("La generación no está en estado ambiguo");

  if (action === "release") {
    const released = await liberarReservaGeneracionDB(
      tenant,
      reservationId,
      new Error(String(reason || "Liberación autorizada tras reconciliación manual"))
    );
    return { action: "released", reservation: released };
  }
  if (action === "retry") {
    const transition = await transicionarProveedorGeneracionDB(tenant, reservationId, {
      action: "authorize_retry",
      jobId: reservation.jobId,
      reason
    });
    return { action: "retry_authorized", reservationId, jobId: reservation.jobId, transition };
  }
  throw new TypeError("La reconciliación requiere action 'release' o 'retry'");
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

async function reclamarWebhookDB(workerId, releaseSha, leaseSeconds = 120) {
  const normalizedReleaseSha = String(releaseSha || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalizedReleaseSha)) {
    throw new TypeError("El claim del inbox requiere el SHA completo del worker");
  }
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.claim(workerId, normalizedReleaseSha, leaseSeconds);
  }
  const now = Date.now();
  const event = fileListar(DIR_INBOX)
    .filter((item) =>
      (item.status === "received" && Date.parse(item.runAfter) <= now) ||
      (item.status === "processing" && leaseVencido(item.leaseExpiresAt, item.lockedAt, 180, now))
    )
    .sort((a, b) => String(a.runAfter).localeCompare(String(b.runAfter)) || String(a.receivedAt).localeCompare(String(b.receivedAt)))[0];
  if (!event) return null;
  event.status = "processing";
  event.attempts += 1;
  event.lockedAt = new Date().toISOString();
  event.leaseExpiresAt = new Date(now + Math.max(30, Number(leaseSeconds) || 120) * 1000).toISOString();
  event.lockedBy = workerId;
  event.workerReleaseSha = normalizedReleaseSha;
  event.updatedAt = event.lockedAt;
  fileGuardar(DIR_INBOX, event.id, event);
  return {
    ...event,
    type: event.topic,
    tenant: TenantContext.fromShopDomain(event.shopDomain, { source: "webhook", requestId: event.id })
  };
}

async function reclamarCompensacionJobDB(workerId, leaseSeconds = 300, jobTypes = null) {
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.claimCompensation(workerId, leaseSeconds, jobTypes);
  }
  if (!workerId) throw new TypeError("La compensacion requiere identidad worker");
  const now = Date.now();
  const candidate = fileListar(DIR_JOBS)
    .filter((job) =>
      job.status === "failed" &&
      (!Array.isArray(jobTypes) || !jobTypes.length || jobTypes.includes(job.type)) &&
      ((job.compensationStatus === "pending" && Date.parse(job.compensationRunAfter) <= now) ||
        (job.compensationStatus === "running" && leaseVencido(
          job.compensationLeaseExpiresAt,
          job.compensationLockedAt,
          300,
          now
        )))
    )
    .sort((a, b) => String(a.compensationRunAfter).localeCompare(String(b.compensationRunAfter)) ||
      String(a.completedAt).localeCompare(String(b.completedAt)))[0];
  if (!candidate) return null;
  candidate.compensationStatus = "running";
  candidate.compensationAttempts = Number(candidate.compensationAttempts || 0) + 1;
  candidate.compensationLockedAt = new Date().toISOString();
  candidate.compensationLeaseExpiresAt = new Date(now + Math.max(30, Number(leaseSeconds) || 300) * 1000).toISOString();
  candidate.compensationLockedBy = workerId;
  candidate.updatedAt = candidate.compensationLockedAt;
  fileGuardar(DIR_JOBS, candidate.id, candidate);
  return {
    ...candidate,
    tenant: TenantContext.fromShopDomain(candidate.tenantId, { source: "internal-job", requestId: candidate.id })
  };
}

async function completarCompensacionJobDB(context, job) {
  const tenant = assertTenant(context, job.tenantId);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.completeCompensation(tenant, job);
  }
  const stored = fileLeer(DIR_JOBS, job.id);
  if (!stored || stored.tenantId !== tenant.tenantId || stored.status !== "failed" ||
      stored.compensationStatus !== "running" || stored.compensationLockedBy !== job.compensationLockedBy) return null;
  stored.compensationStatus = "succeeded";
  stored.compensationLastError = null;
  stored.compensationLockedAt = null;
  stored.compensationLeaseExpiresAt = null;
  stored.compensationLockedBy = null;
  stored.compensatedAt = new Date().toISOString();
  stored.updatedAt = stored.compensatedAt;
  fileGuardar(DIR_JOBS, stored.id, stored);
  return stored;
}

async function renovarCompensacionJobDB(context, job, leaseSeconds = 300) {
  const tenant = assertTenant(context, job.tenantId);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.renewCompensation(tenant, job, leaseSeconds);
  }
  const stored = fileLeer(DIR_JOBS, job.id);
  if (!stored || stored.tenantId !== tenant.tenantId || stored.status !== "failed" ||
      stored.compensationStatus !== "running" || stored.compensationLockedBy !== job.compensationLockedBy) return null;
  stored.compensationLockedAt = new Date().toISOString();
  stored.compensationLeaseExpiresAt = new Date(Date.now() + Math.max(30, Number(leaseSeconds) || 300) * 1000).toISOString();
  stored.updatedAt = stored.compensationLockedAt;
  fileGuardar(DIR_JOBS, stored.id, stored);
  return stored;
}

async function fallarCompensacionJobDB(context, job, error, retryDelaySeconds, terminal = false) {
  const tenant = assertTenant(context, job.tenantId);
  if (USA_PG) {
    const p = await pg();
    jobRepository ||= createJobRepository(p);
    return jobRepository.failCompensation(tenant, job, error, retryDelaySeconds, terminal);
  }
  const stored = fileLeer(DIR_JOBS, job.id);
  if (!stored || stored.tenantId !== tenant.tenantId || stored.status !== "failed" ||
      stored.compensationStatus !== "running" || stored.compensationLockedBy !== job.compensationLockedBy) return null;
  stored.compensationStatus = terminal === true ? "dead_letter" : "pending";
  if (!terminal) {
    stored.compensationRunAfter = new Date(Date.now() + Math.max(1, Number(retryDelaySeconds) || 5) * 1000).toISOString();
  }
  stored.compensationLastError = String(error?.message || error).slice(0, 1000);
  stored.compensationLockedAt = null;
  stored.compensationLeaseExpiresAt = null;
  stored.compensationLockedBy = null;
  stored.updatedAt = new Date().toISOString();
  fileGuardar(DIR_JOBS, stored.id, stored);
  return stored;
}

async function renovarLeaseWebhookDB(context, event, leaseSeconds = 120) {
  const tenant = assertTenant(context, event.tenantId || event.shopDomain);
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.renew(tenant, event, leaseSeconds);
  }
  const stored = fileLeer(DIR_INBOX, event.id);
  if (!stored ||
      stored.shopDomain !== tenant.shopDomain ||
      stored.status !== "processing" ||
      stored.lockedBy !== event.lockedBy ||
      stored.workerReleaseSha !== event.workerReleaseSha) return null;
  stored.lockedAt = new Date().toISOString();
  stored.leaseExpiresAt = new Date(Date.now() + Math.max(30, Number(leaseSeconds) || 120) * 1000).toISOString();
  stored.updatedAt = stored.lockedAt;
  fileGuardar(DIR_INBOX, stored.id, stored);
  return stored;
}

async function completarWebhookDB(context, event) {
  const tenant = assertTenant(context, event.tenantId || event.shopDomain);
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.succeed(tenant, event);
  }
  const stored = fileLeer(DIR_INBOX, event.id);
  if (!stored || stored.shopDomain !== tenant.shopDomain || stored.status !== "processing" ||
      stored.lockedBy !== event.lockedBy || stored.workerReleaseSha !== event.workerReleaseSha) return null;
  stored.status = "processed";
  stored.processedAt = new Date().toISOString();
  stored.updatedAt = stored.processedAt;
  stored.lockedAt = null;
  stored.leaseExpiresAt = null;
  stored.lockedBy = null;
  stored.lastError = null;
  fileGuardar(DIR_INBOX, stored.id, stored);
  return stored;
}

async function fallarWebhookDB(context, event, error, retryDelaySeconds) {
  const tenant = assertTenant(context, event.tenantId || event.shopDomain);
  if (USA_PG) {
    const p = await pg();
    inboxRepository ||= createInboxRepository(p);
    return inboxRepository.fail(tenant, event, error, retryDelaySeconds);
  }
  const stored = fileLeer(DIR_INBOX, event.id);
  if (!stored || stored.shopDomain !== tenant.shopDomain || stored.status !== "processing" ||
      stored.lockedBy !== event.lockedBy || stored.workerReleaseSha !== event.workerReleaseSha) return null;
  const terminal = Number(stored.attempts) >= Number(stored.maxAttempts);
  stored.status = terminal ? "failed" : "received";
  if (!terminal) stored.runAfter = new Date(Date.now() + Math.max(1, retryDelaySeconds) * 1000).toISOString();
  stored.lastError = String(error?.message || error).slice(0, 1000);
  stored.updatedAt = new Date().toISOString();
  stored.lockedAt = null;
  stored.leaseExpiresAt = null;
  stored.lockedBy = null;
  if (!terminal) stored.workerReleaseSha = null;
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
  if (!USA_PG) {
    if (env.DEV_MODE === "1") return { tipo: "archivos" };
    const error = new Error("PostgreSQL es obligatorio fuera de desarrollo");
    error.status = 503;
    throw error;
  }
  const p = await pg();
  await p.query("SELECT 1");
  const appRegistration = await verificarRegistroAplicacionDB();
  const aislamiento = await verifyTenantIsolation(p, { expectedRole: env.PG_RUNTIME_ROLE || "tiendaiq_web_runtime" });
  return { tipo: "postgres", aislamiento, appRegistration };
}

async function verificarWorkerDB() {
  if (!USA_PG) throw new Error("El worker requiere DATABASE_URL; no puede usar almacenamiento por archivos");
  if (!env.PG_RUNTIME_ROLE) throw new Error("El worker requiere PG_RUNTIME_ROLE");
  const p = await pg();
  await p.query("SELECT 1");
  const appRegistration = await verificarRegistroAplicacionDB();
  const aislamiento = await verifyWorkerIsolation(p, { expectedRole: env.PG_RUNTIME_ROLE });
  return { tipo: "postgres", aislamiento, appRegistration };
}

async function verificarRegistroAplicacionDB() {
  if (!USA_PG) return appRegistrationDiagnostic(null);
  const binding = appRegistrationBindingContract(env);
  if (!binding.enforced) return appRegistrationDiagnostic(binding);
  const registration = requireEnforcedAppRegistration(env);
  const p = await pg();
  appRegistrationRepository ||= createAppRegistrationRepository(p);
  await appRegistrationRepository.assert(registration.id);
  return appRegistrationDiagnostic(registration);
}

async function cerrarAlmacenamientoDB() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  pageRepository = null;
  jobRepository = null;
  generationRepository = null;
  inboxRepository = null;
  shopifyCertificationRepository = null;
  appRegistrationRepository = null;
  shopifyCredentialRepository = null;
  await activePool.end();
}

async function leerEvidenciaCertificacionShopifyDB(context, since, pageId, releaseSha) {
  const tenant = requireTenantContext(context);
  if (!USA_PG) throw new Error("La certificacion Shopify requiere PostgreSQL real");
  const p = await pg();
  shopifyCertificationRepository ||= createShopifyCertificationRepository(p);
  return shopifyCertificationRepository.read(tenant, { since, pageId, releaseSha });
}

module.exports = {
  USA_PG,
  guardarTiendaDB, leerTiendaDB, borrarTiendaDB, listarTiendasDB,
  guardarCredencialShopifyDB, guardarInstalacionExpiringDB, leerCredencialShopifyDB,
  adquirirLeaseRefreshShopifyDB, completarRefreshShopifyDB, fallarRefreshShopifyDB,
  incrementarUsoDB, decrementarUsoDB, actualizarCamposTiendaDB,
  guardarPaginaDB, leerPaginaDB, marcarPublicacionFallidaDB,
  encolarPublicacionDB, encolarDespublicacionDB,
  checkpointAvatarPublicacionDB, completarPublicacionPaginaDB, completarDespublicacionPaginaDB,
  listarPaginasDB,
  guardarEstadoDB, consumirEstadoDB,
  encolarJobDB, encolarJobExclusivoDB, leerJobDB, reclamarJobDB, renovarLeaseJobDB, completarJobDB, fallarJobDB,
  reclamarCompensacionJobDB, renovarCompensacionJobDB, completarCompensacionJobDB, fallarCompensacionJobDB,
  estadoColaDB, registrarHeartbeatWorkerDB, estadoWorkerDB, estadoBillingWorkerDB, estadoInboxDB,
  encolarGeneracionDB, leerReservaGeneracionDB, finalizarGeneracionDB, liberarReservaGeneracionDB,
  transicionarProveedorGeneracionDB, reconciliarGeneracionAmbiguaDB,
  recibirWebhookDB, reclamarWebhookDB, renovarLeaseWebhookDB, completarWebhookDB, fallarWebhookDB,
  redactarInboxTiendaDB, registrarPrivacidadWebhookDB, depurarInboxDB,
  leerEvidenciaCertificacionShopifyDB,
  verificarAlmacenamientoDB, verificarWorkerDB, verificarRegistroAplicacionDB, cerrarAlmacenamientoDB
};
