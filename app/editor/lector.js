// ============================================================
// LECTOR — el puente entre el DOM del panel y `parsear`.
//
// Es la única parte de la capa de UI que toca el DOM de verdad, y a propósito
// no hace nada más que juntar valores crudos: quién es checkbox, quién es
// contenteditable, quién es un segmentado. La conversión a valor tipado la hace
// controles.parsear(), que es puro y está testeado.
//
// Esa división importa: los formularios se rompen en la conversión de tipos
// ("" vs 0 vs null), no en leer un .value. Manteniendo la conversión afuera del
// DOM, la parte frágil tiene tests y la parte aburrida no los necesita.
// ============================================================

"use strict";

const { parsear } = require("./controles");

function valorDeParte(el) {
  if (!el) return undefined;
  if (el.classList && el.classList.contains("ed-seg")) return el.dataset.valor || "";
  if (el.isContentEditable) return el.innerHTML;
  if (el.type === "checkbox") return el.checked;
  return el.value;
}

// Las partes que cuelgan de un contenedor, sin bajar a las de un item de lista
// anidado (esas las junta leerLista).
function partesDirectas(raiz) {
  const partes = {};
  for (const el of raiz.querySelectorAll("[data-parte]")) {
    if (el.closest(".ed-lista__item") && !raiz.classList.contains("ed-lista__item")) continue;
    partes[el.dataset.parte] = valorDeParte(el);
  }
  return partes;
}

function leerLista(elCampo, campo) {
  const items = [];
  for (const elItem of elCampo.querySelectorAll(".ed-lista__item")) {
    const item = {};
    for (const sub of campo.item_campos) {
      const elSub = elItem.querySelector(`[data-subcampo="${sub.clave}"]`);
      item[sub.clave] = elSub ? partesDirectas(elSub) : {};
    }
    items.push(item);
  }
  return { items };
}

// Lee un campo completo del panel y devuelve el valor ya tipado, listo para
// entrar al documento por un comando.
function leerCampo(elCampo, campo) {
  const partes = campo.tipo === "lista" ? leerLista(elCampo, campo) : partesDirectas(elCampo);
  return parsear(campo, partes);
}

module.exports = { leerCampo, partesDirectas, valorDeParte };
