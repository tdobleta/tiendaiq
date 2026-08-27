# Progreso: rollback controlado de Partner Staging

## Alcance

Implementación local de un workflow manual y fail-closed para restaurar un
SHA compatible de `origin/main` sobre la **misma** identidad Partner Staging.
No se ejecutó ningún deploy, llamada a Render/Shopify, migración, acción de
billing ni uso de Anthropic.

## Cambios

- Añadido `.github/workflows/rollback-partner-staging.yml`.
- Añadido `docs/runbook-rollback-partner-staging.md`.
- Añadido `pruebas/partner-staging-rollback-contract.test.js`.

## Garantías

- SHA completo y ancestro de `origin/main`.
- Triple confirmación: rollback, identidad remota y compatibilidad de
  migración.
- Lock compartido con releases/migraciones Partner Staging.
- Web, worker y `shopify app deploy --config partner-staging` usan el mismo
  SHA; readiness certifica la convergencia.
- No hay credencial migradora ni `npm run db:migrate`; no se mezclan bases ni
  se revierten migraciones.

## Validación completada

- `npm run probar`: aprobado (437 pruebas, coherencia y humo).
- `git diff --check`: aprobado.
- Secret scan del diff: aprobado; no encontró credenciales, URLs con password
  ni tokens.

El workflow no se dispara desde esta implementación.
