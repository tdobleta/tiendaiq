// ============================================================
// DOBLES — reemplazos de mentira para Shopify y la base.
//
// Los módulos de negocio (facturacion, bundles) hablan con dos cosas que
// no queremos en una prueba: la Admin API de Shopify y el almacén de tiendas.
// Sin poder sustituirlas, probar la lógica de plata significaría crear cargos
// y pedidos de verdad.
//
// Node resuelve cada `require` una sola vez y guarda el resultado en
// `require.cache`, con la ruta absoluta del archivo como clave. Si metemos ahí
// nuestro objeto ANTES de que el módulo bajo prueba haga su `require`, se lo
// lleva sin enterarse. No hace falta tocar el código de producción.
//
// Ojo con el orden: varios módulos leen `env` al cargarse (PAGINAS_GRATIS,
// TIENDAS_PRO, PLAN_TEST). El env se fija acá, antes del require.
// ============================================================

const path = require("path");

const RAIZ = path.join(__dirname, "..");
const ruta = (m) => require.resolve(path.join(RAIZ, m));

// Módulos que se cargan de verdad y hay que sacar del cache para que la
// próxima prueba los vuelva a construir con sus dobles nuevos.
const A_LIMPIAR = ["shopify.js", "tiendas.js", "db.js", "facturacion.js", "bundles.js"];

function limpiarCache() {
  for (const m of A_LIMPIAR) {
    try {
      delete require.cache[ruta(m)];
    } catch {
      /* si el archivo no existe, no hay nada que limpiar */
    }
  }
}

// Registra un objeto como si fuera el módulo que está en `rel`.
function sustituir(rel, exports) {
  const id = ruta(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

/**
 * Prepara el entorno de una prueba y devuelve el módulo pedido, ya cableado a
 * los dobles.
 *
 *   const { modulo, shopify, tiendas } = montar("facturacion.js", {
 *     env: { PAGINAS_GRATIS: "3" },
 *     tiendas: { "x.myshopify.com": { token: "t", plan: "pro" } },
 *     respuestas: [{ currentAppInstallation: { activeSubscriptions: [] } }]
 *   });
 *
 * `shopify.llamadas` guarda cada { query, variables } para poder afirmar sobre
 * lo que se le mandó a Shopify — que es donde viven los bugs de plata: un
 * `test: true` de más y la app deja de cobrar.
 */
function montar(rel, { env = {}, tiendas = {}, respuestas = [] } = {}) {
  limpiarCache();

  const shopify = {
    llamadas: [],
    // Cola de respuestas: cada gql() consume la siguiente. Si se acaban,
    // devuelve {} en vez de romper — así una prueba que no le importa la
    // segunda llamada no tiene que declararla.
    _cola: [...respuestas],
    env: { ...env },
    API: "2026-07",
    async gql(query, variables, sesion) {
      shopify.llamadas.push({ query, variables, sesion });
      const r = shopify._cola.shift();
      if (r instanceof Error) throw r;
      return r ?? {};
    },
    sesionDeEnv() {
      throw new Error("sesionDeEnv no debería usarse en las pruebas");
    }
  };

  // Almacén en memoria. Copia lo guardado para que una prueba no vea mutaciones
  // accidentales del objeto que pasó.
  const almacen = JSON.parse(JSON.stringify(tiendas));
  const dobleTiendas = {
    escrituras: [],
    normalizar: (d) => String(d || "").trim().toLowerCase(),
    esDominioValido: (d) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(d || "").toLowerCase()),
    async leerTienda(dominio) {
      return almacen[dominio] ? JSON.parse(JSON.stringify(almacen[dominio])) : null;
    },
    async guardarTienda(dominio, token, extra = {}) {
      const registro = { dominio, token, ...extra };
      almacen[dominio] = registro;
      dobleTiendas.escrituras.push(JSON.parse(JSON.stringify(registro)));
      return registro;
    },
    async borrarTienda(dominio) {
      delete almacen[dominio];
    },
    async listarTiendas() {
      return Object.values(almacen);
    },
    // Update parcial (no reescribe todo el registro) — como el jsonb_set real.
    async actualizarCamposTienda(dominio, campos) {
      if (!almacen[dominio]) almacen[dominio] = { dominio };
      Object.assign(almacen[dominio], campos);
      dobleTiendas.escrituras.push(JSON.parse(JSON.stringify(almacen[dominio])));
    },
    // Reserva atómica de cupo: incrementa uso[mes] si hay lugar; null si no.
    async consumirCupoTienda(dominio, mes, limite) {
      const t = almacen[dominio] || (almacen[dominio] = { dominio });
      const actual = (t.uso && t.uso[mes]) || 0;
      if (limite != null && actual >= limite) return null;
      t.uso = { ...(t.uso || {}), [mes]: actual + 1 };
      return actual + 1;
    },
    async revertirCupoTienda(dominio, mes) {
      const t = almacen[dominio];
      if (!t) return;
      const actual = (t.uso && t.uso[mes]) || 0;
      t.uso = { ...(t.uso || {}), [mes]: Math.max(0, actual - 1) };
    },
    async sesionDe(dominio) {
      const t = almacen[dominio];
      if (!t) throw new Error(`La tienda ${dominio} no tiene la app instalada`);
      return { tienda: dominio, token: t.token };
    },
    _almacen: almacen
  };

  sustituir("shopify.js", shopify);
  sustituir("tiendas.js", dobleTiendas);

  const modulo = require(ruta(rel));
  return { modulo, shopify, tiendas: dobleTiendas };
}

module.exports = { montar, limpiarCache };
