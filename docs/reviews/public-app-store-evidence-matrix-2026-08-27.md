# TiendaIQ — paquete de evidencia para futura App Store pública

**Fecha de revisión:** 2026-08-27
**Alcance:** sólo lectura de `origin/main` en `8b3acd49d3a449f6adbd6ef4a6d6e0e0211a309f`, documentación oficial de Shopify consultada el mismo día y evidencia histórica del repositorio.
**Fuera de alcance:** no se revisaron ni modificaron secretos, Render, Shopify Dev Dashboard, la tienda, producción ni una ficha de App Store.

## Dictamen ejecutivo

TiendaIQ tiene componentes que ayudan a una revisión pública: contrato versionado para páginas, controles de autenticidad contra claims/reseñas inventadas, RLS forzado, jobs durables, webhooks y páginas legales servidas por la aplicación. Sin embargo, no existe evidencia suficiente para declarar una app pública lista para enviar.

La identidad **TiendaIQ Partner Staging** y su evidencia pertenecen a un entorno de prueba. No deben declararse como evidencia de una futura identidad pública ni de sus endpoints de producción. Un SHA idéntico no transforma una prueba de staging en una prueba de la app o infraestructura que Shopify revisará.

**Decisión:** `NO-GO` para crear una submission pública hasta que las filas bloqueantes de esta matriz queden verificadas sobre la identidad pública, su release y una tienda de review. Esto no bloquea trabajo de producto que no altere contratos, billing, privacidad ni autenticación.

## Convenciones de estado

| Estado | Significado |
| --- | --- |
| `Repositorio` | La implementación o prueba existe en el SHA revisado; no prueba el runtime público. |
| `Staging solamente` | Se reportó o documentó sobre Partner Staging; no es reutilizable para review pública. |
| `Pendiente` | No hay evidencia verificable en este alcance. |
| `Bloqueante` | Debe cerrarse antes de enviar a Shopify. |

## Matriz de requisitos y evidencia

