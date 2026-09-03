// ============================================================
// COMANDOS — el estado del editor y todo lo que se le puede hacer (I5).
//
// Nadie muta el documento a mano. Cada cambio es un comando, y de esa única
// regla salen tres cosas sin escribir código extra:
//
//   · deshacer/rehacer     (cada comando guarda el estado anterior)
//   · el botón Guardar      (sucio = el documento difiere del último sello)
//   · guardado por diff     (se sabe exactamente qué cambió y cuándo)
//
// Si mañana alguien edita `doc.arbol[0].props.x = 3` desde un control "porque
// era más rápido", ese cambio no entra al historial: el merchant aprieta
// deshacer, no pasa nada, y deja de confiar en el editor.
//
// -------- fusión de comandos --------
//
// Escribir "Camisa de oficina" son 18 pulsaciones. Sin fusión, deshacer borra
// una letra por vez y el merchant aprieta 18 veces. Los comandos consecutivos
// sobre el MISMO campo del MISMO nodo dentro de MS_FUSION se colapsan en una
// sola entrada del historial. Es exactamente lo que hace cualquier editor
// maduro, y su ausencia se nota en el primer minuto de uso.
// ============================================================

"use strict";

// Se requiere nucleo/nodos y NO nucleo/documento a propósito: el validador
// vive en el borde del backend y no viaja al navegador (ver nucleo/nodos.js).
const { crearNodo, nuevoId } = require("../../nucleo/nodos");
const registro = require("../../nucleo/registro");

const MS_FUSION = 600;
const MAX_HISTORIAL = 100;   // tope de memoria: 100 pasos es más de lo que nadie deshace

const clonar = (valor) => JSON.parse(JSON.stringify(valor));
const sello = (doc) => JSON.stringify(doc);

// Devuelve dónde vive un nodo: su padre, la lista que lo contiene y su índice.
// El padre null significa que cuelga de la raíz.
function localizar(doc, id, lista = doc.arbol, padre = null) {
  for (let i = 0; i < lista.length; i++) {
    const nodo = lista[i];
    if (nodo.id === id) return { nodo, padre, lista, indice: i };
    if (nodo.hijos && nodo.hijos.length) {
      const encontrado = localizar(doc, id, nodo.hijos, nodo);
      if (encontrado) return encontrado;
    }
  }
  return null;
}

function recorrer(lista, fn, padre = null) {
  for (const nodo of lista || []) {
    fn(nodo, padre);
    if (nodo.hijos) recorrer(nodo.hijos, fn, nodo);
  }
}

function contarPorTipo(doc, tipo) {
  let total = 0;
  recorrer(doc.arbol, (nodo) => { if (nodo.tipo === tipo) total++; });
  return total;
}

// Un duplicado necesita ids nuevos en todo el subárbol: dos nodos con el mismo
// id rompen la selección, el CSS responsive y el guardado.
function conIdsNuevos(nodo) {
  const copia = clonar(nodo);
  recorrer([copia], (n) => { n.id = nuevoId(); });
  return copia;
}

// ¿Este tipo entra una vez más en la página? Es lo que pinta el "1/1" en la
// librería de secciones.
function puedeInsertar(doc, tipo) {
  if (!registro.existe(tipo)) return false;
  const limite = registro.definicion(tipo).limite_por_pagina;
  if (!limite) return true;
  return contarPorTipo(doc, tipo) < limite;
}

