# Verificación live — 13 de septiembre de 2026

## Superficie

- Entorno: TiendaIQ Partner Staging dentro de Shopify Admin.
- Página: `editor-secciones?id=9390316716265`.
- Build observado después del despliegue aprobado del editor nuevo.
- Estado inicial y final: tres secciones raíz; no se dejó ningún cambio persistido.

## Recorrido de agregar sección

1. Se contrajo `Info principal producto` para hacer visibles las tres secciones raíz.
2. Se seleccionó `Testimonios con imágenes`.
3. `Añadir sección` global abrió la biblioteca y mostró que la inserción sería en la posición 3.
4. Se cerró la biblioteca sin modificar el borrador.
5. Se pulsó `Añadir sección después de Testimonios con imágenes`.
6. La misma biblioteca se abrió con el mensaje `Se insertará en la posición 2 de la página`.
7. Se añadió otra composición `Testimonios con imágenes`.
8. El árbol quedó temporalmente así: `Info principal producto`, `Testimonios con imágenes (8)`, `Testimonios con imágenes (7)`, `Carrusel de reseñas (12)`.
9. La nueva instancia recibió un id distinto (`section-a29f909d-daa2-4ba3-ae68-14ed9365e88c`), lo que confirma independencia de identidad.
10. `Deshacer` devolvió el árbol a las tres secciones originales y volvió a deshabilitarse; no se guardó la prueba.

## Recorrido de agregar bloque

1. Se volvió a seleccionar `Testimonios con imágenes`.
2. `Agregar bloque` abrió una biblioteca específica de esa sección y ofreció `Testimonio`.
3. Al añadirlo, el contador de la sección pasó de `(8)` a `(9)` y el inspector mantuvo la sección como destino.
4. `Deshacer` devolvió el contador a `(8)` y dejó staging sin cambios pendientes.

## Resultado

- `[O]` El botón contextual no es un botón aislado: abre la biblioteca común y transporta un índice de inserción.
- `[O]` La sección se inserta en el lugar correcto respecto de la sección seleccionada.
- `[O]` La instancia nueva es independiente y el historial revierte la operación completa.
- `[O]` `Agregar bloque` usa el destino de la sección seleccionada y actualiza su contador; no agrega el bloque a otra sección raíz.
- `[O]` La interacción quedó limitada a staging y se restauró el estado inicial.
- `[P]` Sigue pendiente certificar el gesto de arrastre con un mouse físico auténtico. La automatización disponible selecciona correctamente las filas, pero su método de drag dentro del iframe no produjo una reordenación observable; no se marca como aprobado.

## Frontera de editor

- `[R]` `/editor-v3` conserva la entrada heredada, pero `app/editor-producto.html` deriva a `/editor-secciones` cuando la página ya contiene `data.section_page`.
- `[R]` Las escrituras de `section_page` rechazan payloads genéricos y documentos legacy mediante `page-write-policy`.
- `[I]` El riesgo restante es de deuda de migración y paridad visual para páginas legacy, no de mezcla de dos modelos en una misma página nueva.
