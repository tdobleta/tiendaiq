# Progreso: evidencia de capacidad Partner Staging

## Alcance

Se creó un workflow manual Partner aislado, sin modificar el workflow histórico
`Capacity staging` ni ejecutar servicios remotos.

## Controles incorporados

- SHA completo, `HEAD` de `origin/main` y `/ready` de
  `tiendaiq-partner-staging-web` deben coincidir.
- Requiere confirmación distinta para ejecución y limpieza, con `runId` exacto
  para la segunda.
- Usa exclusivamente `PARTNER_STAGING_WEB_DATABASE_URL` y
  `PARTNER_STAGING_WORKER_DATABASE_URL`, ambos logins runtime; rechaza por
  contrato credenciales migradoras, legacy, producción, Shopify, Anthropic y
  billing.
- La carga usa los datos sintéticos y limpieza idempotente ya implementados en
  `scripts/probar-capacidad-cola.js`.
- Sólo se adjunta un artefacto de métricas con lista blanca; no se adjunta el
  log crudo ni errores que pudieran contener URLs de conexión.

## Validación completada

- `npm run probar`: 438 tests unitarios y humo correctos.
- `git diff --check`: correcto.
- Escaneo de secretos del diff: sin valores de credenciales ni URLs de
  conexión.

No ejecutar el workflow remoto hasta que el PR se revise y el environment
protegido tenga los dos secretos runtime Partner nuevos.
