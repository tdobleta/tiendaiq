# Plan de lanzamiento para 1.000 tiendas

Gobierno y secuencia ejecutiva: [Plan ejecutivo de cierre y lanzamiento](plan-ejecutivo-cierre-y-lanzamiento.md).
Este documento conserva el detalle de capacidad; ante una diferencia de
prioridad o estado, manda el plan ejecutivo.

## Supuesto de capacidad

El objetivo operativo es admitir hasta 1.000 instalaciones durante las primeras
24 horas. Para dimensionar el pico se usa un escenario conservador de 200
sesiones concurrentes y 500 generaciones en la hora de mayor demanda. Esto no
significa que 1.000 usuarios vayan a generar al mismo tiempo.

La arquitectura separa cuatro cargas con limites independientes:

- El proceso web atiende OAuth, API y admision de jobs.
- Ocho carriles procesan generaciones de IA.
- Cuatro carriles procesan publicaciones en Shopify.
- Dos carriles procesan webhooks.

Con una duracion media de 40 segundos, ocho carriles de generacion ofrecen una
capacidad teorica de 720 generaciones por hora. La meta de 500 por hora deja un
margen nominal de 30%, pero solo es valida si Anthropic confirma el rate limit
y si la instancia worker dispone de CPU y memoria suficientes.

## Evidencia automatizada actual

Las pruebas locales ejecutadas el 10 de agosto de 2026 demostraron:

- 2.000 sesiones y 1.000 admisiones de jobs sinteticos: 3.000 requests, cero
  errores, 598 requests por segundo y p95 de 1,3 ms.
- 1.000 tenants y 1.000 jobs persistidos en PostgreSQL: cola drenada en 746 ms,
  p95 de encolado de 19,5 ms y 1.341 jobs por segundo
  con 16 carriles y un efecto falso de 5 ms. Esta prueba valida persistencia,
  leases, concurrencia y limpieza; no valida la latencia de Anthropic o Shopify.
- 138 pruebas unitarias aprobadas.
- Migraciones idempotentes y aislamiento RLS aprobado usando credenciales reales
  separadas para migrador, web y worker.

Los scripts y su modelo de seguridad estan documentados en
`docs/pruebas-carga-local.md`.

### Evidencia de staging real - 11 de agosto de 2026

El release revisado `9a82f36a7e930a3c281285244ae3b271ea94e008` fue promovido
por el workflow protegido `Release staging #11`. El endpoint publico de
readiness respondio:

- `ok=true`;
- `release=9a82f36a7e930a3c281285244ae3b271ea94e008`;
- almacenamiento `postgres`;
- RLS habilitado y forzado sobre 12 tablas protegidas;
- rol web sin `BYPASSRLS`, sin herencia y sin capacidad worker.

La cola durable de staging fue validada con credenciales runtime separadas:

- `Capacity staging #4`, `runId=7e6ca3bf63f8`: 100 tenants y 100 jobs,
  drenaje en 4,45 s, 22,49 jobs/s, limpieza completa 100/100/100.
- `Capacity staging #5`, `runId=bde757a91bf6`: 500 tenants y 500 jobs,
  drenaje en 42,26 s, 11,83 jobs/s, limpieza completa 500/500/500.
- `Capacity staging #6`, `runId=812166fb8a91`: 1.000 tenants y 1.000 jobs,
  drenaje en 37,39 s, 26,74 jobs/s, limpieza completa 1.000/1.000/1.000.

El gate `Anthropic capacity staging #1` con perfil 8 quedo **NO-GO** por
configuracion: el workflow fallo antes de invocar al proveedor con
`Falta ANTHROPIC_API_KEY`. Para repetirlo se debe cargar el secreto
`STAGING_ANTHROPIC_API_KEY` en el environment protegido `staging` de GitHub.

La admision de generacion esta limitada a dos jobs activos por tienda y 120 en
total. El conteo global se resuelve mediante una funcion PostgreSQL que devuelve
solo agregados; el rol web no obtiene acceso a filas de otros tenants. Al llegar
al limite se responde `429` o `503` con `Retry-After` sin reservar cupo.

### Evidencia de staging real - 12 de agosto de 2026

El release revisado `95a81bccac219b9355cf9adb4861a696d9b5caf3` fue promovido
por el workflow protegido `Release staging #12`. El endpoint publico de
readiness respondio:

