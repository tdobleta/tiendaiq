# TiendaIQ — plan de ejecución controlado hacia lanzamiento

**Fecha de corte:** 2026-08-27
**Fuente de producto:** `origin/main` en `8b3acd49d3a449f6adbd6ef4a6d6e0e0211a309f`
**Entorno bajo examen:** Partner Staging, separado de producción y de staging histórico.

## Regla de gestión

No se transfiere evidencia entre entornos ni entre SHAs. Un resultado es válido
sólo si identifica el SHA, la aplicación Shopify, la tienda, el entorno Render,
el procedimiento y el resultado. Un gate no se relaja: se corrige su causa o
permanece bloqueado.

## Estado ejecutivo verificado

| Área | Estado | Evidencia / límite |
| --- | --- | --- |
| Integridad de release | Base implementada | Release por SHA inmutable, migración antes de web/worker, `/ready` y preflight por rol/RLS. El último release Partner reportado fue `8b3acd…`; cada promoción debe revalidarlo. |
| Aislamiento y jobs | Base implementada | PostgreSQL con RLS forzado, roles de runtime separados, jobs/webhooks con leases, idempotencia y compensación. |
| Producto principal | Base implementada | Contrato de páginas versionado, validación central, bloqueo de claims/reseñas/ratings inventados por defecto, y publicación durable con pruebas. |
| Partner Staging | Activo para QA | App, tienda, servicios y extensión aislados. No es una identidad pública ni una prueba de App Store. |
| Certificación Shopify | En progreso | Publicación durable cerrada para la página controlada. Faltan tema/storefront, privacy actual, instalación/reinstalación y billing. |
| Capacidad / canary | NO-GO | No hay evidencia Partner actual de alertas, restore drill, rollback ni carga 50/200/1000; las métricas históricas no cuentan para Partner. |
| Producción y App Store | No iniciadas | Falta identidad pública, listing, soporte/legal, credenciales de review y regresión equivalente. |

## Bloques de trabajo

### A. Cerrar Partner Staging sin costo ni destrucción

1. Activar, sólo en la tienda Partner, el template `tiendaiq` y el bloque de la
   extensión para el producto publicado existente. Volver a ejecutar el
   diagnóstico protegido y conservar JSON sanitizado.
2. Entregar una vez `customers/data_request` y `customers/redact` sintéticos,
   firmados, sin PII y vinculados a este SHA; esperar al worker y registrar el
   hash de evidencia. No enviar `shop/redact`.
3. Ejecutar instalación limpia, reapertura embedded, desinstalación y
   reinstalación. Registrar configuración efectiva de scopes y callbacks.
4. Resolver storefront con una tienda QA pública o preview oficial que satisfaga
   el contrato. Nunca eludir ni almacenar la contraseña de una development
   store.

**Condiciones externas:** los puntos 1, 2 y 4 mutan Shopify o su estado de
prueba; se pedirán justo antes de ejecutarlos. El punto 3 se puede preparar,
pero una desinstalación real se confirma antes porque cambia el estado de QA.

### B. Probar facturación sin duplicar cargos

1. Inspección read-only del job e intención existente.
2. Sólo si no existe efecto externo ambiguo, crear una intención de prueba
   idempotente con `PLAN_TEST=1`.
3. Detenerse antes de la aprobación final de Shopify y pedir confirmación
   puntual. Después probar rechazo, aprobación, upgrade/downgrade, cancelación
   y reinstalación mediante el flujo oficial.

**Regla:** no crear una segunda suscripción ni convertir `PLAN_TEST` a `0`
durante este bloque.

### C. Hacer Partner Staging operable para una ola

Los siguientes trabajos pueden implementarse y revisarse en paralelo; sus
pruebas reales requieren recursos y presupuestos aprobados.

| Entregable | Cierre verificable | Dependencia manual |
| --- | --- | --- |
| Workflow de capacidad Partner aislado | Crea y limpia datos sintéticos sólo en Partner, con SHA y métricas comprobables | Ejecutar sobre la base Partner, nunca sobre legacy |
| Alertas reales + receptor | Prueba de alerta para web, worker, cola, errores, CPU/memoria y conexiones, con owner y runbook | Configurar proveedor/receptor |
| Restore drill | Restore en copia aislada con RPO/RTO registrado | Acceso/plan de backups Render |
| Rollback Partner | Ensayo que deja web, worker y componentes Shopify en el mismo SHA, sin revertir migraciones | Ventana QA y aprobación de deploy controlado |
| Capacidad IA 8 → 50 | Métricas, errores y coste bajo techo; la admisión sigue pausada fuera de la prueba | Crédito y presupuesto explícitamente aprobados |

### D. Preparar la identidad pública y revisión App Store

No reutilizar Partner Staging como producción. Antes de crear la identidad
pública, decidir distribución pública y confirmar que no existe una candidata
Partner pública correcta. Luego: servicios/base/secretos aislados, App Store
listing factual, política de privacidad real, soporte, contacto de emergencia,
capturas de UI real sin navegador, video de onboarding con inglés/subtítulos,
credenciales de revisión y matriz de evidencia.

`shop/redact` se prueba una sola vez en una tienda sacrificable, no en Partner
Staging ni producción.

## Secuencia de canary

| Ola | Máximo | Requisito para empezar | Requisito para avanzar |
| --- | ---: | --- | --- |
| 1 | 50 tiendas | A+B+C+D cerrados; admission control y alertas activas | 24 h sin fuga RLS, cola menor a 10 min, incidentes críticos ni reinicios inexplicados |
| 2 | 200 tiendas | Reconciliación de billing/coste/soporte de Ola 1 | Misma estabilidad durante 24 h |
| 3 | 1.000 tiendas | Métricas/coste/rate limit de proveedores y soporte dimensionado | Misma estabilidad durante 24 h; no se abre por calendario |

## Trabajo de frontend

Se permite **sólo** trabajo aislado que respete los contratos actuales: estados
de carga/error/vacío, accesibilidad, onboarding de la función existente y
templates fijos versionados cuya publicación no invente evidencia. Quedan
congelados los rediseños generales, claims comerciales y cualquier cambio que
altere checkout, billing, contratos de página o superficies Shopify antes de
cerrar A y B.

## Registro de informes

- `docs/reviews/partner-certification-audit-2026-08-27.md`
- `docs/reviews/release-reliability-audit-2026-08-27.md`
- `docs/reviews/product-workflow-audit-2026-08-27.md` (pendiente de consolidar)

Cada PR debe indicar qué fila de este plan cierra, SHA de evidencia y cómo
reproducir la verificación. Un PR que no cierra un hallazgo verificable no se
abre.
