# Gate Shopify E2E en staging

## Objetivo

Producir evidencia reproducible de que una development store instalada usa el
release exacto desplegado en staging y completa el circuito activo:

1. Sesion persistida y token Shopify vigentes mediante una consulta Admin API
   autenticada.
2. Scopes exactos, sin permisos faltantes ni inesperados.
3. Suscripcion `TiendaIQ Pro` activa en modo de prueba.
4. Webhooks operativos registrados en el callback de staging.
5. Publicacion durable terminada por el worker.
6. Producto remoto con `templateSuffix=tiendaiq` y metafield JSON cuyo SHA-256
   coincide con el hash durable de PostgreSQL.
7. Storefront publico HTTP 2xx en la URL durable exacta, con HTML de la theme app
   extension (`TIENDAIQ_DATA`, `#app[data-ssr]` y `tiendaiq.js`).
8. Entregas completadas de `customers/data_request` y `customers/redact`.

La publicacion y las entregas de privacidad deben haber sido procesadas por un
worker que ejecute el mismo SHA completo que se solicita al workflow. Evidencia
de un release anterior no satisface el gate aunque siga dentro de la ventana de
24 horas.

Este gate no llama a Anthropic, no genera contenido y no muta Shopify. Lee
evidencia creada previamente por los flujos reales de la aplicacion.

Este gate tampoco despliega servicios. Verifica que el SHA solicitado ya sea el
HEAD revisado de `main` y que `/ready` exponga exactamente ese SHA. La promocion
previa corresponde a `Release staging`, que envia el parametro `ref=<SHA>` a
los deploy hooks de web y worker para solicitar un commit especifico.

La comprobacion del storefront es un preflight HTTP del HTML servido, no una
certificacion visual en un navegador real. Antes del GO se conserva como gate
separado una prueba Playwright desktop y mobile que compruebe render, assets,
interaccion y ausencia de solapamientos sobre esa misma URL durable.

## Limite deliberado

La consulta autenticada demuestra que la sesion instalada y su token siguen
siendo validos. No sustituye la prueba manual E2E de instalacion o reinstalacion
OAuth (inicio, `state`, HMAC del callback, intercambio y persistencia de una
sesion nueva), que debe conservarse como evidencia separada antes del GO.

`shop/redact` elimina los datos de la tienda. Se certifica por separado en una
development store sacrificable. El endpoint activo siempre informa
`blocksFullCertification=true`; por lo tanto, un workflow verde aqui no es por
si solo un GO para App Store ni para produccion.

Billing en staging exige `PLAN_TEST=1`. El cobro real con `PLAN_TEST=0` sigue
siendo un gate comercial separado antes del lanzamiento.

Los compliance webhooks declarados en `shopify.app.toml` tampoco aparecen en la
consulta Admin GraphQL de suscripciones shop-scoped. Su version desplegada se
certifica por separado en **Shopify Dev Dashboard > Versions > Configuration**.
Un workflow activo verde no reemplaza esa evidencia.

## Configuracion protegida

En el servicio `tiendaiq-staging-web` de Render:

```text
SHOPIFY_CERTIFICATION_ENABLED=1
SHOPIFY_CERTIFICATION_SHOP=development-store.myshopify.com
SHOPIFY_CERTIFICATION_PAGE_ID=<id interno de la pagina de certificacion>
SHOPIFY_CERTIFICATION_MAX_AGE_HOURS=24
# Solo si la QA Development Store conserva password protection. Cargarlo
# exclusivamente como secreto de Render, nunca en GitHub ni en este archivo.
SHOPIFY_CERTIFICATION_STOREFRONT_PASSWORD=<password actual de la tienda QA>
PLAN_TEST=1
OPS_STATUS_TOKEN=<token existente de staging, minimo 32 caracteres>
```

No agregar estas variables al worker. GitHub usa unicamente el secreto ya
existente `STAGING_OPS_STATUS_TOKEN`. GitHub no recibe el token Shopify,
`TOKEN_ENC_KEY`, `DATABASE_URL` ni la credencial migradora.

## Preparar evidencia activa

1. Instalar o reinstalar la app desde el OAuth de staging en una development
   store dedicada.
2. Aceptar la suscripcion `TiendaIQ Pro` de prueba.
3. Crear una pagina desde la aplicacion y publicarla mediante la cola durable.
4. Esperar a que el job termine en `succeeded` bajo el worker del SHA candidato y que la pagina figure
   `publicada`, sin cambios pendientes ni error terminal.
5. Copiar el ID interno de esa pagina a `SHOPIFY_CERTIFICATION_PAGE_ID`.
6. Enviar a staging los webhooks de privacidad de prueba
   `customers/data_request` y `customers/redact`, usando una herramienta oficial
   de Shopify, y comprobar que ambos terminan en `completed`.
7. Abrir la URL publica y comprobar que responde la plantilla TiendaIQ real; no
   sirve una redireccion a password, login, challenge, 404 o plantilla generica.
8. Guardar las variables de Render y esperar a que `/ready` vuelva a responder
   para el SHA desplegado.

No reutilizar una pagina cualquiera: la pagina fijada es el testigo estable del
release y debe publicarse nuevamente cuando caduque la ventana de evidencia.

## Ejecutar el workflow

En GitHub Actions, ejecutar `Shopify E2E staging evidence` con:

```text
release_sha=<SHA completo de 40 caracteres, HEAD actual de main y ya desplegado>
confirmation=VERIFY_SHOPIFY_STAGING_E2E
```

El workflow verifica, en orden:

- que el checkout y `origin/main` coinciden con el SHA solicitado;
- que `/ready` expone ese mismo SHA;
- que web, worker, colas e inbox pasan el gate operativo;
- que `/ops/shopify-certification` cumple el contrato sanitizado.

## Evidencia separada de compliance webhooks

Para el mismo release candidato, abrir la version actualmente desplegada de la
app de staging en Shopify Dev Dashboard y conservar evidencia sanitizada de:

- version y fecha desplegadas;
- callback HTTPS de staging;
- `customers/data_request`;
- `customers/redact`;
- `shop/redact`.

La captura o registro no debe contener tokens, payloads, IDs de clientes ni
secretos. Esta comprobacion demuestra la configuracion app-scoped desplegada;
las entregas activas de `customers/data_request` y `customers/redact` demuestran
por separado el procesamiento durable. `shop/redact` conserva su propio gate
destructivo.

La respuesta nunca contiene dominio, token, GID, contenido de la pagina,
identificadores de billing, IDs de webhook, datos de clientes ni errores crudos
de Shopify.

## Gate destructivo `shop/redact`

1. Crear una development store descartable que no sea la tienda activa del gate.
2. Instalar staging y crear datos reconocibles de prueba.
3. Disparar `shop/redact` mediante la herramienta oficial vigente de Shopify.
4. Verificar firma HMAC, respuesta HTTP, procesamiento durable y eliminacion de
   sesiones, paginas, jobs, inbox y evidencia tenant-owned de esa tienda.
5. Conservar fecha, release SHA y resultado sanitizado en la evidencia del
   lanzamiento. No conservar payloads con datos personales.
6. Eliminar la tienda descartable y no volver a usarla para el gate activo.

## Criterio de cierre

El gate Shopify completo queda cerrado solo cuando existen, para el mismo
release candidato:

- workflow activo verde;
- prueba visual Playwright desktop y mobile aprobada sobre la URL durable;
- version desplegada de los tres compliance webhooks comprobada en Shopify;
- evidencia destructiva `shop/redact` aprobada;
- billing real validado por separado;
- checklist de listing, legales y review de Shopify actualizado.
