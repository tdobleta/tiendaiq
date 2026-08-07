// ============================================================
// COD — creación del pedido contra reembolso.
//
// Es la ruta pública de la app: cualquiera en internet puede postearle a
// /cod/pedido. Todo lo que decide el precio tiene que salir del server, nunca
// del navegador — si el browser puede mandar el precio, el merchant vende a
// cero.
//
// Nada de esto toca Shopify: ver pruebas/dobles.js.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { montar } = require("./dobles");

const TIENDA = "prueba.myshopify.com";
const SESION = { tienda: TIENDA, token: "shpat_falso" };
const VARIANTE = 44444;

// Lo que Shopify contesta cuando se le piden los datos reales del producto.
const datosProducto = (extra = {}) => ({
  shop: { currencyCode: "ARS", billingAddress: { countryCodeV2: "AR" } },
  node: {
    id: `gid://shopify/ProductVariant/${VARIANTE}`,
    title: "Único",
    price: "10000.00",
    availableForSale: true,
    product: { title: "Producto de prueba" },
    ...extra
  }
});

const PEDIDO_OK = { orderCreate: { userErrors: [], order: { id: "gid://shopify/Order/1", name: "#1001" } } };

// Config mínima con el formulario prendido y los campos que trae por defecto.
function tiendaConCod(cod = {}) {
  return { [TIENDA]: { token: "t", cod: { activo: true, ...cod } } };
}

// Un pedido con todos los obligatorios completos.
const camposCompletos = {
  nombre: "Juan",
  apellido: "Pérez",
  telefono: "2612345678",
  direccion: "Azcuénaga 2002",
  provincia: "Mendoza",
  ciudad: "Lunlunta"
};

const pedidoBase = (extra = {}) => ({
  variante_id: VARIANTE,
  cantidad: 1,
  campos: { ...camposCompletos },
  ...extra
});

// Saca la mutación de creación del pedido de entre las llamadas hechas.
const mutacionPedido = (shopify) => shopify.llamadas.find((l) => l.query.includes("orderCreate"));

describe("puertas de entrada", () => {
  test("con el formulario desactivado no se crea nada", async () => {
    const { modulo, shopify } = montar("cod.js", { tiendas: { [TIENDA]: { token: "t", cod: { activo: false } } } });

    await assert.rejects(() => modulo.crearPedidoCod(SESION, pedidoBase()), /desactivado/i);
    assert.equal(shopify.llamadas.length, 0, "ni siquiera tendría que preguntarle a Shopify");
  });

  test("el honeypot rechaza sin tocar Shopify", async () => {
    const { modulo, shopify } = montar("cod.js", { tiendas: tiendaConCod() });

    await assert.rejects(() => modulo.crearPedidoCod(SESION, pedidoBase({ hp: "soy un bot" })), /rechazado/i);
    assert.equal(shopify.llamadas.length, 0);
  });

  test("sin variante no hay pedido", async () => {
    const { modulo } = montar("cod.js", { tiendas: tiendaConCod() });
    await assert.rejects(() => modulo.crearPedidoCod(SESION, pedidoBase({ variante_id: null })), /variante/i);
  });

  test("una variante inexistente no crea un pedido vacío", async () => {
    const { modulo } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [{ shop: { currencyCode: "ARS", billingAddress: {} }, node: null }]
    });
    await assert.rejects(() => modulo.crearPedidoCod(SESION, pedidoBase()), /no existe/i);
  });

  test("un producto sin stock no se vende", async () => {
    const { modulo } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [datosProducto({ availableForSale: false })]
    });
    await assert.rejects(() => modulo.crearPedidoCod(SESION, pedidoBase()), /no está disponible/i);
  });
});

