# Especificación — Editor "Color y estilo" (reconstrucción estilo Pumper)

> Documento de producto + ingeniería para **reconstruir desde cero** el módulo de
> diseño del editor de bundles de TiendaIQ, tomando como única referencia de
> experiencia el editor de **Pumper Bundles**. La implementación actual
> (`panelDiseno` / acordeón "Color y estilo") se considera **descartada**: no es
> base ni referencia de arquitectura.
>
> **Regla de honestidad:** todo lo que sale de la captura de Pumper o del código
> de TiendaIQ es un **hecho**. Todo lo que infiero del funcionamiento interno de
> Pumper (que no puedo inspeccionar) va marcado como **[HIPÓTESIS]** con su
> justificación. No se inventan funciones invisibles.

---

## 0. Resumen ejecutivo

El editor de Pumper no es "una lista de inputs que cambian CSS". Es un **editor de
tema** (theme editor) con cuatro capas conceptuales que se combinan para producir
un único artefacto: el objeto de diseño del bundle. Las capas son:

1. **Layout / Plantilla** — la estructura del widget (vertical vs horizontal).
2. **Geometría** — dos ejes continuos: redondeo y "aire" (spacing).
3. **Paleta** — un set de colores coherente aplicado de golpe (preset).
4. **Personalización fina** — override por-elemento de color, tipografía y texto.

El principio rector es **manipulación directa + preview en vivo**: el usuario
nunca edita "CSS"; edita una representación del producto y ve el resultado al
instante. La complejidad (decenas de propiedades) se esconde detrás de una
jerarquía de "de lo general a lo particular": elegís plantilla → paleta → y solo
si querés, afinás pieza por pieza.

**Hecho clave (código de TiendaIQ):** ya tenemos el motor correcto. El objeto
`b.diseno` se serializa a variables CSS (`--tiq-borde`, `--tiq-radio`,
`--tiq-bot-*`, `--tiq-card-*`, `--tiq-pill-*`, `--tiq-ac`…) que el widget consume,
tanto en el preview del admin como en el storefront. Reconstruir el editor **no
requiere cambiar el motor**; requiere (a) enriquecer el modelo `diseno`, (b)
reemplazar la UI por una de manipulación directa, y (c) mapear cada control a una
variable/JSON. Este documento define exactamente eso.

---

## 1. Arquitectura del sistema (de lo macro al detalle)

### 1.1 Entidades del modelo conceptual

```
BundleDesign (raíz — persistida en el bundle)
├── Layout        estructura del widget           { template: "vertical" | "horizontal" }
├── Geometry      ejes continuos                  { radius: 0..50, breathing: min..max }
├── Palette       preset activo + swatches        { active: "<id>", source: "preset" | "custom" }
├── ColorTokens   color por rol semántico         { cardBg, cardBgSel, border, borderSel,
│                                                    badgeBg, badgeTx, priceTx, strikeTx, radioBd… }
├── Typography    fuente/estilo por rol de texto  { titleFont, tierFont, badgeFont … }
└── Content       textos editables del widget     { title, tierLabel, badgeText, standardLabel,
                                                     soldOutMsg … }  (+ color/fuente por texto)
```

`Preview` **no es una entidad persistida**: es una función pura
`render(BundleDesign, ProductoDemo) → DOM`. Es el mismo render del storefront.

### 1.2 Relación entre entidades

- `Palette` es un **atajo**: al elegir un preset, se **escriben en bloque** los
  `ColorTokens`. A partir de ahí el usuario puede sobreescribir tokens sueltos en
  `Personalizar` → el estado pasa a `source: "custom"` (el preset queda como
  "punto de partida", no como binding permanente). *(Hecho verificable en la
  captura: hay botón "Undo" al lado de las paletas → los cambios de paleta son
  reversibles como una acción atómica.)*
