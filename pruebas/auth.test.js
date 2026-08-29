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
const {
  tiendaDelPase,
  hmacValido,
  timestampOAuthValido,
  validarSolicitudOAuthInicial,
  solicitudInicialOAuthPermitida,
  crearCookieEstadoOAuth,
  verificarCookieEstadoOAuth,
  consumirCookieEstadoOAuth,
  alcancesFaltantes,
  registrarWebhooksOperativos,
  origenStorefrontValido,
  configurarOrigenStorefront,
  asegurarOrigenStorefront,
  recuperarInstalacionDesdePase,
  ALCANCES,
  TOPICOS_OPERATIVOS,
  COOKIE_ESTADO_OAUTH
} = require("../auth");

const SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const CLIENT = process.env.SHOPIFY_CLIENT_ID;
const ahora = () => Math.floor(Date.now() / 1000);

function firmarParametrosOAuth(params) {
  const mensaje = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return {
    ...params,
    hmac: crypto.createHmac("sha256", SECRET).update(mensaje).digest("hex")
  };
}

test("el callback valida credenciales expiring antes de efectos Shopify y persiste al final", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
  const callback = fuente.slice(
    fuente.indexOf("async function terminarInstalacion"),
    fuente.indexOf("function tiendaDelPase")
  );
  const permisos = callback.indexOf("alcancesFaltantes(datos.scope)");
  const credencial = callback.indexOf("credencialExpiringDesdeRespuesta(datos)");
  const webhooks = callback.indexOf("registrarWebhooksOperativos(");
  const storefront = callback.indexOf("asegurarOrigenStorefront(");
  const guardar = callback.indexOf("guardarInstalacionExpiring(");

  assert.ok(credencial >= 0 && permisos > credencial && webhooks > permisos && storefront > webhooks && guardar > storefront);
});

test("el request inicial exige HMAC valido y timestamp reciente en produccion", () => {
  const ahoraMs = 1_800_000_000_000;
  const timestamp = Math.floor(ahoraMs / 1000);
  const firmado = firmarParametrosOAuth({ shop: SHOP, timestamp: String(timestamp) });

  assert.equal(hmacValido(firmado), true);
  assert.equal(timestampOAuthValido(firmado, { ahoraMs }), true);
  assert.equal(validarSolicitudOAuthInicial(firmado, { ahoraMs }), true);
  assert.equal(solicitudInicialOAuthPermitida(firmado, { produccion: true, ahoraMs }), true);
  assert.equal(solicitudInicialOAuthPermitida({ shop: SHOP }, { produccion: true, ahoraMs }), false);
});

test("el request inicial rechaza firmas alteradas y timestamps vencidos o futuros", () => {
  const ahoraMs = 1_800_000_000_000;
  const timestamp = Math.floor(ahoraMs / 1000);
  const firmado = firmarParametrosOAuth({ shop: SHOP, timestamp: String(timestamp) });
  const vencido = firmarParametrosOAuth({ shop: SHOP, timestamp: String(timestamp - 301) });
  const futuro = firmarParametrosOAuth({ shop: SHOP, timestamp: String(timestamp + 61) });

  assert.equal(validarSolicitudOAuthInicial({ ...firmado, shop: "alterada.myshopify.com" }, { ahoraMs }), false);
  assert.equal(validarSolicitudOAuthInicial(vencido, { ahoraMs }), false);
  assert.equal(validarSolicitudOAuthInicial(futuro, { ahoraMs }), false);
  assert.equal(timestampOAuthValido({ timestamp: "1.5" }, { ahoraMs }), false);
});

test("el inicio directo conserva compatibilidad solo fuera de produccion", () => {
  const sinFirma = { shop: SHOP };
  assert.equal(solicitudInicialOAuthPermitida(sinFirma, { produccion: false }), true);
  assert.equal(solicitudInicialOAuthPermitida(sinFirma, { produccion: true }), false);
  assert.equal(
    solicitudInicialOAuthPermitida({ ...sinFirma, timestamp: String(ahora()) }, { produccion: false }),
    false,
    "una firma incompleta no debe caer al modo compatible"
  );
});

test("la app no fabrica enlaces OAuth sin firma para reinstalar en produccion", () => {
  const frontend = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  assert.doesNotMatch(frontend, /location\.origin\}\/auth\?shop=/);
  assert.match(frontend, /Volvé a abrir TiendaIQ desde Apps en Shopify Admin/);
  assert.match(server, /else if \(env\.DEV_MODE === "1"\).*\/auth\?shop=/);
  assert.match(server, /iniciar desde Shopify Admin o el enlace oficial de Shopify/);
});

