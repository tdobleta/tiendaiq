# Evidencia PagePilot

## Hechos observados

- El editor muestra una sección raíz protegida y composiciones raíz reordenables.
- La sección raíz contiene grupos y bloques internos con jerarquía visible.
- Seleccionar una sección cambia el inspector al contexto de esa sección.
- Seleccionar un bloque anidado cambia el inspector al contexto del bloque.
- El título se edita desde el inspector y se confirma con `Enter`.
- El inspector diferencia controles de escritorio y móvil.
- PagePilot acepta arrastrar una fila raíz directamente sobre otra fila, sin exigir una ranura visible.
- El árbol y la vista previa reflejan el orden de las secciones.

## Evidencia no concluyente

- En la sesión auditada no se observó de forma concluyente la apertura textual de la biblioteca desde todos los accesos de `Añadir sección`.
- No se infiere desde una captura cómo se persiste internamente una acción.

## Implicación

La unidad de interacción que el cliente entiende es la fila de sección. Los grupos y bloques forman parte de la composición y no deben fragmentarse automáticamente en secciones independientes.
