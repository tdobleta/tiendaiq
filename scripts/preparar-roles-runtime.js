"use strict";

const { Pool } = require("pg");
const { createPostgresPool } = require("../src/platform/postgres/create-pool");

// Render-managed rotation credentials inherit a provider-owned parent role and
// can recover its privileges with RESET ROLE. Runtime therefore uses logins we
// own; Render only stores their connection URLs as service secrets.
const WEB_LOGIN_ROLE = "tiendaiq_web_login";
const WORKER_LOGIN_ROLE = "tiendaiq_worker_login";
const WEB_RUNTIME_ROLE = "tiendaiq_web_runtime";
const WORKER_RUNTIME_ROLE = "tiendaiq_worker_runtime";
// Version the capability identity so provider-managed legacy grants can remain
// present without carrying authority in current RLS policies.
const WORKER_CAPABILITY = "tiendaiq_worker_capability_v2";
const MIGRATOR_COMPATIBILITY_ROLE = "tiendaiq_migrator";
// Immutable migrations 0007-0010 still refer to these former identities. They
// are created only for fresh-database bootstrap and are inert NOLOGIN roles;
// no service ever authenticates as them.
const LEGACY_COMPATIBILITY_ROLES = [
  "tiendaiq_web",
  "tiendaiq_worker",
  "tiendaiq_worker_capability",
  MIGRATOR_COMPATIBILITY_ROLE
];
const LOGIN_ROLES = [WEB_LOGIN_ROLE, WORKER_LOGIN_ROLE];
const RUNTIME_ROLES = [WEB_RUNTIME_ROLE, WORKER_RUNTIME_ROLE];
const OWNED_ROLES = [...RUNTIME_ROLES, WORKER_CAPABILITY];
const MINIMUM_PASSWORD_LENGTH = 32;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runtimePasswords(env = process.env) {
  const passwords = new Map([
    [WEB_LOGIN_ROLE, env.WEB_RUNTIME_LOGIN_PASSWORD],
    [WORKER_LOGIN_ROLE, env.WORKER_RUNTIME_LOGIN_PASSWORD]
  ]);
  for (const [role, password] of passwords) {
    if (!password || password.length < MINIMUM_PASSWORD_LENGTH || /[\r\n\0]/.test(password)) {
      throw new Error(`Falta una contrasena segura de ${MINIMUM_PASSWORD_LENGTH}+ caracteres para ${role}`);
    }
  }
  return passwords;
}

function bootstrapRolePlan(env = process.env) {
  const compatibilityRoles = env.BOOTSTRAP_LEGACY_COMPATIBILITY_ROLES === "1"
    ? LEGACY_COMPATIBILITY_ROLES
    : [];
  const ownedRoles = [...OWNED_ROLES, ...compatibilityRoles];
  return {
    compatibilityRoles,
    migratorRole: compatibilityRoles.includes(MIGRATOR_COMPATIBILITY_ROLE)
      ? MIGRATOR_COMPATIBILITY_ROLE
      : null,
    ownedRoles,
    controlledRoles: [...LOGIN_ROLES, ...ownedRoles]
  };
}

async function revokeMembership(client, { parent, member, grantor }) {
  try {
    await client.query(
      `REVOKE ${quoteIdentifier(parent)} FROM ${quoteIdentifier(member)} ` +
      `GRANTED BY ${quoteIdentifier(grantor)}`
    );
  } catch (error) {
    throw new Error(
      `No se pudo revocar ${member}->${parent} otorgado por ${grantor}: ${error.message}`
    );
  }
}

function isBootstrapAdministrationEdge(edge, bootstrapRole) {
  return edge.member === bootstrapRole &&
    edge.admin_option === true &&
    edge.inherit_option === false &&
    edge.set_option === false;
}

