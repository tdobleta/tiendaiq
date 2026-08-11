# Pruebas de carga locales

Esta herramienta simula como maximo 2.000 sesiones HTTP y 1.000 envios de
jobs. Usa solamente modulos incluidos en Node.js 20. No importa los SDK de
Shopify o Anthropic y sus payloads estan marcados como sinteticos.

## Modelo de seguridad

- El destino predeterminado es `http://127.0.0.1:4322`.
- El servidor falso escucha solamente en loopback.
- Un destino no local se rechaza sin una autorizacion explicita.
- Las rutas de negocio conocidas de TiendaIQ se rechazan. La herramienta debe
  apuntar a endpoints sinteticos que no ejecuten Shopify, Anthropic, billing,
  publicaciones ni cambios de datos reales.
- Los tokens no se aceptan en la URL. Cuando un endpoint sintetico protegido
  necesite autenticacion, se carga desde el entorno.
- Cada job incluye `simulated: true`, `type: synthetic-load-job`, un UUID y una
  clave de idempotencia unica.

La herramienta mide admision HTTP. No afirma que 1.000 trabajos hayan sido
procesados por workers. El procesamiento de cola necesita una prueba separada
con proveedores falsos, profundidad de cola y tiempo de recuperacion.

## Capacidad real de PostgreSQL y la cola

Con una base de staging aislada y los roles web/worker configurados, la prueba
de cola crea tiendas y jobs sinteticos, los procesa sin proveedores externos y
elimina todas sus filas al finalizar:

```powershell
$env:ALLOW_QUEUE_LOAD_TEST = "1"
$env:TEST_DATABASE_URL = "postgresql://tiendaiq_web@127.0.0.1:55433/tiendaiq_staging?sslmode=disable"
$env:TEST_WORKER_DATABASE_URL = "postgresql://tiendaiq_worker@127.0.0.1:55433/tiendaiq_staging?sslmode=disable"
npm run carga:cola
```

Los defaults son 1.000 tiendas, 1.000 jobs, 40 operaciones de preparacion y 16
carriles worker. `LOAD_FAKE_WORK_MS` simula trabajo sin llamar a Shopify o IA.
Un destino remoto exige ademas la frase de autorizacion indicada por el script.

## Prueba local sin efectos externos

Requiere Node.js 20 o posterior. No hace falta instalar paquetes ni modificar
`package.json`.

Primera terminal:

```powershell
node scripts/servidor-carga-local.js
```

Segunda terminal, perfil maximo solicitado:

```powershell
node scripts/carga-local.js --sessions 2000 --jobs 1000 --concurrency 200 --ramp-up-ms 5000
```

Perfil rapido para desarrollo:

```powershell
node scripts/carga-local.js --sessions 100 --jobs 50 --concurrency 25
```

El proceso termina con codigo `0` cuando aprueba, `1` cuando rompe un umbral y
`2` cuando la configuracion o la ejecucion son invalidas.

## Umbrales

Los valores predeterminados son:

- Tasa global de error menor o igual a 1%.
- Latencia global p95 menor o igual a 1.000 ms.
- Throughput minimo desactivado.
- Timeout individual de 5 segundos.

Ejemplo con una compuerta mas exigente:

```powershell
node scripts/carga-local.js --sessions 2000 --jobs 1000 --concurrency 200 --max-error-rate 0.005 --max-p95-ms 500 --min-rps 100
```

La salida incluye p50, p95, p99, maximo, throughput, codigos HTTP y tipos de
error para el total, sesiones y jobs. `--json` produce una sola linea JSON para
automatizacion.

## Fallos controlados

El servidor falso permite validar que la compuerta detecta degradacion:

```powershell
$env:MOCK_LOAD_FAIL_EVERY = "10"
$env:MOCK_LOAD_DELAY_MS = "100"
node scripts/servidor-carga-local.js
```

Con `MOCK_LOAD_FAIL_EVERY=10`, cerca del 10% de las respuestas sera `503` y la
ejecucion predeterminada debe terminar con codigo `1`.

## Servidor configurable

Antes de enviar trafico, inspeccionar la configuracion sin hacer requests:

```powershell
node scripts/carga-local.js --base-url http://127.0.0.1:9000 --session-path /load/session --job-path /load/jobs --dry-run
```

Un servidor de staging debe exponer endpoints equivalentes que solo validen y
encolen objetos sinteticos en infraestructura aislada. Para un host no local se
requiere la siguiente autorizacion deliberada:

```powershell
$env:ALLOW_NON_LOCAL_LOAD_TEST = "I_UNDERSTAND_THIS_GENERATES_TRAFFIC"
$env:LOAD_TEST_AUTHORIZATION = "Bearer <token-del-endpoint-sintetico>"
$env:LOAD_TEST_HEADERS_JSON = '{"x-test-environment":"staging"}'
node scripts/carga-local.js --base-url https://staging.example.test --session-path /load/session --job-path /load/jobs --sessions 2000 --jobs 1000 --concurrency 200
```

La misma compuerta bloquea produccion por defecto. Autorizar la variable no
convierte una ruta de negocio en segura: las rutas conocidas siguen bloqueadas.
No se debe ejecutar contra produccion hasta disponer de endpoints sinteticos,
ventana autorizada, limites de infraestructura, observabilidad y plan de
interrupcion.

## Opciones

Ejecutar `node scripts/carga-local.js --help` para ver limites, defaults y todas
las opciones disponibles.
