# Editor de páginas de producto — Arquitectura v3

**Estado:** Fase 0–2 terminadas; Fase 3 en integración segura del editor y storefront v1
**Fecha:** 2026-09-03
**Rama base:** `main`
**Reemplaza:** el editor actual (`app/app.js` líneas ~1600-3900) y el renderer `extensions/tiendaiq-widgets/assets/tiendaiq.js`
**Idioma del código:** **español** (nombres de archivo, funciones, variables, comentarios y commits). Sin excepciones.

---

## 0. Para quien retome este trabajo

Este documento es autosuficiente. Si quien lo lee no participó de la conversación original,
alcanza con leerlo entero antes de escribir una línea de código.

Reglas que no se negocian:

1. **No tocar** `auth.js`, `db.js`, `facturacion.js`, `shopify.js`, `publicar.js`, `src/tenancy/`,
   `src/webhooks/`, `src/capacity/`, `src/jobs/`. Están bien y son la parte compliant con el App Store.
2. **No borrar nada hasta la Fase 3.** Se construye al lado, se migra, y recién después se borra.
3. **Una fase = un PR.** Cada fase deja la app funcionando y con sus tests en verde.
4. **Ningún `<input>`, `<select>` ni `<div>` de propiedades escrito a mano.** Si aparece uno, la
   arquitectura ya se violó. Ver §3.
5. **Un solo renderer.** Si en algún momento hay dos funciones que producen el HTML de un bloque,
   la arquitectura ya se violó. Ver §4.

Antecedente relevante: en el commit `a087987` hubo que revertir una reescritura no solicitada del
sistema de creación de página. Este documento existe precisamente para que el trabajo esté acotado
y verificable. Lo que no está en este documento, no se hace.

---

## 1. Diagnóstico: por qué el editor actual no puede escalar

Evidencia medida sobre el repo (2026-09-02):

| Archivo | Tamaño | Problema |
|---|---|---|
| `app/app.js` | 6.372 líneas / 372 KB | Monolito: 9 pantallas, todo el HTML en template literals |
| `app/app.css` | 3.775 líneas / 186 KB | Sin sistema de tokens; estilos por pantalla |
| `extensions/tiendaiq-widgets/assets/tiendaiq.js` | 1.810 líneas / 116 KB | Renderer fijo del "Producto Universal" |

El error de diseño concreto, con ubicación:

- `app/app.js:1895-1905` — el panel de propiedades de la plantilla azul es **una sola expresión**
  con rutas literales (`facetas.pagepilot_blue.social.titular`, `...blue_stats.items.3.pct`) y los
  textos de ejemplo incrustados en el mismo string.
- `app/app.js:3552` — `pantallaPreviewPiloto01()` es **una segunda copia entera del panel** para la
  otra plantilla.

Es decir: **cada plantilla nueva obliga a escribir un panel nuevo a mano.** Con 2 plantillas ya hay
duplicación; con 10 es inmantenible; con 39 secciones anidables es imposible.

Además hay **dos verdades sobre cómo se ve un bloque**: el preview del editor (HTML armado en
`app.js`) y el storefront (`tiendaiq.js`). Divergen por construcción. Todo lo que el merchant ve en
el editor y no coincide con la tienda nace de acá.

Lo que sí está bien y se conserva:

- Rutas REST claras en `server.js`: `/api/paginas`, `/api/paginas/:id`, `/publicar`, `/despublicar`, `/imagenes`.
- `db.js` con funciones por dominio y exports explícitos.
- `publicar.js` (191 líneas): metafield `tiendaiq.pagina` + `templateSuffix`, sin escribir el tema.
  **Esta es la pieza compliant. No se toca.**
- `adaptador.js:113` `extraer()`: extracción GraphQL del producto.
- `src/piloto/piloto-pdp-01.schema.json` + `src/piloto/pdp01-contract.js`: único lugar ya declarativo
  del repo. Es la semilla correcta y se generaliza en la Fase 0.

---

## 2. Los seis invariantes

Todo lo que sigue se deriva de estos seis. Si una decisión futura contradice uno, la decisión está mal.

### I1 — Un solo modelo de documento
Editor, preview, storefront, IA y base de datos operan sobre **el mismo JSON**. Nadie arma HTML por
su cuenta. El documento es serializable, versionado y validable.

### I2 — Un solo renderer, función pura
`render(nodo, ctx) -> string`. El mismo archivo corre en Node (validación, pruebas, previews
servidor) y en el navegador (editor y storefront). Se compila con esbuild a dos bundles desde una
única fuente. Dos renderers = divergencia garantizada.

### I3 — El schema es dato, no código
Un tipo de bloque **declara** sus campos. El panel de propiedades se genera de esa declaración.
El conjunto de tipos de control es **cerrado** (§3.3): 16 controles cubren las 39 secciones.
Agregar una sección = agregar un archivo en `nucleo/tipos/`. Cero cambios en el editor.

