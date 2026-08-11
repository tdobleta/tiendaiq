# Runbook - Roles PostgreSQL en Render

Objetivo: impedir que el proceso web pueda asumir capacidades del worker o
modificar las politicas RLS. No crea otra base ni requiere otra suscripcion.

## Roles

- Migrador: credencial original de Render. Es duena del esquema y solo se usa
  en `npm run db:migrate`.
- `tiendaiq_web`: runtime HTTP. Tiene DML sujeto a RLS y no es dueno.
- `tiendaiq_worker`: runtime de jobs y webhooks. Tiene DML y la membresia
  `tiendaiq_worker_capability` para operaciones transversales controladas.

## Preparacion manual unica

Render permite agregar usuarios desde `Database > Info > Credentials`. Cada
credencial nueva pasa a ser la predeterminada, por lo que hay que guardar su URL
interna en el momento de crearla.

1. Guardar la URL externa original como secreto de entorno de GitHub
   `STAGING_MIGRATION_DATABASE_URL`; no agregarla a servicios Render.
2. Crear la credencial `tiendaiq_web` y guardar su URL interna.
3. Crear la credencial `tiendaiq_worker` y guardar su URL interna.
4. En el servicio web, cargar solo `DATABASE_URL`: URL de `tiendaiq_web`.
5. En el worker, cargar solo `DATABASE_URL`: URL de `tiendaiq_worker`.
6. Crear los secretos `RENDER_STAGING_WEB_DEPLOY_HOOK` y
   `RENDER_STAGING_WORKER_DEPLOY_HOOK` con los hooks de los servicios staging.
7. Disparar el workflow manual `Release staging`. Comprueba y prepara la
   capacidad del worker, migra y luego despliega web y
   worker; `/ready` debe confirmar aislamiento y el rol web no
   puede ser dueno ni miembro de la capacidad worker.

No borrar la credencial original: conserva la propiedad de los objetos. No usar
su URL como `DATABASE_URL` de un proceso de runtime.

Documentacion oficial de credenciales:
https://render.com/docs/postgresql-credentials

## Verificacion

La CI crea una base desechable con los tres roles y comprueba que:

- web no puede ejecutar `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`;
- definir `app.worker_id` desde web no concede acceso transversal;
- worker si puede reclamar jobs;
- tenant A no puede leer paginas, jobs, reservas, inbox ni privacidad de B;
- las migraciones son idempotentes.

## Rollback

Si el runtime falla, no volver a conectar web o worker con la credencial duena.
Revertir el despliegue y corregir grants o politicas con una migracion nueva.
Una interrupcion es preferible a ejecutar produccion sin aislamiento efectivo.