test("la cookie OAuth liga el state, usa atributos seguros y detecta alteraciones", () => {
  const estado = "0123456789abcdef0123456789abcdef";
  const setCookie = crearCookieEstadoOAuth(estado);
  const cookieHeader = setCookie.split(";")[0];

  assert.match(setCookie, new RegExp(`^${COOKIE_ESTADO_OAUTH}=`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\/auth\/callback/);
  assert.equal(verificarCookieEstadoOAuth(cookieHeader, estado), true);
  assert.equal(verificarCookieEstadoOAuth(cookieHeader, `${estado}00`), false);
  assert.equal(verificarCookieEstadoOAuth(`${cookieHeader}x`, estado), false);
  assert.equal(verificarCookieEstadoOAuth("otra=valor", estado), false);
});

test("el callback consume la cookie OAuth y siempre ordena eliminarla", () => {
  const estado = "abcdef0123456789abcdef0123456789";
  const cookieHeader = crearCookieEstadoOAuth(estado).split(";")[0];
  const headers = new Map();
  const res = {
    req: { headers: { cookie: cookieHeader } },
    getHeader(name) { return headers.get(name); },
    setHeader(name, value) { headers.set(name, value); }
  };

  assert.equal(consumirCookieEstadoOAuth(res, estado), true);
  assert.deepEqual(headers.get("Set-Cookie"), [
    `${COOKIE_ESTADO_OAUTH}=; Max-Age=0; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax`
  ]);
  assert.equal(consumirCookieEstadoOAuth({ ...res, req: { headers: {} } }, estado), false);
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
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].variables.topic, "APP_SUBSCRIPTIONS_UPDATE");
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

function respuestaTokenExchange(overrides = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        access_token: "shpat_offline_prueba",
        refresh_token: "shpat_refresh_prueba",
        expires_in: 3600,
        refresh_token_expires_in: 7_776_000,
        scope: ALCANCES,
        ...overrides
      };
    }
  };
}

function gqlConWebhooksCompletos() {
  let origen = null;
  return async (query, variables) => {
    if (query.includes("webhookSubscriptions(first")) return {
      webhookSubscriptions: {
        edges: TOPICOS_OPERATIVOS.map((topic) => ({
          node: { topic, uri: "https://app.example/webhooks" }
        }))
      }
    };
    if (query.includes("currentAppInstallation") && query.includes("metafield(")) return {
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/1",
        metafield: origen ? { value: origen } : null
      }
    };
    if (query.includes("metafieldsSet(")) {
      origen = variables.metafields[0].value;
      return {
        metafieldsSet: {
          metafields: [{ namespace: "tiendaiq", key: "storefront_origin", value: origen }],
          userErrors: []
        }
      };
    }
    throw new Error("consulta GraphQL inesperada");
  };
}

test("el origen del storefront exige HTTPS canónico y sin componentes ambiguos", () => {
  assert.strictEqual(origenStorefrontValido("https://staging.example/"), "https://staging.example");
  for (const valor of [
    "http://staging.example/",
    "https://user@staging.example/",
    "https://staging.example/app",
    "https://staging.example/?debug=1",
    "https://staging.example/#fragmento"
  ]) {
    assert.throws(() => origenStorefrontValido(valor), /APP_URL/);
  }
});

test("la configuración de storefront queda aislada en el app-data metafield de la instalación", async () => {
  const llamadas = [];
  const fakeGql = async (query, variables) => {
    llamadas.push({ query, variables });
    if (query.includes("currentAppInstallation")) return {
      currentAppInstallation: { id: "gid://shopify/AppInstallation/99", metafield: null }
    };
    return {
      metafieldsSet: {
        metafields: [{ namespace: "tiendaiq", key: "storefront_origin", value: variables.metafields[0].value }],
        userErrors: []
      }
    };
  };

  const resultado = await configurarOrigenStorefront({ tienda: SHOP, token: "token" }, "https://staging.example/", fakeGql);
  assert.deepStrictEqual(resultado, { origen: "https://staging.example", actualizado: true });
  assert.strictEqual(llamadas.length, 2);
  assert.deepStrictEqual(llamadas[1].variables.metafields, [{
    ownerId: "gid://shopify/AppInstallation/99",
    namespace: "tiendaiq",
    key: "storefront_origin",
    type: "single_line_text_field",
    value: "https://staging.example"
  }]);
});

