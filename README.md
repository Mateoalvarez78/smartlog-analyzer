# SmartLog Analyzer

Prototipo interno que recibe logs de varios microservicios, los guarda en
PostgreSQL y usa un LLM para generar un resumen, categorizar los problemas y
sugerir acciones. Por defecto usa un LLM simulado (sin red ni API key); se puede
apuntar a un modelo real con variables de entorno.

Decisiones técnicas, diagrama y contrato HTTP: [ARCHITECTURE.md](ARCHITECTURE.md).

Repositorio con el historial completo de commits:
https://github.com/Mateoalvarez78/smartlog-analyzer (el ZIP de entrega no incluye
`.git` porque la plataforma no lo admite).

## Requisitos

- Docker con Docker Compose v2.
- Node.js 24+ y npm, solo para correr los tests o la app fuera de Docker.

## Cómo levantarlo

```bash
docker compose up --build
```

No hace falta crear un `.env`: todas las variables tienen defaults de desarrollo.
Al arrancar, el contenedor `app` espera a que la base esté sana, corre las
migraciones, carga el seed (29 logs sintéticos de 4 servicios, todos del
`2026-11-01` UTC; idempotente) y levanta la API en `http://localhost:3000`.

```bash
curl http://localhost:3000/api/health
# {"status":"ok","checks":{"database":"ok"}}
```

Para detenerlo y borrar los datos: `docker compose down -v`.

### Probar los endpoints

```bash
# Ingestar un log
curl -X POST http://localhost:3000/api/logs \
  -H "Content-Type: application/json" \
  -d '{"service":"demo","level":"ERROR","message":"Connection refused to cache","timestamp":"2026-11-01T12:00:00Z"}'

# Listar con filtros (service, level, from, to, limit)
curl "http://localhost:3000/api/logs?service=payments-api&level=ERROR"

# Agregación: cantidad de logs por servicio y nivel en un rango
curl "http://localhost:3000/api/logs/stats?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z"

# Analizar un rango con el LLM (201 + resultado persistido; el id también viene en el header Location)
curl -X POST http://localhost:3000/api/logs/analyze \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-11-01T00:00:00Z","to":"2026-11-02T00:00:00Z"}'

# Recuperar el análisis
curl http://localhost:3000/api/analysis/<id>
```

Los errores siempre tienen la forma `{"error":{"code","message"}}`; los de
validación agregan `details` con el campo que falló.

### Usar un LLM real

El mismo cliente sirve para cualquier proveedor con API compatible con OpenAI
(`POST /chat/completions`). Crear un `.env` junto al `docker-compose.yml`:

```bash
# Ollama local (gratis). Antes: `ollama pull llama3.1`
ANALYSIS_ADAPTER=openai-compatible
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_MODEL=llama3.1
ANALYSIS_TIMEOUT_MS=30000
```

```bash
# Gemini (free tier, API key de https://aistudio.google.com)
ANALYSIS_ADAPTER=openai-compatible
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=<un modelo "flash" de la lista de AI Studio>
LLM_API_KEY=<tu-key>
ANALYSIS_TIMEOUT_MS=30000
```

y volver a correr `docker compose up --build`. El campo `adapter` de cada análisis
indica qué cliente lo generó (`llm:mock-v1` o `llm:openai-compatible:<modelo>`).
En Linux, `host.docker.internal` requiere agregar
`extra_hosts: ["host.docker.internal:host-gateway"]` al servicio `app`.

## Cómo correr los tests

Los tests de integración usan un PostgreSQL real (no un mock de la base). Lo más
simple es levantar solo la base del compose, publicada en `127.0.0.1:5432`:

```bash
npm ci
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
TEST_DATABASE_URL=postgresql://smartlog:smartlog-dev@localhost:5432/smartlog npm test
```

| Comando | Qué corre | Necesita Postgres |
|---|---|---|
| `npm test` | Todo | Sí |
| `npm run test:unit` | Solo unitarios | No |
| `npm run test:integration` | Solo integración | Sí |
| `npm run typecheck` | Tipos | No |

