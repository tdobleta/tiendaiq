"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TenantContext } = require("../src/tenancy/tenant-context");
const { createPageRepository } = require("../src/platform/postgres/page-repository");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");
const { runMigrations } = require("../src/platform/postgres/migration-runner");
const { PROTECTED_TABLES, verifyTenantIsolation, verifyWorkerIsolation } = require("../src/platform/postgres/verify-tenancy");

test("Postgres remoto exige una CA y nunca desactiva la validación TLS", () => {
  class FakePool {
    constructor(options) { this.options = options; }
  }

  const remoteWithSystemTrust = createPostgresPool({
    databaseUrl: "postgresql://db.internal/tiendaiq?sslmode=require",
    Pool: FakePool
  });
  assert.deepEqual(remoteWithSystemTrust.options.ssl, { rejectUnauthorized: true });
  const remote = createPostgresPool({
    databaseUrl: "postgresql://db.internal/tiendaiq?sslmode=require",
    caCertificate: "CERTIFICADO",
    Pool: FakePool
  });
  assert.deepEqual(remote.options.ssl, { rejectUnauthorized: true, ca: "CERTIFICADO" });
  assert.equal(remote.options.connectionString.includes("sslmode"), false);

  const internal = createPostgresPool({
    databaseUrl: "postgresql://dpg-interno/tiendaiq",
    privateNetwork: true,
    Pool: FakePool
  });
  assert.equal(internal.options.ssl, false);
  assert.throws(() => createPostgresPool({
    databaseUrl: "postgresql://externo/tiendaiq?sslmode=require",
    privateNetwork: true,
    Pool: FakePool
  }), /URL interna de Render/);

  const local = createPostgresPool({
    databaseUrl: "postgresql://localhost/tiendaiq?sslmode=disable",
    Pool: FakePool
  });
  assert.equal(local.options.ssl, false);

  const isolated = createPostgresPool({
    databaseUrl: "postgresql://dpg-interno/tiendaiq",
    privateNetwork: true,
    runtimeRole: "tiendaiq_web_runtime",
    Pool: FakePool
  });
  assert.equal(isolated.options.options, "-c role=tiendaiq_web_runtime");
  assert.throws(() => createPostgresPool({
    databaseUrl: "postgresql://dpg-interno/tiendaiq",
    privateNetwork: true,
    runtimeRole: "web; reset role",
    Pool: FakePool
  }), /PG_RUNTIME_ROLE/);
});

function rlsPool() {
  const rows = new Map();
  const jobs = new Map();
  const calls = [];
  let activeTenant = null;

  const client = {
    async query(sql, values = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, values });
      if (normalized === "BEGIN") return { rows: [] };
      if (normalized.startsWith("SELECT set_config")) {
        activeTenant = values[0];
        return { rows: [] };
      }
      if (normalized === "COMMIT" || normalized === "ROLLBACK") {
        activeTenant = null;
        return { rows: [] };
      }
      if (normalized.startsWith("INSERT INTO public.paginas")) {
        assert.equal(values[0], activeTenant, "la escritura salió del tenant fijado por RLS");
        rows.set(`${activeTenant}:${values[1]}`, values[2]);
        return { rows: [] };
      }
      if (normalized.startsWith("SELECT datos FROM public.paginas")) {
        assert.equal(values[0], activeTenant, "la lectura salió del tenant fijado por RLS");
        const data = rows.get(`${activeTenant}:${values[1]}`);
        return { rows: data ? [{ datos: data }] : [] };
      }
      if (normalized.startsWith("SELECT * FROM control_plane.jobs")) {
        assert.equal(values[0], activeTenant);
        const existing = jobs.get(`${activeTenant}:${values[1]}`);
        return { rows: existing && ["queued", "running"].includes(existing.status) ? [existing] : [] };
      }
      if (normalized.startsWith("INSERT INTO control_plane.jobs")) {
        assert.equal(values[1], activeTenant);
        const inserted = {
          id: values[0],
          tenant_id: values[1],
          type: values[2],
          payload: values[3],
          status: "queued",
          attempts: 0,
          max_attempts: values[4],
          idempotency_key: values[5]
        };
        jobs.set(`${activeTenant}:${inserted.id}`, inserted);
        return { rows: [inserted] };
      }
      if (normalized.startsWith("UPDATE public.paginas SET datos = $3")) {
        assert.equal(values[0], activeTenant);
        const key = `${activeTenant}:${values[1]}`;
        if (!rows.has(key)) return { rows: [] };
        rows.set(key, values[2]);
        return { rows: [] };
      }
      if (normalized.startsWith("UPDATE public.paginas SET datos = jsonb_set")) {
        assert.equal(values[0], activeTenant);
        const key = `${activeTenant}:${values[1]}`;
        const current = rows.get(key);
        if (!current || current.active_job_id !== values[2]) return { rows: [] };
        const updated = {
          ...current,
          estado: "necesita_atencion",
          active_job_id: null,
          last_job_error: values[3]
        };
        rows.set(key, updated);
        return { rows: [{ datos: updated }] };
      }
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE", values: [] }); }
  };

  return { calls, jobs, async connect() { return client; } };
}

