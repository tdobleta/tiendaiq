# Runbook operativo - Ola 1

Objetivo: ejecutar el primer canary externo de TiendaIQ con evidencia y salida
controlada. Este runbook no autoriza el lanzamiento por si solo; convierte los
gates del plan de 1.000 tiendas en una operacion repetible.

## Estado inicial

La Ola 1 empieza en **NO-GO**. Cambia a GO solamente cuando una persona de
producto y una de infraestructura registran evidencia de todos estos puntos:

- `Release staging` promovio un SHA completo de `main` y `/ready` responde
  `ok=true` con el mismo `release`.
- `/ready` confirma PostgreSQL, RLS habilitado y forzado, rol web sin
  `BYPASSRLS`, sin herencia y sin capacidad worker.
- `Capacity staging` paso 1.000 tenants y 1.000 jobs con limpieza completa.
- `Anthropic capacity staging` paso primero perfil 8 y despues perfil 50 sin
  error rate mayor a 1%, p95 menor a 120 segundos y gasto dentro del techo
  aprobado.
- Shopify OAuth, billing con cobro real, publicacion, desinstalacion y los tres
  webhooks de privacidad pasaron en una development store.
- `PLAN_TEST=0` fue decidido por direccion para el canary; si sigue en `1`, el
  lanzamiento puede probar instalacion, pero no valida cobro real.

## Olas

| Ola | Exposicion maxima | Permanencia minima | Condicion para avanzar |
| --- | ---: | ---: | --- |
| 1 | 50 tiendas | 24 horas | cero fugas RLS, cola menor a 10 minutos, sin reinicios no explicados |
| 2 | 200 tiendas | 24 horas | mismas condiciones, mas gasto IA y billing reconciliados |
| 3 | 1.000 tiendas | 24 horas | mismas condiciones, soporte y alertas sin backlog critico |

No se avanza por hora calendario si las metricas no acompanian. Si una ola se
pausa, el contador de permanencia vuelve a empezar despues de corregir y
verificar.

## Alertas obligatorias

Antes de Ola 1 deben existir alertas automaticas, no solo observacion manual,
para:

- `/ready` no saludable en web.
- Worker sin heartbeat o con reinicios repetidos.
- Error rate HTTP mayor a 1% durante 5 minutos.
- p95 HTTP mayor a 1.000 ms durante 10 minutos.
- Antiguedad del job pendiente mas viejo mayor a 10 minutos.
- Jobs fallidos o abandonados creciendo durante 10 minutos.
- Conexiones PostgreSQL mayores al 70% del limite operativo.
- CPU sostenida mayor a 70% o memoria mayor a 75% en web o worker.
- Respuestas `429` o `5xx` de Anthropic por encima de 1%.
- Respuestas `429` o `5xx` de Shopify por encima de 1%.

Cada alerta debe tener receptor, severidad, enlace al dashboard y accion
primaria. Si falta una alerta de esta lista, la decision es NO-GO.

## Demanda excedente

Cuando una tienda queda fuera del cupo de la ola vigente:

- OAuth, lectura, billing y webhooks siguen disponibles.
- La admision de nuevas generaciones responde `429` o `503` con `Retry-After`.
- La interfaz debe explicar que la generacion quedo en espera o fue limitada
  temporalmente; no debe prometer ejecucion inmediata.
- No se reserva cupo ni se cobra consumo de IA si la solicitud no entra a cola.

El objetivo no es esconder el limite, sino proteger reputacion y datos mientras
el sistema absorbe demanda real.

## Pausa y degradacion

Pausar nuevas generaciones si ocurre cualquiera de estos eventos:

- Cola mas antigua sobre 10 minutos.
- Error rate HTTP mayor a 1% sostenido.
- Anthropic responde rate limit o errores de proveedor por encima de 1%.
- Shopify rechaza publicaciones o webhooks de forma sostenida.
- `/ready` falla cualquier control de aislamiento.
- Un deploy de web o worker queda inconsistente con el SHA promovido.

Orden de degradacion:

1. Detener admision de nuevas generaciones.
2. Mantener OAuth, billing, lectura y webhooks.
3. Reducir carriles del worker si el proveedor externo o PostgreSQL estan
   saturados.
4. Reintentar jobs idempotentes con backoff.
5. Revertir deploy solo si la version nueva es la causa; no revertir
   migraciones aplicadas.

## Incidentes

### Cola atrasada

1. Confirmar `oldestJobAge`, profundidad de cola y jobs fallidos.
2. Revisar CPU, memoria y conexiones PostgreSQL.
3. Revisar respuestas de Anthropic y Shopify.
4. Pausar admision si `oldestJobAge` supera 10 minutos.
5. No aumentar carriles hasta confirmar cuota externa y margen de base de datos.

### Proveedor de IA

1. Confirmar rate limits, error rate, latencia p95 y gasto estimado.
2. Reducir concurrencia antes de reintentar masivo.
3. Mantener evidencias sin prompts ni respuestas.
4. Si falta cuota o presupuesto, NO-GO para avanzar de ola.

### Shopify

1. Separar errores OAuth, billing, GraphQL Admin API y webhooks.
2. Validar scopes y version de API.
3. Reconciliar cobros reales antes de aumentar exposicion.
4. Si falla un webhook obligatorio de privacidad, NO-GO inmediato.

### Aislamiento

1. Si `/ready` falla RLS, rol o capacidad worker, detener rollout.
2. No desactivar RLS para recuperar disponibilidad.
3. Corregir con migracion nueva y repetir `Release staging` y prueba cruzada
   entre tenants.

## Registro de evidencia

Registrar cada ejecucion con este formato:

| Fecha | Ola | SHA | Workflow | Resultado | Evidencia |
| --- | --- | --- | --- | --- | --- |
| 2026-08-12 | 1 | `95a81bccac219b9355cf9adb4861a696d9b5caf3` | Release staging #12 | OK | `/ready ok`, Postgres, RLS forzado en 12 tablas, rol web sin bypass/herencia/capacidad worker |
| 2026-08-12 | 1 | `95a81bccac219b9355cf9adb4861a696d9b5caf3` | Capacity staging #9 1000/1000 | OK | `runId=bd3d9d2ef957`, drenaje 81,09 s, limpieza 1.000/1.000/1.000 |
| 2026-08-12 | 1 | `3aeb762d142a20fc117a21a39679abdcd5241db8` | Anthropic capacity staging #3 perfil 8 | OK | 8/8 llamadas reales, error rate 0, p95 39,33 s, costo estimado USD 0,8907 bajo techo USD 5 |
| pendiente | 1 | pendiente | Anthropic profile 50/500 | NO-GO | falta ejecutar perfiles de mayor evidencia antes de aumentar ola |
| pendiente | 1 | pendiente | Shopify E2E billing/webhooks | NO-GO | falta ejecutar |

No borrar filas fallidas. Una falla con causa y correccion es mejor evidencia
que un historial limpio incompleto.
