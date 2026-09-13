# Auditoría UX: editor de secciones PagePilot / TiendaIQ

Fecha de ejecución: 12–13 de septiembre de 2026  
Entorno TiendaIQ: Partner Staging, producto `9390316716265`  
Objetivo: recorrer el editor como cliente, comparar el comportamiento observable con PagePilot y convertir cada expectativa en un criterio comprobable.

## Regla de lectura

Las capturas de PagePilot son referencias visuales y de comportamiento. No se copió código interno de PagePilot. Se compararon únicamente interacciones visibles: árbol, inspector, inserción, edición, vista previa, móvil, historial y reordenamiento.

## Recorrido realizado en PagePilot

1. Abrí el editor de una página de producto y esperé a que cargaran el árbol y la vista previa.
2. Revisé la estructura inicial: una sección raíz protegida (`Product Information`) y varias secciones raíz reordenables con sus cantidades de elementos.
3. Seleccioné `As Seen On (21)`. El inspector cambió al contexto de esa sección y mostró edición del título, desktop/móvil, layout, contenido, fondo, spacing y eliminación.
4. Abrí `Editar título`, escribí `As Seen On — QA` y confirmé con `Enter`. El árbol no reflejó el cambio hasta confirmar el campo; el botón de guardado quedó habilitado.
5. Abrí un `Heading` anidado dentro de la sección, edité su texto a `QA Headline` y comprobé que el preview mostró las coincidencias y que el cambio ensució el estado de guardado.
6. Cambié a móvil. El inspector expuso controles específicos de móvil, incluido tamaño, alineación y padding móvil.
7. Mantuve una sección raíz y la solté directamente sobre otra fila raíz. PagePilot aceptó el destino sin exigir que el cursor cayese sobre una línea independiente; el orden del árbol cambió y la vista previa se reordenó.
8. Intenté abrir la biblioteca con `Añadir sección` desde distintos contextos. En esta sesión concreta no apareció una biblioteca textual de forma concluyente; por eso no se marca como comportamiento confirmado de PagePilot y debe repetirse con una sesión limpia si se necesita copiar ese detalle.
9. Cerré la sesión de prueba sin publicar los nombres de QA.

### Modelo observable de PagePilot

- La fila raíz es la unidad de arrastre.
- La primera sección protegida no se trata como una sección normal.
- Una sección puede contener grupos, bloques y bloques repetibles.
- El inspector cambia según sección, grupo, bloque y dispositivo.
- El reordenamiento se entiende como “tomar una fila y soltarla sobre otra”, no como “encontrar una ranura invisible”.

## Recorrido realizado en TiendaIQ

1. Abrí una sesión nueva del editor de Partner Staging y esperé la carga completa del árbol, inspector y preview.
2. Verifiqué el estado inicial: `Info principal producto (32)` protegida/expandida, `Testimonios con imágenes (8)` y `Carrusel de reseñas (12)` como secciones raíz.
3. Seleccioné un bloque `Beneficio`. El inspector mostró los campos del bloque y el preview mantuvo la misma página.
4. Cambié temporalmente `Helps Prostate` a `QA Benefit 2`, guardé, cerré y abrí una sesión nueva. El texto persistió; después lo restauré a `Helps Prostate` y guardé otra vez.
5. Pulsé el `+` contextual de una sección. Se abrió la misma biblioteca de secciones y comunicó la posición de inserción (`Se insertará en la posición 2 de la página`).
6. Elegí `Imagen con texto`. El árbol quedó en el orden esperado, la nueva sección apareció en la posición indicada y el estado comunicó `Imagen con texto agregada.`. Usé `Deshacer` y confirmé que la sección desaparecía y el orden original volvía.
7. Seleccioné `Testimonios con imágenes`, abrí `Agregar bloque`, elegí `Testimonio`, comprobé `Bloque agregado.` y deshice la operación.
8. Reordené por teclado: foco en `Testimonios`, espacio, flecha abajo, espacio. El árbol cambió a `Info principal producto`, `Carrusel de reseñas`, `Testimonios con imágenes`; el preview cambió en el mismo orden. `Deshacer` restauró árbol y preview.
9. Probé el arrastre directo sobre otra fila en el staging publicado. Antes de la corrección, no se producía ningún cambio; ese fue el fallo real que motivó la implementación.
10. Se agregó una ruta de puntero que reconoce mantener/mover/soltar y comparte el commit canónico con deshacer/rehacer. También se mantuvo el soporte de drag nativo sobre filas y separadores.
11. Se publicó la corrección en staging con el `HEAD` de `main` `4e0c023…`; el workflow terminó correctamente en el run `#152`.
12. Repetí la interacción automatizada sobre el iframe publicado. La acción AX de arrastre disponible no produjo un commit visible dentro del iframe; por eso el gesto humano real sigue siendo una verificación manual pendiente, no un éxito que deba darse por supuesto.
13. Verifiqué además que el árbol conserva los atributos de arrastre, que la primera sección continúa protegida y que la ruta de teclado sigue disponible.
14. Probé contraer y expandir la sección protegida, cambiar a vista móvil y entrar/salir de vista previa completa. En los tres casos el estado se mantuvo coherente.