describe("PageRepository protegido por TenantContext", () => {
  test("un tenant no puede leer una página escrita por otro", async () => {
    const pool = rlsPool();
    const repository = createPageRepository(pool);
    const tenantA = TenantContext.fromShopDomain("a.myshopify.com");
    const tenantB = TenantContext.fromShopDomain("b.myshopify.com");

    await repository.save(tenantA, "p1", { secreto: "solo-a" });

    assert.equal(await repository.findById(tenantB, "p1"), null);
    assert.deepEqual(await repository.findById(tenantA, "p1"), { secreto: "solo-a" });
  });

  test("rechaza un objeto fabricado antes de pedir una conexión", async () => {
    const pool = rlsPool();
    const repository = createPageRepository(pool);

    await assert.rejects(
      repository.findById({ tenantId: "a.myshopify.com" }, "p1"),
      /TenantContext/
    );
    assert.equal(pool.calls.length, 0);
  });

  test("cada operación fija el tenant dentro de su propia transacción", async () => {
    const pool = rlsPool();
    const repository = createPageRepository(pool);
    await repository.findById(TenantContext.fromShopDomain("a.myshopify.com"), "p1");

    assert.deepEqual(pool.calls.map((call) => call.sql), [
      "BEGIN",
      "SELECT set_config('app.tenant_id', $1, true)",
      "SELECT datos FROM public.paginas WHERE tienda = $1 AND id = $2",
      "COMMIT",
      "RELEASE"
    ]);
  });

  test("una compensacion tardia no pisa el job activo de publicacion", async () => {
    const pool = rlsPool();
    const repository = createPageRepository(pool);
    const tenant = TenantContext.fromShopDomain("a.myshopify.com");
    await repository.save(tenant, "p1", {
      estado: "publicando",
      active_job_id: "job-nuevo"
    });

    assert.equal(
      await repository.markPublicationFailed(tenant, "p1", "job-viejo", "fallo tardio"),
      null
    );
    assert.deepEqual(await repository.findById(tenant, "p1"), {
      estado: "publicando",
      active_job_id: "job-nuevo"
    });

    assert.deepEqual(
      await repository.markPublicationFailed(tenant, "p1", "job-nuevo", "Shopify rechazo la publicacion"),
      {
        estado: "necesita_atencion",
        active_job_id: null,
        last_job_error: "Shopify rechazo la publicacion"
      }
    );
  });

  test("encola y marca la publicacion en una sola transaccion, y reutiliza el job activo", async () => {
    const pool = rlsPool();
    const repository = createPageRepository(pool);
    const tenant = TenantContext.fromShopDomain("a.myshopify.com");
    await repository.save(tenant, "p1", { id: "p1", estado: "borrador" });

    const first = await repository.enqueuePublication(tenant, "p1", { maxAttempts: 4 });
    const second = await repository.enqueuePublication(tenant, "p1", { maxAttempts: 4 });

    assert.equal(first.reused, false);
    assert.equal(first.page.estado, "publicando");
    assert.equal(first.page.active_job_id, first.job.id);
    assert.equal(first.job.maxAttempts, 4);
    assert.equal(second.reused, true);
    assert.equal(second.job.id, first.job.id);
    assert.equal(pool.jobs.size, 1);
    assert.equal(
      pool.calls.filter((call) => call.sql.startsWith("INSERT INTO control_plane.jobs")).length,
      1
    );
  });

  test("no permite encolar una pagina perteneciente a otro tenant", async () => {
    const pool = rlsPool();
    const repository = createPageRepository(pool);
    const tenantA = TenantContext.fromShopDomain("a.myshopify.com");
    const tenantB = TenantContext.fromShopDomain("b.myshopify.com");
    await repository.save(tenantA, "p1", { id: "p1", estado: "borrador" });

    assert.equal(await repository.enqueuePublication(tenantB, "p1"), null);
    assert.equal(pool.jobs.size, 0);
  });
});

