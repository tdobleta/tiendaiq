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
- Su distribución no estaba seleccionada durante la observación. Shopify ofrece
  `public` o `custom` y la elección no se puede cambiar después.

## Decisión acotada

La aplicación de Onepilot es la única identidad autorizada para Partner
Staging. No es la futura identidad de producción ni debe reemplazar la app
pública. Por eso su distribución no es un requisito para desplegar ni probar
la infraestructura aislada. La futura aplicación de producción es la que debe
elegir `public` antes de la revisión de App Store.

## Gate antes de desplegar una versión Partner Staging

No convertir Partner Staging en pública para desbloquear un deploy. Shopify
indica que, cuando existen apps de desarrollo y producción separadas, la
distribución se elige en la aplicación de producción. Billing de prueba con
planes públicos también pertenece a esa identidad candidata de producción;
Partner Staging sirve para infraestructura, OAuth, publicación, webhooks y
regresiones sin mezclar la identidad del App Store.

La persona que ejecuta `Release Partner Staging` debe comprobar nuevamente en
Shopify, en el momento del deploy:

1. que continúa con cero instalaciones;
2. que pertenece a Onepilot y no fue confundida con la futura identidad
   pública de producción;
3. que el Client ID coincide con el manifiesto y Blueprint;
4. que sus URLs/callbacks/webhooks corresponden a Partner Staging;
5. que no existe una instalación previa o automatización sobre una identidad
   merchant distinta.

El workflow exige la confirmación `PARTNER_STAGING_REMOTE_IDENTITY_AUDITED`.
Si cualquiera de estos puntos falla, se detiene: no se crean servicios, no se
despliega Shopify y no se reutilizan secretos.