describe("campos obligatorios — los decide la config, no el browser", () => {
  test("falta un obligatorio y el pedido se cae", async () => {
    const { modulo } = montar("cod.js", { tiendas: tiendaConCod() });

    const pedido = pedidoBase();
    delete pedido.campos.telefono;
    await assert.rejects(() => modulo.crearPedidoCod(SESION, pedido), /Teléfono/);
  });

  test("un obligatorio con solo espacios cuenta como vacío", async () => {
    const { modulo } = montar("cod.js", { tiendas: tiendaConCod() });
    await assert.rejects(
      () => modulo.crearPedidoCod(SESION, pedidoBase({ campos: { ...camposCompletos, nombre: "   " } })),
      /Nombre/
    );
  });

  test("un campo oculto por el merchant no se exige aunque diga obligatorio", async () => {
    const { modulo } = montar("cod.js", {
      tiendas: tiendaConCod({
        campos: [
          { id: "nombre", etiqueta: "Nombre", visible: true, obligatorio: true },
          { id: "telefono", etiqueta: "Teléfono", visible: false, obligatorio: true }
        ]
      }),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    const r = await modulo.crearPedidoCod(SESION, pedidoBase({ campos: { nombre: "Juan" } }));
    assert.equal(r.orden, "#1001");
  });

  test("un elemento personalizado obligatorio también se valida en el server", async () => {
    const { modulo } = montar("cod.js", {
      tiendas: tiendaConCod({
        elementos: [{ id: "e1", tipo: "campo", etiqueta: "DNI", obligatorio: true }]
      })
    });

    await assert.rejects(() => modulo.crearPedidoCod(SESION, pedidoBase()), /DNI/);
  });

  test("los campos personalizados llegan al pedido como atributos y nota", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod({ elementos: [{ id: "e1", tipo: "campo", etiqueta: "DNI", obligatorio: true }] }),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase({ extras: { e1: "12345678" } }));
    const { order } = mutacionPedido(shopify).variables;

    assert.ok(order.customAttributes.some((a) => a.key === "DNI" && a.value === "12345678"));
    assert.match(order.note, /DNI: 12345678/);
  });
});

describe("el precio lo pone el server", () => {
  test("sin oferta, no se manda precio: manda el de Shopify", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase());
    const linea = mutacionPedido(shopify).variables.order.lineItems[0];
    assert.equal(linea.priceSet, undefined, "pisar el precio sin descuento abre la puerta a que lo elija el browser");
    assert.equal(linea.quantity, 1);
  });

  test("un precio mandado por el browser se ignora por completo", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    // Un atacante posteando directo a /cod/pedido con precio 1.
    await modulo.crearPedidoCod(SESION, pedidoBase({ precio: 1, total: 1, priceSet: { amount: "1.00" } }));

    const enviado = JSON.stringify(mutacionPedido(shopify).variables.order);
    assert.ok(!enviado.includes('"1.00"'), "se coló un precio del browser");
  });

  test("la oferta aplica el descuento calculado acá", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod({
        ofertas: {
          activo: true,
          tiers: [
            { cantidad: 1, descuento: 0, etiqueta: "1 unidad" },
            { cantidad: 3, descuento: 15, etiqueta: "3 unidades" }
          ]
        }
      }),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase({ oferta: 1 }));
    const linea = mutacionPedido(shopify).variables.order.lineItems[0];

    assert.equal(linea.quantity, 3, "la cantidad la manda el peldaño, no el browser");
    assert.equal(linea.priceSet.shopMoney.amount, "8500.00", "10000 menos 15%");
    assert.equal(linea.priceSet.shopMoney.currencyCode, "ARS");
  });

  test("una oferta inventada se rechaza", async () => {
    const { modulo } = montar("cod.js", {
      tiendas: tiendaConCod({ ofertas: { activo: true, tiers: [{ cantidad: 1, descuento: 0 }] } })
    });
    await assert.rejects(() => modulo.crearPedidoCod(SESION, pedidoBase({ oferta: 99 })), /Oferta inválida/);
  });

  test("las ofertas apagadas no aplican descuento aunque se pida una", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod({
        ofertas: { activo: false, tiers: [{ cantidad: 5, descuento: 90, etiqueta: "regalado" }] }
      }),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase({ oferta: 0 }));
    const linea = mutacionPedido(shopify).variables.order.lineItems[0];
    assert.equal(linea.quantity, 1);
    assert.equal(linea.priceSet, undefined, "aplicó un 90% con las ofertas apagadas");
  });

  test("la cantidad se acota entre 1 y 10", async () => {
    for (const [pedida, esperada] of [[0, 1], [-5, 1], [999, 10], ["3", 3]]) {
      const { modulo, shopify } = montar("cod.js", {
        tiendas: tiendaConCod(),
        respuestas: [datosProducto(), PEDIDO_OK]
      });
      await modulo.crearPedidoCod(SESION, pedidoBase({ cantidad: pedida }));
      assert.equal(mutacionPedido(shopify).variables.order.lineItems[0].quantity, esperada, `cantidad ${pedida}`);
    }
  });
});

