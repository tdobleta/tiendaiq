# Auditoría de confiabilidad de release y operación — 2026-08-27

## Alcance y método

Auditoría **read-only** del árbol de trabajo `codex/partner-session-refresh-race-2026-08-27` (HEAD `ef568f066591ac2e37b00e19ee75d1da0d759ec6`) y de `origin/main` en el momento de la revisión (`8b3acd49d3a449f6adbd6ef4a6d6e0e0211a309f`). No se consultaron secretos, no se accedió a bases ni se hicieron deploys. Por lo tanto, todo lo marcado como «verificado» es verificable desde código, migraciones, CI y runbooks; no es una afirmación sobre la salud presente de Render.

## Dictamen ejecutivo

La base de aislamiento y de releases es más sólida que la de un MVP común: roles de mínimo privilegio, RLS forzado, workers con leases, migraciones con checksum/lock, y releases por SHA inmutable están implementados y tienen pruebas. Sin embargo, **no hay evidencia runtime actual de que Partner Staging tenga capacidad, alertas, restauración o recovery suficientes para 50 instalaciones**, y mucho menos para 200 o 1.000. La documentación de carga más completa corresponde al staging histórico y no se puede transferir automáticamente al nuevo Partner Staging, que usa otra base y servicios `starter/basic-256mb`.

Estado recomendado: **NO-GO de canary**, pero apto para completar gates técnicos de Partner Staging de forma controlada.

## Garantías confirmables desde el repositorio

| Área | Evidencia de código/CI | Juicio |
| --- | --- | --- |
| Inmutabilidad de release | `release-partner-staging.yml` exige SHA de 40 caracteres, hace checkout de ese SHA y exige que siga siendo `origin/main` HEAD antes de migrar/desplegar. | Confirmable; evita promover una rama o commit mutable. |
| Orden de release | Migraciones con credencial propietaria → hook web → hook worker → `/ready` → despliegue Shopify → `/ops/status`. | Correcto como fail-closed; el preflight exige worker, mismo SHA y rol aislado. |
| Migraciones | `migration-runner.js` usa advisory lock, checksums y una transacción por migración. CI ejecuta migraciones dos veces en PostgreSQL 16. | Confirmable para idempotencia/alteración accidental; no prueba restauración ni compatibilidad real de toda futura migración. |
| RLS y roles | `create-pool.js` activa el rol runtime antes de la primera query; `verify-tenancy.js` requiere RLS/`FORCE RLS`, sin bypass, herencia, propiedad ni LOGIN. CI crea logins/roles reales y `probar-rls.js` cubre cruces de tenant y capacidad de worker. | Garantía fuerte y correctamente fail-closed en el artefacto probado. |
| Separación web/worker | Web y worker tienen logins/roles distintos; la credencial refresh queda sólo en web (`0023_expiring_shopify_offline_credentials.sql`); worker recibe columna limitada. | Confirmable en schema/grants y preflight. |
| Jobs/webhooks durables | Jobs, inbox y compensación usan `SKIP LOCKED`, leases, renovación, backoff, estado terminal y evidencia de SHA de worker. | Confirmable por código y tests; no equivale a throughput real de proveedores. |
| Binding app↔DB | Singleton `app_registration_binding` impide mezclar una base con otra identidad Shopify; Partner usa `SHOPIFY_APP_REGISTRATION_BINDING_ENFORCED=1`. | Buen control contra mezcla accidental de staging/legacy. |
| Observación de release | `/ready`, `/ops/status` y `ops:readiness` validan SHA, heartbeat, carriles, cola, inbox, compensación y billing-runtime sin exponer secretos. | Buen preflight puntual; no es monitoreo continuo. |
| CI de pull request | `verificar.yml` corre sintaxis, coherencia, unitarios, humo, PostgreSQL 16/RLS y una cola sintética de 100 jobs. Actions están fijadas por SHA. | Cobertura técnica razonable; no incluye e2e externo ni pruebas visuales/alertas. |

## Supuestos que no se deben presentar como evidencia

