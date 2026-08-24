# Bootstrap seguro de Partner Staging

Partner Staging es una aplicación Shopify, una tienda de desarrollo, dos
servicios Render y una base PostgreSQL independientes del staging legado. Este
procedimiento no copia secretos ni datos entre ambos entornos. La base se
aprovisiona antes que los servicios: los logins runtime de mínimo privilegio no
existen hasta que el bootstrap protegido los crea.

## Precondiciones comprobables

- `shopify.app.partner-staging.toml` apunta únicamente a
  `https://tiendaiq-partner-staging-web.onrender.com`.
- La development store pertenece a la organización Partner Onepilot.
- El SHA fue revisado, está en `main` y pasó `npm run probar`.
- No existe todavía un binding de otra app dentro de la nueva base.

## Fase 1: crear solamente la base Render

1. Crear un Blueprint nuevo desde `render.partner-staging-db.yaml`, en Oregon.
   Debe crear exactamente `tiendaiq-partner-staging-db`; no debe crear web ni
   worker en esta fase.
2. No clonar servicios existentes ni reutilizar su base de datos, grupos de
   variables, deploy hooks ni secretos.
3. Crear el entorno protegido `partner-staging` en GitHub. Cargar sus secretos
   directamente allí, sin imprimirlos:
   `PARTNER_STAGING_MIGRATION_DATABASE_URL`,
   `PARTNER_STAGING_WEB_RUNTIME_LOGIN_PASSWORD` y
   `PARTNER_STAGING_WORKER_RUNTIME_LOGIN_PASSWORD`.

La URL migradora es la conexión administradora de la base nueva. Los passwords
de runtime deben ser nuevos, distintos y de 32+ caracteres; se usan sólo para
crear los logins PostgreSQL de mínimo privilegio. No reutilizar ni revelar
valores del staging legado.

## Fase 2: vincular y crear los servicios

1. Ejecutar **Bootstrap Partner Staging database** sobre el SHA revisado. El
   workflow crea roles, aplica migraciones y vincula de forma irreversible esa
   base sólo a `tiendaiq-partner-staging-v1`; no despliega tráfico.
2. Formar las dos `DATABASE_URL` internas con los logins creados por el
   workflow (web y worker distintos). El usuario administrará estos valores
   solamente dentro de Render, nunca en Git ni por consola.
3. Crear un segundo Blueprint desde `render.partner-staging.yaml`, en Oregon.
   Debe crear exactamente `tiendaiq-partner-staging-web` y
   `tiendaiq-partner-staging-worker`.
4. Completar directamente en Render, sin pegarlos en Git ni en una consola:
   `SHOPIFY_CLIENT_SECRET`, `OPS_STATUS_TOKEN`, `EMAIL_SOPORTE`,
   `RAZON_SOCIAL`, `DOMICILIO` y las dos `DATABASE_URL`. Dejar
   `ANTHROPIC_API_KEY` ausente en el worker.
5. Completar en el entorno protegido `partner-staging` los secretos restantes:
   `PARTNER_STAGING_OPS_STATUS_TOKEN`,
   `RENDER_PARTNER_STAGING_WEB_DEPLOY_HOOK`,
   `RENDER_PARTNER_STAGING_WORKER_DEPLOY_HOOK` y
   `PARTNER_STAGING_SHOPIFY_APP_AUTOMATION_TOKEN`.

`OPS_STATUS_TOKEN` debe coincidir entre Render y GitHub. El Blueprint genera
`TOKEN_ENC_KEY` dentro de Render y sólo lo comparte de forma cifrada con el
worker; nadie debe copiarla.

## Fase 3: desplegar

1. Ejecutar **Release Partner Staging** sobre el mismo SHA. Debe aprobar
   `/ready`, publicar los componentes Shopify con `--config partner-staging`
   y completar `/ops/status` con `PLAN_TEST=1`.
2. Recién entonces instalar la app Partner Staging en la tienda Partner y
   repetir OAuth, webhooks, publicación y billing de prueba conforme a los
   gates de certificación.

Si bootstrap, binding, web o worker fallan, detenerse. No cambiar
`SHOPIFY_APP_REGISTRATION_BINDING_ENFORCED`, no apuntar a una base heredada y
no saltar el preflight para obtener un verde artificial.
