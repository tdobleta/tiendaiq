# Auditoría visual y de experiencia — TiendaIQ vs PagePilot

**Fecha:** 2026-09-03  
**Objeto:** editor de páginas de producto v3 contra PagePilot, antes de ampliar el
pipeline de IA.  
**Base revisada:** `origin/main` mediante la rama de trabajo actual.  
**Estado del código al auditar:** `2dafc94`; `npm run probar` = **757/757**.

**Corte iniciado después de la auditoría:** cromo superior v3 con estado de
borrador, modo avanzado, vista expandida, acciones y variantes; IA oculta cuando
no hay proveedor. La validación posterior quedó en **759/759** y los artefactos
del editor fueron reconstruidos. Este corte no conecta todavía el pipeline IA→árbol.

## 1. Alcance y método

No evalué si algo es “bonito” de forma aislada. Evalué si el editor comunica una
herramienta madura: orientación, densidad, estados, reversibilidad, control del
merchant y consistencia entre árbol, lienzo e inspector.

La evidencia visual son las capturas entregadas explícitamente por el usuario:

| Referencia | Tamaño | Uso |
|---|---:|---|
| [PagePilot — grupo anidado seleccionado](C:/Users/rubio/AppData/Local/Temp/codex-clipboard-2fdd38f2-a466-44dc-bcfa-949c9a47938d.png) | 1919×850 | Referencia PagePilot |
| [TiendaIQ — sección y bloque seleccionados](C:/Users/rubio/AppData/Local/Temp/codex-clipboard-7ed7afe4-ffaa-449d-9805-d8c83114f971.png) | 1698×835 | Editor actual |
| [TiendaIQ — imagen + texto](C:/Users/rubio/AppData/Local/Temp/codex-clipboard-7646485d-f2cd-40aa-a6f3-4508afc581da.png) | 1711×846 | Editor actual |
| [TiendaIQ — beneficios y árbol](C:/Users/rubio/AppData/Local/Temp/codex-clipboard-a0f513ae-a38f-404d-bd56-30070ab271d8.png) | 1918×893 | Editor actual |
| [TiendaIQ — inspector Product Information](C:/Users/rubio/AppData/Local/Temp/codex-clipboard-0b9e41d3-6e10-4508-825a-15da7dc301db.png) | 334×788 | Editor actual |

Las mediciones de panel tomadas de las capturas son aproximadas (no hay DOM
inspeccionable de la sesión autenticada de PagePilot). Las afirmaciones de
comportamiento y estructura se respaldan además con archivo y línea. Cuando un
punto no pudo medirse en vivo, queda marcado como **no verificado**, no como
aprobado.

## 2. Veredicto ejecutivo

La arquitectura de TiendaIQ ya tomó la decisión correcta: una página es un árbol
de composiciones (`sección → grupo → bloques`), el registro genera el inspector y
el renderer es único para editor y tienda (`app/editor/panel.js:1-12`,
`app/editor/libreria.js:46-49`, `nucleo/render.js`). Eso es una base profesional.

La experiencia, sin embargo, **todavía no está al nivel de PagePilot**. PagePilot
no se siente maduro por usar verde o por tener más controles: se siente maduro
porque cada estado tiene contexto, cada superficie tiene una acción clara y el
merchant puede entender una página larga sin adivinar. TiendaIQ tiene buenas
piezas aisladas, pero el cromo superior es más pobre, el inspector aún es un
formulario genérico, hay estados sin tratamiento visual equivalente y la
combinación de `Editar con IA` preparado pero no conectado se lee como una
promesa rota. No recomiendo usar el pipeline de IA ni declarar paridad hasta
cerrar las brechas de experiencia y medir responsive, volumen, latencia y
accesibilidad en un navegador real.

## 3. Hallazgos ordenados por impacto

### P0 — La arquitectura de composición es correcta; la experiencia todavía no la hace evidente

