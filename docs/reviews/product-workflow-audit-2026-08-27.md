# Auditoría de flujo de producto — 2026-08-27

## Alcance

Revisión de código y pruebas del checkout alineado con `origin/main`
`8b3acd49d3a449f6adbd6ef4a6d6e0e0211a309f`. No implica una prueba remota
nueva ni acceso a secretos, Shopify, Anthropic o billing.

## Base confirmable desde código

| Área | Estado | Evidencia |
| --- | --- | --- |
| Contrato de página | Implementado | `src/domain/page-contract.js` y `pruebas/page-contract.test.js` normalizan la versión y rechazan/fijan datos de compliance fabricados. |
| Generación durable | Implementada | La reserva, encolado y recuperación usan claves de idempotencia tenant-scoped en repositorios y `pruebas/generation-jobs.test.js`. |
| Admission control | Implementado | Límites tenant/global consultan una función agregada de PostgreSQL; al no admitir, no reserva cupo. |
| Publicación | Implementada | `publish-page` mantiene job activo, hash publicado y cambios pendientes; los handlers tienen pruebas de carrera y error. |
| Claims / reseñas | Fail-closed | El contrato conserva sólo evidencia verificada; las plantillas fijas deben ocultar reviews/ratings/stats sin fuente verificable. |
| Edición asistida | Parcialmente certificada | El flujo usa job durable; su validación bajo cuota/coste reales sigue pendiente. |

## No declarar como cerrado todavía

1. Una generación real controlada no demuestra capacidad de proveedor,
   presupuesto, rate limit ni UX a escala.
2. Los templates enriquecidos sólo son publicables si respetan el manifiesto
   fijo, los slots de producto reales y el guard de evidencia; no sustituyen la
   validación Shopify de theme/storefront.
3. El recorrido de un merchant nuevo aún requiere QA remota: instalación,
   onboarding, selección de producto, job, edición, publicación, template,
   storefront y recuperación de errores.
4. Billing y cuota deben seguir siendo autoridad de servidor/Shopify, no de
   valores de UI o claims de cliente.

## Prioridad de ejecución

- **Antes de canary:** QA E2E de merchant sobre la identidad Partner después
  de cerrar tema/privacy/billing; pruebas de cancelación/reintento y estados
  error/vacío/carga; evidencia de que contenido no verificable se oculta.
- **Puede avanzar en paralelo:** mejoras de accesibilidad y estados de la UI
  existentes, y empaquetado de templates fijos versionados sin cambiar sus
  claims ni sus contratos.
- **Posterior al GO inicial:** catálogo amplio de templates, editor visual
  avanzado y optimizaciones de conversión. Ninguno debe bloquear seguridad,
  billing o privacidad.

## Decisión

No se recomienda rediseñar el núcleo de generación/publicación ahora. La
mayor reducción de riesgo viene de probar el mismo recorrido de producto como
lo usará un merchant, en la identidad Partner y luego en la identidad pública,
con evidencia por SHA.
