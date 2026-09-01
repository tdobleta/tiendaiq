// ============================================================
// BUNDLES — descuentos automáticos y métricas.
//
// Acá la plata no la calcula la app: la hace cumplir Shopify con descuentos
// automáticos nativos. Eso protege del navegador, pero corre el riesgo a otro
// lado — a lo que la app le PIDE a Shopify que cree. Un descuento mal armado
// se aplica igual, y se aplica en serio.
//
// Nada de esto toca Shopify: ver pruebas/dobles.js.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { montar } = require("./dobles");

const TIENDA = "prueba.myshopify.com";
const SESION = { tienda: TIENDA, token: "shpat_falso" };

const creado = (n) => ({
  discountAutomaticBasicCreate: {
    automaticDiscountNode: { id: `gid://shopify/DiscountAutomaticNode/${n}` },
    userErrors: []
  }
});
const creadoBxgy = (n) => ({
  discountAutomaticBxgyCreate: {
    automaticDiscountNode: { id: `gid://shopify/DiscountAutomaticNode/${n}` },
    userErrors: []
  }
});
const borrado = { discountAutomaticDelete: { deletedAutomaticDiscountId: "x", userErrors: [] } };

// Un bundle mínimo de volumen. Ojo: sincronizarDescuentos recorre config.lista
// y espera bundles ya completos (los completa leerConfigBundles).
function bundle(extra = {}) {
  return {
    id: "b_1",
    nombre: "Volumen",
    tipo: "volumen",
    activo: true,
    activador: { tipo: "todos", ids: [] },
    ofertas: [
      { cantidad: 1, descuento: 0 },
      { cantidad: 2, descuento: 10 },
      { cantidad: 3, descuento: 15 }
    ],
    discount_ids: [],
    ...extra
  };
}

// Todas las mutaciones de creación que se le mandaron a Shopify.
const creaciones = (shopify) => shopify.llamadas.filter((l) => l.query.includes("Create"));
const borrados = (shopify) => shopify.llamadas.filter((l) => l.query.includes("discountAutomaticDelete"));

describe("a qué productos se le aplica el descuento", () => {
  test("activador 'todos' aplica a todo el catálogo", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1), creado(2)]
    });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle()] });
    assert.deepEqual(creaciones(shopify)[0].variables.d.customerGets.items, { all: true });
  });

  test("activador 'productos' scopea a esos productos", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1), creado(2)]
    });

    await modulo.sincronizarDescuentos(SESION, {
      lista: [bundle({ activador: { tipo: "productos", ids: ["gid://shopify/Product/1"] } })]
    });

    assert.deepEqual(creaciones(shopify)[0].variables.d.customerGets.items, {
      products: { productsToAdd: ["gid://shopify/Product/1"] }
    });
  });

  // El merchant elige "solo estos productos", no llega a seleccionar ninguno y
  // guarda. Si eso cae en "todos", le acabamos de poner un descuento a TODA la
  // tienda sin que lo pida. Es el peor error posible del módulo.
  test("activador 'productos' SIN productos elegidos no puede caer en 'todo el catálogo'", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1), creado(2)]
    });

    await assert.rejects(
      () => modulo.sincronizarDescuentos(SESION, { lista: [bundle({ activador: { tipo: "productos", ids: [] } })] }),
      /ningún producto elegido/i,
      "un activador por productos vacío armó un descuento para toda la tienda"
    );
  });

  test("activador 'coleccion' SIN colección elegida tampoco", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1), creado(2)]
    });

    await assert.rejects(
      () => modulo.sincronizarDescuentos(SESION, { lista: [bundle({ activador: { tipo: "coleccion", ids: [] } })] }),
      /ninguna colección elegida/i
    );
  });
});