function migrationPool(appliedRows = []) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, values });
      if (normalized === "SELECT name, checksum FROM public.schema_migrations") {
        return { rows: appliedRows };
      }
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE", values: [] }); }
  };
  return { calls, async connect() { return client; } };
}

describe("runner de migraciones", () => {
  test("aplica en transacción y registra checksum bajo advisory lock", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tiq-migrations-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, "0001_example.sql"), "CREATE TABLE example(id int);\n");
    const pool = migrationPool();

    const applied = await runMigrations(pool, { directory });

    assert.deepEqual(applied, ["0001_example.sql"]);
    assert.equal(pool.calls.some((call) => call.sql.startsWith("SELECT pg_advisory_lock")), true);
    assert.equal(pool.calls.some((call) => call.sql === "BEGIN"), true);
    assert.equal(pool.calls.some((call) => call.sql === "COMMIT"), true);
    assert.equal(pool.calls.some((call) => call.sql.startsWith("INSERT INTO public.schema_migrations")), true);
    assert.equal(pool.calls.some((call) => call.sql.startsWith("SELECT pg_advisory_unlock")), true);
  });

  test("falla si alguien reescribe una migración ya aplicada", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tiq-migrations-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, "0001_example.sql"), "SELECT 1;\n");
    const pool = migrationPool([{ name: "0001_example.sql", checksum: "checksum-anterior" }]);

    await assert.rejects(runMigrations(pool, { directory }), /cambió de contenido/);
    assert.equal(pool.calls.some((call) => call.sql.startsWith("SELECT pg_advisory_unlock")), true);
  });
});

test("la migración de compatibilidad fuerza RLS sobre la tabla vigente", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "0002_legacy_pages_rls.sql"), "utf8");
  assert.match(sql, /ALTER TABLE public\.paginas FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /tienda = current_setting\('app\.tenant_id', true\)/);
  assert.doesNotMatch(sql, /current_setting\('app\.tenant_id'\)(?!, true)/);
});

