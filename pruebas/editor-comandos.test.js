// ============================================================
// COMANDOS DEL EDITOR — historial, fusión y estructura del árbol.
//
// Lo que se protege acá es la confianza del merchant en el editor. Un
// deshacer que borra una letra por vez, un duplicar que repite ids, o un mover
// que mete una sección dentro de sí misma no se ven como bugs de código: se ven
// como "esta app está rota". Cada uno tiene su test.
// ============================================================

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { crearEstado, localizar, conIdsNuevos } = require("../app/editor/comandos");
const documento = require("../nucleo/documento");
const registro = require("../nucleo/registro");

function docBase() {
  const doc = documento.crear({ tienda: "prueba.myshopify.com" });
  doc.arbol = [{
    id: "n_11111111", tipo: "seccion", props: {}, hijos: [
      { id: "n_22222222", tipo: "texto", props: { html: "Hola" } },
      { id: "n_33333333", tipo: "imagen", props: { imagen: { src: "https://x/a.jpg", alt: "a" } } }
    ]
  }];
  return doc;
}

describe("props: escribir, heredar y a dónde va cada cosa", () => {
  test("fijar un valor lo escribe como override en props", () => {
    const ed = crearEstado(docBase());
    ed.fijarProp("n_22222222", "tamano", 24);
    assert.equal(ed.nodo("n_22222222").props.tamano, 24);
  });

  test("en móvil, un campo responsive escribe en props_movil", () => {
    const ed = crearEstado(docBase());
    ed.fijarViewport("movil");
    ed.fijarProp("n_22222222", "tamano", 12);
    assert.equal(ed.nodo("n_22222222").props_movil.tamano, 12);
    assert.equal(ed.nodo("n_22222222").props.tamano, undefined);
  });

  // Si el texto se guardara por viewport, el merchant corrige una frase mirando
  // el celular y en escritorio sigue la vieja. Es un bug que tarda semanas en
  // aparecer y arruina la confianza en el editor.
  test("en móvil, un campo NO responsive igual escribe en props", () => {
    const ed = crearEstado(docBase());
    ed.fijarViewport("movil");
    ed.fijarProp("n_22222222", "html", "Cambiado");
    assert.equal(ed.nodo("n_22222222").props.html, "Cambiado");
    assert.equal(ed.nodo("n_22222222").props_movil, undefined);
  });

  test("heredar borra la clave y deja el bloque siguiendo a la marca", () => {
    const ed = crearEstado(docBase());
    ed.fijarProp("n_22222222", "tamano", 24);
    ed.heredarProp("n_22222222", "tamano");
    assert.equal("tamano" in ed.nodo("n_22222222").props, false);
  });

  test("heredar el último override móvil borra props_movil entero", () => {
    const ed = crearEstado(docBase());
    ed.fijarViewport("movil");
    ed.fijarProp("n_22222222", "tamano", 12);
    ed.heredarProp("n_22222222", "tamano");
    assert.equal(ed.nodo("n_22222222").props_movil, undefined, "un objeto vacío ensucia el documento y el diff");
  });

  test("una clave que el tipo no declara se rechaza", () => {
    const ed = crearEstado(docBase());
    assert.equal(ed.fijarProp("n_22222222", "inventada", 1), false);
  });
});

describe("historial", () => {
  test("deshacer y rehacer devuelven el documento exacto", () => {
    const ed = crearEstado(docBase());
    ed.fijarProp("n_22222222", "tamano", 24);
    ed.deshacer();
    assert.equal(ed.nodo("n_22222222").props.tamano, undefined);
    ed.rehacer();
    assert.equal(ed.nodo("n_22222222").props.tamano, 24);
  });

  // Escribir una frase son decenas de comandos. Sin fusión, deshacer borra letra
  // por letra y el merchant aprieta veinte veces.
  test("cambios seguidos sobre el mismo campo son UN paso de historial", () => {
    const ed = crearEstado(docBase());
    for (const texto of ["C", "Ca", "Cam", "Cami"]) ed.fijarProp("n_22222222", "html", texto);
    assert.equal(ed.pasosDeshacer(), 1);
    ed.deshacer();
    assert.equal(ed.nodo("n_22222222").props.html, "Hola", "vuelve al valor previo a toda la tanda");
  });

  test("campos distintos no se fusionan", () => {
    const ed = crearEstado(docBase());
    ed.fijarProp("n_22222222", "html", "A");
    ed.fijarProp("n_22222222", "tamano", 20);
    assert.equal(ed.pasosDeshacer(), 2);
  });

  test("escritorio y móvil no se fusionan entre sí", () => {
    const ed = crearEstado(docBase());
    ed.fijarProp("n_22222222", "tamano", 20);
    ed.fijarViewport("movil");
    ed.fijarProp("n_22222222", "tamano", 12);
    assert.equal(ed.pasosDeshacer(), 2);
  });

  test("una acción nueva invalida el rehacer pendiente", () => {
    const ed = crearEstado(docBase());
    ed.fijarProp("n_22222222", "tamano", 24);
    ed.deshacer();
    assert.equal(ed.puedeRehacer(), true);
    ed.fijarProp("n_22222222", "peso", "bold");
    assert.equal(ed.puedeRehacer(), false);
  });

  test("deshacer sin historial no rompe nada", () => {
    const ed = crearEstado(docBase());
    assert.equal(ed.deshacer(), false);
    assert.equal(ed.puedeDeshacer(), false);
  });

  test("si deshacer hace desaparecer el nodo seleccionado, se limpia la selección", () => {
    const ed = crearEstado(docBase());
    const id = ed.insertar("texto", { padreId: "n_11111111" });
    assert.equal(ed.seleccion(), id);
    ed.deshacer();
    assert.equal(ed.seleccion(), null, "un panel apuntando a un nodo inexistente reventaría al repintar");
  });
});