- `Geometry.radius` alimenta **múltiples** variables de radio a la vez
  (tarjeta + botón + radio-selector) desde un solo control. *(Hoy en TiendaIQ hay
  radios separados; Pumper los unifica bajo "All corner roundness".)*
- `Layout.template` cambia la **estructura del DOM** del widget, no solo estilos:
  vertical = filas apiladas; horizontal = columnas. Es la única capa que altera
  el markup; el resto solo altera tokens/variables.

### 1.3 Flujo reactivo (sin omitir etapas)

```
Usuario mueve/tipea en un Control
   ↓  (evento input/change, con data-binding declarativo)
Handler traduce el valor → ruta del modelo (p. ej. "geometry.radius" = 18)
   ↓
Estado en memoria (objeto BundleDesign) se muta   → marca "sucio"
   ↓
Serializador: BundleDesign → { CSS vars } + { textos }
   ↓
Preview: aplica las CSS vars al contenedor y re-renderiza el widget (mismo
código que el storefront) → cambio visible <16 ms (sin round-trip al server)
   ↓
Persistencia: al Guardar (o vía Save Bar) → PUT /api/bundles con el JSON completo.
El storefront recibe el mismo JSON y produce el mismo render (paridad admin↔tienda)
```

**Hecho (TiendaIQ):** este flujo ya existe. `bindEditorBundle` escucha `input`,
`fijar(b, ruta, v)` muta el modelo por ruta, `pintarPreviewBundle()` re-renderiza
con `previewBundleHTML(b)`, y el guardado es `PUT /api/bundles`. La reconstrucción
reusa este pipeline; solo cambian los controles y se agregan rutas al modelo.

---

## 2. Modelo de datos (esquema objetivo)

Extensión del actual `b.diseno`. En **negrita** lo nuevo respecto de hoy.

```jsonc
{
  "diseno": {
    "layout": { "template": "horizontal" },          // NUEVO: "vertical" | "horizontal"
    "geometry": {
      "radius": 18,                                   // NUEVO nombre unificado (hoy: "radio")
      "breathing": 21                                 // NUEVO: aire interno (padding/gap escalado)
    },
    "palette": { "active": "rosa", "source": "custom" }, // hoy: "preset"

    // ColorTokens — hoy existen varios; se completan a "por rol":
    "color_card_bg":        "#fff5f8",   // NUEVO: fondo tarjeta no seleccionada
    "color_card_bg_sel":    "#ffffff",   // NUEVO: fondo tarjeta seleccionada
    "color_borde":          "#db2777",   // borde seleccionado (existe)
    "color_badge":          "#db2777",   // fondo insignia (existe)
    "color_badge_texto":    "#ffffff",   // texto insignia (existe)
    "color_etiqueta":       "#db2777",   // etiqueta % OFF (existe)
    "color_texto":          "#111111",   // texto general (existe)
    "color_precio_tachado": "#9aa0a6",   // NUEVO: precio original tachado
    "radio_borde_color":    "#db2777",   // NUEVO: color del radio/selector

    // Typography — NUEVO: fuente/peso por rol de texto
    "type": {
      "title":  { "font": "sans", "weight": 700 },
      "tier":   { "font": "sans", "weight": 600 },
      "badge":  { "font": "sans", "weight": 700 },
      "label":  { "font": "sans", "weight": 500 }
    },

    // Content — textos del widget editables (hoy solo title/subtitle existen)
    "content": {
      "title":        "Elegí tu paquete y ahorrá",
      "subtitle":     "Cuantas más unidades, mejor el precio",
      "standardLabel":"Precio normal",          // NUEVO ("Standard Price")
      "badgeText":    "Más elegido",            // NUEVO (texto insignia por defecto)
      "soldOutMsg":   "¡Los artículos resaltados están agotados!" // NUEVO
    },

    "boton": { "texto": "Agregar al carrito — {total}",
               "color_fondo": "#db2777", "color_texto": "#ffffff",
               "radio": 8, "tamano": 16 }
  }
}
```