1. **Salud live de Partner Staging.** El repositorio configura `basic-256mb` para PostgreSQL y servicios `starter`, pero no demuestra CPU, memoria, conexiones, reinicios, backup ni versiones live. Debe probarse mediante `/ready`, `/ops/status` y paneles Render sobre el SHA exacto.
2. **Capacidad 50 → 200 → 1.000.** `docs/plan-lanzamiento-1000-tiendas.md` conserva mediciones del staging histórico y de SHA anteriores. El workflow `capacity-staging.yml` apunta explícitamente a `tiendaiq-staging-web` y environment `staging`, no a Partner Staging. No puede certificar la topología Partner.
3. **Capacidad Anthropic.** El plan registra 8 llamadas antiguas exitosas y un perfil 50 bloqueado por saldo. El Partner worker puede tener una clave para una prueba controlada, pero no hay perfil 50/500 ni crédito/rate limit actual verificable. La generación debe continuar pausada fuera de pruebas autorizadas.
4. **Alertas/observabilidad externa.** `monitoreo.js` envía a Sentry sólo si existe `SENTRY_DSN`; el Blueprint Partner no declara esa variable ni hay configuración versionada de alertas/receptores Render/Sentry. Logs estructurados y endpoints existen, pero no hay prueba de que alguien reciba alertas.
5. **Backup y restore.** Los runbooks lo requieren, pero no hay evidencia en Git/CI de un backup restaurable ni un restore drill de Partner. Tampoco debe asumirse que el backup administrado por Render cumple RPO/RTO hasta medirlo.
6. **Rollback ensayado.** Hay recuperación automática bien diseñada para producción, pero Partner Staging no tiene workflow de compensación/rollback equivalente y no se encontró un ensayo documentado. El release Partner puede quedar con web/worker/Shopify en versiones distintas si un paso intermedio falla; el gate lo detecta, no lo revierte.
7. **Límites de conexión.** `PG_POOL_MAX` es 10 web y 12 worker, con 8/4/2 carriles configurados. Falta confirmar el límite real de Postgres y multiplicar pools por instancias antes de escalar. No aumentar carriles por intuición.

## Riesgos prioritarios

### P0 antes de exposición externa

- Crear una evidencia **Partner específica** de capacidad de cola y DB, sin proveedores, que use credenciales/runtime Partner y deje limpieza comprobable. Reutilizar el diseño seguro de `capacity-staging.yml`, pero no apuntar al staging legado.
- Configurar y probar alertas reales: web unhealthy, worker heartbeat/reinicio, errores HTTP, cola vieja, fallos/compensación, conexiones, CPU/memoria y errores 429/5xx de Shopify/Anthropic. Registrar receptor y runbook.
- Ejecutar un restore drill de una copia Partner aislada y registrar RPO/RTO; no realizarlo sobre la base activa.
- Ensayar el rollback de aplicación sobre Partner Staging o crear un procedimiento versionado que restaure **web, worker y Shopify app components** al mismo SHA. Ninguna migración se revierte; la compatibilidad expand/contract debe ser gate de PR.

### P1 antes de la ola de 50 tiendas

- Ejecutar 8 → 50 generaciones reales con presupuesto/credito explícitamente aprobados, midiendo p95/p99, errores, rate limits, memoria, pool y antigüedad de cola. 500 sólo después de que 50 sea estable.
- Cerrar el E2E de Partner: instalación/reinstalación, publicación/tema/storefront, billing idempotente, y los tres webhooks de privacidad. Esto requiere acciones Shopify que no se ejecutan desde esta auditoría.
- Validar que los umbrales del preflight son conservadores para el hardware real. Hoy `OPS_MAX_RUNNING_JOBS=16` excede los 8 carriles de generación y mezcla tipos de jobs; es una alarma de salud, no una prueba de capacidad.
- Confirmar retención de logs y quién responde incidentes. `monitoreo.js` redacta bien tokens, URLs DB y PII común, pero una política de retención/alerting no está declarada.

### P2 después de ola 50 estable

