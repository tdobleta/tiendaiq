// ============================================================
// ADAPTADOR DE PÁGINA — envoltorio persistido v0 ↔ documento v1.
//
// El repositorio histórico guarda metadatos de publicación junto con `data`.
// El núcleo nuevo trabaja solo con el documento versionado. Este módulo es la
// frontera explícita entre ambos mundos durante la migración: lee un documento
// v1 si ya existe y, si no, migra la página histórica sin mutarla.
//
// La escritura v1 es deliberadamente transitoria. Se conserva el `data` viejo
// para que el renderer/publicador actual no reciba un documento que todavía no
// sabe interpretar. Cuando el catálogo Piloto esté portado al registro, esta
// frontera será reemplazada por una única columna canónica.
// ============================================================

"use strict";

const documento = require("../documento");

function pareceDocumento(valor) {
  return !!valor && typeof valor === "object" && Number.isInteger(valor.version) && Array.isArray(valor.arbol);
}

function documentoDePagina(pagina) {
  if (!pagina || typeof pagina !== "object") {
    throw new documento.DocumentoInvalido(["la página no es un objeto"]);
  }

  const candidato = pagina.documento_borrador || pagina.documento ||
    (pareceDocumento(pagina) ? pagina : null) ||
    (pareceDocumento(pagina.data) ? pagina.data : null) || pagina.data?.documento;
  // Leer también valida: el inspector no debe recibir un árbol que el
  // renderer o el próximo PUT rechazarían. `validar` devuelve una copia, por
  // lo que la página persistida nunca se modifica al abrirla.
  return documento.validar(documento.migrar(candidato || pagina));
}

function guardarBorradorV1(pagina, candidato, { tienda = null, productoId = null } = {}) {
  const migrado = documento.migrar(candidato);
  const validado = documento.validar(migrado);

  if (pagina.id && validado.id !== pagina.id) {
    throw new documento.DocumentoInvalido(["/id no coincide con la página que se está editando"]);
  }
  if (tienda && validado.tienda !== tienda) {
    throw new documento.DocumentoInvalido(["/tienda no coincide con la sesión actual"]);
  }
  if (productoId && validado.producto_id !== productoId) {
    throw new documento.DocumentoInvalido(["/producto_id no coincide con el producto de la página"]);
  }

  return {
    ...pagina,
    documento_borrador: validado,
    editor_version: validado.version,
    // El resumen histórico todavía lo consume la lista. Mantener el título
    // sincronizado evita que el editor nuevo y la tabla muestren nombres
    // distintos durante esta etapa de compatibilidad.
    ...(validado.titulo ? { titulo: validado.titulo } : {})
  };
}

module.exports = { documentoDePagina, guardarBorradorV1, pareceDocumento };