describe("readiness de aislamiento", () => {
  test("acepta RLS forzado con un rol sin bypass", async () => {
    const responses = [
      { rows: [{ enabled: true, forced: true, all_present: true, owns_protected_table: false }] },
      { rows: [{ current_role: "tiendaiq_web_runtime", superuser: false, bypass_rls: false, inherits_roles: false, worker_capability: false }] }
    ];
    const result = await verifyTenantIsolation({ async query() { return responses.shift(); } });
    assert.deepEqual(result, {
      enabled: true,
      forced: true,
      protectedTables: 15,
      roleBypassesRls: false,
      inheritsRoles: false,
      workerCapability: false
    });
  });

  test("rechaza una tabla sin FORCE ROW LEVEL SECURITY", async () => {
    await assert.rejects(
      verifyTenantIsolation({ async query() { return { rows: [{ enabled: true, forced: false, all_present: true }] }; } }),
      /habilitado y forzado/
    );
  });

  test("rechaza un rol que puede saltarse RLS", async () => {
    const responses = [
      { rows: [{ enabled: true, forced: true, all_present: true, owns_protected_table: false }] },
      { rows: [{ current_role: "tiendaiq_web_runtime", superuser: false, bypass_rls: true, worker_capability: false }] }
    ];
    await assert.rejects(
      verifyTenantIsolation({ async query() { return responses.shift(); } }),
      /puede omitir RLS/
    );
  });

  test("rechaza un rol web que hereda privilegios de proveedor", async () => {
    const responses = [
      { rows: [{ enabled: true, forced: true, all_present: true, owns_protected_table: false }] },
      { rows: [{ current_role: "tiendaiq_web_runtime", superuser: false, bypass_rls: false, inherits_roles: true, worker_capability: false }] }
    ];
    await assert.rejects(
      verifyTenantIsolation({ async query() { return responses.shift(); } }),
      /no puede heredar privilegios del proveedor/
    );
  });

  test("rechaza un rol runtime con LOGIN o atributos administrativos", async () => {
    const responses = [
      { rows: [{ enabled: true, forced: true, all_present: true, owns_protected_table: false }] },
      { rows: [{ current_role: "tiendaiq_web_runtime", superuser: false, bypass_rls: false, inherits_roles: false, can_login: true, worker_capability: false }] }
    ];
    await assert.rejects(
      verifyTenantIsolation({ async query() { return responses.shift(); } }),
      /atributos administrativos o LOGIN/
    );
  });

  test("rechaza que web sea dueño de una tabla protegida", async () => {
    await assert.rejects(
      verifyTenantIsolation({
        async query() {
          return { rows: [{ enabled: true, forced: true, all_present: true, owns_protected_table: true }] };
        }
      }),
      /no puede ser dueno/
    );
  });

  test("rechaza que web herede la capacidad transversal del worker", async () => {
    const responses = [
      { rows: [{ enabled: true, forced: true, all_present: true, owns_protected_table: false }] },
      { rows: [{ current_role: "tiendaiq_web_runtime", superuser: false, bypass_rls: false, inherits_roles: false, worker_capability: true }] }
    ];
    await assert.rejects(
      verifyTenantIsolation({ async query() { return responses.shift(); } }),
      /capacidad de worker/
    );
  });

  test("acepta exclusivamente el rol worker con su capacidad transversal", async () => {
    const responses = [
      { rows: [{ enabled: true, forced: true, all_present: true, owns_protected_table: false }] },
      { rows: [{ current_role: "tiendaiq_worker_runtime", superuser: false, bypass_rls: false, inherits_roles: false, worker_capability: true }] }
    ];
    const result = await verifyWorkerIsolation({ async query() { return responses.shift(); } });
    assert.equal(result.workerCapability, true);
    assert.equal(result.protectedTables, 15);
  });

  test("rechaza un worker conectado con el rol web", async () => {
    const responses = [
      { rows: [{ enabled: true, forced: true, all_present: true, owns_protected_table: false }] },
      { rows: [{ current_role: "tiendaiq_web_runtime", superuser: false, bypass_rls: false, inherits_roles: false, worker_capability: false }] }
    ];
    await assert.rejects(
      verifyWorkerIsolation({ async query() { return responses.shift(); } }),
      /se esperaba el rol tiendaiq_worker_runtime/
    );
  });
});

test("readiness inventaria todo el registro tenant y el control plane", () => {
  assert.deepEqual(PROTECTED_TABLES, [
    ["public", "tiendas"],
    ["public", "paginas"],
    ["public", "estados_oauth"],
    ["control_plane", "tenants"],
    ["control_plane", "inbox_events"],
    ["control_plane", "jobs"],
    ["control_plane", "outbox_events"],
    ["control_plane", "privacy_requests"],
    ["control_plane", "usage_reservations"],
    ["control_plane", "compensation_recovery_audit"],
    ["control_plane", "app_registration_binding"],
    ["control_plane", "shopify_offline_credentials"],
    ["app_data", "pages"],
    ["app_data", "page_versions"],
    ["app_data", "publications"]
  ]);

  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0008_control_plane_isolation.sql"),
    "utf8"
  );
  for (const table of ["public.tiendas", "public.estados_oauth", "control_plane.tenants", "control_plane.outbox_events"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table.replace(".", "\\.")} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /REVOKE ALL ON TABLE[\s\S]*FROM tiendaiq_web, tiendaiq_worker/);
});

test("la migracion de tokens exige el rol administrativo", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "migrar-tokens.js"), "utf8");

  assert.match(source, /env\.MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(source, /listarTiendasDB|guardarTiendaDB/);
  assert.match(source, /SELECT dominio, datos->>'token'/);
});

test("el bootstrap de roles usa la misma politica TLS que las migraciones", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "preparar-roles-runtime.js"), "utf8");

  assert.match(source, /createPostgresPool/);
  assert.match(source, /databaseUrl/);
  assert.doesNotMatch(source, /ssl:\s*process\.env\.PG_CA_CERT/);
});

