# Decisión: páginas como composiciones, con una base comercial segura

## Decisión

La página de producto se modelará como un árbol de composiciones:

`sección → grupo (horizontal/vertical) → bloques de contenido o comercio`.

La sección sigue siendo la unidad que el merchant agrega desde la librería. Los
grupos son primitivas internas reutilizables para expresar la jerarquía visual
que se observa en PagePilot; no se exponen como una sección independiente en la
librería. El renderer, el registro y el documento siguen siendo las autoridades
únicas para editor, IA y storefront.

La experiencia se construye en este orden:

1. **Correctitud:** un tipo desconocido no congela el editor y una composición de
   compra siempre termina en un formulario Shopify válido.
2. **Composición:** las nuevas plantillas y la IA emiten grupos y bloques
   reutilizables, en vez de una sección monolítica con targets compartidos.
3. **Madurez:** inspector schema-driven, estados vacío/roto, foco, touch,
   responsive real y cromo Polaris.

## Qué entra en este corte

- `nucleo/tipos/grupo.js`: primera primitiva composable, no visible en la
  librería, con disposición responsive y los mismos grupos comunes de estilo.
- `nucleo/tipos/comercio.js`: selector de variantes y cantidad como bloques
  independientes, alimentados por datos vivos de Shopify.
- `producto-preview.js`, Liquid y `tiq-storefront.js`: la variante seleccionada
  y la cantidad se sincronizan con el formulario real del CTA.
- `registro.definicionParaEditor()` y panel de estado: un documento futuro puede
  abrirse y repararse sin inventar campos ni debilitar la validación del backend.
- `limite_por_pagina` se evalúa dentro de la sección más cercana (los nodos que
  todavía cuelgan de la raíz conservan el ámbito de página). Así un bloque
  limitado puede aparecer una vez en cada composición independiente.
- La migración v0 → v1 convierte tres superficies reales de Piloto 01 al corte
  composable: héroe, beneficios y línea de tiempo. Cada una conserva su
  contenido y suma un grupo interno editable.

## Criterios de aceptación

- Un documento con `grupo` anidado valida y el mismo `render()` produce sus dos
  columnas con `data-nodo` estable en Node y en los dos bundles.
- `grupo` no aparece en el catálogo de secciones.
- Un selector muestra variantes reales, marca agotadas como `disabled` y al
  cambiar actualiza el `input[name=id]` del formulario del CTA.
- La cantidad mantiene el valor entre 1 y 99 y actualiza `input[name=quantity]`.
- Un tipo desconocido conserva el render tolerante del storefront y muestra en
  el inspector un estado accionable, sin controles falsos.
- Validación, sintaxis y los tests de núcleo/UI pasan; no se hace merge ni
  publicación como parte de este corte.

## Fuera de alcance

La migración de las 19 secciones actuales (más allá de las tres piloto), pasar
el catálogo a árboles de datos, la edición inline, Polaris completo, el cart
drawer y el flujo de instalación gestionado requieren QA visual y cortes
separados. No se mezclan con este vertical slice.
