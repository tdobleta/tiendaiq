# Hallazgos y aceptación

## Prioridad P0

### Reordenamiento físico

PagePilot permite tomar una fila y soltarla sobre otra. TiendaIQ tenía ranuras de inserción y soporte de teclado, pero el gesto físico no quedó certificado en el iframe.

Aceptación:

- mitad superior de fila = antes;
- mitad inferior = después;
- soltar sobre sí misma = sin cambio;
- destino inválido = cancelación explicada;
- árbol, preview, dirty state e historial cambian juntos;
- guardar y recargar conservan el orden.

## Prioridad P1

### Dos modelos dentro de la aplicación

El editor nuevo usa `section_page`, definiciones versionadas y `state.registry`. El editor anterior usa `arbol`, `registro.catalogo()` y otra biblioteca.

Aceptación:

- todas las rutas activas deben converger en el modelo canónico;
- un mismo tipo debe tener nombre, categoría, límites y preview consistentes;
- ninguna ruta de producción debe insertar en un modelo paralelo;
- debe existir una prueba de ruta que confirme la convergencia.

### Protección anticipada

La sección protegida debe mostrarse como protegida antes de intentar moverla, eliminarla o atravesarla. Los controles de movimiento junto a un límite protegido deben deshabilitarse o explicar la restricción de inmediato.

### Inserción contextual

El botón global y el contextual deben diferir solo en la posición. La selección de un bloque debe conservar sección, grupo y posición esperada; si una rama no admite ese bloque, debe explicarlo antes de insertar.

## Prioridad P2

### Biblioteca y affordances

- miniaturas diferenciadas por composición;
- nombre y propósito visibles;
- estados de límite y disponibilidad;
- indicador de reutilización y múltiples instancias;
- asa o indicación visual de arrastre;
- feedback visible durante el movimiento;
- estados de cargando, guardando, conflicto, error y publicado.

## Regla de decisión

No marcar `Igualado` por una prueba estática. Usar:

- `Igualado`: mismo resultado visible, funcional y persistido;
- `Parcial`: solo parte del flujo está probado;
- `No probado`: falta evidencia suficiente;
- `Falta`: no existe;
- `Propuesta`: mejora aún no implementada.

## Próximo orden de trabajo

1. Cerrar el drag físico con mouse real y registrar evidencia.
2. Certificar `Testimonios con imágenes` de punta a punta: añadir, duplicar, bloques, dos instancias, imágenes, móvil, guardar, recargar y publicar.
3. Auditar las rutas del editor antiguo y decidir migración o retiro.
4. Mejorar la biblioteca visual y los estados de disponibilidad.
5. Repetir la auditoría de paridad con storefront, no solo preview.
