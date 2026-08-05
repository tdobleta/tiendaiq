# Editor de página — spec de diseño (réplica de PagePilot)

Extraído de capturas del editor real de PagePilot. Objetivo: reconstruir nuestro
editor de página (`pantallaPreview` en `app/app.js`) como un **builder de 3 paneles**
idéntico en look al de PagePilot. Este doc es la fuente de verdad de diseño.

Paleta / tokens del proyecto (ya existen en app.css): negro `#202223`, texto `#303030`,
subdued `#6d7175`, borde `#e6e6ea`, acento azul Polaris `#005bd3`, superficie `#fff`,
fondo `#f6f6f7`, radios 6–8px. Tipografía: system-ui (font del admin).

## Layout general (3 columnas)
```
┌──────────────┬───────────────────────────────┬──────────────────┐
│ ÁRBOL (izq)  │        PREVIEW (centro)        │  PROPIEDADES(der)│
│ ~300px fijo  │  iframe live + selección inline│  ~320px fijo     │
│ scroll propio│  + toolbar flotante            │  scroll propio   │
└──────────────┴───────────────────────────────┴──────────────────┘
```
Barra superior arriba de todo (volver, título, estado, Guardar/Publicar) — se mantiene.

## 1) Panel IZQUIERDO — árbol de bloques (fijo)
- Contenedor: `#fff`, ancho ~300px, alto completo, borde-derecho 1px `#e6e6ea`, scroll propio.
- Cabecera: título "Página de producto" (15px/700 `#1a1c1e`) + divisor 1px abajo. Padding 14–16px.
- Estructura jerárquica con indentación por nivel (~16px/nivel):
  - **Grupos** (Product Information, Product Details, etc.): fila con chevron ▾ (colapsable),
    ícono de grupo, label 13.5px/650 `#1a1c1e`.
  - **Bloques hijos**: fila con `[drag-handle ⠿ (aparece en hover)] [ícono 16px] [label 13px #303030]`.
  - Bajo "Galería de producto": link **"+ Agregar bloque"** en azul `#005bd3` 12.5px.
- **Fila**: alto ~30–34px, padding 6px 8px, gap 8px ícono-label, radio 8px.
  - Seleccionada: fondo `#f1f2f4`, texto `#1a1c1e`.
  - Hover: fondo `#f6f6f7`.
- Íconos de línea por tipo de bloque (galería, estrella=reseñas, T=título, ≡=texto, $=precio,
  lista=beneficios, divisor, etiqueta=variantes, carrito, tarjetas=pagos, ▤=carrusel reseñas).
  Trazo ~1.8–2, color `#5c5f62` (o acento en grupos). NADA de emojis.
- Drag-handle ⠿ → ícono SVG de 6 puntos (no glyph), gris `#b9bcc3`, 16px.

## 2) Panel DERECHO — propiedades contextuales del bloque seleccionado (fijo)
- Contenedor: `#fff`, ancho ~320px, alto completo, borde-izq 1px, scroll propio.
- Cabecera: nombre del bloque (15px/700 `#1a1c1e`) + ícono lápiz a la derecha + divisor.
- Contenido = grupos apilados. Subheader de grupo: 14px/700 `#1a1c1e`, margen-top ~20px,
  divisores 1px entre grupos.
- **Filas label→control** (label izq 13px `#6d7175`, control der), gap vertical ~14px:
  - **Switch** (toggle): pill, negro `#1a1c1e` cuando ON, blanco el thumb.
  - **Segmentado**: contenedor pill fondo `#f1f2f4` radio 8px; opción seleccionada = fondo `#fff`
    + sombra sutil; texto 13px. (ej. Izq/Der, Tight/Normal/Loose, Ícono/Emoji, Horizontal/Vertical,
    Arriba/Centro/Abajo).
  - **Select**: bordeado 1px `#d9dce0`, radio 8px, 13–14px, chevron a la derecha.
  - **Número + slider**: slider (track fino + thumb redondo negro) a la izq + input boxeado con
    unidad (px/%/ord) a la der, radio 8px.
  - **Color**: swatch (círculo/cuadrado) + nombre o hex, en pill bordeado. (usar `s-color-picker`
    nativo si se puede; si no, input color estilado).
  - **Input de texto**: bordeado radio 8px, 14px.
  - **Rich text**: fila de toolbar (B I U link | ↶ ↷) botones-ícono chicos, luego área bordeada;
    pill **"Editar con IA"** (gradiente violeta→rosa) abajo a la derecha.
  - **Drop zone** (subir imagen/video): caja borde punteado, ícono imagen, "Arrastrá o hacé clic",
    hint de formatos, botón "Elegir archivo" (outline) + "Crear con IA" (gradiente). (usar `s-drop-zone`
    nativo si se puede).
  - **Listas por ítem**: "Ítem 1" (label azul 13px) + dropdown de ícono/emoji + bloque rich-text por ítem.
- Tipografía: headers 14px/700; labels 13px; inputs 13–14px. Espaciado generoso; divisores hairline.

## 3) Centro — preview con selección inline
- Bloque seleccionado: contorno 2px azul `#005bd3`, con un **tag** arriba-izq (texto azul sobre chip
  claro) con el nombre del bloque/grupo ("Detalles del producto", "Lista de ingredientes").
- **Toolbar flotante** (pill blanco, sombra `0 4px 14px rgba(0,0,0,.12)`, alto ~36px) debajo del
  bloque: `[👁 ocultar] [⧉ duplicar] [▲ subir] [▼ bajar] [+ Agregar bloque] [🗑 borrar]` — todos
  SVG ~16px, con divisores entre grupos. Reemplaza los lápices actuales.

## Reglas
- Todo con tokens del proyecto; look nativo Shopify (Polaris). Sin emojis-ícono, sin letra fina.
- Usar componentes nativos `s-*` donde existan: `s-color-picker`, `s-drop-zone`, `s-number-field`,
  `s-switch`, `s-choice-list`, `s-select`, `s-text-field`, `s-text-area`. Lo que no exista (slider,
  árbol, toolbar) se hace bespoke pero estilado nativo.
- Interacción: click en bloque (árbol o preview) → lo selecciona + abre su panel derecho. Edición
  EN VIVO (refleja en el preview al instante); persistencia por la barra superior / Save Bar nativo.
