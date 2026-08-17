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

## Preparacion manual unica

Las credenciales creadas desde `Database > Info > Credentials` heredan el rol
predeterminado administrado por Render. No deben usarse como runtime porque
`RESET ROLE` puede recuperar esos privilegios. Los logins runtime se crean
directamente en PostgreSQL y Render solo almacena sus URLs internas.

1. Guardar la URL externa original como secreto de entorno de GitHub
   `STAGING_MIGRATION_DATABASE_URL`; no agregarla a servicios Render.
2. Generar dos contrasenas aleatorias independientes de al menos 32 caracteres y
   guardarlas como `STAGING_WEB_RUNTIME_LOGIN_PASSWORD` y
   `STAGING_WORKER_RUNTIME_LOGIN_PASSWORD` en el entorno protegido `staging`.
3. Disparar `Rotate staging runtime logins` contra el SHA completo de `main` con
   la confirmacion `ROTATE_RUNTIME_LOGINS_STAGING`.
4. Construir dos URLs internas con el host/base de staging y los usuarios
   `tiendaiq_web_login` y `tiendaiq_worker_login`; guardar cada una como
   `DATABASE_URL` del servicio correspondiente.
5. Mantener `PG_RUNTIME_ROLE=tiendaiq_web_runtime` en web y
   `PG_RUNTIME_ROLE=tiendaiq_worker_runtime` en worker.
6. Crear los secretos `RENDER_STAGING_WEB_DEPLOY_HOOK` y
   `RENDER_STAGING_WORKER_DEPLOY_HOOK` con los hooks de los servicios staging.
7. Disparar el workflow manual `Release staging`. Comprueba y prepara la
   capacidad del worker, migra y luego despliega web y
   worker; `/ready` debe confirmar aislamiento y el rol web no
   puede ser dueno ni miembro de la capacidad worker.

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