test("el origen ya confirmado no se reescribe", async () => {
  let mutaciones = 0;
  const resultado = await configurarOrigenStorefront({ tienda: SHOP, token: "token" }, "https://app.example/", async (query) => {
    if (query.includes("metafieldsSet(")) mutaciones += 1;
    return {
      currentAppInstallation: {
        id: "gid://shopify/AppInstallation/99",
        metafield: { value: "https://app.example" }
      }
    };
  });
  assert.deepStrictEqual(resultado, { origen: "https://app.example", actualizado: false });
  assert.strictEqual(mutaciones, 0);
});

test("un error de Shopify al guardar el origen no considera instalada la configuración", async () => {
  await assert.rejects(
    configurarOrigenStorefront({ tienda: SHOP, token: "token" }, "https://app.example/", async (query) => query.includes("currentAppInstallation")
      ? { currentAppInstallation: { id: "gid://shopify/AppInstallation/99", metafield: null } }
      : { metafieldsSet: { metafields: [], userErrors: [{ message: "rechazado" }] } }),
    /no confirmó/
  );
});

test("la reconciliación de una instalación existente no repite la mutación dentro del proceso", async () => {
  let consultas = 0;
  let mutaciones = 0;
  const fakeGql = async (query, variables) => {
    if (query.includes("currentAppInstallation")) {
      consultas += 1;
      return { currentAppInstallation: { id: "gid://shopify/AppInstallation/100", metafield: null } };
    }
    mutaciones += 1;
    return {
      metafieldsSet: {
        metafields: [{ namespace: "tiendaiq", key: "storefront_origin", value: variables.metafields[0].value }],
        userErrors: []
      }
    };
  };
  const sesion = { tienda: "cache-storefront.myshopify.com", token: "token" };

  await asegurarOrigenStorefront(sesion, "https://cache-storefront.example/", fakeGql);
  await asegurarOrigenStorefront(sesion, "https://cache-storefront.example/", fakeGql);

  assert.strictEqual(consultas, 1);
  assert.strictEqual(mutaciones, 1);
});

test("token exchange offline recupera una instalacion autenticada y la persiste", async () => {
  const llamadas = [];
  const guardadas = [];
  const pase = paseValido();
  const sesion = await recuperarInstalacionDesdePase(pase, {
    tiendaEsperada: SHOP,
    urlApp: "https://app.example",
    gqlClient: gqlConWebhooksCompletos(),
    fetchImpl: async (url, opciones) => {
      llamadas.push({ url, opciones });
      return respuestaTokenExchange();
    },
    guardar: async (...args) => guardadas.push(args)
  });

  assert.deepStrictEqual(sesion, { tienda: SHOP, token: "shpat_offline_prueba" });
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].url, `https://${SHOP}/admin/oauth/access_token`);
  assert.strictEqual(llamadas[0].opciones.headers["Content-Type"], "application/x-www-form-urlencoded");
  const body = new URLSearchParams(llamadas[0].opciones.body);
  assert.strictEqual(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
  assert.strictEqual(body.get("subject_token_type"), "urn:ietf:params:oauth:token-type:id_token");
  assert.strictEqual(body.get("requested_token_type"), "urn:shopify:params:oauth:token-type:offline-access-token");
  assert.strictEqual(body.get("expiring"), "1");
  assert.strictEqual(body.get("subject_token"), pase);
  assert.deepStrictEqual(guardadas, [[SHOP, {
    accessToken: "shpat_offline_prueba",
    refreshToken: "shpat_refresh_prueba",
    accessExpiresAt: guardadas[0][1].accessExpiresAt,
    refreshExpiresAt: guardadas[0][1].refreshExpiresAt
  }, {
    alcances: ALCANCES,
    alcances_faltantes: [],
    autorizacion: "token_exchange"
  }]]);
});

test("un pase invalido nunca llega al token exchange", async () => {
  let llamadas = 0;
  await assert.rejects(
    recuperarInstalacionDesdePase("pase-invalido", {
      fetchImpl: async () => { llamadas += 1; return respuestaTokenExchange(); }
    }),
    /mal formado/i
  );
  assert.strictEqual(llamadas, 0);
});

