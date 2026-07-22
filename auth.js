// ============================================================
// AUTENTICACIÓN — dos cosas distintas que se confunden fácil:
//
//   1. INSTALACIÓN (OAuth). Ocurre una vez por tienda. La tienda autoriza,
//      volvemos con su token y lo guardamos. Reemplaza al oauth.js de una vez.
//
//   2. IDENTIFICACIÓN (pase de sesión). Ocurre en CADA request de la app.
//      App Bridge le da al frontend un pase firmado que dice "soy la tienda
//      tal". Acá se verifica la firma y se saca de ahí quién pregunta.
//
// Sin la 2, cualquiera con la URL podría pedirnos datos de cualquier tienda
// instalada: bastaría con mandar ?shop=lo-que-sea.
// ============================================================

const crypto = require("crypto");
const { env } = require("./shopify");
const { guardarTienda, normalizar, esDominioValido } = require("./tiendas");

// write_orders: lo usa el formulario COD para crear pedidos contra reembolso.
// OJO: al agregar un alcance, las tiendas ya instaladas tienen que volver a
// pasar por /auth?shop=... para autorizarlo.
// write_files: imágenes que el merchant sube al formulario COD (Files API).
// write_discounts: los bundles crean descuentos automáticos (por volumen)
// que Shopify hace cumplir en el checkout.
const ALCANCES = "read_products,write_products,read_themes,write_themes,write_orders,read_files,write_files,read_content,write_content,write_discounts";

// Comparación en tiempo constante: comparar firmas con === filtra el secreto
// de a un carácter por vez.
function igualSeguro(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// ============================================================
// 1. INSTALACIÓN
// ============================================================

// Shopify firma sus redirects con HMAC sobre los parámetros ordenados.
// Sin verificar esto, cualquiera puede hacernos guardar un token falso.
function hmacValido(params) {
  const { hmac, signature, ...resto } = params;
  const mensaje = Object.keys(resto)
    .sort()
    .map((k) => `${k}=${resto[k]}`)
    .join("&");
  const esperado = crypto
    .createHmac("sha256", env.SHOPIFY_CLIENT_SECRET)
    .update(mensaje)
    .digest("hex");
  return igualSeguro(esperado, hmac || "");
}

// Un `state` de un solo uso ata el callback a un inicio nuestro.
const estados = new Map();
function nuevoEstado(tienda) {
  const s = crypto.randomBytes(16).toString("hex");
  estados.set(s, { tienda, vence: Date.now() + 10 * 60 * 1000 });
  return s;
}
function consumirEstado(s) {
  const e = estados.get(s);
  estados.delete(s); // un solo uso, exista o no
  return e && e.vence > Date.now() ? e : null;
}

// GET /auth?shop=xxx.myshopify.com — arranca la instalación.
function iniciarInstalacion(res, url, urlApp) {
  const tienda = normalizar(url.searchParams.get("shop"));
  if (!esDominioValido(tienda)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Falta o es inválido el parámetro ?shop=xxx.myshopify.com");
    return;
  }

  const destino =
    `https://${tienda}/admin/oauth/authorize` +
    `?client_id=${env.SHOPIFY_CLIENT_ID}` +
    `&scope=${encodeURIComponent(ALCANCES)}` +
    `&redirect_uri=${encodeURIComponent(`${urlApp}/auth/callback`)}` +
    `&state=${nuevoEstado(tienda)}`;

  res.writeHead(302, { Location: destino }).end();
}

// GET /auth/callback — la tienda autorizó: canjeamos el código por su token.
async function terminarInstalacion(res, url) {
  const params = Object.fromEntries(url.searchParams);
  const tienda = normalizar(params.shop);

  if (!esDominioValido(tienda)) return void res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("shop inválido");
  if (!hmacValido(params)) return void res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }).end("Firma inválida — el pedido no vino de Shopify");
  if (!consumirEstado(params.state)) return void res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" }).end("state inválido o vencido");

  const r = await fetch(`https://${tienda}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      code: params.code
    })
  });

  const datos = await r.json();
  if (!datos.access_token) {
    return void res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }).end("Shopify no devolvió token: " + JSON.stringify(datos));
  }

  await guardarTienda(tienda, datos.access_token, { alcances: datos.scope });
  console.log(`  ✚ instalada · ${tienda}`);

  // Webhooks que necesitamos de entrada:
  //   APP_UNINSTALLED        → borrar el token al instante (no lazy en el 401).
  //   APP_SUBSCRIPTIONS_UPDATE → si cancelan/vence el plan, bajar a gratis.
  const M_WEBHOOK = `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
      userErrors { message }
    }
  }`;
  for (const topic of ["APP_UNINSTALLED", "APP_SUBSCRIPTIONS_UPDATE"]) {
    try {
      const { gql } = require("./shopify");
      await gql(
        M_WEBHOOK,
        { topic, sub: { callbackUrl: `${env.APP_URL}/webhooks`, format: "JSON" } },
        { tienda, token: datos.access_token }
      );
    } catch (e) {
      console.log(`  ⚠ webhook ${topic} no registrado: ${e.message.slice(0, 80)}`);
    }
  }

  // Adentro del admin, no a la app suelta.
  const handle = tienda.replace(".myshopify.com", "");
  res
    .writeHead(302, {
      Location: `https://admin.shopify.com/store/${handle}/apps/${env.SHOPIFY_CLIENT_ID}`
    })
    .end();
}

// ============================================================
// 2. IDENTIFICACIÓN — el pase de sesión de App Bridge
// ============================================================

const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();

// El pase es un JWT firmado con nuestro client secret. Verificamos la firma
// y las fechas, y el claim `dest` nos dice qué tienda es.
function tiendaDelPase(pase) {
  const partes = String(pase || "").split(".");
  if (partes.length !== 3) throw new Error("Pase de sesión mal formado");

  const [cabecera, cuerpo, firma] = partes;
  const esperada = crypto
    .createHmac("sha256", env.SHOPIFY_CLIENT_SECRET)
    .update(`${cabecera}.${cuerpo}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (!igualSeguro(esperada, firma)) throw new Error("Pase de sesión con firma inválida");

  const c = JSON.parse(b64url(cuerpo));
  const ahora = Math.floor(Date.now() / 1000);
  if (c.exp && ahora >= c.exp) throw new Error("Pase de sesión vencido");
  if (c.nbf && ahora < c.nbf - 5) throw new Error("Pase de sesión todavía no válido");
  if (c.aud !== env.SHOPIFY_CLIENT_ID) throw new Error("Pase de sesión emitido para otra app");

  const tienda = normalizar(c.dest);
  if (!esDominioValido(tienda)) throw new Error("El pase no trae una tienda válida");
  return tienda;
}

module.exports = { iniciarInstalacion, terminarInstalacion, tiendaDelPase, hmacValido, ALCANCES };
