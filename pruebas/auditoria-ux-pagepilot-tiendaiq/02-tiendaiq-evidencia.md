# Evidencia TiendaIQ

## Hechos observados

- La página carga `Info principal producto (32)` como sección protegida y dos secciones reutilizables posteriores.
- El árbol permite expandir/contraer la composición protegida y mostrar sus bloques internos.
- El inspector permite editar bloques y el valor sobrevive a cerrar/reabrir después de guardar.
- El botón global `Añadir sección` y el botón contextual abren la misma biblioteca; el contexto cambia el índice de inserción.
- `Añadir bloque` inserta el bloque en la sección seleccionada y el historial permite deshacerlo.
- El reordenamiento por teclado cambió árbol y preview juntos y pudo deshacerse.
- Vista móvil y preview completo conservan el contexto del editor.
- La primera sección permanece protegida.

## Diferencias y riesgos

- El arrastre físico directo sobre una fila no quedó certificado con la automatización disponible dentro del iframe.
- El proyecto conserva un editor anterior con otro modelo de árbol y otra biblioteca; una mejora aplicada solo a `/editor-secciones` no garantiza paridad en todas las rutas.
- La entrada `/editor-v3` redirige a `/editor-secciones` cuando la página ya contiene `section_page`; el editor anterior queda para páginas legacy. Esto reduce el riesgo de mezcla dentro de una misma página, pero deja una deuda de migración y de consistencia visual entre generaciones.
- Algunas ramas internas se representan visualmente como grupos, pero sus bloques se almacenan en una lista plana de la sección. Debe probarse que el destino semántico coincida con la rama que el usuario tenía seleccionada.
- La biblioteca de TiendaIQ necesita previews más informativas y estados de disponibilidad más explicativos para acercarse a PagePilot.

## Estado actual

La base de sección, inserción contextual, persistencia, historial y preview está operativa en el editor nuevo. La paridad de drag físico, la unificación de rutas antiguas y la profundidad visual de la biblioteca siguen siendo líneas de trabajo independientes.
