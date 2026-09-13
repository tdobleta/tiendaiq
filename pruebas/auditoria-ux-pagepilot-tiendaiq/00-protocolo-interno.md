# Protocolo interno de investigación UX

## Objetivo

Evaluar el editor de secciones como lo usaría un cliente que construye una página de producto. La referencia visual orienta la forma; la evidencia interactiva determina el contrato.

## Reglas antes de tocar código

1. Repetir cada flujo en PagePilot y en TiendaIQ con una sesión limpia.
2. Registrar cada acción en orden: superficie, elemento, gesto, resultado inmediato, resultado en preview, dirty state, historial y persistencia.
3. Separar estrictamente:
   - observado: ocurrió en la interfaz;
   - inferido: explicación razonable todavía no demostrada;
   - pendiente: debe repetirse o probarse con otra superficie.
4. No copiar estructura interna ni asumir que una captura implica un comportamiento.
5. No aceptar un arreglo que solo satisfaga una prueba de código si el recorrido de cliente continúa fallando.

## Capas que deben comprobarse

### Estructura

- secciones raíz independientes;
- grupos y bloques anidados;
- bloques repetibles dentro de su sección;
- sección protegida y límites de movimiento;
- varias instancias sin compartir estado.

### Inserción

- botón global `Añadir sección`;
- inserción contextual después de una sección;
- posición comunicada antes de confirmar;
- biblioteca única;
- inserción dentro de la sección correcta al añadir bloques;
- undo/redo de cada inserción.

### Edición

- selección raíz, grupo, bloque y outline;
- título y rich text;
- confirmación del campo;
- preview actualizado;
- guardado y reapertura;
- errores o estados intermedios visibles.

### Reordenamiento

- drag sobre la fila, no solo sobre una ranura;
- antes/después según mitad de la fila;
- teclado: espacio, flechas, espacio;
- touch/pointer si aplica;
- feedback visual de destino;
- preview, historial y persistencia;
- imposibilidad de mover o atravesar una sección protegida.

### Superficies

- escritorio;
- móvil;
- preview completo;
- árbol desplazado y árbol expandido/contraído;
- foco de teclado y etiquetas accesibles.

## Criterio de cierre

Un flujo solo pasa cuando se cumplen simultáneamente:

1. el cliente entiende qué puede hacer;
2. el gesto produce el cambio correcto;
3. el árbol y el preview coinciden;
4. deshacer/rehacer reconstruye el estado;
5. guardar/reabrir conserva el resultado;
6. la protección y los límites permanecen activos;
7. el comportamiento funciona en la superficie correspondiente y no solo en una simulación interna.

## Qué se adapta del prompt maestro

Se conservan sus exigencias de modularidad, editabilidad, accesibilidad, responsive, encapsulación y fidelidad visual. Para este producto se agregan explícitamente: auditoría de experiencia completa, evidencia por gesto, contrato único de inserción, modelo único de orden, sincronización árbol-preview, persistencia comprobada y distinción entre resultado observado e inferencia.
