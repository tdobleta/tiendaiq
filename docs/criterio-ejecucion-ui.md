# Criterio de ejecucion UI

Este documento es una regla interna para construir y revisar la interfaz de TiendaIQ.
No es contenido para mostrar dentro de la app.

## Regla principal

La interfaz debe parecer hecha por un equipo de producto de Shopify, no por una IA que
explica su propio razonamiento. La pantalla resuelve una tarea; no comenta la estrategia
que hay detras de cada campo.

## Como se ejecuta

- Usar primero la jerarquia visual, el nombre del campo y el estado del control para
  comunicar. No agregar una tarjeta, aviso o parrafo si el control ya se entiende.
- Mantener el texto visible corto, concreto y operativo: nombres, valores, acciones,
  estados y errores. Evitar frases que empiecen por "la IA", "esto ayuda", "elegi",
  "revisa", "manten", "organiza" o que intenten justificar una decision de diseño.
- No escribir consejos de copywriting dentro del editor. El usuario edita el contenido;
  el producto debe darle controles claros, no una mini clase sobre conversion.
- Reservar la ayuda contextual para restricciones reales de formato, carga o validacion.
  Debe decir que admite el control, no explicar por que conviene usarlo.
- La funcion de IA se ofrece como una accion puntual junto al texto editable. El resultado
  debe respetar el tipo de bloque, el producto, el idioma, el publico y el campo actual.
  Nunca debe devolver la pregunta cuando se esta editando una respuesta.
- Seguir patrones de Shopify Admin: system-ui, contraste sobrio, bordes finos, controles
  compactos, acciones nativas y estados visibles. Sin gradientes decorativos, slogans,
  chips redundantes ni avisos de relleno.
- Antes de cerrar un cambio, revisar la pantalla como cliente: quitar todo texto que no
  permita editar, decidir, validar o completar una accion.

## Revision obligatoria

1. Leer todos los textos nuevos en la pantalla, incluidos estados vacios, tooltips y
   modales.
2. Preguntar para cada uno: "Que tarea habilita este texto?" Si la respuesta es ninguna,
   eliminarlo. Si habilita una tarea, reducirlo a la instruccion minima.
3. Comprobar que los textos no repitan informacion que ya expresa el layout o el control.
4. Probar la accion completa, no solo la apariencia: seleccion, edicion, IA, guardado,
   error y vista previa.
