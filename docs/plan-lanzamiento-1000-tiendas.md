# Plan de lanzamiento para 1.000 tiendas

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

La admision de generacion esta limitada a dos jobs activos por tienda y 120 en
total. El conteo global se resuelve mediante una funcion PostgreSQL que devuelve
solo agregados; el rol web no obtiene acceso a filas de otros tenants. Al llegar
al limite se responde `429` o `503` con `Retry-After` sin reservar cupo.

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
   concurrentes.
2. Crear el entorno de staging en Render/PostgreSQL, cargar los secretos y
   habilitar metricas y alertas.
3. Ejecutar el QA de billing con `PLAN_TEST=1` y cambiarlo a `0` solo despues de
   aprobar el flujo completo.
4. Completar la ficha y las evidencias exigidas por Shopify App Store.

La credencial `STAGING_MIGRATION_DATABASE_URL` vive solo en el entorno protegido
de GitHub Actions. El workflow manual migra primero y dispara los deploy hooks
de staging despues; web y worker no reciben una credencial propietaria. El
rollout sigue requiriendo migraciones expand/contract porque Render despliega
los dos procesos como servicios independientes.

## Operacion del primer dia

- Congelar cambios funcionales 24 horas antes.
- Mantener una persona a cargo de producto y otra de infraestructura durante el
  pico inicial.
- Revisar profundidad y antiguedad de cola cada 15 minutos.
- Aumentar carriles solo despues de verificar cuota de Anthropic, memoria y
  conexiones; mas concurrencia sin presupuesto externo empeora los fallos.
- Detener nuevas generaciones con una compuerta de admision si la cola supera
  10 minutos, preservando OAuth, billing, lectura y webhooks.
- No ejecutar migraciones automaticas durante el pico de lanzamiento.