**Evidencia.** TiendaIQ tiene seis composiciones profesionales en el catálogo
(`nucleo/catalogo/secciones.js:16-133`) y permite anidar grupos sin exponer el
tipo `grupo` en la librería (`nucleo/catalogo/secciones.js:139-145` y
`nucleo/tipos/grupo.js`). El panel se genera desde grupos y campos del registro,
no desde ifs por tipo (`app/editor/panel.js:53-76`). En PagePilot (captura
`2fdd`, 1919×850) el árbol y el lienzo dejan visible la composición: `Group
(Horizontal)`, `Group (Vertical)`, `Percentage Circle`, `Text` y el bloque
seleccionado forman una jerarquía legible. En TiendaIQ (captura `7ed`, 1698×835)
la jerarquía existe, pero el primer nivel sigue siendo una lista más plana y el
inspector no explica la relación entre composición y bloques.

**Juicio.** No hay que volver a una página de una sola tira. Hay que mantener el
modelo de secciones, pero diseñar cada composición como un producto completo:
nombre, intención, contenido inicial seguro, estados vacío/roto y controles
propios. El riesgo actual no es el árbol de datos; es que el merchant no perciba
esa intención al abrir una sección.

**Criterio de aceptación.** Para cada composición, una prueba visual debe poder
responder en menos de 3 segundos: qué sección es, qué resultado produce y qué
bloque está editando. La prueba debe usar el mismo `render()` que el lienzo y la
miniatura (`app/editor/libreria.js:109-124`).

### P1 — El cromo superior tiene una brecha de producto, no solo de estilo

**Medición visual.** En la captura de PagePilot se cuentan **12 controles
contextuales visibles** en la barra: modo avanzado, marca, cuatro controles de
viewport/superficie, deshacer, rehacer, guardar, publicar, editar variantes y
acciones (`2fdd`, 1919×850). En TiendaIQ se ven **8**: volver, identidad, Marca,
escritorio/móvil, deshacer, rehacer, Guardar y Publicar (`7ed`, 1698×835).

**Evidencia de código.** El esqueleto de TiendaIQ solo monta volver, identidad,
Marca, Estructura/Inspector responsive, viewport, undo/redo, Guardar y Publicar
(`app/editor/editor.js:40-64`). No existen en ese cromo Modo avanzado,
fullscreen, Editar variantes ni Acciones. Los botones de panel son un sustituto
responsive y se ocultan en escritorio (`app/editor/editor.js:46-57`,
`app/editor/editor.css:409-434`).

**Juicio.** Esta es la diferencia que más rápido hace que el usuario piense
“esto es un prototipo”. PagePilot usa la barra para comunicar el modelo mental
completo; TiendaIQ comunica solo guardar/publicar. No se arregla agrandando el
logo ni cambiando colores.

**Criterio de aceptación.** En escritorio, la barra debe conservar identidad,
modo, marca, viewport/superficie, undo/redo, guardar/publicar, variantes y
acciones sin truncar etiquetas a 1440px. En 390px debe colapsar de manera
explícita, sin solapamientos ni botones inaccesibles; la medición debe ser
`scrollWidth === clientWidth`.

### P1 — El inspector tiene una base correcta, pero todavía se ve genérico

**Medición de implementación.** Cada control horizontal reserva `min-height:30px`
y `margin-bottom:6px`; cada grupo agrega `padding:12px 14px` y un encabezado de
8px (`app/editor/editor.css:186-197`, `208-221`). Diez controles consecutivos
consumen al menos **360px** antes de contar títulos, separadores y ayudas. La
tipografía de labels es 12.5px con line-height 16.5px (`app/editor/editor.css:23-26`,
`140-149`).

**Comparación visual.** PagePilot muestra en una misma columna el contexto del
componente, controles separados por intención, advertencias, selector
escritorio/móvil, ayuda accionable y estados como Sticky/Visibility/Padding
(`2fdd`, 1919×850). TiendaIQ sí tiene Layout, Content, Appearance, Spacing y
Padding (`0b9`, 334×788), pero el patrón es todavía un formulario uniforme; el
merchant tiene que leer más para entender qué afecta al bloque.

