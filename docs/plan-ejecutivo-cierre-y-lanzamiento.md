# Plan ejecutivo de cierre y lanzamiento

Fecha de control: 2026-08-17  
Estado inicial: **NO-GO externo**  
Alcance congelado: backend, operacion, Shopify E2E y preparacion de lanzamiento.

Este documento es la fuente ejecutiva canonica para terminar TiendaIQ. Los
documentos tecnicos existentes conservan el detalle de arquitectura, carga y
operacion, pero ninguna iniciativa entra al plan si no contribuye a uno de los
gates definidos aqui.

## 1. Meta final

TiendaIQ se considera terminada para lanzamiento cuando:

1. el mismo commit revisado opera sano en staging y produccion;
2. la separacion tenant y los privilegios PostgreSQL fallan cerrados;
3. el circuito web -> cola -> worker -> IA/Shopify -> persistencia fue probado;
4. existen alertas automaticas, rollback ensayado y un responsable de guardia;
5. instalacion, billing real, publicacion, desinstalacion y privacidad pasan E2E;
6. Shopify App Store tiene listing, evidencia y cuenta de review completos;
7. las olas 50, 200 y 1.000 permanecen sanas al menos 24 horas cada una.

La aprobacion de Shopify no tiene una fecha controlable por TiendaIQ. El objetivo
controlable es dejar un candidato enviado, reproducible y sin deuda bloqueante.

## 2. Dos metas operativas

### Meta A - Backend certificado

**Objetivo interno: 2026-08-26.**

Al cumplirla se puede descongelar el frontend como frente principal. Requiere:

- produccion recuperada y alineada con el SHA certificado;
- `/ready` verde en web y heartbeat verde en worker;
- alertas y rollback probados;
- capacidad de Postgres, cola e IA medida con evidencia;
- Shopify E2E y billing real aprobados en development store;
- documentacion operativa actualizada.

### Meta B - Candidato de App Store

**Objetivo interno: 2026-09-04.**

Requiere Meta A, frontend final, listing, screencast, legales, soporte, pricing,
credenciales de reviewer y self-review. La fecha de aprobacion posterior depende
de Shopify.

## 3. Linea de mando

| Rol | Responsabilidad | Entregable |
| --- | --- | --- |
| Direccion | alcance, presupuesto, proveedores y decision GO/NO-GO | acta de decision |
| Ingenieria | integridad del release, backend, migraciones y contratos | SHA certificado |
| Confiabilidad | Render, PostgreSQL, alertas, capacidad y rollback | evidencia operativa |
| Shopify/Producto | OAuth, billing, lifecycle, listing y experiencia reviewer | matriz App Store |
| QA | reproducir E2E, regresion y evidencia | expediente de pruebas |

Una misma persona puede cubrir varios roles, pero cada gate debe tener un unico
responsable nominal antes de ejecutarse.

## 4. Secuencia de ejecucion

### Fase 0 - Congelamiento y control (17 de agosto)

- Congelar React Router, DB dedicada, control/data plane, themes nuevos y
  refactors no bloqueantes.
- Fijar `origin/main` y el SHA desplegado en staging como linea base.
- Mantener `GENERATION_ADMISSION_PAUSED=1` y `PLAN_TEST=1`.
- Abrir un registro unico de evidencia con enlace, fecha, SHA, resultado y dueño.

**Salida:** no existen trabajos paralelos fuera del camino critico.

### Fase 1 - Paridad de produccion (17-18 de agosto)

- Diagnosticar el `/ready` 500 de produccion y el worker suspendido.
- Promover exclusivamente un SHA que ya haya pasado staging.
- Confirmar credenciales runtime separadas, migrador ausente del runtime y RLS.
- Verificar web, worker, health, ready, heartbeat y procesamiento de un job
  sintetico sin IA ni mutacion real.

**Salida:** produccion sana, reversible y alineada con el commit certificado.

### Fase 2 - Operacion observable (18-20 de agosto)

- Configurar alertas automaticas del runbook con receptor y severidad.
- Cubrir `/ready`, worker ausente, cola vieja, jobs fallidos, conexiones,
  CPU/memoria, errores Shopify/Anthropic y gasto.
- Ejecutar pausa de admision, reinicio de worker y rollback del release.
- Registrar tiempos de deteccion y recuperacion.

**Salida:** ninguna condicion critica depende de mirar manualmente Render.

### Fase 3 - Capacidad y proveedores (20-24 de agosto)