describe("estado sucio", () => {
  test("arranca limpio, se ensucia al cambiar y se limpia al guardar", () => {
    const ed = crearEstado(docBase());
    assert.equal(ed.hayCambios(), false);
    ed.fijarProp("n_22222222", "tamano", 24);
    assert.equal(ed.hayCambios(), true);
    ed.marcarGuardado();
    assert.equal(ed.hayCambios(), false);
  });

  test("deshacer hasta el principio deja el documento limpio otra vez", () => {
    const ed = crearEstado(docBase());
    ed.fijarProp("n_22222222", "tamano", 24);
    ed.deshacer();
    assert.equal(ed.hayCambios(), false, "el botón Guardar tiene que apagarse solo");
  });
});

describe("estructura", () => {
  test("insertar agrega, selecciona y devuelve el id nuevo", () => {
    const ed = crearEstado(docBase());
    const id = ed.insertar("texto", { padreId: "n_11111111", indice: 0 });
    assert.equal(ed.nodo("n_11111111").hijos[0].id, id);
    assert.equal(ed.seleccion(), id);
  });

  test("no se puede insertar dentro de un tipo que no admite hijos", () => {
    const ed = crearEstado(docBase());
    assert.equal(ed.insertar("texto", { padreId: "n_22222222" }), false);
  });

  test("duplicar copia el subárbol con ids NUEVOS", () => {
    const ed = crearEstado(docBase());
    const id = ed.duplicar("n_11111111");
    const copia = ed.nodo(id);
    assert.equal(copia.hijos.length, 2);
    const ids = [];
    JSON.stringify(ed.documento(), (clave, valor) => { if (clave === "id" && String(valor).startsWith("n_")) ids.push(valor); return valor; });
    assert.equal(new Set(ids).size, ids.length, "dos nodos con el mismo id rompen selección, CSS y guardado");
  });

  test("borrar quita el nodo y limpia la selección si era ese", () => {
    const ed = crearEstado(docBase());
    ed.seleccionar("n_22222222");
    ed.borrar("n_22222222");
    assert.equal(ed.nodo("n_22222222"), null);
    assert.equal(ed.seleccion(), null);
  });

  test("mover entre padres", () => {
    const doc = docBase();
    doc.arbol.push({ id: "n_44444444", tipo: "seccion", props: {}, hijos: [] });
    const ed = crearEstado(doc);
    ed.mover("n_22222222", { padreId: "n_44444444", indice: 0 });
    assert.equal(ed.nodo("n_44444444").hijos[0].id, "n_22222222");
    assert.equal(ed.nodo("n_11111111").hijos.length, 1);
  });

  test("mover dentro de la misma lista corrige el índice tras sacarlo", () => {
    const ed = crearEstado(docBase());
    ed.mover("n_22222222", { padreId: "n_11111111", indice: 2 });
    assert.deepEqual(ed.nodo("n_11111111").hijos.map((n) => n.id), ["n_33333333", "n_22222222"]);
  });

  // Un ciclo en el árbol cuelga el render con un stack overflow, en la tienda.
  test("no se puede mover un nodo dentro de sí mismo ni de un descendiente", () => {
    const ed = crearEstado(docBase());
    assert.equal(ed.mover("n_11111111", { padreId: "n_11111111" }), false);
    const doc = ed.documento();
    doc.arbol[0].hijos.push({ id: "n_55555555", tipo: "seccion", props: {}, hijos: [] });
    const ed2 = crearEstado(doc);
    assert.equal(ed2.mover("n_11111111", { padreId: "n_55555555" }), false);
  });

  test("el documento resultante sigue siendo válido", () => {
    const ed = crearEstado(docBase());
    ed.insertar("texto", { padreId: "n_11111111" });
    ed.duplicar("n_33333333");
    ed.fijarProp("n_22222222", "tamano", 30);
    assert.doesNotThrow(() => documento.validar(ed.documento()));
  });
});

