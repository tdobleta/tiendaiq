# Runbook: rollback controlado de Partner Staging

## Propósito

Restaurar **solamente la aplicación** de Partner Staging a un SHA anterior y
compatible ya presente en `origin/main`. El workflow manual
`Rollback Partner Staging` restaura **web, worker y los componentes Shopify**
desde ese mismo SHA y certifica la convergencia. No despliega producción ni
afecta staging legado.

## Precondiciones fail-closed

- Existe un incidente concreto que justifica recuperar el último SHA conocido
  compatible. No es un atajo para probar ramas ni para reparar una migración.
- El SHA objetivo es completo (40 caracteres), fue revisado y existe en el
  historial de `origin/main`.
- El release posterior fue expand/contract compatible con el objetivo. El
  rollback **no revierte migraciones** ni toca la base: conserva la base
  exclusiva de Partner Staging tal como quedó tras el release más reciente.
- Se auditó la identidad remota: aplicación, handle, extensión e
  instalaciones corresponden a Partner Staging. Nunca usar el workflow con
  staging legado, una app de producción o una base distinta.
- El entorno protegido de GitHub `partner-staging` sigue aislado y contiene
  sus hooks Render, token de automatización Shopify y token operativo; no se
  copian secretos entre entornos.

## Ejecución

En GitHub Actions, ejecutar `Rollback Partner Staging` desde `main` y cargar:

| Campo | Valor exacto |
| --- | --- |
| `rollback_sha` | SHA completo compatible del historial de `origin/main` |
| `confirmation` | `ROLLBACK_REVIEWED_PARTNER_STAGING` |
| `identity_audit_confirmation` | `PARTNER_STAGING_REMOTE_IDENTITY_AUDITED` |
| `migration_compatibility` | `PARTNER_STAGING_MIGRATIONS_ARE_BACKWARD_COMPATIBLE` |

El workflow rechaza cualquier SHA corto, ajeno a `origin/main`, checkout que
no coincida, confirmación incompleta o identidad sin auditar. Comparte el lock
de mantenimiento de Partner Staging con bootstrap y releases ordinarios: no
puede correr mientras una migración está en curso.

## Qué hace

1. Valida el target inmutable y sus precondiciones explícitas.
2. Solicita a Render el deploy del mismo SHA para **web y worker**.
3. Exige `/ready` con ese SHA antes de tocar Shopify.
4. Publica configuración y extensión mediante `shopify app deploy --config
   partner-staging` desde el mismo SHA.
5. Ejecuta readiness operativo con perfil `rollback`; la evidencia resumida se
   conserva en el resumen del run.

## Límites y respuesta ante fallo

- No ejecutar el workflow si una migración destructiva dejó al SHA antiguo
  incapaz de operar. Corregir con un release compatible hacia adelante.
- No usarlo para deshacer datos, billing, configuración de tienda, secretos ni
  cambios de identidad Shopify.
- Si web, worker, Shopify o readiness no convergen, detenerse: el workflow
  termina en rojo y el incidente requiere diagnóstico. No reintentar a ciegas
  ni apuntar servicios a la base de otro entorno.

## Evidencia a registrar

Guardar el URL/run de GitHub Actions, SHA objetivo, hora, resultado de
`/ready`, resultado sanitizado de readiness, y confirmación de que web,
worker y componentes Shopify quedaron en el mismo SHA. No incluir tokens,
URLs de base, secretos ni payloads de merchants.