test("el bootstrap crea logins y roles propios sin depender de credenciales gestionadas por Render", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "preparar-roles-runtime.js"), "utf8");

  assert.match(source, /const WEB_LOGIN_ROLE = "tiendaiq_web_login"/);
  assert.match(source, /const WORKER_LOGIN_ROLE = "tiendaiq_worker_login"/);
  assert.match(source, /const WEB_RUNTIME_ROLE = "tiendaiq_web_runtime"/);
  assert.match(source, /const WORKER_RUNTIME_ROLE = "tiendaiq_worker_runtime"/);
  assert.match(source, /const WORKER_CAPABILITY = "tiendaiq_worker_capability_v2"/);
  assert.match(source, /CREATE ROLE \$\{quoteIdentifier\(role\)\} NOLOGIN/);
  assert.match(source, /CREATE ROLE \$\{quoteIdentifier\(role\)\} LOGIN/);
  assert.match(source, /ALTER ROLE \$\{quoteIdentifier\(role\)\} PASSWORD/);
  assert.doesNotMatch(source, /ALTER ROLE \$\{quoteIdentifier\(role\)\} WITH LOGIN NOSUPERUSER/);
  assert.match(source, /Atributos inseguros para \$\{role\}; requiere correccion administrativa/);
  assert.match(source, /WEB_RUNTIME_LOGIN_PASSWORD/);
  assert.match(source, /WORKER_RUNTIME_LOGIN_PASSWORD/);
  assert.match(source, /GRANT \$\{quoteIdentifier\(WEB_RUNTIME_ROLE\)\} TO \$\{quoteIdentifier\(WEB_LOGIN_ROLE\)\}/);
  assert.match(source, /GRANT \$\{quoteIdentifier\(WORKER_RUNTIME_ROLE\)\} TO \$\{quoteIdentifier\(WORKER_LOGIN_ROLE\)\}/);
  assert.match(source, /GRANT \$\{quoteIdentifier\(WORKER_CAPABILITY\)\} TO \$\{quoteIdentifier\(WORKER_RUNTIME_ROLE\)\}/);
  assert.match(source, /rolcanlogin/);
  assert.match(source, /rolcreatedb/);
  assert.match(source, /rolcreaterole/);
  assert.match(source, /rolreplication/);
  assert.match(source, /Grafo de membresias invalido/);
  assert.match(source, /client\.query\("BEGIN"\)/);
  assert.match(source, /client\.query\("COMMIT"\)/);
  assert.match(source, /client\.query\("ROLLBACK"\)/);
  assert.match(source, /member\.rolname = ANY\(\$1::text\[\]\)/);
  assert.match(source, /controlledRoles: \[\.\.\.LOGIN_ROLES, \.\.\.ownedRoles\]/);
  assert.match(source, /\[rolePlan\.controlledRoles\]/);
  assert.match(source, /REVOKE \$\{quoteIdentifier\(parent\)\} FROM \$\{quoteIdentifier\(member\)\}/);
  assert.match(source, /membership\.grantor/);
  assert.match(source, /GRANTED BY \$\{quoteIdentifier\(grantor\)\}/);
  assert.match(source, /SELECT current_user AS role/);
  assert.match(source, /membership\.admin_option, membership\.inherit_option, membership\.set_option/);
  assert.match(source, /isBootstrapAdministrationEdge\(edge, bootstrapRole\)/);
  assert.match(source, /WITH INHERIT FALSE, SET TRUE/);
  assert.match(source, /membership\.inherit_option, membership\.set_option/);
  assert.match(source, /edge\.inherit_option !== false \|\| edge\.set_option !== true/);
  assert.match(source, /pg_has_role\(login\.rolname, \$2, 'USAGE'\)/);
  assert.match(source, /has_table_privilege\(/);
  assert.match(source, /has_schema_privilege\(/);
  assert.match(source, /conserva privilegios efectivos despues de RESET ROLE/);
  assert.match(source, /El login runtime \$\{unsafeLogin\.rolname\}/);
});