describe("el porcentaje que se le pide a Shopify", () => {
  test("10% viaja como 0.1 y 15% como 0.15", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1), creado(2)]
    });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle()] });
    const cs = creaciones(shopify);
    assert.equal(cs[0].variables.d.customerGets.value.percentage, 0.1);
    assert.equal(cs[1].variables.d.customerGets.value.percentage, 0.15);
  });

  test("el peldaño ancla (descuento 0) no crea descuento", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1), creado(2)]
    });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle()] });
    assert.equal(creaciones(shopify).length, 2, "el peldaño de 1 unidad no tiene que generar nada");
  });

  test("la cantidad mínima viaja como string, que es lo que pide Shopify", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1), creado(2)]
    });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle()] });
    assert.equal(creaciones(shopify)[0].variables.d.minimumRequirement.quantity.greaterThanOrEqualToQuantity, "2");
  });

  // Un merchant que quiso escribir "$150 de descuento" y puso 150 en un campo
  // de porcentaje. Recortarlo a 100% significa regalar el producto.
  test("un porcentaje mayor a 100 se rechaza en vez de recortarse a gratis", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1)]
    });

    await assert.rejects(
      () => modulo.sincronizarDescuentos(SESION, { lista: [bundle({ ofertas: [{ cantidad: 2, descuento: 150 }] })] }),
      /porcentaje/i,
      "un 150% se recortó a 100% y el producto sale gratis"
    );
  });

  test("un descuento de exactamente 100% sí se permite (regalo intencional)", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1)]
    });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle({ ofertas: [{ cantidad: 5, descuento: 100 }] })] });
    assert.equal(creaciones(shopify)[0].variables.d.customerGets.value.percentage, 1);
  });

  test("un descuento negativo se ignora, no crea un descuento al revés", async () => {
    const { modulo, shopify } = montar("bundles.js", { tiendas: { [TIENDA]: { token: "t" } } });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle({ ofertas: [{ cantidad: 2, descuento: -10 }] })] });
    assert.equal(creaciones(shopify).length, 0);
  });
});

describe("combinación de descuentos (defaults estilo Pumper)", () => {
  test("por default el bundle NO se apila con otros de PRODUCTO, pero sí con pedido/envío", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1), creado(2)]
    });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle()] });
    const c = creaciones(shopify)[0].variables.d.combinesWith;

    // Default sin `combina`: producto OFF (si no, el 10% y el 15% de dos
    // descuentos de producto se apilarían); pedido/envío ON (estilo Pumper,
    // controlable por el merchant en Configuración avanzada → combinaDe()).
    assert.equal(c.productDiscounts, false, "los de producto NO se apilan con el bundle");
    assert.equal(c.orderDiscounts, true, "pedido ON por default (Pumper)");
    assert.equal(c.shippingDiscounts, true, "el envío gratis sí puede convivir");
  });
});