| Requisito / fuente | Evidencia actual | Estado | Dueño | Acción mínima de cierre |
| --- | --- | --- | --- | --- |
| Identidad pública y distribución elegida | Existe contrato que separa Partner Staging de candidata pública (`docs/partner-cutover-contract.md`). No hay identidad pública ni distribución pública verificadas en este alcance. | Pendiente · **Bloqueante** | Dueño del Partner account | Crear/configurar la app pública como identidad distinta; registrar nombre final, distribución, app URL, callbacks y app handle sin reutilizar secretos de staging. |
| Nombre único y consistente | Código y legales usan `TiendaIQ`; no hay búsqueda/confirmación de disponibilidad del nombre público ni ficha. | Pendiente · **Bloqueante** | Producto/marketing | Validar el nombre en Developer Dashboard y completar los mismos términos en app, listing e icono. |
| UI operable y sin errores web | Hay pruebas locales y rutas de app; falta recorrido de reviewer contra el runtime público. | Repositorio · **Bloqueante** | QA | Ejecutar instalación limpia, navegación, estados de error y valor principal en identidad pública; adjuntar video y resultados. |
| App embebida, App Bridge y session tokens | La aplicación tiene autenticación propia y pruebas, pero este paquete no aporta prueba de incognito/reviewer sobre la identidad pública. | Repositorio · **Bloqueante** | Ingeniería/QA | Ensayar instalación, reapertura e incógnito sin third-party cookies; conservar pasos y SHA públicos. |
| OAuth, callback y reinstalación | Hay implementación y la certificación de staging contempla OAuth; no hay evidencia actual de install/uninstall/reinstall sobre la app pública. | Staging solamente · **Bloqueante** | Ingeniería/QA | Ejecutar un guion limpio con tienda de review: install → OAuth → valor → uninstall → reinstall → OAuth, sin preconfiguración oculta. |
| GraphQL Admin API y versión soportada | La configuración y el código trabajan con Admin GraphQL; la versión y scopes definitivos de producción no están demostrados. | Repositorio · **Bloqueante** | Ingeniería | Fijar y desplegar la configuración pública revisada; almacenar matriz feature → scope → query/mutation. |
| Scopes mínimos | Partner Staging usa scopes de productos, contenido, archivos, descuentos y navegación. Su necesidad por feature en una futura app pública no está justificada en un artefacto de review. | Staging solamente · **Bloqueante** | Ingeniería/producto | Aprobar matriz de scopes, quitar los no necesarios y marcar como opcionales los que no apliquen a todos los merchants. |
| Theme app extension y storefront | Existe extensión de tema y evidencia de publicación en staging. Falta prueba de Theme Editor y storefront de la app pública. | Staging solamente · **Bloqueante** | Ingeniería/QA | Instalar la extensión pública en una tienda de review, activar embed/bloque con deep link, validar Theme Editor y storefront sin errores. |
| Onboarding de extensión | Hay documentación de bootstrap, no una demostración pública de onboarding completo y sin pasos ocultos. | Repositorio · **Bloqueante** | Producto/QA | Probar onboarding desde cero y documentar deep link, permisos, activación y recuperación de errores. |
| Claims, reseñas y estadísticas | Contrato versionado y pruebas evitan contenido fabricado por defecto. | Repositorio | Ingeniería | Mantener pruebas; revisar que el listing, capturas, plantillas y copy de lanzamiento no introduzcan claims, reseñas o métricas no permitidas. |
| Billing vía Shopify y reconciliación | Existe código de billing y recuperación idempotente. `PLAN_TEST=1` y la certificación histórica indican que el billing de prueba aún no está activo. | Repositorio / Staging solamente · **Bloqueante** | Ingeniería/QA + dueño | Ejecutar, con autorización separada, una sola prueba idempotente de: aceptar, rechazar, trial, upgrade, downgrade, cancelación y reinstalación; después repetir en la configuración pública sin cobro inesperado. |
| Pricing exacto | Términos indican que los cargos se procesan por Shopify, pero falta tabla pública de precios/condiciones y su correspondencia con billing real. | Repositorio parcial · **Bloqueante** | Producto/legal | Aprobar precio, trial, límites y cancelación; alinear selector, App Pricing/Billing API, términos y Pricing details. |
| Compliance webhooks obligatorios | Código verifica/normaliza topics y maneja `customers/data_request`, `customers/redact`, `shop/redact`; existe evidencia sintética histórica sólo de los dos primeros en staging. | Repositorio / Staging solamente · **Bloqueante** | Ingeniería/privacidad | Configurar URLs en identidad pública, demostrar HMAC válido/401 inválido y procesamiento durable. Probar `shop/redact` exclusivamente en tienda sacrificable con autorización específica. |
| `app/uninstalled` y lifecycle | Handler y pruebas existen; no hay evidencia runtime pública del corte de acceso, jobs y datos. | Repositorio · **Bloqueante** | Ingeniería/QA | Ensayar uninstall y confirmar que sesiones, tokens y jobs de esa tienda quedan inactivos; no confundirlo con `shop/redact`. |
| Política de privacidad | `/privacidad` se sirve desde `app/privacidad.html`, con datos de responsable/sporte desde entorno y proveedores Shopify, Anthropic y Render. Falta revisión legal y verificación pública con datos finales. | Repositorio parcial · **Bloqueante** | Titular/legal | Revisar legalmente exactitud, subprocesadores, retención, transferencias, derechos y contacto; completar valores sólo en producción y verificar URL pública. |
| Términos, soporte e identidad legal | `/terminos` existe y requiere `EMAIL_SOPORTE`, `RAZON_SOCIAL`, `DOMICILIO`. No se verifican valores ni operatividad de soporte desde este paquete. | Repositorio parcial · **Bloqueante** | Titular/soporte | Confirmar titular legal, domicilio, email que recibe respuestas, SLA y proceso de soporte; publicar y probar ambas URLs finales. |
| Datos protegidos de clientes | La política declara no almacenar datos de compradores, y no se observa un scope de cliente en el conjunto revisado. No es una aprobación formal de protected customer data. | Repositorio parcial | Ingeniería/legal | Revalidar el inventario real de datos/API antes de submission; solicitar acceso a protected customer data sólo si una feature futura lo exige. |
| Listing factual y clasificación | No hay borrador de ficha pública. El producto requiere Online Store; la ficha deberá declararlo si aplica. | Pendiente · **Bloqueante** | Producto/marketing | Escribir listado factual: categoría/tags, idioma soportado, dependencia de Online Store, funciones, soporte y privacidad; no usar precios fuera de Pricing details ni testimonios/estadísticas. |
| Icono y media | No hay paquete de media de listing validado. | Pendiente · **Bloqueante** | Diseño/producto | Preparar icono PNG/JPEG 1200×1200 y capturas únicas de UI real, sin marcos de navegador/escritorio, precios, testimonios, métricas ni marcas Shopify. |
| Screencast y credenciales | No hay video ni credenciales de review. | Pendiente · **Bloqueante** | QA/soporte | Crear video en inglés o con subtítulos ingleses que muestre install/onboarding/valor principal; proveer instrucciones y credenciales válidas con acceso a todo el flujo. |
| Contacto de emergencia y canal de review | No hay evidencia de emergency developer contact ni de monitoreo del email de submission. | Pendiente · **Bloqueante** | Dueño del Partner account | Configurar contacto técnico de emergencia (email y teléfono) y asegurar recepción de correo de Shopify. |
| Release, rollback, alertas y restauración | RLS, jobs y `/ready` están implementados; la evidencia de rollout actual es Partner Staging. Los controles de capacidad y rollback se están preparando por separado. | Staging solamente · **Bloqueante para canary** | SRE/ingeniería | Ejecutar pruebas en topology pública: release inmutable, rollback coordinado web/worker/componentes, alertas accionables, restore drill y carga representativa con presupuesto de IA. |
| Self-review y submission | No se ejecutó el self-review oficial ni se inició submission. | Pendiente · **Bloqueante** | Ingeniería/PM | En la rama/release candidata, ejecutar `/shopify-app-store-review`, triagear findings y completar la página de review; no sustituye QA live. |

