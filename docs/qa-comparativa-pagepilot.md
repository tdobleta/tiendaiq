# QA comparativa contra PagePilot — editor v3

**Fecha:** 2026-09-03
**Método:** los dos editores abiertos en vivo, mismo producto, mismos estados
(sin selección / sección seleccionada / bloque hoja seleccionado / librería abierta / vista móvil).
PagePilot: `admin.shopify.com/…/pagepilotai/app/builder/t/0e07b42e`.
Nuestro: `app/dist/editor.js` con un documento de 9 secciones armado con los 18 tipos del registro.

Este documento es la lista de trabajo previa a retirar el editor histórico. No propone arquitectura
nueva: todo lo de acá entra dentro del contrato de `docs/arquitectura-editor-v3.md`.

**Corte 2026-09-03:** los puntos **2.1 a 2.5** quedaron implementados en el editor v3: etiquetas
semánticas para contenedores, iconos SVG por tipo, selección sincronizada en ambas direcciones y
posicionamiento de la barra flotante dentro del lienzo. También se cerró el foco visual del cromo:
el teclado usa un anillo azul consistente y no el `outline: auto` naranja del navegador. Los puntos
2.5 en adelante siguen pendientes y no se mezclan con este corte.

---

## 0. Bug encontrado y corregido durante la revisión

**`packs_compra` sembraba un nodo que el validador rechaza.** El campo `cantidad` está declarado
`texto_plano` y la semilla escribía `cantidad: 1` (número). Insertar ese bloque desde la librería
producía un documento que `documento.validar()` rechazaba: el merchant lo agregaba, editaba, y al
guardar recibía un error de validación que no mencionaba la librería por ningún lado.

Corregido (`nucleo/tipos/piloto.js`), y —lo que importa— **agregado el guardián que faltaba**:
`pruebas/nucleo-registro.test.js` ahora corre un test por cada tipo registrado comprobando que
`crearNodo(tipo)` produce un documento válido. Con 18 tipos hoy y 39 mañana, ese test es lo único
que impide que el ejemplo de un tipo se desincronice de su propio schema.

---

## 1. Paridad ya lograda

No hace falta tocar nada de esto.

| | Estado |
|---|---|
| Anatomía de tres paneles + barra superior | ✅ |
| Grupos del panel (Contenido / Tipografía / Apariencia / Espaciado / Visibilidad) | ✅ |
| Micro-toggle de herencia por campo | ✅ |
| Toggle escritorio/móvil por grupo | ✅ |
| Barra flotante sobre el bloque (IA / ocultar / duplicar / borrar / añadir) | ✅ |
| Librería con categorías, contadores y buscador | ✅ |
| Vista móvil real a 390px, centrada | ✅ |
| Undo/redo con fusión de tecleo | ✅ |
| Renderer único editor↔tienda | ✅ **verificado por test** (PagePilot no puede demostrarlo) |
| Árbol → lienzo con scroll y centrado del bloque | ✅ **verificado por test** |
| Foco visible consistente para teclado | ✅ **verificado por test** |

---

## 2. Brechas, por impacto

### 2.1 El árbol es ilegible — **corregido en el corte actual**

Nueve filas que dicen **"Sección"**. PagePilot muestra `Product Information`, `Image with Timeline`,
`As Seen On`, `Reviews Carousel`… El árbol es el panel que más se usa para navegar una página larga,
y hoy no sirve para nada.

Causa: `arbol.etiquetaDe()` busca props de texto **en el nodo**, y un contenedor `seccion` no tiene
ninguna, así que cae al nombre del tipo.

Arreglo propuesto: si el nodo es contenedor y no tiene texto propio, tomar la etiqueta del primer
descendiente con contenido; si tampoco hay, usar el nombre del tipo del primer hijo
(`Galería del producto`) antes que `Sección`.

### 2.2 Sin iconos por tipo — **corregido en el corte actual**

Cuadrados grises idénticos (`.ed-arbol__icono` es un `background` plano). PagePilot tiene un icono
distinto por tipo, y es lo que permite escanear cuarenta filas sin leerlas. El registro ya declara
`icono` en cada tipo; falta el set de SVG y el mapeo.

### 2.3 Seleccionar en el lienzo no revela el nodo en el árbol — **corregido en el corte actual**