### I4 — Herencia explícita de estilos
`props` guarda **solo overrides**. Ausente = hereda. La cascada es:

```
props_movil[clave]        (solo si el viewport es móvil)
  → props[clave]
    → token de branding referenciado por el default del tipo
      → default literal del tipo
```

Esto es lo que en PagePilot se ve como el micro-toggle a la izquierda de cada control: apagado =
heredado, encendido = override. Se modela como `undefined` vs valor. **Nunca** como string vacío ni
como `0`, porque `0` es un override legítimo.

### I5 — Ids estables y comandos, no mutaciones
Cada nodo tiene un `id` inmutable. Todo cambio pasa por un bus de comandos
(`fijarProp`, `insertarNodo`, `moverNodo`, `borrarNodo`, `duplicarNodo`). De ahí salen gratis:
undo/redo, estado sucio (botón Guardar deshabilitado si no hay cambios), guardado por diff,
y más adelante analítica por bloque y A/B.

### I6 — Migraciones versionadas
El documento lleva `version`. Cada cambio de schema trae su función `migrar_vN_vN+1`.
Sin esto, el primer cambio de schema rompe todas las páginas publicadas de todas las tiendas.
Este invariante es el que separa "prototipo" de "producto con 1000 tiendas".

---

## 3. El contrato

### 3.1 Documento

```jsonc
{
  "version": 1,
  "id": "pag_0e07b42e",
  "tienda": "emi7zn-jd.myshopify.com",
  "producto_id": "gid://shopify/Product/123",
  "titulo": "Professional Office Shirt",
  "branding": {
    "preset": "verde",                     // id del preset activo
    "tokens": {                            // overrides del preset; ausente = valor del preset
      "primario": "#1D3B1D",
      "primario_suave": "#FCFCF7",
      "secundario": "#E9F0CA",
      "secundario_suave": "#F8FAEF",
      "boton_fondo": "#1D3B1D",
      "boton_texto": "#FCFCF7",
      "titulos": "#1D3B1D",
      "subtitulos": "#1D3B1D",
      "parrafos": "#1D3B1D"
    },
    "radio": "pequeno",                    // ninguno | pequeno | grande
    "tipografia": { "titulos": "grotesca", "cuerpo": "sistema" }
  },
  "seo": {
    "descripcion": "…",
    "palabras_clave": ["office shirt", "workwear"]
  },
  "arbol": [ /* nodos */ ]
}
```

### 3.2 Nodo

```jsonc
{
  "id": "n_a1b2c3",              // inmutable, generado al insertar
  "tipo": "texto",               // clave en el registro
  "props": { "tamano": 13, "peso": "semibold" },   // SOLO overrides de escritorio
  "props_movil": { "tamano": 11 },                 // SOLO overrides de móvil
  "hijos": []                    // solo si el tipo admite hijos
}
```

Reglas:
- Una clave ausente en `props` **hereda**. No se escriben defaults en el documento.
- `props_movil` solo existe si hay al menos un override móvil.
- `hijos` solo existe si `admite_hijos` es `true` en la definición del tipo.

> **Decisión tomada en la Fase 0.** Un borrador previo de este documento ponía
> `visible: {movil, escritorio}` y `clase` como campos del nodo, al lado de `props`.
> Se descartó: obligaba al panel a tener casos especiales para dibujarlos, y el
> panel tiene que ser *totalmente* genérico (I3). Ahora son props normales
> (`mostrar_movil`, `mostrar_escritorio`, `clase`), aportadas por
> `grupoVisibilidad()` y `grupoAvanzado()` de `nucleo/tipos/_base.js`. **Todo lo
> que el merchant edita es una prop. Sin excepciones.**

### 3.3 Definición de tipo (registro)

Un archivo por tipo en `nucleo/tipos/`. Forma:

```js
// nucleo/tipos/texto.js
module.exports = {
  tipo: "texto",
  nombre: "Texto",
  categoria: "contenido",          // ver §3.5
  icono: "texto",
  admite_hijos: false,
  limite_por_pagina: null,         // null = sin límite; 1 = como Sticky Add to Cart
  grupos: [
    {
      id: "tipografia",
      nombre: "Tipografía",
      responsive: true,            // muestra el toggle escritorio/móvil del grupo
      campos: [
        { clave: "html",   tipo: "richtext",    etiqueta: "Texto", ia: true },
        { clave: "color",  tipo: "token_color", etiqueta: "Color de marca", defecto: "@parrafos" },
        { clave: "tamano", tipo: "medida",      etiqueta: "Tamaño", unidad: "px", defecto: 16, min: 8, max: 96 },
        { clave: "peso",   tipo: "seleccion",   etiqueta: "Grosor",
          opciones: [["regular","Regular"],["medium","Medium"],["semibold","Semibold"],["bold","Bold"]],
          defecto: "regular" },
        { clave: "espaciado", tipo: "segmentado", etiqueta: "Interletrado",
          opciones: [["tight","Ajustado"],["normal","Normal"],["loose","Amplio"]], defecto: "normal" },
        { clave: "caja",   tipo: "seleccion",   etiqueta: "Mayúsculas",
          opciones: [["normal","Normal"],["upper","MAYÚSCULAS"],["lower","minúsculas"]], defecto: "normal" },
        { clave: "interlineado", tipo: "medida", etiqueta: "Altura de línea", unidad: "", defecto: null }
      ]
    },
    { id: "layout",      nombre: "Disposición", responsive: true,  campos: [ /* ancho, alineacion */ ] },
    { id: "visibilidad", nombre: "Visibilidad", responsive: false, campos: [ /* mostrar_en */ ] },
    { id: "apariencia",  nombre: "Apariencia",  responsive: true,  campos: [ /* fondo, borde, radio, sombra */ ] },
    { id: "espaciado",   nombre: "Espaciado",   responsive: true,  campos: [ /* padding x4, margin x2 */ ] },
    { id: "avanzado",    nombre: "Avanzado",    responsive: false, campos: [ { clave:"clase", tipo:"texto_plano", etiqueta:"Clase CSS" } ] }
  ],
  render(nodo, ctx) {
    const v = ctx.resolver(nodo);                       // aplica la cascada I4
    return `<p class="tiq-texto ${nodo.clase}" style="${ctx.estilos(v, [
      "color","tamano","peso","espaciado","caja","interlineado"
    ])}">${ctx.sanear(v.html)}</p>`;
  }
};
```

**`@parrafos` con arroba = referencia a token de branding.** El resolver la desreferencia.
Sin arroba = valor literal.

### 3.4 Tipos de control (conjunto CERRADO)

El panel solo sabe renderizar estos 16. Ninguna sección puede pedir uno nuevo sin que se agregue
acá primero, con revisión.

| Tipo | Uso | Valor |
|---|---|---|
| `texto_plano` | nombres, clases CSS | `string` |
| `texto_largo` | descripciones | `string` |
| `richtext` | copy con formato | `string` (HTML saneado, allowlist estricta) |
| `numero` | conteos | `number` |
| `medida` | tamaños con unidad | `number` (unidad en el campo) |
| `booleano` | switches (Sticky, etc.) | `boolean` |
| `seleccion` | desplegable | `string` |
| `segmentado` | 2-3 opciones en botones | `string` |
| `token_color` | color de marca | `"@titulos"` \| `"#RRGGBB"` |
| `color` | color libre | `"#RRGGBB"` \| `null` |
| `imagen` | media | `{ src, alt, id }` |
| `video` | media | `{ src, poster, id }` |
| `icono` | iconos del set | `string` (clave del set) |
| `enlace` | CTA | `{ url, texto, nueva_pestana }` |
| `lista` | repetidor (reseñas, FAQ, beneficios) | `array` de objetos; el campo declara `item_campos` |
| `producto` | selector de producto Shopify | `gid` |

Nada más. Si una sección "necesita" otro control, casi siempre es una `lista` mal modelada.

### 3.5 Categorías del catálogo

Espejo del competidor, para que el merchant que migra no se pierda:

`prueba_social` · `beneficios` · `imagen_contenido` · `conversion` · `faq` · `garantia` · `layout` · `integraciones`

### 3.6 Presets de branding

Siete presets con nombre, editables, más "crear preset". Cada uno define los 9 tokens de §3.1.
Semilla: `rosa`, `violeta`, `amarillo`, `turquesa`, `azul`, `verde`, `gris`.

Los tokens se emiten como custom properties de CSS en el contenedor del documento:

```css
.tiq-doc { --tiq-primario:#1D3B1D; --tiq-titulos:#1D3B1D; /* … */ }
```

Cambiar de preset = reescribir 9 variables. **No** re-renderizar el árbol.

---

## 4. Estructura de archivos

```
nucleo/                          # compartido Node + navegador. SIN acceso al DOM.
  documento.js                   # crear, validar (AJV), migrar
  registro.js                    # carga y expone las definiciones de tipo
  resolver.js                    # cascada de estilos (I4) + estilos() + sanear()
  tokens.js                      # presets, desreferencia de @token, emisión de CSS vars
  render.js                      # render(nodo, ctx) -> string  (I2)
  migraciones/
    v0_a_v1.js                   # facetas de la plantilla vieja -> árbol de nodos
  tipos/
    indice.js                    # lista explícita de tipos (un require por tipo)
    _base.js                     # grupos comunes: apariencia, espaciado, visibilidad, avanzado
    seccion.js
    texto.js
    imagen.js
    ...                          # un archivo por tipo

app/editor/                      # solo navegador
  arbol.js                       # panel izquierdo: árbol, drag, colapsar, contadores
  panel.js                       # panel derecho: genera desde grupos+campos
  controles/                     # los 16 de §3.4, uno por archivo
  lienzo.js                      # iframe de preview, selección, toolbar flotante del bloque
  libreria.js                    # modal "Añadir sección": categorías, buscador, miniaturas
  comandos.js                    # bus de comandos + undo/redo + estado sucio (I5)
  branding.js                    # panel de branding y presets

app/dist/                        # generado por esbuild, no se edita a mano
  render.editor.js

extensions/tiendaiq-widgets/assets/
  tiq-render.js                  # generado por esbuild desde nucleo/ (mismo origen que el editor)
  tiq-render.css
```

**Regla de oro del build:** `app/dist/render.editor.js` y `assets/tiq-render.js` se generan del
**mismo** `nucleo/render.js`. Hay un test que compila ambos y compara el HTML de un documento de
referencia. Si difieren, falla.

**Por qué `tipos/indice.js` y no `fs.readdirSync`.** El registro se empaqueta con esbuild para el
navegador, y un bundler no puede seguir una lectura de disco en tiempo de ejecución. El precio es
una línea por tipo; la ganancia es que el mismo código corre en Node y en la tienda del merchant
(I2). Agregar una sección sigue siendo: crear el archivo + agregar su línea. **Ni una línea de
`app/editor/`.**

---

## 5. Backend

### 5.1 Contrato HTTP (se conserva la forma actual)

| Método | Ruta | Cambio |
|---|---|---|
| GET | `/api/paginas` | sin cambios |
| POST | `/api/paginas` | el cuerpo ahora es un **documento v1** |
| GET | `/api/paginas/:id` | devuelve documento + `publicado_version` |
| PUT | `/api/paginas/:id` | **nuevo**: guarda borrador. Valida contra el registro antes de persistir |
| POST | `/api/paginas/:id/publicar` | flujo histórico v0; bloquea borradores v1 para no mezclar modelos |
| POST | `/api/paginas/:id/publicar-v1` | valida el borrador v1, escribe el metafield y apunta a la plantilla `tiendaiq` |
| POST | `/api/paginas/:id/despublicar` | sin cambios |
| POST | `/api/paginas/:id/imagenes` | sin cambios |
| POST | `/api/texto/editar` | pasa a recibir `{ nodo_id, instrucciones }` |
| GET | `/api/registro` | **nuevo**: el catálogo de tipos para la librería y el panel |

### 5.2 Borrador vs publicado

Dos columnas distintas. **Nunca la misma fila.**

- `documento_borrador jsonb` — lo que edita el merchant.
- `documento_publicado jsonb` + `publicado_en timestamptz` — lo que lee la tienda.

Publicar copia borrador → publicado y escribe el metafield. El storefront jamás lee el borrador.

### 5.3 Validación en el borde

`documento.validar()` con AJV (ya está en `package.json`). Se ejecuta en **todo** PUT y POST, y
también sobre la salida de la IA. Un documento inválido se rechaza con el detalle del campo.
Nunca se confía en que el cliente ni el modelo devolvieron algo bien formado.

### 5.4 Migraciones

`documento.migrar(doc)` aplica en cadena las funciones de `nucleo/migraciones/` hasta la versión
actual. Se ejecuta al **leer**, no al escribir. Las páginas publicadas viejas siguen funcionando.

---

## 6. La IA

Cambio conceptual respecto de hoy:

**Hoy:** la IA rellena `facetas` de una plantilla fija.
**v3:** la IA **emite un árbol de nodos** válido contra el registro.

Pipeline:

1. `extraer(idProducto)` — GraphQL de Shopify. **Se reutiliza tal cual** (`adaptador.js:113`).
2. Se arma el prompt con: ficha del producto + **el registro resumido** (tipos disponibles,
   sus campos, y para qué sirve cada uno) + nicho + idioma.
3. Una llamada con visión: elige imágenes del pool y devuelve el árbol.
4. `documento.validar()`. Si falla → un reintento con los errores concretos. Si vuelve a fallar →
   se cae al árbol por defecto del nicho y se avisa en la UI. **Nunca se guarda algo inválido.**
5. Se guarda como borrador.

`Editar con IA` por nodo: recibe `{ nodo_id, instrucciones }`, la IA devuelve **solo las props de
ese nodo**, se valida contra el schema del tipo, y se aplica como un comando (por lo tanto entra al
undo).

---

## 7. Plan de fases

Cada fase es un PR. Cada fase deja la app funcionando.

### Fase 0 — Núcleo y contrato
Construye `nucleo/` sin tocar nada existente.
- `documento.js`, `registro.js`, `resolver.js`, `tokens.js`
- Tipos semilla: `seccion`, `texto`, `imagen`
- Schema AJV generado **desde** el registro (no escrito a mano)
- Tests unitarios en `pruebas/`

**Criterio de aceptación**
- `npm run unidad` en verde.
- Un documento de ejemplo valida.
- La cascada I4 tiene test explícito: override móvil > override escritorio > token > default,
  y `0` se respeta como override.

### Fase 1 — Renderer único
- `nucleo/render.js`
- Build esbuild → `app/dist/render.editor.js` y `assets/tiq-render.js`
- Emisión de tokens como CSS custom properties

**Criterio de aceptación**
- Test que renderiza el documento de referencia en Node y en el bundle del navegador y compara
  **carácter por carácter**.
- Snapshot del HTML de los 3 tipos semilla.

### Fase 2 — Editor genérico
- `app/editor/*`: árbol, panel (16 controles), lienzo, comandos, librería, branding
- Se monta como pantalla nueva, en paralelo a la vieja

**Criterio de aceptación — este es EL test de la arquitectura**
> Agregar un archivo nuevo en `nucleo/tipos/` hace que el tipo aparezca en la librería, se pueda
> insertar en el árbol, se edite en el panel y se vea en el preview — **sin modificar ni una línea
> de `app/editor/`**.

Si esto no se cumple, la fase no está terminada. No se avanza.

Además: undo/redo funcionando, botón Guardar deshabilitado sin cambios sucios.

### Fase 3 — Integración y borrado
La integración empieza con una entrada canónica y un fallback explícito. El borrado definitivo
solo ocurre cuando el storefront v1 y la publicación tienen evidencia de producción.
- `app/app.js`: `pantallaPreview`, `pantallaPreviewPiloto01`, constructores `.pe-tree`/`.pe-prop`,
  paneles por plantilla (~líneas 1600-3900)
- `app/editor-pagepilot.css`, `app/editor-harness.html`
- `plantilla-producto/pagepilot-mascara-preview.html`, `hotmart-ventas-premium.html`,
  `editorial-commerce-preview.html`
- `adaptador.js`: `ensamblar()`, `validar()` y todo lo atado a `facetas`
- `extensions/tiendaiq-widgets/assets/tiendaiq.js` (renderer viejo, todavía conservado como fallback)

**Criterio de aceptación**
- `grep -rn "facetas.pagepilot_blue" --include=*.js .` → **0 resultados**.
- `grep -rn "pe-prop__fila" app/` → 0 resultados.
- La app arranca y las páginas existentes se editan con el editor nuevo.

### Fase 4 — Migración de datos
- `nucleo/migraciones/v0_a_v1.js`: documentos con `facetas` o `content.*` → árbol de nodos.
- `nucleo/migraciones/pagina.js`: frontera de lectura/escritura v1; acepta páginas históricas,
  documentos v1 directos y el envoltorio persistido.
- Se ejecuta al leer y valida el resultado antes de entregarlo al editor.

**Criterio de aceptación**
- Test con un documento real de producción (anonimizado) que migra y renderiza.
- Una página publicada antes de la migración sigue viéndose igual.

### Fase 5 — Catálogo
Portar `piloto-pdp-01` al registro con unidades atómicas (galería, título, precio, packs,
beneficios, reseña y FAQ). Después sumar tipos por categoría, empezando por `prueba_social`
y `beneficios` (los de mayor impacto en conversión). Cada tipo debe tener esquema, semilla,
render compartido y miniatura real en la librería.

**Criterio de aceptación por sección**
- Archivo en `nucleo/tipos/`, miniatura renderizada real para la librería, snapshot de render,
  y verificación en móvil y escritorio.

### Fase 6 — IA sobre el árbol
§6 completo, incluido `Editar con IA` por nodo.

### Fase 7 — Producto
Variantes (hasta 3 opciones × 15), métricas por página (vistas/pedidos/conversión/ingresos),
`Guardar como plantilla` + `Guardados`, `Ver origen`.

---

## 8. Convenciones

- **Español** en todo: archivos, funciones, variables, comentarios, mensajes de commit.
- Sin dependencias nuevas. Ya están `ajv`, `esbuild`, `pg`, `@anthropic-ai/sdk`.
- Sin framework de frontend. DOM directo, como el resto del repo.
- Cada archivo de `nucleo/` es CommonJS y **no** referencia `window`, `document` ni `process`.
- Tests con `node --test` en `pruebas/`, como ya hace el repo.
- Commits: `feat(editor): …`, `fix(nucleo): …`, `refactor(app): …`.

---

## 9. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| El editor nuevo tarda y el viejo queda roto mientras tanto | Fases 0-2 construyen **al lado**. El viejo sigue vivo hasta la Fase 3 |
| Divergencia editor/storefront | Test de igualdad de bundles en Fase 1. Es bloqueante |
| Romper páginas publicadas | Fase 4 con migración probada contra documento real, y `documento_publicado` separado del borrador |
| Alguien agrega un control fuera del set cerrado | Revisión: §3.4 es una lista cerrada. Ampliarla es una decisión, no un atajo |
| La IA devuelve árboles inválidos | Validación AJV + un reintento con errores + fallback al árbol por defecto |
| Scope creep hacia refactors no pedidos | §0 regla 5: lo que no está en este documento, no se hace |

---

## 10. Estado de avance

Actualizar esta tabla al cerrar cada fase.

| Fase | Estado | PR | Notas |
|---|---|---|---|
| 0 — Núcleo y contrato | ✅ **hecha** | — | `nucleo/` completo; schema, resolver, tokens, registro y contratos de seguridad. Ver §12 |
| 1 — Renderer único | ✅ **hecha** | — | `render()` → `{html, css}`. Bundles byte-idénticos verificados. |
| 2 — Editor genérico | ✅ **hecha** | — | 3 paneles, undo/redo, controles schema-driven, ramas colapsadas y viewport móvil. |
| 3 — Integración y borrado | 🟡 **en curso** | — | Listado y preview convergen en `/editor-v3`; guardado, carga de imágenes y publicación v1 ya tienen frontera propia. QA comparativo: árbol semántico, iconos, selección enlazada, scroll en ambas direcciones, foco visual y barra flotante corregidos. El legado sigue disponible con `?editor=legacy` hasta cerrar QA del storefront |
| 4 — Migración de datos | ✅ **puente cerrado** | — | v0→v1 determinista para legado y `content.*`, frontera HTTP, evidencia, producto de preview y guardado v1 validado |
| 5 — Catálogo | 🟡 **base implementada** | — | 11 tipos atómicos de producto registrados; falta completar las secciones restantes y sus miniaturas reales |
| 6 — IA sobre el árbol | ⬜ pendiente | — | |
| 7 — Producto | ⬜ pendiente | — | |

---

## 11. Instrucción para retomar (pegar tal cual)

> Trabajás sobre el repo TiendaIQ. Leé `docs/arquitectura-editor-v3.md` completo antes de escribir
> código. Implementá **únicamente la Fase N** de la sección 7, respetando los seis invariantes de
> la sección 2 y las convenciones de la sección 8.
>
> No toques `auth.js`, `db.js`, `facturacion.js`, `shopify.js`, `publicar.js`, `src/tenancy/`,
> `src/webhooks/`, `src/capacity/`, `src/jobs/`.
>
> No borres nada antes de la Fase 3.
>
> Todo el código en español. Al terminar, corré `npm run probar`, verificá los criterios de
> aceptación de la fase, y actualizá la tabla de la sección 10.
>
> Si algo del documento resulta ambiguo o incorrecto, **preguntá antes de decidir por tu cuenta**.

---

## 12. Lo entregado

### Fase 0 — archivos nuevos

| Archivo | Qué hace |
|---|---|
| `nucleo/tokens.js` | 7 presets × 9 tokens, radios, tipografías. `tokensDe()`, `desreferenciar()` (`@titulos` → hex), `variablesCss()` (emite `--tiq-*`) |
| `nucleo/resolver.js` | Cascada I4 (`valorCrudo`, `valorFinal`, `hayOverride`), saneador de HTML por lista blanca, `contexto(documento, {viewport})` |
| `nucleo/registro.js` | Carga y **valida** las definiciones al arrancar. `definicion()`, `catalogo()`, `esquemaPanel()`, `resumenParaIA()`. Conjunto cerrado `TIPOS_CAMPO` (16) |
| `nucleo/documento.js` | `crear()`, `crearNodo()`, `validar()` (AJV **generado desde el registro**), `migrar()`, topes `MAX_NODOS=500` / `MAX_PROFUNDIDAD=8` |
| `nucleo/migraciones/indice.js` | Cadena de migraciones; contiene v0→v1 |
| `nucleo/migraciones/v0_a_v1.js` | Convierte `facetas` heredadas a árbol v1 con ids estables, sin mutar el origen |
| `nucleo/migraciones/pagina.js` | Frontera del envoltorio persistido: lee/migra y guarda borradores v1 validados |
| `nucleo/tipos/_base.js` | Grupos comunes: apariencia, espaciado, visibilidad, avanzado |
| `nucleo/tipos/{seccion,texto,imagen}.js` | Tipos estructurales semilla |
| `nucleo/tipos/{imagen-texto,tabla-comparacion,estadisticas,garantia}.js` | Bloques editoriales atómicos migrados desde las facetas históricas |
| `nucleo/tipos/indice.js` | Lista explícita, apta para bundler |
| `pruebas/nucleo-{resolver,documento,registro}.test.js` | Contratos del núcleo y catálogo |

### Criterios de aceptación — verificados

- `npm run probar` → **353 tests, 0 fallos** (sintaxis + coherencia + bundles + unidad + humo).
- Documento de ejemplo valida (`pruebas/nucleo-documento.test.js`).
- Cascada I4 con test explícito, incluidos los dos casos que suelen romperse:
  **`0` se respeta como override** y **`null` significa "sin valor"**.
- El esquema AJV se genera del registro: hay un test que falla si el registro y el esquema se
  separan.

### Puente de migración — evidencia actual

- `GET /api/paginas/:id` expone `documento` v1 y conserva `data` para el publicador legado.
- `GET /api/registro` entrega el catálogo y el esquema serializable del inspector.
- `PUT /api/paginas/:id` acepta `{ documento }`, valida identidad/tenant/producto y guarda el
  borrador v1 en `documento_borrador` sin habilitar una publicación parcial.
- `app/editor-producto.html` monta el editor v3 contra una página real en `/editor-v3?id=…`.
- La tabla de páginas y los flujos de generación abren `/editor-v3?id=…` como entrada canónica; la
  pantalla vieja solo queda disponible como fallback explícito durante la transición.
- Los campos de imagen ofrecen URL o carga nativa. La carga se valida en el navegador y usa la ruta
  existente `/api/paginas/:id/imagenes`, también para imágenes dentro de listas.
- El botón Publicar guarda primero si hay cambios, valida el documento de nuevo y usa
  `/api/paginas/:id/publicar-v1`; el publicador histórico y sus jobs no se tocaron.
- El storefront v1 sirve `tiq-render.js` y `tiq-storefront.js`: ambos parten del documento publicado,
  conectan galería, packs y contador, y dejan el renderer viejo intacto como respaldo.
- La librería del editor ya muestra miniaturas vectoriales por tipo, no placeholders grises.
- `npm run probar` pasa con 353 tests y 0 fallos. El puente incluye una proyección de producto de
  solo lectura para el preview y la página histórica real entra a bloques atómicos sin convertir
  guías de reseñas en testimonios falsos.

### Detalles de implementación que conviene conocer antes de seguir

1. **`ctx.hijos(nodo)`** lo consume `seccion.render` y lo provee el recorrido del árbol de la Fase 1.
   Los tipos no conocen el árbol completo: solo reciben sus hijos ya renderizados.
2. **Rechazos que ya funcionan** (la red contra la IA): tipo inexistente, prop no declarada,
   token `@inventado`, id repetido, hijos en tipo que no admite, valor fuera de rango, opción
   inválida, override móvil de un campo no responsive, árbol demasiado profundo o grande.
3. **Los límites por página ya tienen cobertura** con los tipos atómicos únicos (`galeria_producto`,
   `titulo_producto`, `precio_producto`, `packs_compra`, `boton_carrito`, `contador_oferta`, `carrusel_resenas`, `garantia`).
4. **`semilla`** en la definición de un tipo = contenido mínimo con el que se inserta el bloque.
   Solo contenido: sembrar estilos los convertiría en overrides y el bloque dejaría de seguir al
   branding.
5. El registro **revienta al cargar** si una definición está mal. Es deliberado: lo agarra CI, no
   el merchant.

---

### Fase 1 — archivos nuevos

| Archivo | Qué hace |
|---|---|
| `nucleo/render.js` | `render(documento, {modo})` → **`{ html, css }`**. Recorre el árbol, arma el `ctx` y emite el CSS responsive. `renderNodo()` para repintado parcial |
| `nucleo/render.css` | Clases base (`tiq-doc`, `tiq-seccion`, `tiq-texto`, `tiq-imagen`, `tiq-error`). Solo estructura: cero colores literales, verificado por test |
| `nucleo/entrada-navegador.js` | Entrada del bundle. **No** importa `documento.js` (arrastraría ajv + crypto a la tienda) |
| `scripts/construir-render.js` | esbuild → dos salidas. `--verificar` falla si el disco quedó viejo |
| `app/dist/render.{editor.js,css}` · `extensions/tiendaiq-widgets/assets/tiq-render.{js,css}` | Artefactos commiteados (73 KB de JS) |
| `pruebas/nucleo-render.test.js` | 17 tests |

Scripts nuevos: `npm run construir:render`. `npm run probar` ahora incluye `--verificar`.

### La decisión de arquitectura de la Fase 1: `render()` devuelve `{ html, css }`

El borrador de este documento asumía que el render resolvía **un** viewport. Al implementarlo quedó
claro que eso no puede funcionar: **la tienda sirve un solo HTML a celulares y a escritorios**. Si
los valores de móvil se resuelven al renderizar, en la tienda nunca se aplican.

Entonces:

- Los estilos de **escritorio** van en línea, en el elemento.
- Las diferencias de **móvil** salen como una hoja de CSS, agrupada por media query y scopeada por
  `[data-nodo="n_xxx"]`. Solo se emite lo que de verdad cambia.
- El corte es **750px**, el mismo que Dawn. Que coincida con el tema del merchant importa: si no,
  hay una franja de anchos donde la página se ve rota.
- **Ocultar es CSS, no ausencia de HTML.** Un bloque escondido en móvil sigue en el HTML con
  `display:none` dentro de `@media (max-width:749px)`. Sacarlo lo sacaría también del escritorio.
  Solo se omite del HTML cuando está oculto en los dos viewports.

Efecto secundario bueno, y no menor: **el preview del editor deja de simular nada.** Muestra el
mismo HTML y el mismo CSS que la tienda, y "ver en móvil" es cambiar el ancho del iframe. Un
preview que simula móvil resolviendo otras variables miente tarde o temprano — y esa mentira es
justamente lo que hace que un merchant deje de confiar en el editor.

`resolver.visible(nodo)` cambió de sentido acorde: ahora responde *"¿este nodo llega al HTML?"*.

### Fase 2 — archivos nuevos

| Archivo | Qué hace |
|---|---|
| `app/editor/comandos.js` | Estado + bus de comandos + undo/redo con **fusión** + estado sucio (I5) |
| `app/editor/controles.js` | Los 16 controles: `htmlCampo()` dibuja, `parsear()` lee. Puros |
| `app/editor/panel.js` | Panel derecho generado del schema. Cero nombres de tipo |
| `app/editor/arbol.js` | Panel izquierdo. Etiqueta por contenido, no por tipo |
| `app/editor/libreria.js` | Modal "Añadir sección" desde `registro.catalogo()` |
| `app/editor/lector.js` | Único puente DOM → partes crudas → `parsear()` |
| `app/editor/lienzo.js` | Preview en iframe, selección, coordenadas de la barra flotante |
| `app/editor/editor.js` | Cableado. No decide nada |
| `app/editor/editor.css` | Cromo de los tres paneles |
| `app/editor.html` | Arnés local, sin backend ni Shopify. No es parte del producto |
| `scripts/construir-editor.js` | esbuild → `app/dist/editor.js` (134 KB) |
| `pruebas/editor-{comandos,ui}.test.js` | 63 tests |

**Criterio de la fase — verificado.** `pruebas/editor-ui.test.js` inventa un tipo
(`carrusel_resenas`, con un campo `lista` que ningún tipo semilla usa) y comprueba que el panel, el
árbol y la librería lo dibujan bien. Sin tocar una línea de `app/editor/`.

### Tres bugs que solo aparecieron al abrirlo en un navegador

Los tests pasaban y la UI estaba mal. Vale registrarlos porque los tres son de la misma familia:
**cosas que ningún test unitario ve**.

1. **`valores()` devolvía el valor ya traducido a CSS.** El panel mostraba *Grosor: Regular* con un
   bloque en `bold` (le llegaba `700`, que no es una opción) y *Color: Personalizado* con
   `@titulos` (le llegaba el hex). Se separó: `valores()` devuelve lo que dice el documento,
   `estilos()` traduce a CSS. **Valores son datos; CSS es presentación.**
2. **El atributo `style` del documento se cortaba.** Las pilas tipográficas llevan comillas dobles
   (`"Archivo", …`) y se escribían sin escapar dentro de `style="…"`. El atributo terminaba en la
   primera comilla, **todas** las variables de marca desaparecían y la página caía a Times New
   Roman — sin un solo error en consola. Hoy tiene test propio.
3. **`[hidden]` no gana contra `display:flex`.** La barra flotante y el modal se veían siempre.

El primero es el más instructivo: el test *correcto* existía y pasaba, porque comprobaba el CSS
emitido, que estaba bien. Lo que estaba mal era el otro consumidor de la misma función.

### Correcciones QA comparativa — corte actual

- El árbol deriva etiquetas de contenido desde descendientes y deja el nombre del primer tipo como
  respaldo; ya no presenta una lista ilegible de contenedores llamados "Sección".
- Cada fila del árbol muestra un icono SVG lineal según `def.icono`, con fallback seguro para tipos
  nuevos, y expone selección accesible.
- Una selección nacida en el iframe expande solo sus padres y hace scroll/foco sobre la fila
  correspondiente del árbol.
- La selección desde el árbol conserva un desplazamiento pendiente durante el repintado del iframe
  y centra el bloque seleccionado; las ediciones ordinarias conservan la posición de scroll actual.
- La barra flotante se limita al lienzo visible, se ajusta horizontalmente y cae debajo del bloque
  cuando no tiene espacio superior; también sigue el scroll del preview.
- El cromo del editor define `:focus-visible` con el azul de selección y elimina el anillo naranja
  nativo, manteniendo un foco visible y consistente para teclado en controles y filas navegables.

### Fase 3 — siguiente corte verificable

1. Probar en una tienda de staging el ciclo completo: abrir una página existente, editar, guardar,
   recargar, subir una imagen y publicar v1.
2. Confirmar que el bloque `pagina.liquid` recibe el documento publicado y que la tienda usa el
   mismo bundle `tiq-render.js` que el preview; validar también escritorio, tablet y móvil.
3. Instrumentar errores de render y publicación sin exponer contenido del merchant; un bloque inválido
   queda aislado y no tumba el resto de la página.
4. Solo con esa evidencia retirar las rutas y constructores históricos listados arriba. El fallback
   `?editor=legacy` se elimina en el PR de borrado, no antes.

**El test de la fase**: agregar un archivo a `nucleo/tipos/` (+ su línea en `indice.js`) hace que
el tipo aparezca en librería, árbol, panel y preview **sin tocar `app/editor/`**.