## Evidencia que no se puede reciclar como prueba pública

| Artefacto o hecho | Por qué no basta para la App Store pública | Uso correcto |
| --- | --- | --- |
| SHA `8b3acd49d3a449f6adbd6ef4a6d6e0e0211a309f` y `/ready` de Partner Staging | Prueba una versión y un runtime de staging, no el release, dominio ni roles de producción. | Base técnica/repetibilidad; repetir contra SHA candidato público. |
| Página controlada y publicación de producto en Partner Staging | Está ligada a una tienda de desarrollo y a una app de staging. | Validar contrato de publicación; repetir con datos de review pública. |
| Privacy sintético de `customers/data_request` y `customers/redact` en staging | No cubre URLs/configuración de la identidad pública y no cubre `shop/redact`. | Ensayo de implementación; repetir los dos y planificar `shop/redact` en tienda sacrificable. |
| Scopes/extension configurados en Partner Staging | Scopes, UIDs, handles, callbacks e instalaciones son específicos de esa identidad. | Referencia de configuración mínima; revisar y aplicar explícitamente a producción. |
| Billing de prueba o `PLAN_TEST=1` | No prueba el comportamiento de cobranza final ni el listing de precios. | Sólo seguridad del ensayo; requerir matriz de billing pública. |
| Development store con contraseña | No demuestra que un reviewer externo pueda seguir la experiencia pública ni que el storefront de producción funcione. | Usar para desarrollo; la review necesita instrucciones/credenciales y runtime apto para revisión. |

## Paquete que debe existir antes de pulsar “Submit for review”

1. **Hoja de trazabilidad de release:** SHA, versión de app, app handle, dominios, callbacks, scopes y fecha, sin secretos.
2. **Guion de reviewer reproducible:** instalación limpia, OAuth, primer valor, publicación, extensión de tema, errores previstos, uninstall/reinstall y billing según plan.
3. **Matriz de pruebas runtime:** resultados con tienda, SHA, hora y evidencia sanitizada para OAuth, webhooks, publication, theme/editor, billing y privacidad.
4. **Paquete de listing:** nombre aprobado, subtitle/descripción factual, categoría/tags, idiomas, Online Store requirement, Pricing details, icono y media únicas.
5. **Paquete legal/soporte:** política y términos revisados para el comportamiento real; URLs públicas, titular, contacto, emergencia, instrucciones de soporte y credenciales de review funcionales.
6. **Paquete operacional:** canary, dashboards/alertas, criterios de pausa, rollback y restore drill con un responsable on-call.

## Próxima acción manual mínima

Antes de crear una ficha pública, el dueño debe decidir y registrar la **identidad pública final** (nombre comercial aprobado, distribución pública y titular/legal). Después de esa decisión, ingeniería puede copiar configuración no secreta a una nueva app pública y ejecutar el paquete de pruebas sin confundirla con Partner Staging.

## Fuentes oficiales consultadas (2026-08-27)

- [Shopify App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [Pass app review](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review)
- [Submit your app for review](https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review)
- [Privacy requirements](https://shopify.dev/docs/apps/launch/privacy-requirements)
- [Privacy law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)

Estas fuentes cambian; volver a consultarlas inmediatamente antes de la submission. Esta matriz es técnica/operativa y no reemplaza asesoramiento legal.