Verificado: clic en "Título del producto" en el preview → el árbol queda igual, todas las ramas
colapsadas y ninguna fila marcada. PagePilot expande la rama, resalta la fila y hace scroll hasta
ella. Sin esto, lienzo y árbol se sienten como dos aplicaciones distintas.

### 2.4 La barra flotante se superpone a la barra superior — **corregido en el corte actual**

Con el bloque más alto seleccionado, la barra flotante se dibuja encima de los controles de
viewport. `colocarFlota()` hace `Math.max(8, arriba - 42)`: el tope es el viewport, cuando debería
ser el borde superior del lienzo. Cuando no entra arriba, PagePilot la pone **debajo** del bloque.

### 2.5 Miniaturas de la librería genéricas — **cerrado en este corte**

Son wireframes esquemáticos, y varias son indistinguibles entre sí (Texto vs Imagen con texto).
PagePilot muestra **la sección renderizada con contenido real**, que es lo que hace que el merchant
elija bien a la primera.

La librería ahora construye un documento mínimo con la semilla del tipo o la composición guardada
y llama al mismo `render()` que usa el lienzo (`app/editor/libreria.js`). El HTML resultante se
escala dentro de la tarjeta; los formularios se vuelven contenido no interactivo para no anidar
controles dentro de la tarjeta. Si un tipo necesita un archivo externo y no produce HTML con su
semilla, mantiene un wireframe vectorial explícito como fallback.

Además, la librería dejó de mezclar niveles: en la raíz muestra composiciones profesionales
(`Añadir sección`) y dentro de una sección muestra bloques atómicos (`Añadir bloque`). Esto evita
que el merchant anide una página completa accidentalmente y refleja el flujo sección → grupo →
bloques de PagePilot.

### 2.6 Casi no hay texto de ayuda — **medio**

**18 de 313 campos** tienen `ayuda`. PagePilot explica prácticamente todo control no obvio:
*"Show controls works only for external videos"*, *"Autoplay works only if the video is muted"*,
*"If enabled, the product details will be sticky…"*. Es lo que hace que un panel de veinte
controles no intimide. El soporte ya existe (`campo.ayuda` se dibuja); falta escribirlos.

### 2.7 Los campos que se llenan del producto real se ven vacíos — **medio**

El panel de `titulo_producto` muestra "Título" vacío mientras el lienzo dice "Título del producto".
El comportamiento es correcto (vacío = usar el dato vivo de Shopify) pero **no lo dice**, y un campo
vacío se lee como un error. Falta `placeholder` en los controles y una nota del tipo
*"Vacío = se usa el título real del producto"*.

### 2.8 Faltan piezas de la barra superior — **medio**

Contra PagePilot faltan: **Modo Avanzado**, las tres muestras de color dentro del botón Marca,
herramienta de selección y pantalla completa, **Editar variantes**, y **Acciones**
(*Ver origen* / *Guardar como plantilla*). `Guardar como plantilla` + `Guardados` es además lo que
convierte el editor en algo reutilizable entre productos.

### 2.9 El campo imagen no tiene zona de arrastre ni "Crear con IA" — **medio**

Hoy: `input type=file` + URL. PagePilot: zona de arrastre con límites escritos
(*JPG, PNG, GIF, WEBP hasta 10MB*), botón *Seleccionar archivos* y **Crear con IA**.

### 2.10 Catálogo: 18 contra 39 — **esperado**

Y de nuestros 18, varios son átomos (`titulo_producto`, `precio_producto`, `boton_carrito`) que en
PagePilot son bloques **dentro** de Product Information, no entradas del catálogo. Secciones "de
vender" comparables tenemos unas 9. La diferencia es volumen, no arquitectura: cada sección nueva
sigue costando un archivo.

---

## 3. Orden sugerido

1. **2.1 + 2.3** — el árbol. Es lo que hoy hace que el editor se sienta a medio hacer.
2. **2.2** — iconos.
3. **2.4** — la barra flotante.
4. **2.6 + 2.7** — ayudas y placeholders. Barato y muy visible.
5. **2.5** — miniaturas reales desde el propio render.
6. **2.8** — Acciones + Guardar como plantilla.
7. **2.9** — subida de imagen.
8. **2.10** — catálogo, en tandas por categoría.

Los puntos 1 a 4 son los que separan "funciona" de "parece maduro", y ninguno toca el contrato.