describe("envío — la tarifa sale de la config", () => {
  test("se usa la tarifa elegida, con SU precio", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod({
        tarifas: [
          { id: "estandar", nombre: "Estándar", precio: 0 },
          { id: "express", nombre: "Express", precio: 3500 }
        ]
      }),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase({ tarifa_id: "express" }));
    const envio = mutacionPedido(shopify).variables.order.shippingLines[0];
    assert.equal(envio.title, "Express");
    assert.equal(envio.priceSet.shopMoney.amount, "3500.00");
  });

  test("una tarifa inventada cae a la primera de la config, no al precio del browser", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod({ tarifas: [{ id: "estandar", nombre: "Estándar", precio: 2000 }] }),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase({ tarifa_id: "gratis-inventada", tarifa_precio: 0 }));
    const envio = mutacionPedido(shopify).variables.order.shippingLines[0];
    assert.equal(envio.priceSet.shopMoney.amount, "2000.00");
  });
});

describe("el pedido que se arma", () => {
  test("nace pendiente de pago y etiquetado como COD", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase());
    const { order, options } = mutacionPedido(shopify).variables;

    assert.equal(order.financialStatus, "PENDING", "un COD no está pago hasta que se entrega");
    assert.ok(order.tags.includes("TiendaIQ COD"));
    assert.equal(options.sendReceipt, false, "no mandarle un recibo de pago a quien todavía no pagó");
    assert.equal(options.inventoryBehaviour, "DECREMENT_OBEYING_POLICY");
  });

  test("la provincia va como atributo y en la nota (MailingAddress no la acepta libre)", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase());
    const { order } = mutacionPedido(shopify).variables;

    assert.ok(order.customAttributes.some((a) => a.key === "Provincia" && a.value === "Mendoza"));
    assert.match(order.note, /Provincia: Mendoza/);
    assert.equal(order.shippingAddress.province, undefined);
  });

  test("un email inválido no se manda", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase({ campos: { ...camposCompletos, email: "no-es-un-email" } }));
    assert.equal(mutacionPedido(shopify).variables.order.email, undefined);
  });

  test("un email válido sí", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase({ campos: { ...camposCompletos, email: "juan@ejemplo.com" } }));
    assert.equal(mutacionPedido(shopify).variables.order.email, "juan@ejemplo.com");
  });

  test("la moneda es la de la tienda, no una fija", async () => {
    const { modulo, shopify } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [
        { ...datosProducto(), shop: { currencyCode: "MXN", billingAddress: { countryCodeV2: "MX" } } },
        PEDIDO_OK
      ]
    });

    await modulo.crearPedidoCod(SESION, pedidoBase());
    const { order } = mutacionPedido(shopify).variables;
    assert.equal(order.currency, "MXN");
    assert.equal(order.shippingAddress.countryCode, "MX");
  });

  test("si Shopify rechaza el pedido, el error se propaga", async () => {
    const { modulo } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [datosProducto(), { orderCreate: { userErrors: [{ message: "inventario insuficiente" }], order: null } }]
    });

    await assert.rejects(() => modulo.crearPedidoCod(SESION, pedidoBase()), /inventario insuficiente/);
  });

  test("devuelve el número de orden para mostrarle al cliente", async () => {
    const { modulo } = montar("cod.js", {
      tiendas: tiendaConCod(),
      respuestas: [datosProducto(), PEDIDO_OK]
    });

    const r = await modulo.crearPedidoCod(SESION, pedidoBase());
    assert.equal(r.orden, "#1001");
    assert.equal(r.id, "gid://shopify/Order/1");
  });
});

describe("configDefault y mezcla", () => {
  test("una tienda sin config guardada hereda el default completo", async () => {
    const { modulo } = montar("cod.js", { tiendas: { [TIENDA]: { token: "t" } } });

    const cfg = await modulo.leerConfigCod(TIENDA);
    assert.equal(cfg.activo, false, "el formulario no puede nacer prendido");
    assert.ok(Array.isArray(cfg.campos) && cfg.campos.length > 0);
    assert.ok(cfg.textos.titulo);
  });

  test("lo guardado pisa al default sin perder las claves nuevas", async () => {
    const { modulo } = montar("cod.js", {
      tiendas: { [TIENDA]: { token: "t", cod: { activo: true, textos: { titulo: "Mi título" } } } }
    });

    const cfg = await modulo.leerConfigCod(TIENDA);
    assert.equal(cfg.activo, true);
    assert.equal(cfg.textos.titulo, "Mi título");
    assert.ok(cfg.textos.cta, "una clave que la tienda no guardó tiene que venir del default");
  });

  test("no se puede guardar config de una tienda sin instalar", async () => {
    const { modulo } = montar("cod.js", { tiendas: {} });
    await assert.rejects(() => modulo.guardarConfigCod(TIENDA, { activo: true }), /no está instalada/);
  });
});
