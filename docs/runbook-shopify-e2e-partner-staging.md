# Gate Shopify E2E en Partner Staging

## Objetivo

El workflow `Shopify E2E Partner Staging evidence` verifica exclusivamente la
app Partner Staging y su tienda de desarrollo perteneciente a Onepilot. No
reemplaza el workflow histórico de staging ni usa sus secretos, Render URL o
entorno protegido.

## Precondiciones

- El SHA completo solicitado es el `HEAD` revisado de `main` y ya está live en
  `tiendaiq-partner-staging-web` y `tiendaiq-partner-staging-worker`.
- La app `TiendaIQ Partner Staging` está instalada en
  `tiendaiq-partner-staging.myshopify.com`.
- El entorno GitHub `partner-staging` contiene
  `PARTNER_STAGING_OPS_STATUS_TOKEN`; el valor nunca se copia a Actions,
  documentación ni logs.
- La evidencia durable de página, publicación Shopify y privacy corresponde al
  mismo SHA. El workflow no genera contenido ni muta Shopify.

## Ejecución

En GitHub Actions, ejecutar `Shopify E2E Partner Staging evidence` con:

```text
release_sha=<SHA completo de 40 caracteres, HEAD de main ya desplegado>
confirmation=VERIFY_SHOPIFY_PARTNER_STAGING_E2E
```

## Límites deliberados

El workflow conserva los mismos límites del gate de staging: no sustituye una
prueba manual de instalación/reinstalación OAuth, no certifica visualmente una
development store protegida por contraseña, no crea billing y no ejecuta el
destructivo `shop/redact`. Esos controles continúan siendo evidencia separada
para App Store y producción.