test("las contrasenas de logins runtime son obligatorias y no aceptan valores debiles", () => {
  const { runtimeLoginDatabaseUrl, runtimePasswords, safeDatabaseEndpoint } = require("../scripts/preparar-roles-runtime");
  assert.throws(() => runtimePasswords({}), /32\+ caracteres/);
  assert.throws(
    () => runtimePasswords({
      WEB_RUNTIME_LOGIN_PASSWORD: "corta",
      WORKER_RUNTIME_LOGIN_PASSWORD: "w".repeat(40)
    }),
    /tiendaiq_web_login/
  );
  const passwords = runtimePasswords({
    WEB_RUNTIME_LOGIN_PASSWORD: "v".repeat(40),
    WORKER_RUNTIME_LOGIN_PASSWORD: "w".repeat(40)
  });
  assert.equal(passwords.get("tiendaiq_web_login"), "v".repeat(40));
  assert.equal(passwords.get("tiendaiq_worker_login"), "w".repeat(40));

  const runtimeUrl = new URL(runtimeLoginDatabaseUrl(
    "postgresql://owner:owner-password@postgres.internal:5432/tiendaiq_production",
    "tiendaiq_web_login",
    "web-password"
  ));
  assert.equal(runtimeUrl.username, "tiendaiq_web_login");
  assert.equal(runtimeUrl.password, "web-password");
  assert.equal(runtimeUrl.hostname, "postgres.internal");
  assert.deepEqual(
    safeDatabaseEndpoint("postgresql://owner:owner-password@postgres.internal:5432/tiendaiq_production"),
    {
      hostname: "postgres.internal",
      port: "5432",
      database: "tiendaiq_production",
      username: "owner"
    }
  );
});

test("el bootstrap de una base nueva crea solo los roles legacy NOLOGIN indispensables para migraciones inmutables", () => {
  const { bootstrapRolePlan } = require("../scripts/preparar-roles-runtime");

  assert.deepEqual(bootstrapRolePlan({}).compatibilityRoles, []);
  assert.deepEqual(
    bootstrapRolePlan({ BOOTSTRAP_LEGACY_COMPATIBILITY_ROLES: "1" }).compatibilityRoles,
    ["tiendaiq_web", "tiendaiq_worker", "tiendaiq_worker_capability", "tiendaiq_migrator"]
  );
  assert.equal(
    bootstrapRolePlan({ BOOTSTRAP_LEGACY_COMPATIBILITY_ROLES: "1" }).migratorRole,
    "tiendaiq_migrator"
  );
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "preparar-roles-runtime.js"), "utf8");
  assert.match(source, /BOOTSTRAP_LEGACY_COMPATIBILITY_ROLES === "1"/);
  assert.match(source, /for \(const role of rolePlan\.compatibilityRoles\) await ensureRuntimeRole/);
  assert.match(source, /CREATE ROLE \$\{quoteIdentifier\(role\)\} NOLOGIN/);
  assert.match(source, /GRANT \$\{quoteIdentifier\(migratorRole\)\} TO \$\{quoteIdentifier\(bootstrapRole\)\}/);
  assert.match(source, /WITH INHERIT TRUE, SET TRUE/);
  assert.match(source, /pg_has_role\(current_user, \$1, 'member'\)/);
});

test("el bootstrap solo tolera la arista administrativa no efectiva creada por PostgreSQL", () => {
  const { isBootstrapAdministrationEdge } = require("../scripts/preparar-roles-runtime");
  const administrativeEdge = {
    member: "tiendaiq_migrator",
    parent: "tiendaiq_worker_capability_v2",
    grantor: "postgres",
    admin_option: true,
    inherit_option: false,
    set_option: false
  };

  assert.equal(isBootstrapAdministrationEdge(administrativeEdge, "tiendaiq_migrator"), true);
  assert.equal(isBootstrapAdministrationEdge({ ...administrativeEdge, member: "tiendaiq_web" }, "tiendaiq_migrator"), false);
  assert.equal(isBootstrapAdministrationEdge({ ...administrativeEdge, inherit_option: true }, "tiendaiq_migrator"), false);
  assert.equal(isBootstrapAdministrationEdge({ ...administrativeEdge, set_option: true }, "tiendaiq_migrator"), false);
  assert.equal(isBootstrapAdministrationEdge({ ...administrativeEdge, admin_option: false }, "tiendaiq_migrator"), false);
});

