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
- El servicio Render `tiendaiq-partner-staging-web` tiene configurado, sólo
  para la tienda Partner instalada:
  `SHOPIFY_CERTIFICATION_ENABLED=1`,
  `SHOPIFY_CERTIFICATION_SHOP`, `SHOPIFY_CERTIFICATION_PAGE_ID` y
  `SHOPIFY_CERTIFICATION_MAX_AGE_HOURS=24`. El ID corresponde a una página
  real publicada por el worker del SHA solicitado; no reutilizar evidencia de
  staging histórico ni inventar IDs.
- Si la Development Store mantiene la pantalla de contraseña, el servicio web
  puede recibir además `SHOPIFY_CERTIFICATION_STOREFRONT_PASSWORD` como secreto
  de Render. No se agrega a GitHub, archivos ni logs: el verificador sólo la
  envía por HTTPS al dominio exacto de `SHOPIFY_CERTIFICATION_SHOP`, conserva
  la cookie durante una única consulta y no devuelve contraseña, cookie ni HTML.
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
prueba manual de instalación/reinstalación OAuth, no crea billing y no ejecuta
el destructivo `shop/redact`. Esos controles continúan siendo evidencia separada
para App Store y producción.
