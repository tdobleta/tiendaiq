// Pase de sesión de App Bridge: verificación de firma + claims (exp/nbf/aud) y
// —lo que agrega el hardening P2— que `iss` y `dest` apunten a la MISMA tienda,
// como exige la doc de Shopify (set-up-session-tokens). Sin ese chequeo, un pase
// legítimo de una tienda podría reusarse apuntando a otra.

// Las claves tienen que estar en el entorno ANTES de requerir auth.js: shopify.js
// toma un snapshot de env al cargar, con precedencia de process.env.
process.env.SHOPIFY_CLIENT_SECRET = "secreto-de-prueba-para-firmar-el-pase";
process.env.SHOPIFY_CLIENT_ID = "client-id-de-prueba-0000";

const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { tiendaDelPase, alcancesFaltantes, registrarWebhooksOperativos, ALCANCES } = require("../auth");

const SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const CLIENT = process.env.SHOPIFY_CLIENT_ID;
const ahora = () => Math.floor(Date.now() / 1000);

test("el callback valida permisos y webhooks antes de persistir la instalación", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
  const callback = fuente.slice(
    fuente.indexOf("async function terminarInstalacion"),
    fuente.indexOf("function tiendaDelPase")
  );
  const permisos = callback.indexOf("alcancesFaltantes(datos.scope)");
  const webhooks = callback.indexOf("registrarWebhooksOperativos(");
  const guardar = callback.indexOf("guardarTienda(");

  assert.ok(permisos >= 0 && webhooks > permisos && guardar > webhooks);
});

const b64url = (o) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Arma un JWT firmado igual que App Bridge (HS256 sobre header.body).
function firmar(payload, secret = SECRET, header = { alg: "HS256", typ: "JWT" }) {
  const head = b64url(header);
  const body = b64url(payload);
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${head}.${body}.${sig}`;
}

const SHOP = "demo-tienda.myshopify.com";
const paseValido = (over = {}) =>
  firmar({
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: CLIENT,
    exp: ahora() + 60,
    nbf: ahora() - 10,
    iat: ahora() - 10,
    sub: "42",
    ...over
  });

test("pase válido (iss y dest a la misma tienda) → devuelve el dominio", () => {
  assert.strictEqual(tiendaDelPase(paseValido()), SHOP);
});

test("iss y dest de tiendas distintas → rechaza", () => {
  const malo = paseValido({ iss: "https://otra-tienda.myshopify.com/admin" });
  assert.throws(() => tiendaDelPase(malo), /iss|dest|inconsistente/i);
});

test("aud de otra app → rechaza", () => {
  assert.throws(() => tiendaDelPase(paseValido({ aud: "otra-app-9999" })), /otra app/i);
});

test("pase vencido → rechaza", () => {
  assert.throws(() => tiendaDelPase(paseValido({ exp: ahora() - 10 })), /vencid/i);
});

test("firma inválida (payload manipulado) → rechaza", () => {
  const bueno = paseValido();
  const [h, , s] = bueno.split(".");
  const cuerpoFalso = b64url({ iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: CLIENT, exp: ahora() + 60 });
  assert.throws(() => tiendaDelPase(`${h}.${cuerpoFalso}.${s}`), /firma/i);
});

test("pase mal formado (no es un JWT de 3 partes) → rechaza", () => {
  assert.throws(() => tiendaDelPase("no-es-un-pase"), /mal formado/i);
});

test("claims temporales y subject son obligatorios", () => {
  for (const claim of ["exp", "nbf", "iat", "sub"]) {
    assert.throws(
      () => tiendaDelPase(paseValido({ [claim]: undefined })),
      new RegExp(claim === "sub" ? "subject" : claim, "i")
    );
  }
});

test("solo acepta JWT HS256", () => {
  const payload = {
    iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: CLIENT,
    exp: ahora() + 60, nbf: ahora() - 10, iat: ahora() - 10, sub: "42"
  };
  assert.throws(
    () => tiendaDelPase(firmar(payload, SECRET, { alg: "none", typ: "JWT" })),
    /algoritmo/i
  );
});

test("detecta cualquier alcance obligatorio faltante", () => {
  assert.deepStrictEqual(alcancesFaltantes(ALCANCES), []);
  assert.deepStrictEqual(alcancesFaltantes(ALCANCES.replace("write_files,", "")), ["write_files"]);
});

test("reconcilia solo los webhooks operativos que faltan", async () => {
  const calls = [];
  const fakeGql = async (query, variables) => {
    calls.push({ query, variables });
    if (query.includes("webhookSubscriptions(first")) {
      return {
        webhookSubscriptions: {
          edges: [{ node: { topic: "APP_UNINSTALLED", uri: "https://app.example/webhooks" } }]
        }
      };
    }
    return {
      webhookSubscriptionCreate: {
        webhookSubscription: { id: "gid://shopify/WebhookSubscription/1", topic: variables.topic },
        userErrors: []
      }
    };
  };

  await registrarWebhooksOperativos({ tienda: SHOP, token: "token" }, "https://app.example", fakeGql);
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(calls[1].variables.topic, "APP_SUBSCRIPTIONS_UPDATE");
  assert.strictEqual(calls[2].variables.topic, "PRODUCTS_UPDATE");
});

test("un userError impide considerar completa la instalacion", async () => {
  const fakeGql = async (query) => query.includes("webhookSubscriptions(first")
    ? { webhookSubscriptions: { edges: [] } }
    : { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ message: "rechazado" }] } };

  await assert.rejects(
    registrarWebhooksOperativos({ tienda: SHOP, token: "token" }, "https://app.example", fakeGql),
    /No se pudo registrar/
  );
});