async function ensureRuntimeRole(client, role) {
  const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  if (!existing.rowCount) {
    await client.query(
      `CREATE ROLE ${quoteIdentifier(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
    );
  }
}

async function ensureLoginRole(client, role, password) {
  const existing = await client.query(
    `SELECT rolcanlogin, rolsuper, rolbypassrls, rolinherit,
            rolcreatedb, rolcreaterole, rolreplication
     FROM pg_roles WHERE rolname = $1`,
    [role]
  );
  if (!existing.rowCount) {
    await client.query(
      `CREATE ROLE ${quoteIdentifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ` +
      `NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD ${quoteLiteral(password)}`
    );
    return;
  }
  const current = existing.rows[0];
  if (!current.rolcanlogin || current.rolsuper || current.rolbypassrls || current.rolinherit ||
      current.rolcreatedb || current.rolcreaterole || current.rolreplication) {
    throw new Error(`Atributos inseguros para ${role}; requiere correccion administrativa`);
  }
  // A CREATEROLE principal with ADMIN membership can rotate this password, but
  // PostgreSQL reserves some attribute clauses (even their negative forms) for
  // a superuser. The read above is the fail-closed attribute reconciliation.
  await client.query(
    `ALTER ROLE ${quoteIdentifier(role)} PASSWORD ${quoteLiteral(password)}`
  );
}

async function grantMigratorMembership(client, { bootstrapRole, migratorRole }) {
  if (!migratorRole) return;
  await client.query(
    `GRANT ${quoteIdentifier(migratorRole)} TO ${quoteIdentifier(bootstrapRole)} ` +
    "WITH INHERIT TRUE, SET TRUE"
  );
  const verification = await client.query(
    "SELECT pg_has_role(current_user, $1, 'member') AS member",
    [migratorRole]
  );
  if (!verification.rows[0]?.member) {
    throw new Error("La identidad de migracion no recibio el rol administrativo requerido");
  }
}

async function main() {
  if (process.env.ALLOW_ROLE_BOOTSTRAP !== "1") {
    throw new Error("Defini ALLOW_ROLE_BOOTSTRAP=1 para configurar roles de runtime");
  }
  const databaseUrl = process.env.MIGRATION_DATABASE_URL;
  if (!databaseUrl) throw new Error("Falta MIGRATION_DATABASE_URL");
  const passwords = runtimePasswords();
  const rolePlan = bootstrapRolePlan();

  const pool = createPostgresPool({ databaseUrl, caCertificate: process.env.PG_CA_CERT, Pool });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const bootstrapIdentity = await client.query("SELECT current_user AS role");
    const bootstrapRole = bootstrapIdentity.rows[0].role;

    for (const role of RUNTIME_ROLES) await ensureRuntimeRole(client, role);
    await ensureRuntimeRole(client, WORKER_CAPABILITY);
    for (const role of rolePlan.compatibilityRoles) await ensureRuntimeRole(client, role);
    for (const role of LOGIN_ROLES) await ensureLoginRole(client, role, passwords.get(role));
    await grantMigratorMembership(client, { bootstrapRole, migratorRole: rolePlan.migratorRole });

    const expectedPaths = new Set([
      `${WEB_LOGIN_ROLE}->${WEB_RUNTIME_ROLE}`,
      `${WORKER_LOGIN_ROLE}->${WORKER_RUNTIME_ROLE}`,
      `${WORKER_RUNTIME_ROLE}->${WORKER_CAPABILITY}`
    ]);
    if (rolePlan.migratorRole) {
      expectedPaths.add(`${bootstrapRole}->${rolePlan.migratorRole}`);
    }
    const existingPaths = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent, grantor.rolname AS grantor,
              membership.admin_option, membership.inherit_option, membership.set_option
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       JOIN pg_roles AS grantor ON grantor.oid = membership.grantor
       WHERE member.rolname = ANY($1::text[]) OR parent.rolname = ANY($1::text[])`,
      [rolePlan.controlledRoles]
    );
    // PostgreSQL 16+ gives a non-superuser role creator an ADMIN-only edge to
    // each role it creates. Render records it under its bootstrap role. It is
    // harmless only when both INHERIT and SET are false; every other edge that
    // touches a login or authorization role we own must match our exact graph.
    for (const edge of existingPaths.rows) {
      if (expectedPaths.has(`${edge.member}->${edge.parent}`)) continue;
      if (isBootstrapAdministrationEdge(edge, bootstrapRole)) continue;
      await revokeMembership(client, edge);
    }

    await client.query(
      `GRANT ${quoteIdentifier(WEB_RUNTIME_ROLE)} TO ${quoteIdentifier(WEB_LOGIN_ROLE)} WITH INHERIT FALSE, SET TRUE`
    );
    await client.query(
      `GRANT ${quoteIdentifier(WORKER_RUNTIME_ROLE)} TO ${quoteIdentifier(WORKER_LOGIN_ROLE)} WITH INHERIT FALSE, SET TRUE`
    );
    await client.query(`GRANT ${quoteIdentifier(WORKER_CAPABILITY)} TO ${quoteIdentifier(WORKER_RUNTIME_ROLE)}`);

    const verified = await client.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin,
              rolcreatedb, rolcreaterole, rolreplication,
              pg_has_role(rolname, $1, 'member') AS worker_capability
       FROM pg_roles WHERE rolname = ANY($2::text[]) ORDER BY rolname`,
      [WORKER_CAPABILITY, rolePlan.ownedRoles]
    );
    if (verified.rowCount !== rolePlan.ownedRoles.length) {
      throw new Error("No se pudieron verificar todos los roles aislados");
    }
    const invalid = verified.rows.find((row) =>
      row.rolsuper || row.rolbypassrls || row.rolinherit || row.rolcanlogin ||
      row.rolcreatedb || row.rolcreaterole || row.rolreplication ||
      (row.rolname === WEB_RUNTIME_ROLE && row.worker_capability) ||
      (row.rolname === WORKER_RUNTIME_ROLE && !row.worker_capability)
    );
    if (invalid) throw new Error(`Privilegios invalidos para ${invalid.rolname}`);

    const verifiedLogins = await client.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit,
              rolcreatedb, rolcreaterole, rolreplication
       FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
      [LOGIN_ROLES]
    );
    const invalidLogin = verifiedLogins.rows.find((row) =>
      !row.rolcanlogin || row.rolsuper || row.rolbypassrls || row.rolinherit ||
      row.rolcreatedb || row.rolcreaterole || row.rolreplication
    );
    if (verifiedLogins.rowCount !== LOGIN_ROLES.length || invalidLogin) {
      throw new Error(`Atributos inseguros para ${invalidLogin?.rolname || "un login runtime"}`);
    }

    const paths = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent,
              membership.admin_option, membership.inherit_option, membership.set_option
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS parent ON parent.oid = membership.roleid
       WHERE member.rolname = ANY($1::text[])
          OR parent.rolname = ANY($1::text[])
       ORDER BY member.rolname, parent.rolname`,
      [rolePlan.controlledRoles]
    );
    const runtimePaths = paths.rows.filter((edge) =>
      !isBootstrapAdministrationEdge(edge, bootstrapRole)
    );
    const actualPaths = new Set(runtimePaths.map(({ member, parent }) => `${member}->${parent}`));
    const missingPaths = [...expectedPaths].filter((path) => !actualPaths.has(path));
    const unexpectedPaths = [...actualPaths].filter((path) => !expectedPaths.has(path));
    if (missingPaths.length || unexpectedPaths.length) {
      throw new Error(
        `Grafo de membresias invalido para los roles runtime; faltantes=[${missingPaths.join(", ")}]; ` +
        `inesperadas=[${unexpectedPaths.join(", ")}]`
      );
    }
    const loginEdges = runtimePaths.filter(({ member, parent }) =>
      (member === WEB_LOGIN_ROLE && parent === WEB_RUNTIME_ROLE) ||
      (member === WORKER_LOGIN_ROLE && parent === WORKER_RUNTIME_ROLE)
    );
    if (loginEdges.some((edge) => edge.inherit_option !== false || edge.set_option !== true)) {
      throw new Error("Los logins runtime deben poder SET ROLE sin heredar privilegios runtime");
    }
    if (rolePlan.migratorRole) {
      const migratorEdge = runtimePaths.find(({ member, parent }) =>
        member === bootstrapRole && parent === rolePlan.migratorRole
      );
      if (!migratorEdge || migratorEdge.inherit_option !== true || migratorEdge.set_option !== true) {
        throw new Error("La membresia administrativa de migracion no conserva el contrato esperado");
      }
    }

    // A correct login->runtime edge is insufficient: prove that RESET ROLE
    // leaves the transport login without application authority.
    const loginIsolation = await client.query(
      `SELECT login.rolname,
              pg_has_role(login.rolname, $2, 'USAGE') AS effective_worker_capability,
              EXISTS (
                SELECT 1
                FROM pg_class AS relation
                JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
                  AND namespace.nspname IN ('public', 'control_plane', 'app_data')
                  AND has_table_privilege(
                    login.rolname,
                    format('%I.%I', namespace.nspname, relation.relname),
                    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                  )
              ) AS effective_application_dml,
              EXISTS (
                SELECT 1
                FROM pg_namespace AS namespace
                WHERE namespace.nspname IN ('public', 'control_plane', 'app_data')
                  AND has_schema_privilege(login.rolname, namespace.oid, 'CREATE')
              ) AS effective_schema_create
       FROM pg_roles AS login
       WHERE login.rolname = ANY($1::text[])
       ORDER BY login.rolname`,
      [LOGIN_ROLES, WORKER_CAPABILITY]
    );
    const unsafeLogin = loginIsolation.rows.find((login) =>
      login.effective_worker_capability || login.effective_application_dml || login.effective_schema_create
    );
    if (unsafeLogin) {
      throw new Error(
        `El login runtime ${unsafeLogin.rolname} conserva privilegios efectivos despues de RESET ROLE`
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log("  logins y roles runtime propios listos: RESET ROLE no recupera privilegios de aplicacion");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`  preparacion de roles fallida: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { bootstrapRolePlan, isBootstrapAdministrationEdge, runtimePasswords };
