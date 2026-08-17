# Runbook - Activacion de RLS en staging

Este cambio protege las 12 tablas tenant-scoped de `public`, `control_plane` y
`app_data`, incluyendo tiendas, OAuth, paginas, jobs, reservas, inbox, outbox,
privacidad, versiones y publicaciones. No mueve documentos ni cambia su formato.

## 1. Precondiciones

- Crear un backup restaurable de PostgreSQL.
- Confirmar que staging contiene al menos dos tiendas de prueba.
- Configurar `TOKEN_ENC_KEY` y `PG_PRIVATE_NETWORK=1` porque web y worker usan
  la URL interna de Render en la misma region. Una URL externa no puede usar
  esta variable: debe conservar TLS validado y, si hace falta, `PG_CA_CERT`.
- Confirmar que el rol web de `DATABASE_URL` no es superuser, no tiene
  `BYPASSRLS`, no es dueno de tablas y no hereda la capacidad worker.
- Confirmar que `MIGRATION_DATABASE_URL`, `DATABASE_URL` web y la URL del
  worker son credenciales distintas. Web debe conectar como
  `tiendaiq_web_login` y worker como `tiendaiq_worker_login`; ninguna URL
  runtime puede pertenecer a Credential Rotation de Render. Ver
  `runbook-roles-postgres.md`.
- Desplegar primero en staging, nunca directamente sobre produccion.

## 2. Inspeccion previa

```sql
SELECT tienda, count(*)
FROM public.paginas
GROUP BY tienda
ORDER BY tienda;

SELECT current_user, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;
```

Guardar los conteos para compararlos despues de la migracion.

## 3. Migracion

El workflow manual `Release staging` ejecuta las migraciones antes de disparar
los deploy hooks de Render. El secreto de migracion no se entrega a web ni
worker. Desde una maquina administrativa tambien se puede ejecutar:

```text
npm run db:migrate
```

Para inspeccionar una base manualmente sin modificarla:

```text
npm run db:migrate:check
```

El runner usa un advisory lock, aplica cada archivo en una transaccion y guarda
su SHA-256. Una migracion aplicada no se edita: se agrega otra.

## 4. Verificacion

1. Consultar `/ready`; debe responder `ok: true`, almacenamiento `postgres` y
   aislamiento habilitado.
2. Abrir la app como tenant A y crear una pagina y una generacion senuelo.
3. Abrirla como tenant B y comprobar que pagina, job, reserva, inbox y solicitud
   de privacidad no aparecen.
4. Editar y publicar desde A.
5. Repetir el conteo previo y confirmar que no se perdieron filas.
6. Ejecutar `npm run probar` contra el mismo artefacto desplegado.

La prueba automatizada exige autorizacion explicita porque escribe y elimina una
fila señuelo:

```text
ALLOW_RLS_TEST=1 TEST_DATABASE_URL=<staging> npm run db:test:rls
```

GitHub Actions ejecuta además `npm run db:test:integration` en PostgreSQL 16
desechable para cada pull request y push a `main`. La compuerta crea un rol de
web, uno de worker y uno migrador, aplica las migraciones dos veces para
comprobar idempotencia y realiza los cruces entre tenants y capacidades. Esta prueba continua
complementa la validacion manual sobre staging; no la sustituye antes de un
despliegue con datos reales.

Prueba SQL controlada dentro de una transaccion:

```sql
BEGIN;
SELECT set_config('app.tenant_id', 'tenant-a.myshopify.com', true);
SELECT DISTINCT tienda FROM public.paginas;
ROLLBACK;
```

El resultado solo puede contener `tenant-a.myshopify.com`. Repetir la misma
prueba para `control_plane.jobs` y `control_plane.usage_reservations`.

## 5. Rollback

Si la nueva version no puede operar, revertir primero el despliegue. No borrar
datos, checksums ni migraciones aplicadas, y no desactivar RLS para recuperar
disponibilidad: una app inaccesible es preferible a datos cruzados. Corregir la
causa con una migracion nueva y auditable y volver a validar en staging.