**Evidencia estructural.** El panel es deliberadamente schema-driven
(`app/editor/panel.js:1-12`, `53-76`), lo cual es correcto para escalar, pero el
HTML común no introduce jerarquía semántica más allá de grupo/campo. El soporte
de ayuda existe (`app/editor/controles.js:158-165`, `232-239`), aunque solo se
han declarado **21 ayudas de 352 campos** y **0 placeholders** según el registro
actual (medición Node sobre `nucleo/registro.js`).

**Juicio.** La densidad no es el principal problema; el problema es la densidad
sin suficiente significado. PagePilot gana por agrupación, microcopy y estados,
no simplemente por usar una fuente más pequeña.

**Criterio de aceptación.** Cada control no obvio debe tener ayuda o un tooltip
de una línea; cada campo derivado del producto debe tener placeholder explicando
“vacío = dato real de Shopify”; ningún campo horizontal con ayuda puede romper su
fila. Medir: cero labels con ancho 0 y cero filas con altura inesperada >2× la
altura del control.

### P1 — El árbol es navegable en concepto, pero falta validarlo con volumen real

**Lo que sí existe.** Las filas tienen etiqueta semántica derivada de contenido,
icono SVG por tipo, `role="treeitem"`, `tabindex="0"` y `aria-selected`
(`app/editor/arbol.js:34-73`, `87-124`). La selección desde el árbol llama a
`lienzo.verNodo()` (`app/editor/editor.js:524-531`) y el lienzo calcula un destino
centrado (`app/editor/lienzo.js:131-152`). Esto explica por qué la captura `7ed`
muestra la rama y el bloque seleccionados en ambas superficies.

**Lo que no está medido.** No existe en la suite un benchmark del caso exigido de
**40 secciones y 200 nodos**: `rg` encuentra comentarios y pruebas unitarias,
pero no un tiempo de repintado ni una medición de navegación profunda. Tampoco
hay evidencia de cuántas pulsaciones/scrolls requiere llegar a un nodo profundo.

**Juicio.** La estructura es mejor que la anterior y no debe reemplazarse por
una tira plana. Pero afirmar “escala” sin el escenario de 200 nodos sería
prematuro.

**Criterio de aceptación.** Con 40 secciones/200 nodos: repintado del árbol
`<100 ms` en p95, selección profunda visible en un máximo de una acción y sin
scroll a ciegas; registrar `performance.now()` antes/después del repintado y
un test de teclado que alcance un nodo a profundidad 4.

### P1 — Los estados feliz, vacío y roto no tienen simetría completa

| Superficie | Feliz | Vacío | Roto | Evidencia / juicio |
|---|---|---|---|---|
| Librería | Tarjetas y miniaturas renderizadas | Búsqueda sin resultados explícita | Fallback wireframe si falla la miniatura | `app/editor/libreria.js:109-154`, `194-207`; es la superficie más completa |
| Inspector | Esquema del nodo seleccionado | Solo “Inspector” genérico | “Bloque no disponible” + eliminar | `app/editor/panel.js:30-50`; falta orientar el primer uso |
| Imagen | Vista previa + URL + alt | “Sin imagen” | Sin tratamiento dedicado de URL rota | `app/editor/controles.js:232-239`; no aparece `onerror` en `app/editor`/`nucleo` |
| Renderer | HTML normal | Vacíos explícitos de galería/imagen/reseñas | Marca de error con tipo y detalle | `nucleo/render.js:43-46`, `103-104`; técnicamente sólido |
| Árbol | Filas con icono/label | Documento sin nodos no observado en captura | Tipo desconocido degradado | `app/editor/editor.js:102-106`, `app/editor/arbol.js:87-124` |

