# Runbook: Pages with AI — flujo cliente en Partner Staging

Este runbook certifica el flujo real de `Páginas con IA` en la aplicación
embebida de Shopify. Separa los checks automatizables de la prueba que debe
hacer una persona dentro de Shopify Admin y del storefront. No reutiliza el
entorno `tiendaiq-staging` ni permite aprobar un release sólo porque el código
compile.

## Qué se puede automatizar

Antes de abrir la app, ejecutar el workflow `Ops readiness Partner Staging`
con el SHA completo que se quiere probar:

```text
release_sha=<SHA completo, presente en main y desplegado>
confirmation=CHECK_PARTNER_STAGING_OPS_READINESS
certification_mode=technical_preflight
require_generation_admission_open=false
```

Ese preflight debe comprobar, sin mostrar secretos:

- `/health` y `/ready` responden correctamente.
- El release de web coincide con el SHA solicitado.
- Web y worker usan PostgreSQL, RLS forzado y roles aislados.
- Existe un heartbeat reciente del worker.
- Web y worker comparten el contrato de billing esperado.
- No hay jobs fallidos recientes, leases estancados ni compensaciones en
  cuarentena.

Para probar generación real, repetir el workflow con:

```text
certification_mode=technical_preflight
require_generation_admission_open=true
```

Este segundo paso sólo certifica que el worker está listo para aceptar
generaciones; no inventa una generación ni consume Anthropic por sí mismo.

## Acciones manuales obligatorias en Render

Un administrador debe revisar en el servicio
`tiendaiq-partner-staging-worker`:

1. `TOKEN_ENC_KEY` está disponible para el worker mediante la referencia
   `fromService` al web Partner Staging. Nunca copiarla manualmente a GitHub o
   a un archivo.
2. `ANTHROPIC_API_KEY` está cargada en Render como secreto del worker. El
   blueprint la declara `sync: false`, por lo que la ausencia de esta variable
   bloquea generación real aunque `/ready` del web esté verde.
3. `GENERATION_ADMISSION_PAUSED` está configurada temporalmente como `0` sólo
   durante la prueba controlada. Si está ausente, el comportamiento seguro es
   permanecer pausado.
4. El worker se reinició después de cambiar secretos y su heartbeat aparece en
   `/ops/status`. No se deben pegar valores secretos en capturas, logs ni
   comentarios.

La prueba no debe continuar si `/ops/status` devuelve `401`: eso significa que
falta el token operativo en el entorno de ejecución del check, no que el worker
esté certificado.

## Prueba de cliente real

Usar una Development Store Partner y un producto de prueba que tenga al menos
una imagen, una variante vendible y precio. Ejecutar en este orden y guardar la
evidencia del mismo SHA:

| Paso | Acción | Resultado exigido |
| --- | --- | --- |
| 1 | Abrir la app embebida dentro de Shopify Admin | La sesión y la tienda corresponden al Partner Staging; no aparece la app local |
| 2 | Entrar en `Páginas con IA` | La pantalla carga productos reales de esa tienda |
| 3 | Seleccionar un producto | Se muestran título, imágenes, variantes, precio y moneda reales |
| 4 | Elegir idioma, público y ángulo | La estrategia queda visible antes de generar |
| 5 | Pulsar `Crear página con IA` | Se crea un job durable y la interfaz muestra estado, no una espera infinita |
| 6 | Esperar la generación | El worker completa el job; un fallo deja mensaje accionable y no una página falsa |
| 7 | Abrir el editor | La página aparece por secciones, con la sección inicial seleccionada y sus controles |
| 8 | Editar texto, imagen y un bloque | El preview cambia sin pantalla blanca ni perder selección |
| 9 | Guardar y recargar | Los cambios sobreviven; la revisión evita sobrescrituras antiguas |
| 10 | Duplicar o insertar una sección | La instancia nueva es independiente de la original |
| 11 | Publicar | Se ejecuta la ruta durable; el estado muestra éxito o error verificable |
| 12 | Abrir el storefront | Se ve la página publicada del producto correcto |
| 13 | Cambiar variante | Imagen, precio, disponibilidad y variante seleccionada son coherentes |
| 14 | Probar `ADD TO CART` | Shopify agrega la variante real y la cantidad correcta al carrito |
| 15 | Volver a editar y publicar | El botón de publicar se reactiva y el storefront recibe la revisión nueva |

## Criterios de bloqueo

Marcar la prueba como `NO GO` si ocurre cualquiera de estos casos:

- La app usa una sesión o tienda distinta de Partner Staging.
- El job aparece completo pero no existe evidencia durable en la base.
- La IA genera reviews, estadísticas, garantías, descuentos o claims sin
  evidencia del producto.
- El editor muestra contenido demo como si fuera dato real del merchant.
- Guardar o publicar depende de una ruta legacy.
- El storefront no recibe el metafield o el template esperado.
- El CTA no usa una variante real o no agrega al carrito.
- Una edición de una página modifica accidentalmente otra página.
- El worker tiene un SHA distinto de web o hay jobs fallidos recientes.

## Evidencia mínima para marcar GO

Conservar sólo datos no secretos:

- SHA desplegado.
- Resultado de `/ready` y del workflow de readiness.
- ID interno de página y producto, sin tokens.
- ID del job y su estado terminal.
- Capturas del editor y storefront.
- Confirmación del carrito con la variante de prueba.
- Resultado de recargar, editar y volver a publicar.

La certificación posterior de Shopify puede ejecutarse con
`Shopify E2E Partner Staging evidence`, pero ese workflow valida una página ya
publicada; no reemplaza los pasos de generación, edición y carrito de este
runbook.
