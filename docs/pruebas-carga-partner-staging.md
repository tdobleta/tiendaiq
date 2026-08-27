# Capacidad de cola de Partner Staging

`Capacity Partner Staging` es un workflow manual separado de `Capacity staging`.
Sirve para obtener evidencia reproducible de PostgreSQL, RLS, encolado, leases,
carriles worker y limpieza usando únicamente filas sintéticas en la base
**Partner Staging**.

## Antes de ejecutar

- El SHA completo debe ser el `HEAD` revisado de `main`, ya desplegado en
  `https://tiendaiq-partner-staging-web.onrender.com/ready`.
- El environment protegido `partner-staging` debe contener sólo estos secretos
  runtime para esta prueba: `PARTNER_STAGING_WEB_DATABASE_URL` y
  `PARTNER_STAGING_WORKER_DATABASE_URL`.
- Las URLs usan los logins runtime Partner Staging de mínimo privilegio. Nunca
  usar la URL migradora, secretos `STAGING_*`, producción ni valores copiados
  desde el entorno histórico.

## Ejecución

En Actions, elegir **Capacity Partner Staging** y completar:

- `mode=run`, `confirmation=RUN_PARTNER_STAGING_QUEUE_CAPACITY`, más el SHA,
  tenants y jobs elegidos; o
- `mode=cleanup`,
  `confirmation=CLEAN_PARTNER_STAGING_QUEUE_CAPACITY` y el `runId` exacto de
  doce hexadecimales de una ejecución interrumpida.

El workflow comprueba el SHA contra `origin/main` y `/ready` Partner antes de
crear datos. Todo job contiene `synthetic: true`, no llama Shopify, Anthropic,
billing ni la web pública, y elimina sus filas por el prefijo del `runId`.

El artefacto de Actions contiene sólo métricas permitidas (recuento, tiempos,
concurrencia, `runId` y recuentos de limpieza). Los logs crudos no se publican
ni se adjuntan.

## Límites de la evidencia

Este gate no prueba capacidad de Anthropic, publicación Shopify, storefront,
billing, privacidad ni tráfico HTTP real. Tampoco autoriza producción. Es una
medición de cola sintética contra la topología Partner Staging concreta y debe
repetirse tras un cambio relevante de base, roles, worker o capacidad.