test("CI reproduce y reconcilia grants administrativos de PostgreSQL antes de migrar", () => {
  const fixture = fs.readFileSync(path.join(__dirname, "..", "scripts", "preparar-db-integracion.js"), "utf8");
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "verificar.yml"), "utf8");

  assert.match(fixture, /WITH ADMIN TRUE, INHERIT FALSE, SET FALSE/);
  assert.match(fixture, /ALTER ROLE \$\{quoteIdentifier\(EXPECTED_ROLES\.migration\)\} CREATEROLE/);
  assert.match(fixture, /EXPECTED_ROLES\.migration/);
  assert.match(fixture, /legacyWeb: "tiendaiq_web"/);
  assert.match(fixture, /legacyWorker: "tiendaiq_worker"/);
  assert.match(fixture, /NOLOGIN compatibility roles/);
  assert.match(workflow, /Reconciliar roles runtime con grants administrados por PostgreSQL/);
  assert.match(workflow, /ALLOW_ROLE_BOOTSTRAP: "1"/);
  assert.match(workflow, /WEB_RUNTIME_LOGIN_PASSWORD/);
  assert.match(workflow, /WORKER_RUNTIME_LOGIN_PASSWORD/);
  assert.match(workflow, /node scripts\/preparar-roles-runtime\.js/);
});

test("la rotacion de logins de staging exige entorno protegido y commit inmutable", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "rotate-runtime-logins-staging.yml"),
    "utf8"
  );
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /ROTATE_RUNTIME_LOGINS_STAGING/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /STAGING_MIGRATION_DATABASE_URL/);
  assert.match(workflow, /STAGING_WEB_RUNTIME_LOGIN_PASSWORD/);
  assert.match(workflow, /STAGING_WORKER_RUNTIME_LOGIN_PASSWORD/);
  assert.doesNotMatch(workflow, /RENDER_STAGING_.*DEPLOY_HOOK/);
});

test("el alta prelaunch de logins de produccion exige entorno protegido y commit inmutable", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "bootstrap-runtime-logins-production.yml"),
    "utf8"
  );
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /BOOTSTRAP_RUNTIME_LOGINS_PRODUCTION/);
  assert.match(workflow, /ACKNOWLEDGE_PRELAUNCH_DATABASE_CUTOVER/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /PRODUCTION_MIGRATION_DATABASE_URL/);
  assert.match(workflow, /PRODUCTION_WEB_RUNTIME_LOGIN_PASSWORD/);
  assert.match(workflow, /PRODUCTION_WORKER_RUNTIME_LOGIN_PASSWORD/);
  assert.match(workflow, /group: tiendaiq-production-database-maintenance/);
  assert.doesNotMatch(workflow, /RENDER_PRODUCTION_.*DEPLOY_HOOK/);
});

test("readiness descubre tablas tenant-owned nuevas ademas del inventario minimo", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "platform", "postgres", "verify-tenancy.js"), "utf8");

  assert.match(source, /pg_attribute/);
  assert.match(source, /a\.attname IN \('tenant_id', 'shop_domain', 'tienda', 'dominio'\)/);
  assert.match(source, /relrowsecurity/);
  assert.match(source, /relforcerowsecurity/);
  assert.match(source, /protected_count/);
});

