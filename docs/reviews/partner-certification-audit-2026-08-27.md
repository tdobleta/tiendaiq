# Auditoría Shopify Partner Staging — 2026-08-27

## Alcance y método

Auditoría **sólo lectura** del checkout `fixed-pdp-template-port-2026-08-26`.
No se leyó ningún secreto, no se mutó Shopify/Render/GitHub, no se inició
billing y no se ejecutó ningún webhook. Las conclusiones separan código
revisado, evidencia de ejecución observada en esta continuidad y elementos que
requieren una prueba remota nueva.

La documentación oficial de Shopify fue consultada el 2026-08-27:

- [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [Pass app review](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review)
- [Privacy law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- [Privacy requirements](https://shopify.dev/docs/apps/launch/privacy-requirements)

## Identidad y release bajo examen

| Aspecto | Estado | Evidencia |
| --- | --- | --- |
| SHA canónico remoto | Verificado en Git | `origin/main` = `8b3acd49d3a449f6adbd6ef4a6d6e0e0211a309f`. El checkout auditado está en el commit de PR #89 que fue mergeado en ese SHA. |
| App Partner Staging | Configurada | `shopify.app.partner-staging.toml`: handle `tiendaiq-partner-staging`, App URL y callback HTTPS del runtime Partner, app embebida y tienda `tiendaiq-partner-staging.myshopify.com`. |
| Aislamiento de la identidad | Configurado | Blueprint, token de operaciones y workflow dedicados a Partner Staging; no apuntan al staging legado. Ver `render.partner-staging.yaml`, `docs/partner-staging-bootstrap.md` y workflows `*-partner-staging.yml`. |
| Web/worker live en SHA | Evidencia observada, no reconsultada por esta auditoría | Release Partner Staging #15 fue reportado exitoso para `8b3acd…`; `/ready` reportó Postgres/RLS y binding de registro correctos. La próxima promoción debe volver a comprobar ambos procesos contra el SHA exacto. |
| Producción/App Store pública | No iniciada | La propia documentación de cutover separa Partner Staging de la futura identidad pública de producción. No hay evidencia de una identidad de producción con distribución pública, listing o review lista. |

## Hallazgos por gate

| Gate | Estado | Evidencia verificable | Qué falta / riesgo | Acción siguiente mínima |
| --- | --- | --- | --- | --- |
| OAuth de instalación | **Implementado; E2E incompleto** | `auth.js` valida HMAC, timestamp, state de un uso persistido, cookie `HttpOnly; Secure; SameSite=Lax`, shop y scopes antes de persistir. La UI usa App Bridge `idToken()` en cada llamada (`app/index.html`, `app/app.js`). | Falta evidencia en la identidad Partner de instalación limpia, reapertura, desinstalación/reinstalación y, si aplica, dos usuarios. No se puede inferir desde tests. | En la tienda Partner, ejecutar instalación limpia y luego desinstalación/reinstalación con captura de pasos y resultado; no introducir `?shop=` manualmente. |
| Sesión y token offline expiring | **Implementado y testeado** | PR #89 añade espera acotada para carreras de refresh; `src/shopify/offline-token-lifecycle.js`, `src/shopify/token-refresh-broker.js`, `tiendas.js` y `pruebas/expiring-offline-credentials.test.js`. | La regresión remota posterior a la instalación/reinstalación no consta como evidencia durable. | Incluir reapertura de la app después de OAuth en el recorrido E2E anterior. |
| Scopes | **Configurado; evidencia remota previa verde** | Manifiesto pide los nueve scopes de producto, contenido, archivos, descuentos y navegación. `evaluateScopeEquivalence` falla por faltantes o extras peligrosos y sólo admite el `read_*` implícito de un `write_*` ya concedido. | Hay que conservar la comprobación contra `currentAppInstallation.accessScopes` tras cada cambio de manifest/reinstalación. Cada scope debe seguir teniendo justificación de feature para review. | Revalidar scopes durante la instalación limpia; no agregar ninguno. |
| Webhooks operativos | **Implementado; evidencia remota previa verde** | OAuth registra `APP_UNINSTALLED` y `APP_SUBSCRIPTIONS_UPDATE` idempotentemente. El workflow E2E los consulta contra la URL esperada. | Falta evidencia nueva si se reinstala/cambia versión remota. | La instalación limpia debe confirmar ambos callbacks registrados en la URL Partner. |
| Compliance webhooks configurados | **Configurado** | `shopify.app.partner-staging.toml` declara `customers/data_request`, `customers/redact`, `shop/redact` hacia `/webhooks`; la versión remota mostrada en Dev Dashboard incluye las tres URLs. | La configuración no prueba entrega ni procesamiento. | Con autorización específica, enviar una única entrega sintética, HMAC válida y sin PII para cada uno de `customers/data_request` y `customers/redact`. |
| Privacy `customers/data_request` y `customers/redact` | **Bloqueado por evidencia runtime** | `src/webhooks/verify-and-normalize.js` valida HMAC sobre cuerpo crudo, minimiza payload y hashea referencia de cliente; `handlers.js` registra evidencia durable con SHA del worker. El gate exige ambos eventos procesados por el mismo SHA. | Para `8b3acd…` no hay evidencia durable actual de ambas entregas. El E2E previo informó `privacy_webhook_evidence_incomplete`. | Ejecutar las dos entregas sintéticas anteriores, esperar al worker y leer el diagnóstico protegido. |
| `shop/redact` | **Deliberadamente pendiente/destructivo** | Handler elimina instalación/inbox y registra evidencia anonimizada. El verificador declara explícitamente que no certifica este paso. | Shopify lo requiere para una app pública; jamás debe probarse sobre la tienda Partner que se usa para QA. | Crear/identificar una tienda sacrificable y obtener autorización explícita antes de un único `shop/redact`. |
| Página durable publicada | **Cerrado para el SHA reportado** | La página controlada `9390316716265` fue publicada; el segundo E2E removió `durable_publication_not_verified`. El código exige job `publish-page` exitoso, hash, URL HTTPS y SHA de worker coincidente. | Si cambia el SHA, se debe republicar la página existente con el worker del nuevo SHA; no generar otra. | Mantener el ID y el hash como evidencia; sólo reprocesar/republicar cuando cambie el release. |
| Publicación Shopify/template | **Pendiente** | El gate exige producto exacto, `templateSuffix === "tiendaiq"`, metafield JSON con hash coincidente y URL Shopify normalizada. El app block está implementado en `extensions/tiendaiq-widgets/blocks/pagina.liquid`, sin escribir archivos de theme. | El último E2E reportó `shopify_publication_not_verified`. Aún no consta la activación del template de producto `tiendaiq` y del bloque de la extensión en el tema de la tienda Partner. | Con autorización para mutar sólo el tema Partner, crear/seleccionar el template `product.tiendaiq`, agregar el bloque TiendaIQ y asignar la página existente; luego una lectura protegida del diagnóstico. |
| Storefront público | **Bloqueado por contraseña de Development Store** | El verificador sólo acepta HTML HTTPS de la URL exacta con `window.TIENDAIQ_DATA`, `#app[data-ssr]` y `tiendaiq.js`; no obtiene ni elude contraseñas. | El último E2E reportó `storefront_not_verified`; una tienda de desarrollo protegida no aporta evidencia pública. | Usar preview oficial seguro si satisface la URL exacta; si no, autorizar temporalmente quitar/restaurar la contraseña en una tienda QA no productiva o usar una tienda QA pública separada. |
| Billing de prueba | **Bloqueado deliberadamente** | `facturacion.js` consulta/reconcilia suscripciones, usa intención durable y los jobs bloquean nueva mutación ante resultado ambiguo. El gate sólo acepta una suscripción `TiendaIQ Pro`, `ACTIVE`, `test=true`, con `PLAN_TEST=1`. | El último E2E reportó `test_billing_not_active`. Ninguna suscripción de prueba debe crearse sin aprobación puntual y no debe repetirse un intento ambiguo. | Antes de tocar Shopify Billing, revisar diagnóstico de jobs en modo lectura; después crear una única intención idempotente y detenerse antes de la aprobación Shopify. |
| Listing, review y soporte | **No preparado** | La fuente oficial exige nombre coherente, pricing exacto, screenshots de UI real sin browser/desktop, screencast, instrucciones/credenciales estables, soporte y privacidad. | No hay matriz de listing, video, credenciales de reviewer, política publicada validada, detalles de pricing ni inventario de requisitos de canal Online Store. | Abrir un paquete de listing sólo cuando el recorrido de producto y billing de la futura identidad pública estén probados; no usar capturas de staging como entrega final. |

## Controles que el código sí mantiene fail-closed

1. El endpoint protegido no da un verde parcial: `scripts/verificar-certificacion-shopify-staging.js` exige checks de scopes, billing, webhooks operativos, publicación durable, publicación remota, storefront y privacy todos correctos.
2. La comparación de publicación no relaja host/path/query: `onlineStorePreviewUrl` es fallback sólo si `onlineStoreUrl` no existe y debe ser HTTPS, host de tienda exacto y sin query/fragmento.
3. Los payloads de privacy no guardan email, teléfono, pedidos ni cliente completo; se conserva hash de referencia cuando aplica.
4. La extensión de tema usa app block y assets de extensión; no persiste Liquid/JS directamente en themes.
5. La aplicación sigue con `PLAN_TEST=1` en ambos servicios Partner según `render.partner-staging.yaml`; no es válida para cobro real.

## Discrepancias y advertencias

1. `docs/partner-staging-identity-audit-2026-08-24.md` describe una condición previa de **cero instalaciones**. Esa afirmación es histórica: Partner Staging ya se instaló posteriormente para generar/publicar la página controlada. No debe reutilizarse como evidencia actual ni como precondición literal de futuros releases. Hace falta actualizarla en un PR documental separado, luego de una nueva lectura remota de identidad.
2. Partner Staging estar dentro de Onepilot/Dev Dashboard **no equivale** a tener la app pública del App Store. La futura identidad de producción debe decidir distribución pública antes de submission y conservar configuración/secretos/bases independientes.
3. El campo `embedded=false` observado bajo la sección POS del dashboard no contradice que la app sea embedded: el manifiesto declara `embedded = true` para la app y `[pos] embedded = false` para POS. De todos modos, el QA debe confirmar que la app abre embedded con App Bridge en Shopify Admin.
4. No hay evidencia auditada aquí de que la versión actual de la extensión se encuentre activa en el tema Partner. El `shopify app deploy` exitoso publica componente, pero no activa automáticamente un bloque en un theme.

## Secuencia de cierre recomendada (sin saltos)

1. **Tema y publicación:** habilitar el bloque/template sólo en la tienda Partner, asignarlo al producto existente y leer `/ops/shopify-certification` protegido.
2. **Privacy no destructivo:** dos entregas sintéticas firmadas (`customers/data_request`, `customers/redact`), esperar worker y comprobar evidencia de `8b3acd…`.
3. **Storefront:** demostrar URL pública y marcadores mediante preview oficial o una tienda QA pública; no eludir contraseña.
4. **Ciclo OAuth:** instalación limpia, acceso embedded, desinstalación/reinstalación y reapertura; adjuntar pasos reproducibles.
5. **Billing test:** diagnóstico read-only primero; una única intención idempotente, detenerse antes de cualquier pantalla de aprobación hasta autorización.
6. **`shop/redact`:** sólo en tienda sacrificable y con autorización explícita.
7. **Identidad pública + listing:** decidir/crear la app de producción con distribución pública, preparar soporte/legal/listing/credenciales/video, y ejecutar regresión en un entorno equivalente.

## Decisión de auditoría

Partner Staging tiene una base técnica razonable y no debe rediseñarse ahora. No está certificado para App Store ni listo para promoción pública: los bloqueadores reales son evidencia remota de tema/storefront/privacy/OAuth/billing, `shop/redact` aislado y la futura identidad pública con material de review. La siguiente acción de menor riesgo y mayor desbloqueo es la **activación controlada de template y app block en el tema Partner**, seguida de una lectura protegida del diagnóstico; requiere confirmación porque modifica Shopify.
