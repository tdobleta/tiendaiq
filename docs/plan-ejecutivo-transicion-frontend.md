# Plan ejecutivo: transicion controlada a frontend

**Estado:** activo desde el 18 de agosto de 2026.

**Decision:** el lanzamiento publico permanece en **NO-GO**. El frontend no se
abre de forma general hasta cerrar la puerta de transicion definida aqui.

## 1. Definiciones operativas

`Backend certificable` significa que el camino servidor, datos, cola, worker,
tenancy y Shopify cuenta con controles implementados y evidencia reproducible
en staging. No significa que la app publica este lista para 1.000 tiendas.

`GO de lanzamiento` requiere ademas capacidad real, cuota y limite de gasto de
IA, billing real, cumplimiento Shopify, legales y operacion por olas. El plan
de esa etapa vive en `docs/plan-lanzamiento-1000-tiendas.md`.

Una tarea se considera terminada solo cuando esta en `main`, el SHA revisado se
promovio a staging y la evidencia correspondiente esta registrada. Que el codigo
exista en una rama no cierra un gate.

## 2. Decision de alcance

Hasta que se abra el workstream de frontend, solo se permiten cambios visuales
que cumplan una de estas excepciones:

1. corrigen un bloqueo de la certificacion Shopify E2E;
2. eliminan contenido o claims no autenticos;
3. adaptan un cliente existente a un contrato de servidor ya congelado.

Quedan fuera del alcance: reescritura de router, nuevos experimentos de
plantillas, nichos, prototipos, cambios de control/data plane y cambios de base
dedicada por tenant. Se reevalua cada uno despues del canary, no durante esta
certificacion.

## 3. Puerta para abrir frontend

Todos los items B-E deben tener evidencia del mismo release candidato.

| Gate | Resultado exigido | Estado actual |
| --- | --- | --- |
| A. Integridad de release | CI, migracion y web/worker promovidos por SHA revisado; rollback probado | Continuar conservando evidencia |
| B. Instalacion Shopify | managed install, scopes efectivos y sesion embebida comprobados en development store | Pendiente de cierre con evidencia actual |
| C. E2E controlado | instalar/reinstalar -> producto -> estrategia -> job durable -> generacion controlada -> revision -> publicacion -> storefront | Pendiente |
| D. Contrato de pagina | validacion central versionada antes de persistir/publicar, compatibilidad y lectura de versiones existentes | Pendiente |
| E. Autenticidad | ninguna plantilla publica fabrica reviews, ratings, estrellas, porcentajes o estadisticas; cada claim se omite, es placeholder editable o tiene procedencia | Pendiente |
| F. Activacion frontend | B-E cerrados, evidencia registrada y contrato congelado para el sprint | Bloqueado por B-E |

El detalle de la evidencia de Shopify esta en
`docs/runbook-shopify-e2e-staging.md`. Ese gate no sustituye el ensayo visual
desktop/mobile, `shop/redact` destructivo, billing real ni la revision de
listing de Shopify.

## 4. Orden de ejecucion

1. **Consolidar evidencia.** Registrar para el SHA candidato: workflow, deploy
   web, deploy worker, migracion, resultado y fecha. Invalidar evidencia que
   provenga de otro SHA.
2. **Cerrar el contrato de pagina.** Definir esquema y `schema_version`,
   validar entrada en el limite HTTP antes de escribir, versionar cambios y
   probar carga, edicion y publicacion de datos validos e invalidos.
3. **Cerrar autenticidad.** Localizar cada claim visual fabricado en los
   renderers; reemplazarlo por datos con procedencia, placeholder editable u
   omision. Agregar pruebas de regresion.
4. **Ejecutar E2E controlado.** Usar una development store sacrificable y un
   producto de prueba. Habilitar una unica generacion deliberada, sin bucles ni
   reintentos automaticos; restaurar la pausa de admision al terminar.
5. **Abrir frontend sprint 1.** Solo tras F. Trabajar sobre el contrato
   congelado, con estados de carga/error/vacio, responsive y el criterio de
   `docs/criterio-ejecucion-ui.md`. No introducir nuevas capacidades de
   servidor desde una pantalla.
6. **Preparar GO publico.** Ejecutar capacidad con metricas, confirmar cuota y
   techo de gasto de IA, billing real, compliance, soporte/legal y canary
   50 -> 200 -> 1.000 conforme a los runbooks existentes.

## 5. Evidencia minima por gate

Cada cierre debe incluir, sin secretos ni datos de clientes:

- SHA completo de `main` y SHA reportado por `/ready`;
- enlace o identificador de workflow y deploy web/worker;
- caso ejecutado, resultado, fecha y responsable;
- para capacidad: CPU, memoria, conexiones PostgreSQL, antiguedad de cola,
  tasa de errores y gasto de IA;
- para Shopify: store de desarrollo, version de app, scopes, URL durable y
  resultado sanitizado de cada comprobacion.

## 6. Control de IA y seguridad

- La clave de Anthropic queda solo donde la requiere el servicio web; nunca se
  pega en issues, documentos, logs, frontend ni worker sin necesidad expresa.
- Una prueba de generacion tiene cupo, timeout, presupuesto y trazabilidad.
  El fallo debe dejar un estado recuperable, no reintentos infinitos.
- No se habilita `PLAN_TEST=0`, se publican paginas reales ni se abre una ola
  externa como consecuencia de este documento.

## 7. Resultado esperado de esta fase

Al cerrar F, el equipo puede construir frontend de manera ordenada sobre un
contrato verificable. Al cerrar los gates de la seccion 4.6 se evalua el GO de
canary; no antes.
