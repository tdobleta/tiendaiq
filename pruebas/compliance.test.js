const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.join(__dirname, "..");
const leer = (archivo) => fs.readFileSync(path.join(raiz, archivo), "utf8");

test("la IA genera contenido sin prueba social inventada", () => {
  const adaptador = leer("adaptador.js");

  assert.match(adaptador, /No inventes prueba social/);
  assert.match(adaptador, /claims_verified:\s*false/);
  assert.match(adaptador, /review_source:\s*null/);
  assert.match(adaptador, /statistics_source:\s*null/);
  assert.match(adaptador, /policy_source:\s*null/);
  assert.doesNotMatch(adaptador, /puntaje:\s*un número creíble/i);
});

test("el storefront exige una fuente antes de insertar claims", () => {
  const widget = leer("extensions/tiendaiq-widgets/assets/tiendaiq.js");

  assert.match(widget, /function filtrarClaimsSinFuente/);
  assert.match(widget, /!compliance\.review_source/);
  assert.match(widget, /!compliance\.statistics_source/);
  assert.match(widget, /!compliance\.policy_source/);
  assert.match(widget, /filtrarClaimsSinFuente\(render\(datos/);
  assert.doesNotMatch(widget, /#1 EL MÁS VENDIDO DE 2026/);
  assert.doesNotMatch(widget, /Basado en más de 1422 reseñas/);
  assert.doesNotMatch(widget, /Recomendaron esta experiencia a todas sus amigas/);
});

test("Liquid no sirve reseñas ni políticas sin procedencia", () => {
  const liquid = leer("extensions/tiendaiq-widgets/blocks/pagina.liquid");

  assert.match(liquid, /compliance\.review_source != blank/);
  assert.match(liquid, /compliance\.policy_source != blank/);
  assert.doesNotMatch(liquid, /h\.puntaje \| default: 4\.9/);
});

test("los defaults no convierten guias en prueba social ni estadisticas", () => {
  const adaptador = leer("adaptador.js");

  assert.doesNotMatch(adaptador, /const PCT_FIJOS/);
  assert.doesNotMatch(adaptador, /Reseñas verificadas/);
  assert.doesNotMatch(adaptador, /Resultados verificados/);
  assert.match(adaptador, /resenas:\s*\{[\s\S]{0,400}items:\s*\[\]/);
});

test("el editor no precarga testimonios ni porcentajes aparentes", () => {
  const editor = leer("app/app.js");

  assert.doesNotMatch(editor, /Basado en más de 1422 reseñas/);
  assert.doesNotMatch(editor, /Cliente verificado/);
  assert.doesNotMatch(editor, /Notaron una mejora en su rutina/);
  assert.doesNotMatch(editor, /\[98,\s*100,\s*100,\s*96\]/);
  assert.doesNotMatch(editor, /estrellas:\s*5/);
});

test("el storefront obtiene recomendados reales y no publica precios de ejemplo", () => {
  const adaptador = leer("adaptador.js");
  const widget = leer("extensions/tiendaiq-widgets/assets/tiendaiq.js");

  assert.match(adaptador, /recomendados como un\s+array vacío/);
  assert.match(widget, /data-tiq-live-recommendations hidden/);
  assert.match(widget, /recommendations\/products\.json/);
  assert.match(widget, /if \(!productos\.length\) return/);
  assert.doesNotMatch(widget, /Producto agregado al carrito de demostración/);
  assert.doesNotMatch(widget, /item\.precio \|\| "19\.99"/);
  assert.doesNotMatch(widget, /item\.descuento \|\| "20%"/);
});

test("la base compartida fuerza aislamiento por tenant", () => {
  const migration = leer("db/migrations/0001_tenancy_foundation.sql");

  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /current_setting\('app\.tenant_id', true\)/);
});

test("los bundles no solicitan acceso a pedidos", () => {
  const auth = leer("auth.js");
  const toml = leer("shopify.app.toml");
  const bundles = leer("bundles.js");
  assert.match(auth, /read_discounts/);
  assert.doesNotMatch(auth, /(?:read|write)_orders/);
  assert.doesNotMatch(toml, /(?:read|write)_orders/);
  assert.doesNotMatch(bundles, /\borders\s*\(/);
});
