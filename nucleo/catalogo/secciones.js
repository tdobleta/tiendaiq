// ============================================================
// COMPOSICIONES DE SECCIÓN — datos del catálogo, no lógica del editor.
//
// Una tarjeta de la librería puede representar un árbol completo. El merchant
// agrega una composición lista para editar y luego abre sus grupos y bloques;
// no empieza frente a una hoja en blanco. Las definiciones de los tipos siguen
// viviendo en `nucleo/tipos/`; este archivo solo describe cómo se combinan.
//
// Los specs no guardan ids: al insertar se materializan con ids nuevos. Los
// props que se declaran son overrides de contenido o estructura intencionales;
// los defaults de cada tipo se aplican en el comando de inserción.
// ============================================================

"use strict";

const COMPOSICIONES = [
  {
    id: "hero_producto",
    nombre: "Héroe del producto",
    categoria: "producto",
    icono: "galeria",
    limite_por_pagina: null,
    arbol: [{
      tipo: "seccion",
      props: { ancho: "pagina", ancho_contenido: "pagina", direccion: "horizontal", gap: 32 },
      hijos: [
        { tipo: "galeria_producto", props: {} },
        {
          tipo: "grupo",
          props: { direccion: "vertical", gap: 16 },
          hijos: [
            { tipo: "titulo_producto", props: {} },
            { tipo: "precio_producto", props: {} },
            { tipo: "beneficios_producto", props: {} },
            { tipo: "packs_compra", props: {} },
            { tipo: "boton_carrito", props: {} }
          ]
        }
      ]
    }]
  },
  {
    id: "beneficios_producto",
    nombre: "Beneficios destacados",
    categoria: "beneficios",
    icono: "beneficios",
    limite_por_pagina: null,
    arbol: [{
      tipo: "seccion",
      props: { ancho: "pagina", ancho_contenido: "pagina", direccion: "vertical", gap: 16 },
      hijos: [{
        tipo: "grupo",
        props: { direccion: "vertical", gap: 16 },
        hijos: [{ tipo: "beneficios_producto", props: {} }]
      }]
    }]
  },
  {
    id: "linea_tiempo_producto",
    nombre: "Línea de tiempo",
    categoria: "beneficios",
    icono: "tiempo",
    limite_por_pagina: null,
    arbol: [{
      tipo: "seccion",
      props: { ancho: "pagina", ancho_contenido: "pagina", direccion: "vertical", gap: 16 },
      hijos: [{
        tipo: "grupo",
        props: { direccion: "vertical", gap: 16 },
        hijos: [{ tipo: "linea_tiempo", props: {} }]
      }]
    }]
  },
  {
    id: "resenas_producto",
    nombre: "Reseñas destacadas",
    categoria: "prueba_social",
    icono: "carrusel",
    limite_por_pagina: null,
    arbol: [{
      tipo: "seccion",
      props: { ancho: "pagina", ancho_contenido: "pagina", direccion: "vertical", gap: 24 },
      hijos: [{
        tipo: "grupo",
        props: { direccion: "vertical", gap: 16 },
        hijos: [{
          // La lista nace vacía a propósito: las reseñas son evidencia del
          // merchant, nunca copy que la plantilla pueda inventar.
          tipo: "carrusel_resenas",
          props: { titulo: "Lo que dicen quienes ya lo probaron" }
        }]
      }]
    }]
  },
  {
    id: "faq_producto",
    nombre: "Preguntas frecuentes",
    categoria: "faq",
    icono: "faq",
    limite_por_pagina: null,
    arbol: [{
      tipo: "seccion",
      props: { ancho: "pagina", ancho_contenido: "pagina", direccion: "vertical", gap: 16 },
      hijos: [{
        tipo: "grupo",
        props: { direccion: "vertical", gap: 12 },
        hijos: [{
          tipo: "acordeon_faq",
          props: { titulo: "Preguntas frecuentes" }
        }]
      }]
    }]
  },
  {
    id: "garantia_urgencia",
    nombre: "Garantía y urgencia",
    categoria: "garantia",
    icono: "garantia",
    limite_por_pagina: null,
    arbol: [{
      tipo: "seccion",
      props: { ancho: "pagina", ancho_contenido: "pagina", direccion: "vertical", gap: 16 },
      hijos: [{
        tipo: "grupo",
        props: { direccion: "vertical", gap: 16 },
        hijos: [
          { tipo: "garantia", props: { titulo: "Compra tranquila" } },
          { tipo: "contador_oferta", props: { texto: "La oferta finaliza en", minutos: 60 } }
        ]
      }]
    }]
  }
];

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function todas() {
  return COMPOSICIONES.map(({ arbol, ...meta }) => ({
    ...meta,
    tipo: `composicion:${meta.id}`,
    composicion_id: meta.id,
    admite_hijos: false
  }));
}

function existe(id) {
  return COMPOSICIONES.some((composicion) => composicion.id === id);
}

function arbolDe(id) {
  const composicion = COMPOSICIONES.find((item) => item.id === id);
  return composicion ? clonar(composicion.arbol) : null;
}

module.exports = { todas, existe, arbolDe };