- `ok=true`;
- `release=95a81bccac219b9355cf9adb4861a696d9b5caf3`;
- almacenamiento `postgres`;
- RLS habilitado y forzado sobre 12 tablas protegidas;
- rol web sin `BYPASSRLS`, sin herencia y sin capacidad worker.

La cola durable de staging fue validada nuevamente con credenciales runtime
separadas despues de agregar la compuerta operativa de pausa de generaciones:

- `Capacity staging #7`, `runId=804dbfd8d951`: 100 tenants y 100 jobs,
  drenaje en 8,40 s, 11,90 jobs/s, limpieza completa 100/100/100.
- `Capacity staging #8`, `runId=b49beb1fa343`: 500 tenants y 500 jobs,
  drenaje en 28,69 s, 17,43 jobs/s, limpieza completa 500/500/500.
- `Capacity staging #9`, `runId=bd3d9d2ef957`: 1.000 tenants y 1.000 jobs,
  drenaje en 81,09 s, 12,33 jobs/s, `oldestQueuedSeconds=40,12`, picos de
  pool `web=10` y `worker=10`, limpieza completa 1.000/1.000/1.000.

El gate `Anthropic capacity staging` quedo habilitado despues de cargar
`STAGING_ANTHROPIC_API_KEY` en el environment protegido `staging`. La ejecucion
oficial `Anthropic capacity staging #3` corrio sobre
`3aeb762d142a20fc117a21a39679abdcd5241db8` con perfil 8 y paso:

- 8 llamadas reales, 8 exitosas, 0 fallidas;
- error rate `0`;
- p95 `39,33 s`, p99 `39,33 s`;
- 47.104 tokens de entrada y 26.207 tokens de salida;
- costo estimado `USD 0,8907`, bajo el techo `USD 5`.

Esta evidencia cierra el gate inicial de acceso y concurrencia Anthropic 8/8,
y el gate de cola durable sintetica de staging para 1.000/1.000. No cierra los
gates de Anthropic perfil 50/500, Shopify E2E, billing real ni alertas
automaticas.

El workflow manual `Ops readiness staging` queda como preflight operativo
barato entre releases y pruebas caras: valida el SHA desplegado en `/ready`, el
aislamiento RLS y el estado actual de la cola durable mediante el endpoint
operativo autenticado. No consume Anthropic, no llama Shopify y no reemplaza las alertas
automaticas; evita confundir ruido de deploy con evidencia de canary.

El gate `Anthropic capacity staging #4` con perfil 50 corrio sobre
`e3040961d1a47cc836ab2bca0398b49149540501` y quedo **NO-GO**. Una
reproduccion local controlada con el mismo contrato, techo de presupuesto y
concurrencia confirmo la causa: Anthropic rechazo la ejecucion por saldo
insuficiente de la cuenta. El proveedor devolvio `invalid_request_error` con el
mensaje de saldo bajo antes de consumir tokens en la muestra reducida. No es un
fallo de RLS, Render, PostgreSQL ni del worker; bloquea exclusivamente los
gates de capacidad IA 50/500 hasta cargar credito o corregir billing en
Anthropic.

Mientras el balance del proveedor este agotado, la operacion correcta es dejar
pausada la admision de nuevas generaciones con `GENERATION_ADMISSION_PAUSED=1`
en el servicio web de Render y no ejecutar workflows de capacidad Anthropic. La
clave de IA pertenece solamente al worker; la web no debe recibirla porque solo
admite y encola solicitudes.

## Criterios de salida

El lanzamiento recibe **GO** solamente si se cumplen todos estos puntos:

- La prueba HTTP de staging mantiene errores <= 1% y p95 <= 1.000 ms durante
  el perfil de 2.000 sesiones y 1.000 jobs.
- La cola de staging procesa 500 generaciones reales en <= 60 minutos, sin jobs
  perdidos ni cobros de cupo duplicados.
- La antiguedad del job pendiente mas viejo permanece por debajo de 10 minutos
  y vuelve a menos de 2 minutos despues del pico.
- Anthropic confirma cuota y rate limit para al menos ocho solicitudes largas
  concurrentes, con margen para reintentos.
- Shopify OAuth, billing, publicacion y webhooks de cumplimiento pasan el flujo
  E2E en una development store.