El CI (`.github/workflows/ci.yml`) corre lo mismo en cada push y, en un segundo
job, `docker compose up --build --wait` + requests reales contra la API.

Qué cubren, a grandes rasgos: validación y casos borde de cada endpoint (fechas
imposibles, rangos invertidos, NUL bytes, campos extra, límites), el formato de
error, el health check con la base caída, y el análisis con un LLM que responde
bien, que responde prosa / JSON truncado / JSON con forma incorrecta / IDs
inventados, que tarda más que el timeout, y que falla. El cliente HTTP real se
prueba contra un servidor falso local.

## Desarrollo local

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
npm run migrate && npm run seed
npm run dev
```

## Puertos y red

| Servicio | Puerto interno | Publicado en el host | Red |
|---|---|---|---|
| `app` | 3000 | `APP_PORT` (default 3000) | `smartlog` |
| `db` | 5432 | No; solo con `docker-compose.dev.yml` en `127.0.0.1:${DB_PORT:-5432}` | `smartlog` |

La app llega a la base por el nombre `db` dentro de la red `smartlog`. Los datos
persisten en el volumen `db-data`.

## Variables de entorno

Todas opcionales con `docker compose up`. Ver [.env.example](.env.example).

| Variable | Default | Para qué |
|---|---|---|
| `APP_PORT` | `3000` | Puerto publicado en el host |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Dónde escucha la API dentro del contenedor |
| `DATABASE_URL` | la arma el compose | Conexión a PostgreSQL |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `smartlog` / `smartlog-dev` / `smartlog` | Credenciales de desarrollo |
| `LOG_LEVEL` | `info` | Nivel de log (pino) |
| `HEALTH_DB_TIMEOUT_MS` | `1000` | Tiempo máximo del health check contra la base |
| `ANALYSIS_ADAPTER` | `mock` | `mock` o `openai-compatible` |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | — | Proveedor real (requeridas las dos primeras si `openai-compatible`) |
| `ANALYSIS_TIMEOUT_MS` | `5000` | Timeout del LLM (subirlo a ~30000 con un modelo real) |
| `ANALYSIS_MAX_LOGS` / `ANALYSIS_MAX_BYTES` | `100` / `200000` | Tamaño máximo del lote a analizar |
| `LOGS_DEFAULT_LIMIT` / `LOGS_MAX_LIMIT` | `50` / `500` | Límites de `GET /api/logs` |

La configuración se valida al arrancar: si una variable es inválida, el proceso
no levanta e indica cuál (nunca su valor).

## Cómo usé IA durante el desarrollo

Usé Claude Code (Anthropic) como asistente, en varias sesiones. Arrancamos con un
plan por etapas (arquitectura → base de datos → ingesta → análisis →
verificación), pero no fue un plan cerrado: lo fui ajustando a medida que algo
no se sostenía al ejecutarlo, y el proyecto se construyó de a poco, etapa por
etapa, revisando cada cambio antes de aceptarlo.

Algunos de los cambios de rumbo más importantes — la alternativa que se dejó
de lado y por qué:

- **Análisis síncrono vs. cola asíncrona.** El primer borrador de arquitectura
  (de una sesión anterior) proponía una cola con estado `pending`, `202` +
  polling y errores en formato RFC 9457. Lo reemplazamos por un flujo síncrono
  con timeout acotado: para 100 logs y un mock que responde al instante, la
  cola agregaba locking y estado sin necesidad real, y no alcanzaba el tiempo
  para verificarla bien. Si un modelo real tardara 20-30 segundos, ese sería
  el primer cambio a reconsiderar. (Ese primer diseño queda en la rama
  `stage-1-walking-skeleton`, sin mergear, como referencia.)

- **`from >= to`: ¿lista vacía o error?** La primera versión devolvía
  `200 []` (razonando que "rango sin resultados" y "rango inválido" eran lo
  mismo). Al revisarlo de nuevo nos dimos cuenta de que eso esconde un error
  del cliente detrás de un "no hay datos" — se cambió a `400 INVALID_RANGE`,
  distinguiendo explícitamente "rango válido sin datos" de "rango mal
  armado".

- **El mock del LLM: objeto armado vs. texto real.** La primera versión del
  adaptador mock devolvía directamente un objeto `AnalysisOutput` ya tipado.
  Funcionaba, pero significaba que los tests de "respuesta inesperada del
  LLM" solo podían simular un objeto bien formado con un dato incorrecto —
  nunca el caso real de un modelo que devuelve prosa, un bloque de markdown
  con fence `json`, o JSON cortado. Se rediseñó para que el mock pase por el mismo camino de
  texto que un proveedor real (arma texto, lo parsea, lo valida), así los
  tests de "formato inesperado" prueban fallas de verdad, no una simulación
  cómoda.

- **Migraciones: librería vs. script propio.** Se consideró `node-pg-migrate`,
  pero el alcance (aplicar un puñado de scripts SQL en orden, sin necesitar
  rollback) no justificaba la dependencia — un runner de ~40 líneas hace lo
  mismo y es auditable de un vistazo.

- **Categorías del LLM: texto libre vs. lista cerrada.** Se evaluó forzar un
  enum fijo de categorías para que un modelo real no pueda "inventar"
  nombres nuevos cada vez. Se decidió no hacerlo ahora: una lista cerrada
  necesita revalidar la taxonomía cada vez que cambia y agrega lógica de
  orquestación que no alcanzaba a probarse bien en el tiempo disponible.
  Queda anotado como el primer cambio natural si se muestra un modelo real.

- **Contenedor como root vs. usuario sin privilegios.** La primera versión
  del `Dockerfile` no fijaba usuario (corría como `root` por default de la
  imagen). Al auditar el proyecto completo se cambió a `USER node`: no había
  ninguna razón real para correr como root, y era gratis arreglarlo.

Un hilo que se repite en casi todos estos casos: **el typecheck nunca mostró
ninguno de estos problemas.** Compilaba limpio en todas las versiones
"viejas". Lo que los sacó a la luz fue correr el código de verdad contra
Postgres real y contra el contenedor — varias veces un bug apareció recién
ahí: el `statement_timeout` que se pegaba a una conexión del pool, un byte
NUL que llegaba a Postgres y volvía como `500`, un `413` de Fastify que el
error handler propio convertía en `500`. Construir de a poco y volver a
probar cada etapa contra el entorno real, en vez de confiar en que "si
compila, funciona", fue la parte más útil de trabajar así.

## Qué quedó afuera y cómo lo resolvería

| Qué | Cómo lo resolvería |
|---|---|
| Idempotencia de `POST /api/logs/analyze` | Header `Idempotency-Key` con `UNIQUE` en `analyses`; ante un reintento, devolver el registro existente. |
| Análisis asíncrono para modelos lentos | Estado `pending`, worker con `SELECT ... FOR UPDATE SKIP LOCKED`, `202` + `GET /api/analysis/{id}` para consultar. |
| Paginación por cursor en `GET /api/logs` | Cursor `(timestamp, id)` en lugar de `OFFSET`, para no degradar con volumen. |
| Ingesta en lote (`POST /api/logs` con un array) | Mismo schema por ítem, un `INSERT` multi-fila en una transacción, reporte de errores por índice. |
| OpenAPI | `@fastify/swagger` a partir de los JSON Schemas que ya validan cada ruta. |
| Retención / borrado de logs | Revisar antes la integridad de `analyses.log_ids` (array sin FK). |
| Migraciones con varias réplicas arrancando a la vez | `pg_advisory_lock` alrededor de `runMigrations`. |
| Seed en producción | Hoy el seed corre siempre al arrancar; con datos reales lo haría opcional (`SEED_DEMO=false`). |

## Problemas conocidos

- **Docker Desktop en Windows:** a veces `curl localhost:3000` desde el host queda
  colgado aunque el contenedor esté sano (`docker compose ps` lo marca `healthy`).
  Probar con `127.0.0.1` o reiniciar Docker Desktop.
