"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { iniciarServidor, requierePostgresRuntime, diagnosticoEndpointPostgres } = require("../server");

function fakeServer() {
  return {
    listening: false,
    listenCalls: 0,
    once() {},
    off() {},
    listen(_port, callback) {
      this.listenCalls += 1;
      this.listening = true;
      callback();
    }
  };
}

test("la web no abre un puerto si falla el preflight de registro Shopify", async () => {
  const server = fakeServer();

  await assert.rejects(
    iniciarServidor({
      server,
      port: 0,
      usaPostgres: true,
      async verificar() { throw new Error("registro Shopify no coincide"); }
    }),
    /registro Shopify no coincide/
  );
  assert.equal(server.listenCalls, 0);
});

test("la web verifica antes de escuchar cuando usa Postgres", async () => {
  const server = fakeServer();
  const events = [];

  await iniciarServidor({
    server,
    port: 0,
    usaPostgres: true,
    async verificar() { events.push("verified"); }
  });

  assert.deepEqual(events, ["verified"]);
  assert.equal(server.listenCalls, 1);
});

test("un runtime deployable exige PostgreSQL aunque DATABASE_URL falte", () => {
  assert.equal(requierePostgresRuntime({ DEV_MODE: "0", DATABASE_URL: "" }), true);
  assert.equal(requierePostgresRuntime({ NODE_ENV: "production", DATABASE_URL: "" }), true);
  assert.equal(requierePostgresRuntime({ DEV_MODE: "1", DATABASE_URL: "" }), false);
  assert.equal(requierePostgresRuntime({}), false);
});

test("el diagnostico de endpoint no expone la contrasena de Postgres", () => {
  const diagnostic = diagnosticoEndpointPostgres(
    "postgresql://runtime_user:very-secret-password@db.internal:5432/tiendaiq"
  );

  assert.deepEqual(diagnostic, {
    configured: true,
    hostname: "db.internal",
    port: "5432",
    database: "tiendaiq",
    username: "runtime_user",
    passwordLength: 20
  });
  assert.equal(JSON.stringify(diagnostic).includes("very-secret-password"), false);
  assert.deepEqual(diagnosticoEndpointPostgres("not-a-url"), { configured: true, valid: false });
});
