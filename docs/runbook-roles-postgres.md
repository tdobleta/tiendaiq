# Runbook - Roles PostgreSQL en Render

Objetivo: impedir que el proceso web pueda asumir capacidades del worker o
modificar las politicas RLS. No crea otra base ni requiere otra suscripcion.

## Roles

- Migrador: credencial original de Render. Es duena del esquema y solo se usa
  en `npm run db:migrate`.
- `tiendaiq_web_login`: login de transporte del runtime HTTP. No tiene DML.
- `tiendaiq_worker_login`: login de transporte del worker. No tiene DML.
- `tiendaiq_web_runtime`: rol efectivo web, sin LOGIN y sujeto a RLS.
- `tiendaiq_worker_runtime`: rol efectivo del worker, sin LOGIN, sujeto a RLS y
  miembro de `tiendaiq_worker_capability_v2`.

## Preparacion manual unica por entorno

Las credenciales creadas desde `Database > Info > Credentials` heredan el rol
predeterminado administrado por Render. No deben usarse como runtime porque
`RESET ROLE` puede recuperar esos privilegios. Los logins runtime se crean
directamente en PostgreSQL y Render solo almacena sus URLs internas.

Los nombres siguientes usan `STAGING_` para staging. En produccion se reemplaza
ese prefijo por `PRODUCTION_` y se usa exclusivamente el entorno protegido
`production` de GitHub.

1. Guardar la URL externa original como secreto de entorno de GitHub
   `STAGING_MIGRATION_DATABASE_URL` o `PRODUCTION_MIGRATION_DATABASE_URL`; no
   agregarla a servicios Render.
2. Generar dos contrasenas aleatorias independientes de al menos 32 caracteres y
   guardarlas como `STAGING_WEB_RUNTIME_LOGIN_PASSWORD` y
   `STAGING_WORKER_RUNTIME_LOGIN_PASSWORD`, o sus equivalentes
   `PRODUCTION_*`, en el entorno protegido correspondiente.
3. En staging, disparar `Rotate staging runtime logins`. En produccion, antes de
   recibir trafico externo, disparar una sola vez `Bootstrap production runtime
   logins` con las dos confirmaciones exactas del workflow. Ese bootstrap es un
   cutover pre-lanzamiento, no un mecanismo de rotacion ordinaria.
4. Construir dos URLs internas con el host/base de staging y los usuarios
   `tiendaiq_web_login` y `tiendaiq_worker_login`; guardar cada una como
   `DATABASE_URL` del servicio correspondiente.
5. Mantener `PG_RUNTIME_ROLE=tiendaiq_web_runtime` en web y
   `PG_RUNTIME_ROLE=tiendaiq_worker_runtime` en worker.
6. Crear los secretos `RENDER_STAGING_WEB_DEPLOY_HOOK` y
   `RENDER_STAGING_WORKER_DEPLOY_HOOK`, o sus equivalentes `PRODUCTION_*`, con
   los hooks de los dos servicios del entorno.
7. Guardar `STAGING_OPS_STATUS_TOKEN` o `PRODUCTION_OPS_STATUS_TOKEN` con el
   mismo valor que usa `OPS_STATUS_TOKEN` en los servicios Render del entorno.
8. Disparar `Release staging` o `Release production`. Staging reconcilia roles;
   producción nunca modifica contrasenas durante un release. Ambos workflows
   migran y despliegan web y worker; `/ready` y el preflight tecnico deben
   confirmar el mismo SHA, RLS forzado, heartbeat reciente y capacidades
   separadas.

## Orden de promocion a produccion

1. Proteger el entorno GitHub `production`, limitarlo a `main` y exigir revisión.
2. Configurar todos los secretos `PRODUCTION_*` anteriores.
3. Ejecutar `Bootstrap production runtime logins` una sola vez, durante una
   ventana pre-lanzamiento sin merchants, y construir las URLs internas runtime
   con esas contrasenas. La URL web usa `tiendaiq_web_login`; la del worker usa
   `tiendaiq_worker_login`.
4. Guardar cada URL como `DATABASE_URL` en su servicio Render y verificar los
   `PG_RUNTIME_ROLE` correspondientes. Nunca guardar
   `PRODUCTION_MIGRATION_DATABASE_URL` en Render.
5. Reiniciar ambos servicios y comprobar que `/ready` falla cerrado si falta el
   worker o el aislamiento.
6. Ejecutar `Release production` con el SHA completo actual de `main` y la
   confirmacion `DEPLOY_REVIEWED_PRODUCTION`. Confirmar tambien
   `MIGRATIONS_ARE_BACKWARD_COMPATIBLE`: el release anterior debe poder operar
   sobre el esquema migrado. Solo en el primer despliegue, cuando todavia no
   existe un SHA recuperable desde `https://tiendaiq.com/ready`, se permite
   `ALLOW_NO_PREVIOUS_RELEASE` durante una ventana sin merchants.