test("token exchange falla cerrado ante scopes incompletos", async () => {
  let guardadas = 0;
  await assert.rejects(
    recuperarInstalacionDesdePase(paseValido(), {
      urlApp: "https://app.example",
      fetchImpl: async () => respuestaTokenExchange({ scope: "read_products" }),
      gqlClient: async (query) => {
        assert.match(query, /currentAppInstallation/);
        return { currentAppInstallation: { accessScopes: [{ handle: "read_products" }] } };
      },
      guardar: async () => { guardadas += 1; }
    }),
    (error) => error.code === "SHOPIFY_SCOPES_INCOMPLETOS"
      && error.status === 403
      && !error.detalle.includes("shpat_offline_prueba")
  );
  assert.strictEqual(guardadas, 0);
});

test("token exchange confirma scopes efectivos cuando la respuesta parece incompleta", async () => {
  const guardadas = [];
  const efectivos = [...ALCANCES.split(","), "read_online_store_navigation"];
  const gqlClient = async (query) => {
    if (query.includes("currentAppInstallation")) {
      return {
        currentAppInstallation: {
          accessScopes: efectivos.map((handle) => ({ handle }))
        }
      };
    }
    if (query.includes("webhookSubscriptions(first")) {
      return {
        webhookSubscriptions: {
          edges: TOPICOS_OPERATIVOS.map((topic) => ({
            node: { topic, uri: "https://app.example/webhooks" }
          }))
        }
      };
    }
    throw new Error("consulta GraphQL inesperada");
  };

  const sesion = await recuperarInstalacionDesdePase(paseValido(), {
    urlApp: "https://app.example",
    fetchImpl: async () => respuestaTokenExchange({ scope: "read_products" }),
    gqlClient,
    guardar: async (...args) => guardadas.push(args)
  });

  assert.deepStrictEqual(sesion, { tienda: SHOP, token: "shpat_offline_prueba" });
  assert.strictEqual(guardadas.length, 1);
  assert.deepStrictEqual(guardadas[0][2], {
    alcances: efectivos.join(","),
    alcances_faltantes: [],
    autorizacion: "token_exchange"
  });
});

test("token exchange falla cerrado si no puede confirmar los scopes efectivos", async () => {
  let guardadas = 0;
  const secretoRemoto = "shpat_no_debe_filtrarse";
  await assert.rejects(
    recuperarInstalacionDesdePase(paseValido(), {
      fetchImpl: async () => respuestaTokenExchange({ scope: "read_products" }),
      gqlClient: async () => {
        const error = new Error("fallo remoto");
        error.detalle = secretoRemoto;
        throw error;
      },
      guardar: async () => { guardadas += 1; }
    }),
    (error) => error.code === "SHOPIFY_TOKEN_EXCHANGE_FAILED"
      && error.status === 502
      && !error.message.includes(secretoRemoto)
      && !String(error.detalle || "").includes(secretoRemoto)
  );
  assert.strictEqual(guardadas, 0);
});

test("una respuesta fallida de Shopify no persiste tokens ni filtra el cuerpo", async () => {
  let guardadas = 0;
  const secretoRemoto = "respuesta-remota-que-no-debe-filtrarse";
  await assert.rejects(
    recuperarInstalacionDesdePase(paseValido(), {
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        async json() { return { error: secretoRemoto }; }
      }),
      guardar: async () => { guardadas += 1; }
    }),
    (error) => error.status === 502 && !error.message.includes(secretoRemoto) && !error.detalle.includes(secretoRemoto)
  );
  assert.strictEqual(guardadas, 0);
});

test("requests concurrentes comparten un solo token exchange por tienda", async () => {
  let intercambios = 0;
  let liberar;
  const espera = new Promise((resolve) => { liberar = resolve; });
  const opciones = {
    urlApp: "https://app.example",
    gqlClient: gqlConWebhooksCompletos(),
    fetchImpl: async () => {
      intercambios += 1;
      await espera;
      return respuestaTokenExchange();
    },
    guardar: async () => {}
  };
  const pase = paseValido();
  const primero = recuperarInstalacionDesdePase(pase, opciones);
  const segundo = recuperarInstalacionDesdePase(pase, opciones);
  liberar();
  const resultados = await Promise.all([primero, segundo]);

  assert.strictEqual(intercambios, 1);
  assert.deepStrictEqual(resultados[0], resultados[1]);
});