test("el fixture y los probes de PostgreSQL usan los roles runtime efectivos", () => {
  const fixture = fs.readFileSync(path.join(__dirname, "..", "scripts", "preparar-db-integracion.js"), "utf8");
  const rlsProbe = fs.readFileSync(path.join(__dirname, "..", "scripts", "probar-rls.js"), "utf8");
  const capacityProbe = fs.readFileSync(path.join(__dirname, "..", "scripts", "probar-capacidad-cola.js"), "utf8");

  assert.match(fixture, /webRuntime: "tiendaiq_web_runtime"/);
  assert.match(fixture, /workerRuntime: "tiendaiq_worker_runtime"/);
  assert.match(fixture, /legacyCapability: "tiendaiq_worker_capability"/);
  assert.match(fixture, /capability: "tiendaiq_worker_capability_v2"/);
  assert.match(fixture, /GRANT \$\{quoteIdentifier\(EXPECTED_ROLES\.webRuntime\)\} TO/);
  assert.match(fixture, /GRANT \$\{quoteIdentifier\(EXPECTED_ROLES\.workerRuntime\)\} TO/);
  assert.match(fixture, /FROM pg_auth_members membership/);
  assert.match(fixture, /AS direct_worker_capability/);
  assert.doesNotMatch(fixture, /pg_has_role\(current_user, \$1, 'member'\)/);
  for (const source of [rlsProbe, capacityProbe]) {
    assert.match(source, /runtimeRole: WEB_RUNTIME_ROLE/);
    assert.match(source, /runtimeRole: WORKER_RUNTIME_ROLE/);
  }
  assert.match(rlsProbe, /claim\("rls-worker", TEST_RELEASE_SHA, 30\)/);
  assert.match(capacityProbe, /normalizeReleaseSha\(process\.env\.EXPECTED_RELEASE_SHA\)/);
  assert.match(capacityProbe, /workerJobs\.claim\([\s\S]{0,180}releaseSha,[\s\S]{0,80}\["capacity-probe"\]/);
});

test("la migracion de roles gestionados mueve privilegios y capacidad al rol efectivo", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0011_render_managed_runtime_roles.sql"),
    "utf8"
  );

  assert.match(sql, /REVOKE ALL ON ALL TABLES[\s\S]*FROM tiendaiq_web, tiendaiq_worker/);
  assert.match(sql, /TO tiendaiq_web_runtime, tiendaiq_worker_runtime/);
  assert.match(sql, /pg_has_role\(current_user, 'tiendaiq_worker_capability', 'member'\)/);
  assert.doesNotMatch(sql, /pg_has_role\(session_user/);
});

test("la capacidad worker activa rota sin depender del grant legacy administrado por Render", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0018_rotate_worker_capability.sql"),
    "utf8"
  );

  for (const policy of [
    "jobs_worker_claim",
    "inbox_events_worker",
    "privacy_requests_worker",
    "outbox_worker_dispatch"
  ]) {
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS ${policy}`));
    assert.match(sql, new RegExp(`CREATE POLICY ${policy}`));
  }
  assert.match(sql, /pg_has_role\(current_user, 'tiendaiq_worker_capability_v2', 'member'\)/);
  assert.doesNotMatch(sql, /pg_has_role\(current_user, 'tiendaiq_worker_capability', 'member'\)/);
  assert.doesNotMatch(sql, /\bREVOKE\b[\s\S]*tiendaiq_worker_capability\s+FROM\s+tiendaiq_staging_user/);
});

test("la evidencia terminal de certificacion exige un SHA no nulo", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0019_shopify_certification_release_evidence.sql"),
    "utf8"
  );

  for (const [status, constraint] of [
    ["succeeded", "jobs_succeeded_requires_release_sha"],
    ["processed", "inbox_processed_requires_release_sha"],
    ["completed", "privacy_completed_requires_release_sha"]
  ]) {
    assert.match(sql, new RegExp(`${constraint}[\\s\\S]{0,260}status <> '${status}'[\\s\\S]{0,160}worker_release_sha IS NOT NULL`));
  }
});

test("el worker embebido local usa una identidad de release sintetica explicita", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  assert.match(source, /const localReleaseSha = "0"\.repeat\(40\)/);
  assert.match(source, /createRuntime\(\{[\s\S]{0,160}releaseSha: localReleaseSha/);
});

test("el diagnostico de roles solo inspecciona privilegios y membresias", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "diagnosticar-roles-runtime.js"), "utf8");

  assert.match(source, /pg_auth_members/);
  assert.match(source, /rolbypassrls/);
  assert.match(source, /tiendaiq_web_runtime/);
  assert.match(source, /tiendaiq_worker_runtime/);
  assert.doesNotMatch(source, /\b(?:ALTER|CREATE|DELETE|DROP|GRANT|INSERT|REVOKE|UPDATE)\b/);
});

test("la admision global expone solo un agregado y reserva acceso administrativo", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "0010_generation_admission_control.sql"),
    "utf8"
  );

  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /REVOKE ALL ON FUNCTION control_plane\.generation_queue_pressure\(\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION control_plane\.generation_queue_pressure\(\)[\s\S]*TO tiendaiq_web, tiendaiq_worker/);
  assert.doesNotMatch(sql, /RETURNS TABLE[\s\S]{0,180}tenant/i);
  assert.match(sql, /CREATE POLICY jobs_migrator_admin ON control_plane\.jobs[\s\S]*TO tiendaiq_migrator/);
});