Un release ordinario nunca cambia contrasenas. Una rotacion posterior al
lanzamiento requiere un procedimiento blue/green con logins alternos y no debe
reutilizar el bootstrap, porque cambiar primero PostgreSQL o primero las URLs de
Render produciria una interrupcion. Release, recuperacion y bootstrap comparten
el lock `tiendaiq-production-database-maintenance` con `queue: max` para impedir
ejecuciones simultaneas sin reemplazar una recuperacion pendiente.

Antes de migrar, el workflow captura el SHA servido por el dominio canonico.
Despues de migrar y antes de disparar cualquier deploy, persiste por un dia un
artefacto `production-rollback-state-<run_attempt>` que vincula ese SHA con el
release nuevo y con el intento exacto de GitHub Actions. Un re-run no puede
consumir el estado de un intento anterior aunque conserve el mismo `run_id` y
SHA.
Si falla, se cancela o agota su tiempo un deploy o el preflight tecnico, el
workflow independiente `Recover failed production release` consume el artefacto
y vuelve a disparar ambos deploy hooks con el SHA anterior. El rollback solo se
considera recuperado cuando `/ready` y
`/ops/status` confirman el mismo SHA anterior, el worker mantiene un heartbeat
estable y tanto web como worker conservan sus roles aislados. La certificacion
de rollback tolera volumen y antiguedad de backlog que pudieran preceder al
incidente, pero nunca acepta fallos recientes, leases estancados, compensaciones
pendientes o en cuarentena, ni webhooks fallidos. Ambos hooks se intentan y
reintentan de forma independiente, incluso si la promocion fue cancelada. El
rollback restaura aplicacion, no revierte migraciones; por eso la compatibilidad
expand/contract es una precondicion del release. Si el paso de rollback falla,
tratarlo como incidente critico y mantener cerrado el lanzamiento comercial.

La recuperacion reintenta la consulta del artefacto y, si sigue ausente, revisa
los pasos del run origen. Solo termina sin rollback cuando GitHub confirma que
ningun hook de deploy llego a comenzar. Si un deploy comenzo sin estado durable,
falla en rojo y exige intervencion manual; no existe una omision silenciosa.

La recuperacion se activa por `workflow_run`, fuera del workflow que puede
quedar cancelado, y dispone de 25 minutos propios. Un timeout del job de
promocion no consume el presupuesto del rollback. Solo se habilita para un
`Release production` manual ejecutado desde `main`, terminado como fallido,
cancelado o vencido, y con un artefacto de rollback vigente que corresponda al
SHA del run fallido.

GitHub debe tener un entorno `production-recovery` limitado a la rama `main`,
sin revisores manuales que puedan bloquear una emergencia y con solo estos tres
secretos:

- `RENDER_PRODUCTION_WEB_DEPLOY_HOOK`;
- `RENDER_PRODUCTION_WORKER_DEPLOY_HOOK`;
- `PRODUCTION_OPS_STATUS_TOKEN`.

Ese entorno no recibe la credencial migradora, contrasenas runtime, secretos de
Shopify ni claves de IA. Su capacidad queda limitada a restaurar y certificar
aplicaciones ya revisadas.

Los hooks de web y worker se disparan antes de instalar dependencias de
verificacion, cada solicitud tiene limites de conexion y duracion, y ambos se
intentan aunque uno falle. La certificacion posterior dispone de un deadline
estricto de 15 minutos por medio de `timeout`, reservando al menos cinco minutos
del workflow para hooks e instalacion.

La promocion técnica no abre el lanzamiento comercial: `PLAN_TEST`, admisión y
las olas se habilitan con gates independientes después de certificar el backend.

No borrar la credencial original: conserva la propiedad de los objetos. No usar
su URL ni una credencial creada desde Credential Rotation como `DATABASE_URL`
de un proceso runtime.

Documentacion oficial de credenciales:
https://render.com/docs/postgresql-credentials

## Verificacion

La CI crea una base desechable con los logins y roles aislados y comprueba que:

- web no puede ejecutar `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`;
- definir `app.worker_id` desde web no concede acceso transversal;
- worker si puede reclamar jobs;
- tenant A no puede leer paginas, jobs, reservas, inbox ni privacidad de B;
- las migraciones son idempotentes.

## Rollback

Si el runtime falla, no volver a conectar web o worker con la credencial duena.
Revertir el despliegue y corregir grants o politicas con una migracion nueva.
Una interrupcion es preferible a ejecutar produccion sin aislamiento efectivo.
