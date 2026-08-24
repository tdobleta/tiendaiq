# Auditoría de identidad candidata: Partner Staging

Fecha de observación: 2026-08-24. Fuente: lectura directa del Shopify Dev
Dashboard; no se revelaron secretos ni se modificó Shopify.

## Hechos observados

- La aplicación `TiendaIQ` declarada por
  `shopify.app.partner-staging.toml` existe en el dashboard actual y tiene
  cero instalaciones.
- Tiene una versión activa heredada, `tiendaiq-3-6`, publicada el 2026-07-23.
- Esa versión aún apunta al runtime anterior, usa callbacks y webhooks
  anteriores, conserva el flujo de instalación heredado, solicita scopes más
  amplios y contiene la extensión `tiendaiq-widgets`.
- `TiendaIQ Staging` y `TiendaIQ: Páginas con IA` tienen una instalación cada
  una; no son candidatas para este cutover.

## Decisión acotada

La aplicación sin instalaciones es una **candidata heredada** para Partner
Staging: puede recibir una versión nueva aislada sin afectar merchants. No es
una aplicación virgen, no demuestra por sí sola distribución pública y no se
declara como la futura identidad de producción.

## Gate antes de desplegar una versión Partner Staging

La persona que ejecuta `Release Partner Staging` debe comprobar nuevamente en
Shopify, en el momento del deploy:

1. que continúa con cero instalaciones;
2. la organización y el método de distribución compatibles;
3. el handle y las URLs/callbacks/webhooks legacy que serán reemplazados;
4. que `tiendaiq-widgets` pertenece a esta aplicación y puede publicar la
   versión nueva;
5. que no hay enlaces o automatizaciones que dependan del handle legacy.

El workflow exige la confirmación `PARTNER_STAGING_REMOTE_IDENTITY_AUDITED`.
Si cualquiera de estos puntos falla, se detiene: no se crean servicios, no se
despliega Shopify y no se reutilizan secretos.