describe("sincronizar sin dejar descuentos huérfanos", () => {
  test("crea los reemplazos antes de borrar los viejos", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(9), creado(10), borrado, borrado]
    });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle({ discount_ids: ["gid://viejo/1", "gid://viejo/2"] })] });
    assert.equal(borrados(shopify).length, 2);
    const llamadas = shopify.llamadas.map((l) => l.query.includes("discountAutomaticDelete") ? "borrar" : "crear");
    assert.deepEqual(llamadas, ["crear", "crear", "borrar", "borrar"]);
  });

  test("guarda los ids nuevos en el bundle", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(7), creado(8)]
    });

    const config = { lista: [bundle()] };
    await modulo.sincronizarDescuentos(SESION, config);
    assert.deepEqual(config.lista[0].discount_ids, [
      "gid://shopify/DiscountAutomaticNode/7",
      "gid://shopify/DiscountAutomaticNode/8"
    ]);
  });

  test("si la creación falla a mitad, compensa lo nuevo y conserva lo anterior", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [
        creado(1),
        { discountAutomaticBasicCreate: { automaticDiscountNode: null, userErrors: [{ message: "límite alcanzado" }] } },
        borrado
      ]
    });

    const config = { lista: [bundle({ discount_ids: ["gid://viejo/1"] })] };
    await assert.rejects(() => modulo.sincronizarDescuentos(SESION, config), /límite alcanzado/);

    assert.deepEqual(
      config.lista[0].discount_ids,
      ["gid://viejo/1"],
      "el descuento anterior debe seguir activo mientras se compensa el reemplazo"
    );
    assert.equal(borrados(shopify)[0].variables.id, "gid://shopify/DiscountAutomaticNode/1");
  });

  test("una compensación fallida conserva el id nuevo para reintentar", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [
        creado(1),
        { discountAutomaticBasicCreate: { automaticDiscountNode: null, userErrors: [{ message: "límite alcanzado" }] } },
        new Error("Shopify temporalmente no disponible")
      ]
    });

    const config = { lista: [bundle({ discount_ids: ["gid://viejo/1"] })] };
    await assert.rejects(() => modulo.sincronizarDescuentos(SESION, config), /límite alcanzado/);
    assert.deepEqual(config.lista[0].discount_ids, ["gid://viejo/1", "gid://shopify/DiscountAutomaticNode/1"]);
  });

  test("un bundle desactivado borra sus descuentos y no crea ninguno", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [borrado]
    });

    const config = { lista: [bundle({ activo: false, discount_ids: ["gid://viejo/1"] })] };
    await modulo.sincronizarDescuentos(SESION, config);

    assert.equal(borrados(shopify).length, 1);
    assert.equal(creaciones(shopify).length, 0);
    assert.deepEqual(config.lista[0].discount_ids, []);
  });

  test("borrar tolera ids que ya no existen sin frenar el resto", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [new Error("no existe"), borrado]
    });

    await modulo.borrarDescuentos(SESION, ["gid://muerto", "gid://vivo"]);
    assert.equal(borrados(shopify).length, 2, "un id muerto no puede cortar la limpieza");
  });
});

describe("BXGY — comprá X, llevate Y", () => {
  test("arma un solo descuento con las dos patas", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creadoBxgy(1)]
    });

    await modulo.sincronizarDescuentos(SESION, {
      lista: [bundle({ tipo: "bxgy", bxgy: { compra_cantidad: 2, regalo_cantidad: 1, regalo_descuento: 100 } })]
    });

    const cs = creaciones(shopify);
    assert.equal(cs.length, 1, "BXGY es un solo descuento, no uno por peldaño");
    const d = cs[0].variables.d;
    assert.equal(d.customerBuys.value.quantity, "2");
    assert.equal(d.customerGets.value.discountOnQuantity.quantity, "1");
    assert.equal(d.customerGets.value.discountOnQuantity.effect.percentage, 1, "100% = gratis");
  });

  test("las ofertas de volumen se ignoran cuando el tipo es bxgy", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creadoBxgy(1)]
    });

    await modulo.sincronizarDescuentos(SESION, {
      lista: [bundle({ tipo: "bxgy", ofertas: [{ cantidad: 2, descuento: 10 }, { cantidad: 3, descuento: 15 }] })]
    });
    assert.equal(creaciones(shopify).length, 1);
  });
});

describe("métricas — uso de descuentos sin leer pedidos", () => {
  const id = (n) => `gid://shopify/DiscountAutomaticNode/${n}`;
  const nodo = (n, usos) => ({ id: id(n), automaticDiscount: { asyncUsageCount: usos } });

  test("suma únicamente los IDs que la app guardó para cada bundle", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [{ nodes: [nodo(1, 7), nodo(2, 4)] }]
    });
    const config = {
      lista: [
        bundle({ id: "b_a", discount_ids: [id(1)] }),
        bundle({ id: "b_b", discount_ids: [id(2)] })
      ]
    };

    const m = await modulo.metricasBundles(SESION, config);
    assert.equal(m.usos, 11);
    assert.equal(m.reglas, 2);
    assert.deepEqual(m.porBundle, { b_a: { usos: 7 }, b_b: { usos: 4 } });
    assert.deepEqual(shopify.llamadas[0].variables.ids, [id(1), id(2)]);
    assert.doesNotMatch(shopify.llamadas[0].query, /\borders\b/);
  });

  test("deduplica referencias y marca reglas borradas fuera de la app", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [{ nodes: [nodo(1, 3), null] }]
    });
    const config = {
      lista: [
        bundle({ id: "b_a", discount_ids: [id(1), id(2)] }),
        bundle({ id: "b_b", discount_ids: [id(1)] })
      ]
    };

    const m = await modulo.metricasBundles(SESION, config);
    assert.equal(m.usos, 3, "un ID compartido no puede duplicar el total global");
    assert.equal(m.faltantes, 1);
    assert.deepEqual(m.porBundle, { b_a: { usos: 3 }, b_b: { usos: 3 } });
  });

  test("una tienda sin reglas devuelve cero sin llamar a Shopify", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } }
    });

    const m = await modulo.metricasBundles(SESION, { lista: [] });
    assert.equal(m.usos, 0);
    assert.equal(m.reglas, 0);
    assert.equal(m.ofertasActivas, 0);
    assert.equal(shopify.llamadas.length, 0);
  });
});