- Confirmar cuota, rate limit y techo de gasto de Anthropic.
- Ejecutar perfiles 8, 50 y 500 con presupuesto acotado.
- Ejecutar 2.000 sesiones y 1.000 jobs sinteticos contra PostgreSQL real.
- Medir p95, error rate, job mas antiguo, conexiones, CPU, memoria y costo.
- Ajustar sizing antes de repetir; no aumentar concurrencia a ciegas.

**Salida:** 500 generaciones en <= 60 minutos, cola < 10 minutos, errores de
proveedor < 1% y conexiones PostgreSQL < 70% del limite.

### Fase 4 - Shopify E2E y dinero (24-26 de agosto)

- Probar instalacion, reapertura, session token, reinstalacion y desinstalacion.
- Probar los tres compliance webhooks y `app/uninstalled` con evidencia durable.
- Aprobar y rechazar un cargo real; comprobar entitlement y reconciliacion.
- Generar, editar, publicar y retirar una pagina en development store.
- Confirmar scopes minimos, legales completas y soporte operativo.

**Salida:** expediente E2E verde. Solo entonces cambiar `PLAN_TEST=0` en el
entorno candidato y volver a ejecutar readiness.

### Fase 5 - Frontend y App Store (27 de agosto-4 de septiembre)

- Descongelar frontend unicamente si Meta A fue certificada.
- Cerrar onboarding, estados vacio/carga/error/exito, responsive y accesibilidad.
- Verificar preview, storefront y theme app extension sin inyeccion manual.
- Preparar listing, pricing, capturas, screencast, instrucciones y cuenta reviewer.
- Ejecutar self-review y regresion completa sobre el candidato enviado.

**Salida:** submission reproducible sin pasos secretos ni dependencias personales.

### Fase 6 - Lanzamiento por olas

| Ola | Tiendas | Permanencia minima | Condicion para avanzar |
| --- | ---: | ---: | --- |
| 1 | 50 | 24 h | cero incidente critico y SLO verdes |
| 2 | 200 | 24 h | cola, costo, billing y soporte estables |
| 3 | 1.000 | 24 h | mismas condiciones y capacidad con margen |

La admision se abre por ola. Excedentes reciben espera explicita y no promesas
de disponibilidad inmediata.

## 5. Gates binarios

| Gate | Evidencia obligatoria | Estado inicial |
| --- | --- | --- |
| Release | SHA revisado = SHA desplegado | staging verde, produccion no |
| Datos | RLS forzado, aislamiento cruzado, backup/restore | RLS verde; restore por certificar |
| Worker | heartbeat, leases, retry, compensacion y apagado | codigo verde; produccion no |
| Observabilidad | alertas recibidas y runbook ejecutado | pendiente |
| Capacidad | perfiles completos y metricas Render/Postgres | parcial |
| Anthropic | cuota, gasto y perfil 500 | parcial |
| Shopify E2E | OAuth, billing, publicar, uninstall y privacy | pendiente |
| App Store | listing, screencast, reviewer y self-review | pendiente |

Un gate parcial se considera **NO-GO**. CI verde no reemplaza evidencia operativa.

## 6. Decisiones que requieren a Direccion

1. Autorizar presupuesto y techo mensual de Anthropic.
2. Autorizar el sizing de Render/PostgreSQL resultante de la prueba, no antes.
3. Proporcionar razon social, domicilio, email de soporte, pricing y cuenta review.
4. Firmar el GO de cada ola despues de revisar el expediente de evidencia.

Ninguna de estas decisiones requiere exponer secretos en chat o en el repositorio.

## 7. Regla de cambio

Hasta Meta A solo se acepta trabajo que:

- cierre un gate;
- reduzca un riesgo de lanzamiento demostrado;
- produzca evidencia reproducible;
- corrija un fallo observado en staging o produccion.

Todo lo demas entra al backlog posterior al lanzamiento. No se reconstruye una
pieza estable durante el cierre salvo que impida un gate.

## 8. Definicion de exito

El proyecto no termina al fusionar codigo ni al recibir aprobacion automatica.
Termina cuando la Ola 3 cumple 24 horas con:

- cero fuga entre tenants;
- cero mutacion o cobro duplicado;
- disponibilidad y latencia dentro del SLO;
- cola y conexiones bajo umbral;
- gasto dentro del presupuesto;
- alertas y soporte funcionando;
- evidencia archivada para operacion y futuras revisiones.