- Render muestra memoria < 75%, CPU sostenida < 70%, conexiones PostgreSQL bajo
  el 70% del limite y cero reinicios inesperados durante la prueba.
- Existe una alerta para error rate, p95, jobs fallidos, job mas antiguo,
  conexiones PostgreSQL y reinicios de web/worker.
- El rollback de web y worker fue ensayado y no revierte migraciones.

El resultado es **NO-GO** si falta una cuota externa, si la cola supera los 10
minutos de antiguedad, si hay cualquier fuga entre tenants o si una migracion no
puede desplegarse de forma compatible.

### Gate protegido del proveedor de IA

El workflow manual `Anthropic capacity staging` separa la capacidad del
proveedor de la cola y de Shopify. Ejecuta el contrato real de generacion de
pagina con un producto sintetico sin datos personales ni llamadas a tiendas.
Admite perfiles de 8, 50 y 500 llamadas, siempre con ocho carriles como maximo.

La ejecucion exige el secreto `STAGING_ANTHROPIC_API_KEY`, una confirmacion que
incluye el perfil elegido y el entorno protegido `staging`. Una primera llamada
proyecta el gasto con 25% de margen y detiene el resto si supera el techo del
perfil. La salida conserva solamente latencias, tokens, costo estimado, avisos y
tipos de error; nunca registra prompts, respuestas o la clave.

El perfil de 8 valida acceso y concurrencia inicial. El de 50 sirve para revisar
latencia, rate limits y costo antes de autorizar el gate final de 500. Ningun
perfil reemplaza la prueba de cola durable: ambos resultados son necesarios para
el GO.

## Riesgos que requieren accion manual

No hace falta comprar una suscripcion para continuar el desarrollo local. Antes
de abrir al publico, una persona con acceso a las cuentas debe:

1. Confirmar o ampliar la cuota de Anthropic para el perfil de ocho generaciones
   concurrentes, cargar credito suficiente y despausar admision solo antes de
   repetir perfiles 50/500.
2. Crear el entorno de staging en Render/PostgreSQL, cargar los secretos y
   habilitar metricas y alertas.
3. Ejecutar el QA de billing con `PLAN_TEST=1` y cambiarlo a `0` solo despues de
   aprobar el flujo completo.
4. Completar la ficha y las evidencias exigidas por Shopify App Store.

La credencial `STAGING_MIGRATION_DATABASE_URL` vive solo en el entorno protegido
de GitHub Actions. El workflow manual migra primero y dispara los deploy hooks
de staging despues; web y worker no reciben una credencial propietaria. El
rollout sigue requiriendo migraciones expand/contract porque Render despliega
los dos procesos como servicios independientes. La readiness operativa ademas
requiere `STAGING_OPS_STATUS_TOKEN` en GitHub y `OPS_STATUS_TOKEN` en Render web;
ambos deben tener el mismo valor fuerte y se usan solo para leer metricas
agregadas de `/ops/status`.

La misma readiness separa dos perfiles explicitos. `technical_preflight`
valida release, RLS, worker y cola, pero no autoriza lanzamiento. `go` exige
ademas `billing.planTest=false`, `legal.complete=true` y admision de IA abierta.
Staging conserva la admision pausada por defecto hasta que billing, legales,
proveedor de IA y capacidad tengan evidencia verde. Solo una corrida verde con
perfil `go` puede respaldar la decision comercial de abrir una ola.

## Operacion del primer dia

La ejecucion operativa de las olas vive en `docs/runbook-ola-1.md`. Ese
runbook es obligatorio antes del canary externo: define alertas, pausa,
degradacion, demanda excedente, incidentes y registro de evidencia. Si el
runbook o sus alertas no estan completos, el estado sigue siendo **NO-GO**.

- Congelar cambios funcionales 24 horas antes.
- Mantener una persona a cargo de producto y otra de infraestructura durante el
  pico inicial.
- Revisar profundidad y antiguedad de cola cada 15 minutos.
- Aumentar carriles solo despues de verificar cuota de Anthropic, memoria y
  conexiones; mas concurrencia sin presupuesto externo empeora los fallos.
- Detener nuevas generaciones con una compuerta de admision si la cola supera
  10 minutos, preservando OAuth, billing, lectura y webhooks.
- No ejecutar migraciones automaticas durante el pico de lanzamiento.