describe("límites por sección", () => {
  test("un tipo con límite deja de poder insertarse al llegar al tope de la sección", (t) => {
    const definicion = registro.definicion("imagen");
    definicion.limite_por_pagina = 1;
    t.after(() => { definicion.limite_por_pagina = null; });

    const ed = crearEstado(docBase());   // ya trae una imagen
    assert.equal(ed.puedeInsertar("imagen", { padreId: "n_11111111" }), false);
    assert.equal(ed.insertar("imagen", { padreId: "n_11111111" }), false);
    assert.equal(ed.duplicar("n_33333333"), false, "duplicar también cuenta contra el límite");

    ed.borrar("n_33333333");
    assert.equal(ed.puedeInsertar("imagen", { padreId: "n_11111111" }), true);
  });

  test("el límite se reinicia en otra sección", (t) => {
    const definicion = registro.definicion("imagen");
    definicion.limite_por_pagina = 1;
    t.after(() => { definicion.limite_por_pagina = null; });

    const doc = docBase();
    doc.arbol.push({ id: "n_44444444", tipo: "seccion", props: {}, hijos: [] });
    const ed = crearEstado(doc);
    assert.equal(ed.puedeInsertar("imagen", { padreId: "n_44444444" }), true);
    assert.ok(ed.insertar("imagen", { padreId: "n_44444444" }));
    assert.equal(ed.puedeInsertar("imagen", { padreId: "n_44444444" }), false);
  });

  test("insertar una composición materializa el árbol completo con ids nuevos", () => {
    const ed = crearEstado(documento.crear({ tienda: "prueba.myshopify.com" }));
    const id = ed.insertarComposicion("hero_producto");
    assert.ok(id);
    assert.equal(ed.documento().arbol.length, 1);
    const hero = ed.nodo(id);
    assert.equal(hero.tipo, "seccion");
    assert.equal(hero.hijos.some((nodo) => nodo.tipo === "grupo"), true);
    assert.doesNotThrow(() => documento.validar(ed.documento()));
  });

  test("dos composiciones no comparten sus semillas anidadas", () => {
    const ed = crearEstado(documento.crear({ tienda: "prueba.myshopify.com" }));
    const primero = ed.insertarComposicion("hero_producto");
    const segundo = ed.insertarComposicion("hero_producto");
    const packs = (id) => {
      const hero = ed.nodo(id);
      const grupo = hero.hijos.find((nodo) => nodo.tipo === "grupo");
      return grupo.hijos.find((nodo) => nodo.tipo === "packs_compra");
    };
    packs(primero).props.packs[0].titulo = "Uno";
    assert.notEqual(packs(segundo).props.packs[0].titulo, "Uno");
  });

  test("una composición desconocida no modifica el documento", () => {
    const ed = crearEstado(documento.crear());
    assert.equal(ed.insertarComposicion("no-existe"), false);
    assert.equal(ed.documento().arbol.length, 0);
  });
});

describe("branding y seo", () => {
  test("cambiar el preset entra al historial como cualquier otro cambio", () => {
    const ed = crearEstado(docBase());
    ed.fijarBranding("preset", "azul");
    assert.equal(ed.documento().branding.preset, "azul");
    ed.deshacer();
    assert.equal(ed.documento().branding.preset, "verde");
  });

  test("un token override se escribe bajo branding.tokens", () => {
    const ed = crearEstado(docBase());
    ed.fijarBranding("tokens.titulos", "#112233");
    assert.equal(ed.documento().branding.tokens.titulos, "#112233");
    ed.fijarBranding("tokens.titulos", undefined);
    assert.equal("titulos" in ed.documento().branding.tokens, false);
  });

  test("la fuente se escribe bajo branding.tipografia", () => {
    const ed = crearEstado(docBase());
    ed.fijarBranding("tipografia.titulos", "serif");
    assert.equal(ed.documento().branding.tipografia.titulos, "serif");
    assert.equal(Object.hasOwn(ed.documento().branding, "tipografia.titulos"), false);
  });

  test("el seo se guarda en el documento", () => {
    const ed = crearEstado(docBase());
    ed.fijarSeo("descripcion", "Camisa cómoda");
    assert.equal(ed.documento().seo.descripcion, "Camisa cómoda");
  });
});

describe("utilidades", () => {
  test("localizar devuelve padre, lista e índice", () => {
    const doc = docBase();
    const u = localizar(doc, "n_33333333");
    assert.equal(u.padre.id, "n_11111111");
    assert.equal(u.indice, 1);
  });

  test("conIdsNuevos no toca el original", () => {
    const doc = docBase();
    const copia = conIdsNuevos(doc.arbol[0]);
    assert.notEqual(copia.id, doc.arbol[0].id);
    assert.equal(doc.arbol[0].id, "n_11111111");
  });

  test("el estado no comparte referencias con el documento que recibió", () => {
    const doc = docBase();
    const ed = crearEstado(doc);
    ed.fijarProp("n_22222222", "tamano", 24);
    assert.equal(doc.arbol[0].hijos[0].props.tamano, undefined);
  });
});