- Automatizar la recopilación de artefactos sanitizados por release (ready, ops, despliegue, métricas de Render) y anexarlos al registro de evidencia.
- Añadir una prueba de compatibilidad de migración contra el SHA anterior para cambios de schema de alto riesgo. La CI actual prueba idempotencia, no la operación del binario anterior sobre schema nuevo.
- Reemplazar la instalación global de Shopify CLI por una imagen/herramienta con integridad más explícita si el pipeline se vuelve crítico; no bloquea Partner staging actual.

## Capacidad: lectura realista de 50 → 200 → 1.000

La topología actual es una protección de admisión, no una certificación de 1.000 instalaciones:

- `GENERATION_QUEUE_MAX_PER_TENANT=2` y global `120` protegen contra un tenant ruidoso y crecimiento infinito de cola. Es correcto.
- Ocho carriles de generación ofrecen capacidad teórica, pero cada llamada real depende de la cuota/latencia Anthropic y de CPU/memoria del worker `starter`.
- 10+12 conexiones máximas configuradas no son automáticamente 22 conexiones reales ni seguras; se debe medir el límite del plan, overhead de migrador/monitor y posibles réplicas de servicio.
- La carga de OAuth, publicación y webhooks comparte infraestructura con el web/worker. La ola debe medir los tres, no sólo jobs sintéticos.

Secuencia segura: **baseline Partner (sin proveedor) → 8 IA → 50 IA → ola 50 por 24h → ola 200 por 24h → ola 1.000 por 24h**. Cada transición exige métricas observadas y no sólo el paso del workflow.

## Bloques de ejecución y paralelismo

| Bloque | Dependencias | Puede ir en paralelo con | Condición de cierre |
| --- | --- | --- | --- |
| A. Inventario runtime Partner | Ninguna; lectura de Render/GitHub/Shopify | B, C, D | SHA web/worker, plan/DB, límites Render, alertas y secretos sólo por presencia quedan registrados sanitizados. |
| B. Alertas y runbooks operativos | A para conocer destinos | C, D | Alertas disparadas en prueba segura, receptor confirmado, runbook enlazado. |
| C. Capacidad Partner sin proveedor | A; autorización para datos sintéticos Partner | B, D | 100→500→1.000 tenants/jobs, limpieza total, pools/CPU/memoria dentro de umbrales. |
| D. E2E Shopify Partner no financiero | App/staging live | B, C | OAuth/reinstalación, publicación, theme/storefront y privacy no destructiva con evidencia del SHA. |
| E. Prueba IA pagada 8→50 | Crédito y presupuesto aprobados; B/C | F (preparación billing) | Coste, cuota, p95/p99 y cola dentro de umbral. |
| F. Billing idempotente | E recomendado; aprobación puntual antes del botón final | Ninguno que active un plan | Rechazo/aprobación/cancelación/reinstalación reconciliados sin solicitudes duplicadas. |
| G. Sacrificial `shop/redact` | Tienda sacrificable y aprobación puntual | Preparación listing | Borrado y evidencia durable, sin afectar staging/candidata pública. |
| H. GO canary | A–G, legales/listing y rollback drill | Preparación de soporte | Decisión GO firmada, ola 50 habilitada con criterios de pausa. |

## Decisiones manuales que siguen siendo necesarias

1. Autorizar una carga sintética **sobre Partner Staging** después de verificar límites y backup, o mantenerla bloqueada hasta crear ese workflow aislado.
2. Elegir/activar la solución de alertas y su receptor operativo; no basta con que exista `SENTRY_DSN` como posibilidad.
3. Aprobar presupuesto y crédito antes de cualquier prueba Anthropic de 8/50/500.
4. Autorizar por separado billing Shopify, cambios de contraseña/storefront y `shop/redact` en una tienda sacrificable. Ninguno es sustituible por CI.

## Recomendación inmediata

No abrir todavía la ola 50. Priorizar un PR pequeño que añada la capacidad Partner aislada y/o la evidencia de observabilidad sólo si el inventario runtime demuestra que faltan; en paralelo cerrar los gates no financieros de Shopify. Antes de cualquier acción con costo o efecto destructivo, solicitar una autorización ligada a la tienda, SHA, presupuesto y criterio de reversión.