**Mapeo modelo → variables CSS** (contrato con el widget; hoy vive en
`previewBundleHTML` y `tiendaiq-bundle.js`):

| Rol de token           | Variable CSS        | Fuente en el modelo        |
|------------------------|---------------------|----------------------------|
| Redondeo global        | `--tiq-radio`       | `geometry.radius`          |
| Aire interno           | `--tiq-gap` (NUEVO) | `geometry.breathing`       |
| Borde seleccionado     | `--tiq-borde`       | `color_borde`              |
| Fondo tarjeta          | `--tiq-card-bg`     | `color_card_bg`            |
| Borde tarjeta          | `--tiq-card-bd`     | derivado (mezcla)          |
| Fondo insignia         | `--tiq-badge`       | `color_badge`              |
| Texto insignia         | `--tiq-badge-txt`   | `color_badge_texto`        |
| Etiqueta % OFF         | `--tiq-etq`         | `color_etiqueta`           |
| Acento (radio/pill)    | `--tiq-ac`          | `radio_borde_color`        |
| Botón (fondo/txt/…)    | `--tiq-bot-*`       | `boton.*`                  |

> **Principio:** el editor **nunca** escribe CSS directamente. Escribe **modelo**.
> El serializador (una sola función) traduce modelo → variables. Esto garantiza
> paridad admin↔storefront y hace el editor testeable sin DOM.

---

## 3. Los bloques del editor

Cada bloque se analiza desde **Producto · UX · Sistema de diseño · Frontend**.
El orden vertical del panel es intencional: **de lo estructural a lo cosmético**.

### 3.1 Bloque "Diseño de Plantilla" (Layout template)