describe("config", () => {
  test("rechaza capacidades visuales que no tienen operación monetaria", () => {
    const { modulo } = montar("bundles.js", { tiendas: { [TIENDA]: { token: "t" } } });
    const casos = [
      bundle({ tipo: "combo" }),
      bundle({ ofertas: [{ cantidad: 2, tipo_desc: "fijo", monto_fijo: 10 }] }),
      bundle({ ofertas: [{ cantidad: 2, descuento: 10, addons: { regalo: { on: true } } }] }),
      bundle({ ofertas: [{ cantidad: 2, descuento: 10, addons: { envio: { on: true } } }] }),
      bundle({ ofertas: [{ cantidad: 2, descuento: 10, redondeo: true }] })
    ];

    for (const caso of casos) {
      assert.throws(() => modulo.validarConfigBundles({ lista: [caso] }), /todavía no está/i);
    }
  });

  test("una oferta marcada sin descuento no crea una regla por un valor viejo", async () => {
    const { modulo, shopify } = montar("bundles.js", { tiendas: { [TIENDA]: { token: "t" } } });
    await modulo.sincronizarDescuentos(SESION, {
      lista: [bundle({ ofertas: [{ cantidad: 2, tipo_desc: "ninguno", descuento: 40 }] })]
    });
    assert.equal(creaciones(shopify).length, 0);
  });

  test("una tienda sin bundles arranca vacía y apagada", async () => {
    const { modulo } = montar("bundles.js", { tiendas: { [TIENDA]: { token: "t" } } });

    const cfg = await modulo.leerConfigBundles(TIENDA);
    assert.equal(cfg.activo, false);
    assert.deepEqual(cfg.lista, []);
  });

  test("apaga promesas experimentales guardadas por builds anteriores", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: {
        [TIENDA]: {
          token: "t",
          bundles: {
            lista: [bundle({ ofertas: [{ cantidad: 2, descuento: 10, redondeo: true, addons: { regalo: { on: true }, envio: { on: true } } }] })]
          }
        }
      }
    });

    const oferta = (await modulo.leerConfigBundles(TIENDA)).lista[0].ofertas[0];
    assert.equal(oferta.redondeo, false);
    assert.equal(oferta.addons.regalo.on, false);
    assert.equal(oferta.addons.envio.on, false);
  });

  test("cada bundle guardado se completa contra su default", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t", bundles: { lista: [{ id: "b_x", nombre: "Mío" }] } } }
    });

    const cfg = await modulo.leerConfigBundles(TIENDA);
    assert.equal(cfg.lista[0].nombre, "Mío");
    assert.ok(cfg.lista[0].diseno, "un bundle viejo tiene que heredar las claves nuevas");
    assert.equal(cfg.lista[0].tipo, "volumen");
  });

  test("no se puede guardar config de una tienda sin instalar", async () => {
    const { modulo } = montar("bundles.js", { tiendas: {} });
    await assert.rejects(() => modulo.guardarConfigBundles(TIENDA, { lista: [] }), /no está instalada/);
  });
});