PagePilot añade contexto visual en estados no ideales: por ejemplo, la captura
`2fdd` muestra el aviso de que ciertos ajustes no son visibles en móvil dentro
del inspector. TiendaIQ no muestra todavía una advertencia equivalente en el
estado normal del inspector; el usuario debe inferirlo del toggle.

**Criterio de aceptación.** Cada superficie debe tener captura aprobada de los
tres estados. Una URL de imagen rota debe mostrar placeholder con acción
“Reemplazar” y no el icono roto del navegador. Un documento sin selección debe
explicar qué seleccionar o elegir automáticamente el primer bloque de forma
visible.

### P1 — Responsive: hay una estrategia, pero todavía no hay certificación

**Evidencia de implementación.** En <=900px los paneles se convierten en drawers
fuera de pantalla y el centro ocupa 100%; en <=520px se reducen los botones de
viewport y se truncan acciones largas (`app/editor/editor.css:409-434`). El iframe
móvil usa 390px reales (`app/editor/lienzo.js:22`, `124-129`), no una simulación
de CSS.

**Lo no verificado.** No hay una captura/medición de esta auditoría a 390px y
768px que demuestre simultáneamente `scrollWidth <= clientWidth`, texto no
cortado y áreas táctiles de al menos 44×44px. De hecho, algunos controles del
cromo declaran 26–32px (`app/editor/editor.css:77-87`, `94-111`), por lo que no
se puede afirmar cumplimiento táctil sin un wrapper o una zona de interacción
mayor.

**Criterio de aceptación.** Ejecutar matriz 390/768/1024/1440px. En 390px:
`document.documentElement.scrollWidth === clientWidth`, drawers mutuamente
excluyentes, ningún texto crítico con `scrollWidth > clientWidth`, y cada
control accionable con rect de al menos 44×44px aunque el icono visual sea menor.

### P2 — Latencia percibida: el diseño evita dos regresiones, pero no hay números

**Evidencia de diseño.** El panel no se repinta al escribir para conservar foco y
cursor (`app/editor/editor.js:8-14`); el iframe conserva scroll al repintar
(`app/editor/lienzo.js:79-95`). La librería cachea miniaturas por composición o
tipo (`app/editor/libreria.js:71-123`). Son decisiones correctas.

**Lo no verificado.** No existe medición tecla→lienzo ni clic en tarjeta→bloque
visible. Los **757 tests** prueban contratos y resultados, no p95 de interacción.

**Criterio de aceptación.** Instrumentar dos marcas: `keydown`→primer cambio
visual del iframe y `click` de librería→nodo insertado/pintado. Aceptar p95
<100ms para edición de texto local y p95 <250ms para inserción sin red.

### P2 — Accesibilidad: hay fundamentos, no certificación

**Evidencia positiva.** Hay `:focus-visible` azul consistente
(`app/editor/editor.css:40-50`), filas `treeitem` navegables
(`app/editor/arbol.js:124`), tarjetas de librería con `role="button"`,
`tabindex` y `aria-disabled` (`app/editor/libreria.js:157-169`), y botones de
viewport con `aria-pressed` (`app/editor/panel.js:22-28`).

**Lo no verificado.** No hay auditoría automatizada de orden de tabulación,
contraste, nombre accesible de todos los iconos, ni navegación completa de la
librería. Las capturas no permiten demostrarlo. El anillo violeta/naranja ya no
debe aparecer, pero la existencia de una regla no prueba que todos los controles
la reciban correctamente.

**Criterio de aceptación.** Axe/pa11y sin errores críticos, navegación completa
solo con teclado, foco siempre dentro de la superficie abierta, contraste WCAG
AA y targets táctiles >=44px.

### P2 — Identidad visual: comparar el cromo, no la marca del merchant

**Evidencia.** El verde de las capturas pertenece a la marca del producto en el
lienzo; no es el cromo del editor. TiendaIQ define un cromo neutro
(`#f6f6f7`, blanco, texto `#1a1a1a`, azul de selección) en
`app/editor/editor.css:13-35`. PagePilot usa también un cromo neutro en la
captura `2fdd`; la comparación correcta es de jerarquía, bordes, radios,
espaciado y estados, no de verde contra gris.