function crearEstado(documentoInicial, { alCambiar = null } = {}) {
  let doc = clonar(documentoInicial);
  let seleccion = null;
  let viewport = "escritorio";
  let selloGuardado = sello(doc);

  const historial = [];   // { antes, etiqueta, fusion, ts }
  const rehacer = [];
  const oyentes = alCambiar ? [alCambiar] : [];

  function avisar(motivo) {
    for (const oyente of oyentes) oyente({ documento: doc, seleccion, viewport, motivo });
  }

  // El único camino por el que cambia el documento.
  function aplicar(mutar, { etiqueta, fusion = null } = {}) {
    const antes = clonar(doc);
    const borrador = clonar(doc);
    const resultado = mutar(borrador);
    if (resultado === false) return false;   // el comando decidió no hacer nada

    const ultimo = historial[historial.length - 1];
    const fusiona = fusion && ultimo && ultimo.fusion === fusion && Date.now() - ultimo.ts < MS_FUSION;

    if (fusiona) {
      ultimo.ts = Date.now();          // se extiende la entrada, no se agrega otra
    } else {
      historial.push({ antes, etiqueta, fusion, ts: Date.now() });
      if (historial.length > MAX_HISTORIAL) historial.shift();
    }
    rehacer.length = 0;                // una acción nueva invalida el futuro
    doc = borrador;
    avisar(etiqueta);
    return true;
  }

  // ---------- props ----------

  // Escribir un valor lo convierte en override. Pasar `undefined` lo borra, que
  // es lo que hace el micro-toggle al apagarse: el campo vuelve a heredar.
  function fijarProp(nodoId, clave, valor) {
    const ubicacion = localizar(doc, nodoId);
    if (!ubicacion) return false;
    const campo = registro.definicion(ubicacion.nodo.tipo).porClave[clave];
    if (!campo) return false;

    // Un campo no responsive siempre escribe en props, aunque el editor esté
    // mirando móvil: si no, el merchant cambiaría un texto en la vista de
    // celular y en escritorio seguiría el viejo.
    const enMovil = viewport === "movil" && campo.responsive;
    const bolsa = enMovil ? "props_movil" : "props";

    return aplicar((borrador) => {
      const nodo = localizar(borrador, nodoId).nodo;
      if (valor === undefined) {
        if (!nodo[bolsa] || !(clave in nodo[bolsa])) return false;
        delete nodo[bolsa][clave];
        if (bolsa === "props_movil" && Object.keys(nodo.props_movil).length === 0) delete nodo.props_movil;
      } else {
        if (!nodo[bolsa]) nodo[bolsa] = {};
        nodo[bolsa][clave] = valor;
      }
    }, {
      etiqueta: valor === undefined ? `heredar ${clave}` : `cambiar ${clave}`,
      fusion: valor === undefined ? null : `${nodoId}:${bolsa}:${clave}`
    });
  }

  const heredarProp = (nodoId, clave) => fijarProp(nodoId, clave, undefined);

  // ---------- estructura ----------

  function insertar(tipo, { padreId = null, indice = null } = {}) {
    if (!puedeInsertar(doc, tipo)) return false;
    if (padreId) {
      const padre = localizar(doc, padreId);
      if (!padre || !registro.definicion(padre.nodo.tipo).admite_hijos) return false;
    }
    const nuevo = crearNodo(tipo);
    const hecho = aplicar((borrador) => {
      const lista = padreId ? localizar(borrador, padreId).nodo.hijos : borrador.arbol;
      lista.splice(indice === null ? lista.length : indice, 0, nuevo);
    }, { etiqueta: `agregar ${tipo}` });
    if (hecho) seleccionar(nuevo.id);
    return hecho ? nuevo.id : false;
  }

  function borrar(nodoId) {
    const ubicacion = localizar(doc, nodoId);
    if (!ubicacion) return false;
    const hecho = aplicar((borrador) => {
      const donde = localizar(borrador, nodoId);
      donde.lista.splice(donde.indice, 1);
    }, { etiqueta: `borrar ${ubicacion.nodo.tipo}` });
    if (hecho && seleccion === nodoId) seleccionar(null);
    return hecho;
  }

  function duplicar(nodoId) {
    const ubicacion = localizar(doc, nodoId);
    if (!ubicacion) return false;
    if (!puedeInsertar(doc, ubicacion.nodo.tipo)) return false;
    const copia = conIdsNuevos(ubicacion.nodo);
    const hecho = aplicar((borrador) => {
      const donde = localizar(borrador, nodoId);
      donde.lista.splice(donde.indice + 1, 0, copia);
    }, { etiqueta: `duplicar ${ubicacion.nodo.tipo}` });
    if (hecho) seleccionar(copia.id);
    return hecho ? copia.id : false;
  }

  // Mover valida que el destino admita hijos y —lo importante— que no se esté
  // metiendo un nodo dentro de sí mismo, que dejaría el árbol en un ciclo y
  // colgaría el render.
  function mover(nodoId, { padreId = null, indice = 0 } = {}) {
    const ubicacion = localizar(doc, nodoId);
    if (!ubicacion) return false;
    if (padreId) {
      if (padreId === nodoId) return false;
      const destino = localizar(doc, padreId);
      if (!destino || !registro.definicion(destino.nodo.tipo).admite_hijos) return false;
      if (localizar(doc, padreId, [ubicacion.nodo])) return false;   // el destino cuelga del que se mueve
    }
    return aplicar((borrador) => {
      const desde = localizar(borrador, nodoId);
      const mismoPadre = (desde.padre ? desde.padre.id : null) === padreId;
      desde.lista.splice(desde.indice, 1);
      const lista = padreId ? localizar(borrador, padreId).nodo.hijos : borrador.arbol;
      // Al sacarlo primero, un índice posterior dentro de la misma lista se corre uno.
      const destino = mismoPadre && indice > desde.indice ? indice - 1 : indice;
      lista.splice(Math.max(0, Math.min(destino, lista.length)), 0, desde.nodo);
    }, { etiqueta: "mover bloque" });
  }

  // ---------- documento ----------

  function fijarBranding(clave, valor) {
    return aplicar((borrador) => {
      if (!borrador.branding) borrador.branding = {};
      if (clave.startsWith("tokens.")) {
        const token = clave.slice(7);
        if (!borrador.branding.tokens) borrador.branding.tokens = {};
        if (valor === undefined) delete borrador.branding.tokens[token];
        else borrador.branding.tokens[token] = valor;
      } else if (clave.startsWith("tipografia.")) {
        const fuente = clave.slice("tipografia.".length);
        if (!borrador.branding.tipografia) borrador.branding.tipografia = {};
        if (valor === undefined) delete borrador.branding.tipografia[fuente];
        else borrador.branding.tipografia[fuente] = valor;
      } else {
        borrador.branding[clave] = valor;
      }
    }, { etiqueta: `marca: ${clave}`, fusion: `branding:${clave}` });
  }

  function fijarSeo(clave, valor) {
    return aplicar((borrador) => {
      if (!borrador.seo) borrador.seo = {};
      borrador.seo[clave] = valor;
    }, { etiqueta: `seo: ${clave}`, fusion: `seo:${clave}` });
  }

  // ---------- historial ----------

  function deshacerUno() {
    const entrada = historial.pop();
    if (!entrada) return false;
    rehacer.push({ ...entrada, antes: clonar(doc) });
    doc = entrada.antes;
    if (seleccion && !localizar(doc, seleccion)) seleccion = null;
    avisar("deshacer");
    return true;
  }

  function rehacerUno() {
    const entrada = rehacer.pop();
    if (!entrada) return false;
    historial.push({ ...entrada, antes: clonar(doc) });
    doc = entrada.antes;
    if (seleccion && !localizar(doc, seleccion)) seleccion = null;
    avisar("rehacer");
    return true;
  }

  // ---------- selección y vista ----------

  function seleccionar(id) {
    if (id !== null && !localizar(doc, id)) return false;
    seleccion = id;
    avisar("seleccion");
    return true;
  }

  function fijarViewport(nuevo) {
    if (nuevo !== "escritorio" && nuevo !== "movil") return false;
    viewport = nuevo;
    avisar("viewport");
    return true;
  }

  return {
    // lectura
    documento: () => doc,
    nodo: (id) => { const u = localizar(doc, id); return u ? u.nodo : null; },
    nodoSeleccionado: () => (seleccion ? localizar(doc, seleccion).nodo : null),
    seleccion: () => seleccion,
    viewport: () => viewport,
    puedeInsertar: (tipo) => puedeInsertar(doc, tipo),
    ubicacion: (id) => localizar(doc, id),

    // comandos
    fijarProp, heredarProp, insertar, borrar, duplicar, mover, fijarBranding, fijarSeo,

    // historial
    deshacer: deshacerUno,
    rehacer: rehacerUno,
    puedeDeshacer: () => historial.length > 0,
    puedeRehacer: () => rehacer.length > 0,
    pasosDeshacer: () => historial.length,

    // guardado
    hayCambios: () => sello(doc) !== selloGuardado,
    marcarGuardado: () => { selloGuardado = sello(doc); avisar("guardado"); },

    // vista
    seleccionar, fijarViewport,
    suscribir: (fn) => { oyentes.push(fn); return () => oyentes.splice(oyentes.indexOf(fn), 1); }
  };
}

module.exports = { crearEstado, localizar, recorrer, puedeInsertar, conIdsNuevos, MS_FUSION };
