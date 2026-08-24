# Auditoría de identidad: Partner Staging

Fecha de observación: 2026-08-24. Fuente: lectura directa del Shopify Partner
Dashboard y Dev Dashboard de la organización Onepilot; no se revelaron
secretos ni se modificó Shopify.

## Hechos observados

- La organización Partner correcta es `Onepilot`; su identificador no coincide
  con el dashboard merchant que contiene aplicaciones históricas.
- La aplicación `TiendaIQ Partner Staging` declarada por
  `shopify.app.partner-staging.toml` pertenece a Onepilot, fue creada el
  2026-08-24 y tiene cero instalaciones.
- Su Client ID coincide con el manifiesto y el Blueprint Partner Staging. No
  se leyó ni reveló el secreto de cliente.
- El dashboard lista dos versiones Partner Staging; la activa se llama
  `tiendaiq-partner-staging-2`. El historial y la extensión de la aplicación
  merchant `TiendaIQ` pertenecen a otra identidad y no se reutilizan aquí.
- Su distribución no está seleccionada todavía: Shopify ofrece `public` o
  `custom` y esa decisión es irreversible.

## Decisión acotada

La aplicación de Onepilot es la única identidad autorizada para Partner
Staging. No es la futura identidad de producción ni debe reemplazar la app
pública. La distribución permanece bloqueada hasta una decisión explícita.

## Gate antes de desplegar una versión Partner Staging

Antes de seleccionar distribución, la dirección debe aprobar explícitamente
la opción `public`: la documentación oficial de Shopify indica que `custom`
no puede usar Billing API, mientras que el objetivo de Partner Staging incluye
una prueba de billing. La selección no crea una suscripción, pero es
irreversible y no se automatiza.

La persona que ejecuta `Release Partner Staging` debe comprobar nuevamente en
Shopify, en el momento del deploy:

1. que continúa con cero instalaciones;
2. que pertenece a Onepilot y tiene distribución `public` elegida;
3. que el Client ID coincide con el manifiesto y Blueprint;
4. que sus URLs/callbacks/webhooks corresponden a Partner Staging;
5. que no existe una instalación previa o automatización sobre una identidad
   merchant distinta.

El workflow exige la confirmación `PARTNER_STAGING_REMOTE_IDENTITY_AUDITED`.
Si cualquiera de estos puntos falla, se detiene: no se crean servicios, no se
despliega Shopify y no se reutilizan secretos.