**Producto.** Resuelve la decisión más grande y menos reversible: la **forma**
del widget (apilado vertical vs columnas horizontales). Va primero porque cambia
la estructura sobre la que se apoya todo lo demás; elegir colores antes de la
forma sería trabajo perdido. El callout azul ("estás usando variables dinámicas…
las plantillas heredadas están ocultas") comunica un **contrato de compatibilidad**:
ciertas plantillas viejas no soportan las variables nuevas, así que se ocultan
para no ofrecer combinaciones rotas. *(Flujo mental del usuario: "¿cómo quiero
que se vea la oferta: en lista o en tira?" → elige → recién ahí piensa en color.)*

**UX.** Dos cards grandes, clicables, con **mini-preview real** de cada layout y
un badge "Recomendado". La seleccionada lleva check verde + borde de color. Es
reconocimiento, no recuerdo: el usuario ve el resultado antes de elegir. Carga
cognitiva mínima (2 opciones), decisión de alto nivel.

**Sistema de diseño.** Cards ~150×150, borde 1px, radio 12, la activa con borde
de acento (verde) 2px + check. El badge "Recomendado" es una pill chica sobre la
card. Mini-preview construido con los mismos primitivos del widget (no imágenes).

**Frontend.**
```
<fieldset role="radiogroup" aria-label="Plantilla">
  <label class="tpl-card is-sel"><input type="radio" name="tpl" value="horizontal" hidden>
     <span class="tpl-badge">Recomendado</span>
     <div class="tpl-mini tpl-mini--horizontal">…</div>
     <span class="tpl-name">Horizontal</span></label>
  <label class="tpl-card">…vertical…</label>
</fieldset>
```
Estado: `diseno.layout.template`. Al cambiar → re-render del preview (el widget
elige markup según `template`). **[HIPÓTESIS]** las "plantillas heredadas
ocultas" implican que Pumper mantiene un catálogo mayor de templates versionados;
para TiendaIQ alcanza con las dos actuales (`vertical`/`horizontal`) y el callout
puede omitirse hasta que existan plantillas legacy.

### 3.2 Bloque "Diseño" (sliders de geometría)

**Producto.** Dos ejes **continuos** que definen el "carácter" del widget sin
tocar color: **redondeo** (de cuadrado a muy redondeado) y **breathing space**
(compacto ↔ aireado). Son continuos (no presets) porque el gusto de redondez/aire
es subjetivo y granular. "All corner roundness" unifica todos los radios en un
control → coherencia garantizada (imposible dejar la tarjeta redonda y el botón
cuadrado por error).

**UX.** Slider con ícono a la izquierda (esquina para radius, flechas
expandiendo para breathing), y **valor numérico "18 / 50"** a la derecha →
feedback exacto + rango visible. Edición en tiempo real: se ve el preview cambiar
mientras se arrastra. Rango acotado (0–50, ~min–24) evita valores absurdos.

**Sistema de diseño.** Slider nativo estilizado (track fino gris, thumb
circular). Label 13/500. Valor en gris `#6d7175`. Ícono 20px. Fila alto ~40,
gap 16 entre sliders.

**Frontend.**
```
<div class="slider-row">
  <span class="slider-ico">▢</span>
  <label class="visually-hidden" for="radius">All corner roundness</label>
  <input type="range" id="radius" min="0" max="50" step="1" data-b="diseno.geometry.radius">
  <output>18 / 50</output>
</div>
```
- `radius` → `--tiq-radio` (y radios derivados de botón/selector escalados).
- `breathing` → `--tiq-gap` NUEVO (multiplica el padding/gap interno de las
  tarjetas del widget). **Requiere** agregar esa variable al widget CSS.
Actualización: `input` (no `change`) para arrastre en vivo; `output` refleja el
valor. Accesibilidad: `aria-valuetext`, foco visible.

### 3.3 Bloque "Paletas de colores" (presets)

**Producto.** Un preset aplica un **set coherente** de colores de un toque. Es el
95% de los casos de uso: el merchant quiere "que combine con mi marca" sin pensar
7 colores. Existe porque elegir colores individualmente es la tarea más pesada y
donde más se rompe la coherencia. "Undo" existe porque aplicar una paleta pisa
todos los tokens → es destructivo → necesita reversa inmediata.

**UX.** Galería horizontal de swatches, cada uno un **mini-preview de la tarjeta**
en ese esquema (no un círculo de color: muestra el resultado real). Selección con
borde/anillo de acento. "Undo" al final. Descubrimiento por reconocimiento. Un
clic = cambio total + preview inmediato.

**Sistema de diseño.** Swatch ~28–34px, radio 8, muestra 2–3 barras del mini
widget. Activo con anillo 2px. Fila scrolleable si no entran. "Undo" como botón
fantasma chico.

**Frontend.**
```
<div class="palette-row" role="listbox" aria-label="Paletas">
  <button role="option" class="pal is-sel" data-palette="rosa">
     <span class="pal-mini">…3 barras con los colores del preset…</span></button>
  …
  <button class="pal-undo" data-palette-undo>Undo</button>
</div>
```
Estado: al click, `aplicarPaleta(id)` escribe **todos** los ColorTokens desde
`PRESETS_BDL[id]` y setea `palette.active/source`. `Undo` restaura el snapshot
previo (guardar un `_snapshot` del `diseno` antes de aplicar).
**Hecho (TiendaIQ):** ya existe `PRESETS_BDL` con 6 paletas y el handler
`data-preset`; falta (a) render visual (mini-preview en vez de texto) y (b) Undo.

### 3.4 Bloque "Personalizar" (manipulación directa)

Es el corazón del editor y lo que más lo distingue. Subtítulo: *"Color, Texto,
Ancho del borde"*.

**Producto.** Para el 5% que quiere control total. Resuelve "quiero ESTE elemento
de ESTE color / con ESTA fuente / con ESTE texto". La clave: no es un formulario
de 20 inputs sueltos; es un **mapa visual** — una mini-tarjeta en el centro con
**flechas** que conectan cada control (izquierda = colores de fondo/borde;
derecha = colores de texto + fuente `Aa`) a la parte que afecta. El usuario ve
**qué** cambia cada control antes de tocarlo (mapping espacial = cero ambigüedad).
Debajo, filas de **texto editable**: cada string del widget ("Buy More Save More",
"Buy 1", "Standard Price", "Más Popular", mensaje de agotado) con su control de
fuente/color y el texto real editable inline.

**UX.** Jerarquía: (1) el mapa visual arriba (colores por posición), (2) los
textos abajo (contenido). El mapa reduce carga cognitiva brutalmente: en vez de
"Color de fondo de tarjeta seleccionada" (texto), ves la tarjeta y su swatch al
lado. Feedback inmediato en el preview grande. Las flechas son el recurso de UX
central: enseñan la relación control→efecto.

**Sistema de diseño.**
- Swatch de color = cuadrado ~28px, radio 6, con el color; al click abre color
  picker. Los oscuros (texto) a la derecha; los de superficie a la izquierda.
- Botón de fuente = `Aa` en caja ~28px (abre selector de tipografía/peso).
- Mini-tarjeta central = el widget real a escala.
- Filas de texto: `[Aa] → <texto editable>` con la tipografía aplicada, para
  previsualizar el estilo en el propio texto.

**Frontend.** Estructura en tres columnas (grid):
```
<div class="perso">
  <div class="perso-left">   <!-- swatches de superficie/borde -->
     <button class="sw" data-token="color_card_bg" style="--c:#fff5f8"></button>
     <button class="sw" data-token="color_card_bg_sel"></button>
     <button class="sw" data-token="color_borde"></button>   <!-- ancho/color de borde -->
     <button class="sw" data-token="color_etiqueta"></button>
  </div>
  <div class="perso-mid"><!-- mini widget real (render(diseno)) --></div>
  <div class="perso-right"> <!-- color de texto + fuente por zona -->
     <button class="sw sw--dark" data-token="color_texto"></button>
     <button class="font" data-font="type.title">Aa</button>
     <button class="sw sw--dark" data-token="color_precio_tachado"></button>
     <button class="font" data-font="type.tier">Aa</button>
  </div>
</div>

<div class="perso-texts">
  <button class="font" data-font="type.title">Aa</button>
  <input data-b="diseno.content.title" value="Buy More Save More">
  <button class="font" data-font="type.tier">Aa</button>
  <input data-b="diseno.content.tierLabel" value="Buy 1">
  <!-- Standard Price, Más Popular, mensaje agotado … -->
</div>
```
- Cada `data-token` abre un `<input type="color">` (o popover) y escribe el token.
- Cada `data-font` abre selector de fuente/peso → escribe `type.<rol>`.
- Cada `data-b` de texto escribe `content.<clave>` y el widget re-renderiza con
  el string nuevo.
Las **flechas** son decorativas (SVG/`::before`) que unen la columna con la
mini-tarjeta; no requieren lógica, solo layout de grid con líneas.

---

## 4. Sistema de diseño (tokens del EDITOR, no del widget)

El chrome del editor sigue **Polaris** (ya alineado en el resto del panel):

- **Tipografía:** título de sección 16/600; label 13/500; valor/secundario
  13/400 `#6d7175`; texto `#202223`. Fuente Inter.
- **Spacing:** escala 4/8 exclusiva. Gap entre bloques 24; entre controles 16;
  interno 8.
- **Cards/acordeón:** borde `#d2d5d8`, radio 12, padding 16, sombra
  `0 1px 2px rgba(0,0,0,.05)`.
- **Controles:** slider (track `#e3e3e3`, thumb circular), swatch 28px radio 6,
  botón `Aa` 28px radio 6, select 44px radio 8 borde `#c9cccf`.
- **Iconografía:** 20px, stroke 1.75, color `#6d7175`.
- **Callout:** fondo `#f1f6fe`, borde/acento azul Polaris, ícono info.

**Nota importante:** hay DOS sistemas de diseño en juego y no deben mezclarse.
(1) El **chrome del editor** = Polaris (Shopify admin). (2) El **contenido del
widget** = la marca del merchant (rosa/naranja/lo que elija). El editor pinta el
widget con los colores del merchant, pero el editor en sí es Polaris.

---

## 5. Ingeniería frontend (arquitectura recomendada)

### 5.1 Principios

1. **Modelo único, serializador único.** `BundleDesign` (JSON) → `serializar()`
   → `{ cssVars, textos }`. Un solo lugar traduce. Testeable sin DOM.
2. **Binding declarativo.** Controles con `data-b="ruta.al.modelo"` (ya existe) o
   `data-token` / `data-font` / `data-palette`. Un delegador por evento en la
   raíz del panel (no listeners por control) → sobrevive re-renders.
3. **Preview = función pura del storefront.** No duplicar lógica: el admin importa
   el MISMO render del widget. Paridad garantizada.
4. **Actualización granular.** `input` → mutar modelo → aplicar solo las CSS vars
   afectadas al contenedor del preview (sin re-montar el widget cuando solo cambia
   un color) → re-render completo solo cuando cambia `layout.template` o `content`.

### 5.2 Componentes

| Componente        | Responsabilidad                                   |
|-------------------|---------------------------------------------------|
| `TemplatePicker`  | radio de layout; muta `layout.template`           |
| `GeometrySlider`  | slider + output; muta `geometry.*`                |
| `PaletteGallery`  | swatches + Undo; aplica preset / restaura snapshot|
| `DirectEditor`    | mapa visual color/fuente por token                |
| `TextRows`        | textos editables + fuente por string              |
| `PreviewRenderer` | render(diseno, productoDemo) → DOM (compartido)   |
| `DesignSerializer`| diseno → { cssVars, textos } (puro)               |

### 5.3 Estados por componente

- Swatch/slider/select: `default · hover · focus-visible · active · disabled`.
  **Hoy faltan** hover/focus-visible/disabled consistentes → agregarlos (lo marcó
  el QA como parte del "se siente nativo").
- Paleta: `default · selected · applying`.
- Undo: `enabled` solo si hay snapshot; si no, `disabled`.

### 5.4 Reactividad (implementación concreta en TiendaIQ)

```
be-left (raíz, un solo listener 'input' + 'click' — patrón actual)
  input[data-b]      → fijar(b, ruta, valor) → pintarPreviewBundle()
  [data-token]       → abrir color → fijar(b, "diseno."+token, hex) → preview
  [data-font]        → abrir selector → fijar(b, "diseno."+ruta, {font,weight}) → preview
  [data-palette]     → snapshot = clone(b.diseno); aplicarPaleta(id) → preview
  [data-palette-undo]→ b.diseno = snapshot → pintarEditorBundle()
pintarPreviewBundle() → previewBundleHTML(b) (ya aplica las --tiq-* vía serializador)
Guardar/Save Bar    → PUT /api/bundles (JSON completo)  → storefront usa el mismo JSON
```

**Hecho:** `fijar`, `bindEditorBundle` (delegación), `previewBundleHTML` y el
guardado ya existen y son exactamente este patrón. La reconstrucción es
**aditiva**: nuevos controles + nuevas rutas en `diseno` + nuevas `--tiq-*`.

---

## 6. Mapeo a TiendaIQ — qué existe, qué falta, qué tocar

| Capacidad Pumper            | Estado en TiendaIQ                     | Trabajo |
|-----------------------------|----------------------------------------|---------|
| Objeto diseño → CSS vars    | **Existe** (`b.diseno` → `--tiq-*`)    | —       |
| Preview en vivo compartido  | **Existe** (`previewBundleHTML`)       | —       |
| Presets de color            | **Existe** (`PRESETS_BDL`, `data-preset`) | Falta render visual + Undo |
| Slider de redondeo          | Parcial (`radio` numérico separado)    | Unificar a un slider `geometry.radius` |
| Slider "breathing"          | **No existe**                          | Nuevo: `geometry.breathing` + `--tiq-gap` en el widget |
| Layout vertical/horizontal  | **No existe** (solo un layout)         | Nuevo: `layout.template` + rama de markup en el widget |
| Personalizar (mapa visual)  | Parcial (color pickers sueltos)        | Reconstruir como mapa directo con flechas |
| Tipografía por rol          | **No existe**                          | Nuevo: `type.*` + variables de fuente en el widget |
| Textos editables del widget | Parcial (`title`, `subtitle`)          | Extender a badge/standard/soldOut + color/fuente por texto |
| Undo de paleta              | **No existe**                          | Snapshot antes de aplicar preset |

**Orden de implementación sugerido** (de mayor impacto estructural a detalle,
respetando "sistema → detalle"):

1. **Serializador explícito** `disenoAVars(diseno)` (extraer lo que hoy está
   inline en `previewBundleHTML`) → base para todo lo demás y para tests.
2. **Geometría unificada** (slider radius + breathing con `--tiq-gap`).
3. **Galería de paletas visual + Undo** (reusa `PRESETS_BDL`).
4. **Layout template** (vertical/horizontal) — toca el markup del widget.
5. **Personalizar (mapa directo)** — color/fuente por token con flechas.
6. **Tipografía y textos por rol** (`type.*`, `content.*`).
7. **Estados interactivos** (hover/focus/disabled) en todos los controles.

Cada paso es independiente, verificable con el preview, y no rompe el guardado
(el JSON es retrocompatible: propiedades nuevas con defaults).

---

## 7. Hipótesis (lo no demostrable desde la captura)

- **[HIPÓTESIS]** El "Theme object" interno de Pumper ≈ nuestro `b.diseno`
  (JSON serializable). Justificación: el preview cambia sin recargar y persiste;
  el único mecanismo consistente con paridad admin↔tienda es un JSON → CSS vars,
  que es lo que TiendaIQ ya hace. Muy probable.
- **[HIPÓTESIS]** El slider "breathing" escala padding/gap internos (no márgenes
  externos). Justificación: afecta la densidad del contenido, no la posición del
  widget. Alta confianza.
- **[HIPÓTESIS]** "Plantillas heredadas ocultas" = versionado de templates legacy
  incompatibles con las variables nuevas. Justificación: el texto del callout lo
  dice explícitamente. Para TiendaIQ es irrelevante hasta tener legacy.
- **[HIPÓTESIS]** El Undo es de un solo nivel (última aplicación de paleta), no un
  historial completo. Justificación: es un botón simple junto a las paletas, no un
  stack. Media-alta confianza; si se quiere multinivel, es un stack de snapshots.
- **No demostrable:** rangos exactos de los sliders (se ve 18/50 y 21/24 → radius
  0–50; breathing tope ~24, piso probable 0 o 8). Ajustar con el merchant.

---

## 8. Criterio de finalización

El módulo se considera reconstruido cuando:

1. El modelo `diseno` cubre las 6 capas (Layout, Geometry, Palette, ColorTokens,
   Typography, Content) y se serializa a variables con una sola función.
2. Cada control muta el modelo (no CSS) y el preview refleja el cambio <16ms.
3. Existe paridad admin↔storefront (mismo JSON → mismo render).
4. La UX replica el patrón de Pumper: plantilla → geometría → paleta →
   personalización directa, con manipulación directa + preview en vivo.
5. El chrome del editor cumple Polaris (tokens de la sección 4) y todos los
   controles tienen sus estados (hover/focus/disabled).
6. Guardado retrocompatible: bundles viejos abren sin romperse (defaults).
```