## Hallazgos priorizados

### P0 — Reordenamiento físico directo

La expectativa de cliente es arrastrar una sección raíz sobre otra y ver cambiar inmediatamente la página. PagePilot lo hace de forma directa. TiendaIQ tenía una implementación basada en ranuras que no aceptaba de forma confiable soltar encima de la fila.

Estado: corregido en código y publicado; teclado validado en staging. Falta cerrar una prueba manual con mouse real dentro del iframe porque la interfaz de automatización disponible no reproduce ese gesto con fidelidad suficiente.

### P1 — Un solo modelo para insertar

El botón inferior y los `+` contextuales deben abrir la misma biblioteca y diferenciar únicamente el índice de inserción. TiendaIQ ya lo hace y se comprobó con `Imagen con texto` y `Deshacer`.

### P1 — Protección explícita

`Info principal producto` no debe poder moverse ni eliminarse si está protegida. La regla se mantiene al usar teclado, drag nativo y la ruta de puntero.

### P1 — Preview como fuente de verdad

Cada edición estructural debe actualizar árbol, preview, dirty state e historial. La edición de texto, inserción, bloque y reordenamiento por teclado cumplieron esa secuencia.

### P1 — Persistencia verificable

Guardar no basta: hay que cerrar/reabrir y comprobar el valor. El bloque de beneficio se guardó, persistió y se restauró al valor original.

### P2 — Descubribilidad del arrastre

El árbol comunica la ayuda accesible (“mantené pulsada una sección”), pero la affordance visual del control de arrastre es discreta. Antes de considerar la experiencia terminada conviene validar que un cliente entienda qué parte de la fila puede tomar y que vea una línea/estado claro durante el movimiento.

## Matriz de aceptación

| Flujo | Resultado esperado | Evidencia actual |
|---|---|---|
| Seleccionar sección raíz | Inspector contextual y preview estable | Cumplido |
| Editar título | Cambio confirmado y dirty state | Cumplido; PagePilot requiere confirmar campo |
| Editar bloque | Cambio visible y persistente tras reabrir | Cumplido |
| Añadir sección inferior | Biblioteca común e inserción definida | Cumplido |
| Añadir sección contextual | Misma biblioteca en el índice contextual | Cumplido |
| Añadir bloque | Bloque independiente dentro de su sección | Cumplido |
| Deshacer / rehacer | Árbol, preview y estado vuelven juntos | Cumplido en flujos probados |
| Reordenar con teclado | Movimiento accesible y preview sincronizado | Cumplido |
| Reordenar con mouse sobre fila | Antes/después según mitad de la fila | Código publicado; prueba manual pendiente |
| Proteger primera sección | No mover, no borrar, no atravesar | Cumplido |
| Contraer / expandir | Árbol legible sin cambiar contenido | Cumplido |
| Vista móvil / preview completo | Cambia la superficie sin perder edición | Cumplido |

## Próxima prueba manual obligatoria

En Chrome, con el editor visible y el árbol desplazado hasta las dos secciones raíz:

1. Mantener pulsada la fila `Testimonios con imágenes`.
2. Mover el cursor lentamente sobre la mitad inferior de `Carrusel de reseñas` y soltar.
3. Confirmar que el orden pasa a `Info principal producto`, `Carrusel de reseñas`, `Testimonios con imágenes`.
4. Mantener ahora `Testimonios con imágenes`, moverla sobre la mitad superior de `Carrusel de reseñas` y soltar.
5. Confirmar que vuelve a `Info principal producto`, `Testimonios con imágenes`, `Carrusel de reseñas`.
6. Confirmar que `Deshacer` restaura árbol y preview en cada operación.
7. Intentar mover la primera sección protegida y confirmar que no se inicia el movimiento.

La implementación no debe considerarse cerrada para clientes hasta que esos seis pasos se observen con mouse real y queden registrados como evidencia.
