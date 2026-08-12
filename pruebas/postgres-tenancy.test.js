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
      return { rows: [] };
    },
    release() { calls.push({ sql: "RELEASE", values: [] }); }
  };

  return { calls, async connect() { return client; } };
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
      protectedTables: 12,
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
    assert.equal(result.protectedTables, 12);
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

test("el bootstrap crea roles propios y no intenta modificar credenciales gestionadas por Render", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "preparar-roles-runtime.js"), "utf8");

  assert.match(source, /const WEB_LOGIN_ROLE = "tiendaiq_web"/);
  assert.match(source, /const WEB_RUNTIME_ROLE = "tiendaiq_web_runtime"/);
  assert.match(source, /const WORKER_RUNTIME_ROLE = "tiendaiq_worker_runtime"/);
  assert.match(source, /CREATE ROLE \$\{quoteIdentifier\(role\)\} NOLOGIN/);
  assert.match(source, /WHERE parent\.rolname = \$1 AND member\.rolname <> \$2/);
  assert.match(source, /GRANT \$\{quoteIdentifier\(WEB_RUNTIME_ROLE\)\} TO \$\{quoteIdentifier\(WEB_LOGIN_ROLE\)\}/);
  assert.match(source, /GRANT \$\{quoteIdentifier\(WORKER_RUNTIME_ROLE\)\} TO \$\{quoteIdentifier\(WORKER_LOGIN_ROLE\)\}/);
  assert.match(source, /REVOKE \$\{quoteIdentifier\(WORKER_CAPABILITY\)\} FROM \$\{quoteIdentifier\(member\)\}/);
  assert.match(source, /GRANT \$\{quoteIdentifier\(WORKER_CAPABILITY\)\} TO \$\{quoteIdentifier\(WORKER_RUNTIME_ROLE\)\}/);
  assert.doesNotMatch(source, /ALTER ROLE/);
  assert.doesNotMatch(source, /REVOKE \$\{quoteIdentifier\(parent\)\}/);
});

test("el fixture y los probes de PostgreSQL usan los roles runtime efectivos", () => {
  const fixture = fs.readFileSync(path.join(__dirname, "..", "scripts", "preparar-db-integracion.js"), "utf8");
  const rlsProbe = fs.readFileSync(path.join(__dirname, "..", "scripts", "probar-rls.js"), "utf8");
  const capacityProbe = fs.readFileSync(path.join(__dirname, "..", "scripts", "probar-capacidad-cola.js"), "utf8");

  assert.match(fixture, /webRuntime: "tiendaiq_web_runtime"/);
  assert.match(fixture, /workerRuntime: "tiendaiq_worker_runtime"/);
  assert.match(fixture, /GRANT \$\{quoteIdentifier\(EXPECTED_ROLES\.webRuntime\)\} TO/);
  assert.match(fixture, /GRANT \$\{quoteIdentifier\(EXPECTED_ROLES\.workerRuntime\)\} TO/);
  assert.match(fixture, /FROM pg_auth_members membership/);
  assert.match(fixture, /AS direct_worker_capability/);
  assert.doesNotMatch(fixture, /pg_has_role\(current_user, \$1, 'member'\)/);
  for (const source of [rlsProbe, capacityProbe]) {
    assert.match(source, /runtimeRole: WEB_RUNTIME_ROLE/);
    assert.match(source, /runtimeRole: WORKER_RUNTIME_ROLE/);
  }
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

test("el diagnostico de roles solo inspecciona privilegios y membresias", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "diagnosticar-roles-runtime.js"), "utf8");

  assert.match(source, /pg_auth_members/);
  assert.match(source, /rolbypassrls/);
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
