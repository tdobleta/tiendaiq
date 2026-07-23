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

describe("no acumular descuentos entre sí", () => {
  test("los bundles no combinan con otros descuentos de producto ni de pedido", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [creado(1), creado(2)]
    });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle()] });
    const c = creaciones(shopify)[0].variables.d.combinesWith;

    assert.equal(c.productDiscounts, false, "si combinan, el 10% y el 15% se apilan");
    assert.equal(c.orderDiscounts, false);
    assert.equal(c.shippingDiscounts, true, "el envío gratis sí puede convivir");
  });
});

describe("sincronizar sin dejar descuentos huérfanos", () => {
  test("borra los viejos antes de crear los nuevos", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [borrado, borrado, creado(9), creado(10)]
    });

    await modulo.sincronizarDescuentos(SESION, { lista: [bundle({ discount_ids: ["gid://viejo/1", "gid://viejo/2"] })] });
    assert.equal(borrados(shopify).length, 2);
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

  // Si el segundo peldaño falla, el primero ya se creó en Shopify y está
  // activo. Perder su id significa un descuento vivo que la app no puede
  // borrar nunca más — y que se duplica en cada intento siguiente.
  test("si la creación falla a mitad, los ya creados quedan registrados", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [
        creado(1),
        { discountAutomaticBasicCreate: { automaticDiscountNode: null, userErrors: [{ message: "límite alcanzado" }] } }
      ]
    });

    const config = { lista: [bundle()] };
    await assert.rejects(() => modulo.sincronizarDescuentos(SESION, config), /límite alcanzado/);

    assert.deepEqual(
      config.lista[0].discount_ids,
      ["gid://shopify/DiscountAutomaticNode/1"],
      "el descuento creado antes del fallo quedó vivo en la tienda y sin rastro"
    );
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

describe("métricas — solo lo que generó la app", () => {
  const pedido = (titulo, total, desc) => ({
    id: "gid://shopify/Order/1",
    currentTotalPriceSet: { shopMoney: { amount: String(total), currencyCode: "ARS" } },
    totalDiscountsSet: { shopMoney: { amount: String(desc) } },
    discountApplications: { nodes: titulo ? [{ title: titulo }] : [] }
  });

  const pagina = (nodes, hasNextPage = false) => ({
    orders: { pageInfo: { hasNextPage, endCursor: "c1" }, nodes }
  });

  test("cuenta solo los pedidos con un descuento nuestro", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [
        pagina([
          pedido("TiendaIQ Bundle · Volumen · 2+", 20000, 2000),
          pedido("Promo de invierno del merchant", 50000, 5000),
          pedido(null, 10000, 0)
        ])
      ]
    });

    const m = await modulo.metricasBundles(SESION, 30);
    assert.equal(m.pedidos, 1, "se colaron pedidos que no generó la app");
    assert.equal(m.ingresos, 20000);
    assert.equal(m.descuento, 2000);
  });

  test("el ticket promedio no divide por cero", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [pagina([])]
    });

    const m = await modulo.metricasBundles(SESION, 30);
    assert.equal(m.pedidos, 0);
    assert.equal(m.ticket, 0);
    assert.equal(m.parcial, false);
  });

  test("marca parcial cuando hay más pedidos de los que recorrió", async () => {
    const { modulo } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: Array.from({ length: 6 }, () => pagina([pedido("TiendaIQ Bundle · x", 100, 10)], true))
    });

    const m = await modulo.metricasBundles(SESION, 30);
    assert.equal(m.parcial, true, "sin esta marca el dashboard miente sobre un total incompleto");
    assert.equal(m.pedidos, 5, "tope de 5 vueltas");
  });

  test("la ventana de días viaja en la consulta", async () => {
    const { modulo, shopify } = montar("bundles.js", {
      tiendas: { [TIENDA]: { token: "t" } },
      respuestas: [pagina([])]
    });

    await modulo.metricasBundles(SESION, 7);
    assert.match(shopify.llamadas[0].variables.q, /^created_at:>=\d{4}-\d{2}-\d{2}$/);
  });
});

describe("config", () => {
  test("una tienda sin bundles arranca vacía y apagada", async () => {
    const { modulo } = montar("bundles.js", { tiendas: { [TIENDA]: { token: "t" } } });

    const cfg = await modulo.leerConfigBundles(TIENDA);
    assert.equal(cfg.activo, false);
    assert.deepEqual(cfg.lista, []);
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
