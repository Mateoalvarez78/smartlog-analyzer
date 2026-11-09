# SmartLog Analyzer

Prototipo interno que recibe logs de varios microservicios, los guarda en
PostgreSQL y usa un LLM para generar un resumen, categorizar los problemas y
sugerir acciones. Por defecto usa un LLM simulado (sin red ni API key); se puede
apuntar a un modelo real con variables de entorno.

Decisiones técnicas, diagrama y contrato HTTP: [ARCHITECTURE.md](ARCHITECTURE.md).

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

Usé Claude Code (Anthropic) como asistente en sesiones dirigidas: yo definía el
enfoque y revisaba cada cambio antes de aceptarlo.

**Lo que más aportó**
- Un primer borrador de `ARCHITECTURE.md` a partir de mi brief, que discutí y
  ajusté antes de escribir código.
- El código repetitivo (schemas de Fastify, repositorios SQL, error handler) de
  forma consistente entre módulos.
- Diseñar casos borde de tests: timeout con respuesta tardía que no debe pisar el
  resultado, fallo real de persistencia vía un `CHECK` de Postgres, respuestas
  malformadas del LLM.
- Una revisión final del código contra la letra, que encontró problemas que
  después corregí con su test: el health check dejaba un `statement_timeout` de
  1 s pegado a conexiones del pool, un byte NUL en un log daba `500`, un rango
  invertido devolvía una lista vacía, y el mock devolvía un objeto ya armado, así
  que el parseo de una respuesta real de un LLM no tenía código ni tests.

**Lo que corregí o descarté**
- El primer diseño propuesto era asincrónico (cola, `202` + polling, RFC 9457).
  Lo descarté por un flujo síncrono más simple de verificar en el tiempo
  disponible (queda en la rama `stage-1-walking-skeleton`).
- El código inicial se escribió sin correr contra Postgres. Al ejecutarlo
  aparecieron bugs que el typecheck no detectaba: Fastify descartaba en silencio
  campos no declarados, `Date.parse` aceptaba el 30 de febrero, y los tests de
  integración se pisaban entre sí al correr en paralelo.
- Una pasada contra el contenedor real encontró que los errores propios de
  Fastify (JSON malformado, body demasiado grande) salían como `500` en vez de su
  código real, y que el contenedor corría como `root`.
- Para el parser de respuestas del LLM descarté la opción permisiva de "buscar el
  primer `{...}` en el texto": esconde fallas del modelo.

Lo que más aprendí: compilar y pasar el typecheck no reemplaza correr contra la
base y el contenedor reales. Casi todos los bugs aparecieron solo al ejecutar.

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
