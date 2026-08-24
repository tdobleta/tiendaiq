# Contrato de promoción Partner y limpieza legacy de TiendaIQ

## Hecho comprobado y decisión

El **Dev Dashboard** es la superficie actual de Shopify para crear y gestionar
apps; reemplaza esos flujos del antiguo Partner Dashboard. Shopify CLI también
crea y conecta apps allí. Por eso, la presencia de una app en Dev Dashboard no
demuestra que sea una app ligada sólo a una tienda ni que sea inelegible para
Shopify App Store.

La condición relevante es otra: una app de App Store debe tener **distribución
pública** bajo una organización Partner. La distribución elegida no se puede
cambiar después. Antes de crear otra app, se debe demostrar si la candidata
existente pertenece a la organización Partner correcta, tiene o puede elegir
distribución pública y coincide con el manifiesto, la extensión y el runtime
de producción.

Este contrato evita los dos errores opuestos: crear una identidad duplicada sin
necesidad, o reutilizar una app custom/incorrecta para el lanzamiento público.

## Límites no negociables

- No se infiere propiedad ni distribución a partir del nombre, de una
  instalación de desarrollo o de la pantalla Dev Dashboard.
- La candidata existente se reutiliza si el inventario prueba organización
  Partner, distribución pública apta y correspondencia con el runtime. Si no,
  se crea una app pública nueva y aislada.
- Staging y producción usan registros Shopify distintos, bases PostgreSQL,
  servicios web/worker, tokens de tienda y secretos de cliente distintos.
- No se copia un token, secreto, callback, App Home handle o base de una app a
  otra. Un binding de base se activa una vez por registro y entorno.
- Las aplicaciones antiguas se conservan como respaldo mientras haya rollback
  o instalaciones activas. Borrar apps, tiendas, webhooks o datos requiere
  inventario y autorización explícita.

## Estados de identidad

| Estado | Finalidad permitida | Decisión pendiente |
| --- | --- | --- |
| Candidata existente | validar propiedad Partner, distribución y configuración | reutilizar o reemplazar, según inventario |
| Partner staging | instalación limpia, OAuth, webhooks, billing de prueba y QA aislado | conservar aislada de producción |
| Partner production pública | revisión, canary y operación pública | sólo después de todos los gates |
| Legacy/prototipo | referencia, rollback temporal o experimento sin instalaciones | archivar o retirar sólo después de clasificarlo |

## Secuencia obligatoria

1. **Inventario read-only.** Registrar, sin secretos, nombre, identificador de
   configuración, organización que la ve, tipo de distribución, handles,
   callbacks, scopes, versión de extensión, instalaciones y estado de billing
   de cada app existente.
2. **Decisión de reutilización.** Si una app existente ya es Partner/pública y
   corresponde a producción, se la conserva. Si es custom, pertenece a otra
   organización o no puede tener distribución pública, se crea una candidata
   nueva con Shopify CLI. Esta decisión requiere evidencia del dashboard, no
   una suposición de código.
3. **Partner staging aislado.** Mantener o crear una app de staging, su tienda
   de desarrollo, manifest, base y servicios Render exclusivos. Publicar la
   extensión como versión de esa app y vincular su registro al runtime.
4. **Pruebas de ciclo de vida.** En una instalación limpia ejecutar OAuth,
   acceso embebido con session token, desinstalación y reinstalación. Revalidar
   scopes efectivos y que no queda sesión o job activo previo.
5. **Pruebas Shopify de valor.** Verificar publicación durable, extensión de
   tema, storefront en una tienda QA pública, `customers/data_request`,
   `customers/redact`, y `shop/redact` sólo en una tienda sacrificable.
6. **Billing.** Crear una única intención idempotente con `PLAN_TEST=1` y
   detenerse antes de toda aprobación. Validar rechazo, aprobación, cancelación,
   reinstalación y cambio de plan. La prueba real requiere autorización aparte.
7. **Promoción pública.** Configurar la candidata pública validada con
   `PLAN_TEST` desactivado, admisión IA con presupuesto aprobado y una versión
   de extensión asociada al mismo SHA de la aplicación.
8. **Canary y retirada.** Mantener los recursos anteriores durante el periodo
   de rollback. Después inventariar instalaciones/recursos residuales,
   desactivar webhooks y billing de legacy, archivar evidencia y solicitar la
   retirada de lo que no tenga uso.

## Evidencia requerida antes de cada promoción

| Promoción | Evidencia mínima |
| --- | --- |
| Inventario → decisión de identidad | organización Partner, distribución, manifiesto, extensión, callbacks, scopes e instalaciones comprobados |
| Staging → candidata pública | instalación/reinstalación, scopes, publicación, storefront QA, tres webhooks, billing test y alertas |
| Candidata pública → App Store/canary | listing factual, soporte/legales, credenciales de review, capacidad IA aprobada, rollback ensayado y GO operativo verde |

## Rollback

Un rollback revierte tráfico hacia el último SHA y entorno válido; nunca mezcla
bases entre apps ni cambia un `client_id` en caliente. No se revierte una
migración de datos destructiva: las migraciones siguen expand/contract y se
recupera con un release compatible. Si falla una candidata nueva, se deshabilita
su distribución y se conserva evidencia para diagnóstico.

## Condición de limpieza de legacy

La limpieza empieza únicamente cuando la candidata pública tenga instalaciones
reales sin errores de OAuth, billing, publicación ni privacidad durante el
periodo de rollback acordado. Antes de borrar, el dueño aprueba una lista exacta
de apps, tiendas, webhooks, servicios y datos a retirar. Los secretos nunca se
copian a documentación ni se imprimen durante el inventario.
