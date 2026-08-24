# Contrato de cutover Partner para TiendaIQ

## Decisión

La aplicación que se publique en Shopify App Store debe pertenecer a la cuenta
Partner que la distribuye. Las aplicaciones actuales del Dev Dashboard ligadas a
una tienda son evidencia de desarrollo; no son la identidad pública de
TiendaIQ.

No existe una migración de identidad segura basada en copiar credenciales,
reutilizar una base entre aplicaciones o cambiar el `client_id` en un servicio
activo. Cada registro Shopify tiene OAuth, webhooks, extensión y billing propios.
El cutover se hace creando identidades Partner nuevas y aisladas, con una
promoción explícita entre ellas.

Este documento es un contrato operativo: ningún gate de App Store se declara
cerrado por evidencia producida únicamente por una app ligada a tienda.

## Límites no negociables

- Partner staging y Partner production usan registros Shopify distintos.
- Cada registro usa su propio par web/worker, base PostgreSQL, tokens de tienda,
  `SHOPIFY_APP_REGISTRATION_ID` y secreto de cliente. Nunca se comparten.
- Los callbacks, App Home handles y URLs de extensión deben pertenecer al mismo
  entorno. No se copia un token de una app a otra.
- La app ligada a tienda queda congelada como respaldo y evidencia hasta que el
  nuevo entorno complete los gates; no se borra durante el cutover.
- La limpieza de una app o una tienda es destructiva y requiere inventario,
  periodo de rollback y autorización explícita.

## Estados de identidad

| Estado | Finalidad permitida | No permitido |
| --- | --- | --- |
| Legacy shop-owned | referencia histórica y recuperación de staging | submission App Store, billing de lanzamiento |
| Partner staging | instalación limpia, OAuth, webhooks, billing de prueba y QA aislado | datos o secretos de producción |
| Partner production | candidato de revisión, canary y operación pública | pruebas destructivas o secretos de staging |

## Secuencia obligatoria

1. **Inventario inmutable.** Registrar, sin secretos, nombre, handle, tipo de
   propietario, scopes, callbacks, versión de extensión, tiendas instaladas,
   dominios y estado de billing de cada registro existente. Marcar qué app es
   legacy y cuál será Partner staging/production.
2. **Provisionar Partner staging aislado.** Crear la app Partner de staging y
   una tienda de desarrollo de prueba. Configurar el manifiesto de staging, una
   base y servicios Render exclusivos, y publicar la extensión como versión de
   esa app. No usar la base de legacy staging.
3. **Vincular el runtime.** Con el flujo protegido, ligar exactamente un
   registro Partner a su base y activar `enforced=1` en web y worker. `/ready`
   debe demostrar SHA, RLS y fingerprint sanitizado del binding antes de abrir
   tráfico.
4. **Pruebas de ciclo de vida.** En una instalación limpia ejecutar OAuth,
   acceso embebido con session token, desinstalación y reinstalación. Revalidar
   scopes efectivos y que no queda sesión o job activo de una instalación
   anterior.
5. **Pruebas Shopify de valor.** Verificar publicación durable, extensión de
   tema, storefront en una tienda QA pública, `customers/data_request`,
   `customers/redact`, y `shop/redact` sólo en una tienda sacrificable.
6. **Billing.** Crear una única intención idempotente con `PLAN_TEST=1` y
   detenerse antes de toda aprobación. Validar rechazo, aprobación, cancelación,
   reinstalación y cambio de plan. La prueba real de producción requiere una
   autorización separada.
7. **Partner production.** Repetir configuración como entorno independiente,
   con `PLAN_TEST` desactivado, admisión IA con presupuesto aprobado y un
   release de extensión asociado al mismo SHA de la aplicación.
8. **Canary y retirada.** Mantener legacy intacta durante el canary y el
   periodo de rollback. Después inventariar instalaciones/recursos residuales,
   desactivar webhooks y billing de legacy, archivar evidencia y sólo entonces
   solicitar eliminación de lo que no tenga uso.

## Evidencia requerida antes de cada promoción

| Promoción | Evidencia mínima |
| --- | --- |
| Legacy → Partner staging | inventario firmado, aislamiento de DB/runtime, SHA desplegado, `/ready` con RLS y binding enforced |
| Partner staging → Partner production | instalación/reinstalación, scopes, publicación, storefront QA, tres webhooks, billing test y alertas |
| Partner production → App Store/canary | listing factual, soporte/legales, credenciales de review, capacidad IA aprobada, rollback ensayado y GO operativo verde |

## Rollback

Un rollback revierte tráfico hacia el último SHA y entorno Partner conocido,
nunca mezcla una base entre aplicaciones ni cambia un `client_id` en caliente.
No se revierte una migración de datos destructiva: las migraciones siguen el
contrato expand/contract y se recupera con un release compatible. Si falla una
instalación Partner nueva, se deshabilita su distribución y se conserva la
evidencia para diagnóstico; legacy no se elimina como respuesta al incidente.

## Condición de limpieza de legacy

La limpieza empieza únicamente cuando Partner production tenga instalaciones
reales sin errores de OAuth, billing, publicación ni privacidad durante el
periodo de rollback acordado. Antes de borrar, el dueño aprueba una lista exacta
de apps, tiendas, webhooks, servicios y datos a retirar. Los secretos nunca se
copian a documentación ni se imprimen durante el inventario.