**Juicio.** TiendaIQ no falla por “usar otro color”. Falla cuando el botón de IA
aparece morado como acción disponible pero su handler solo emite un evento
preparatorio (`app/editor/editor.js:549-552`). En la captura `7ed` el tooltip
explica que la conexión se habilitará en una fase futura: eso es una señal visible
de producto inacabado y debe desaparecer o funcionar antes de exposición real.

## 4. Deuda de arquitectura vs deuda de acabado

### Deuda de arquitectura (bloquea ampliar y publicar)

1. **IA todavía no emite el árbol v3.** `nucleo/ia` no existe en esta base y el
   pipeline de generación sigue leyendo/escribiendo `facetas` en
   `adaptador.js:10`, `201`, `337`, `626`, `826-959` y
   `src/jobs/runtime.js:35-99`. Si se conecta IA antes de resolver esto, el
   editor nuevo recibirá documentos que no puede editar como composiciones.
2. **Límite por página vs por sección debe quedar explícito.** El validador aplica
   el alcance de `limite_por_pagina` en `nucleo/documento.js:280-345`; con grupos
   y sticky hay que probar que el límite correcto se cuenta en el ámbito correcto.
3. **Catálogo todavía parcialmente codificado.** Hay 21 tipos registrables, 26
   entradas visibles y 6 composiciones medidas en esta rama (script Node sobre
   `nucleo/registro.js` y `catalogo/secciones.js`). El modelo permite crecer, pero
   añadir cada composición aún depende de editar JavaScript, no de datos
   versionados con tooling de preview.

### Deuda de acabado (no cambia el contrato, pero sí la percepción)

1. Cromo superior incompleto: modo avanzado, acciones, variantes y fullscreen.
2. Microcopy insuficiente: 21/352 ayudas y 0 placeholders declarados.
3. Campo de imagen sin estado de URL rota ni dropzone equivalente a PagePilot.
4. Estados de primer uso y advertencias responsive poco explícitos.
5. Medición pendiente de volumen, latencia, foco, contraste y targets táctiles.
6. Acción IA visible sin conexión real.

## 5. Decisión

**No usar todavía el pipeline anterior ni declarar paridad con PagePilot.** La
decisión correcta es conservar la arquitectura por secciones y reconstruir la
capa de experiencia encima de ella. No hay que tirar `sección → grupo → bloque`;
hay que hacer que cada sección sea una composición profesional y que el editor
explique sus estados como PagePilot.

Orden recomendado antes de IA:

1. **Certificación de superficie:** matriz visual 390/768/1024/1440, foco,
   targets y estados feliz/vacío/roto.
2. **Cromo de producto:** cerrar la barra superior y quitar el affordance de IA
   falso; conservar anchos de panel actuales (aprox. 280px izquierda y 300px
   derecha en `editor.css:117-123`, que ya están en el mismo orden que las
   capturas de PagePilot).
3. **Inspector por intención:** ayudas/placeholders, media con dropzone y error,
   advertencias responsive y controles semánticos por composición.
4. **Prueba de volumen/latencia:** 40 secciones/200 nodos, p95 y navegación
   profunda.
5. **Puente IA→árbol:** recién después, con un documento v3 validado y un test
   que pruebe que cada composición generada se puede editar, guardar y publicar.

## 6. Límites de esta auditoría

No pude inspeccionar el DOM autenticado de PagePilot ni ejecutar una matriz de
interacciones directamente en su sesión; por eso las medidas visuales de
PagePilot son aproximadas a partir de las capturas entregadas. No inventé
resultados para árbol de 200 nodos, latencia, contraste o targets táctiles: quedan
como pruebas de aceptación pendientes. La suite 757/757 confirma contratos de
código, no madurez visual.
