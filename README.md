# SmartLog Analyzer

Prototipo interno que recibe logs de varios microservicios, los almacena y usa un
adaptador de IA (mock determinista, intercambiable por un proveedor real) para
generar un resumen, categorías y sugerencias. Las decisiones técnicas y el
contrato HTTP completo están en [ARCHITECTURE.md](ARCHITECTURE.md).

> **Estado:** funcional end-to-end (Etapa 4 de 5). Arranque, migraciones,
> seed, ingesta/listado de logs y análisis (adaptador mock) están
> implementados y verificados contra Docker + PostgreSQL real, incluida una
> corrida completa desde un clon limpio (ver [Verificación](#verificación)).
> Falta la Etapa 5 (empaquetado para entrega).

## Requisitos

- Docker Desktop (con Docker Compose v2), para levantar la app y PostgreSQL con un solo comando.
- Node.js 24+ y npm, solo si querés correr la app o los tests fuera de Docker.

## Cómo levantarlo

```bash
docker compose up --build
```

No hace falta crear un `.env`: todas las variables tienen defaults de
desarrollo en `docker-compose.yml`. Al arrancar, el contenedor `app`:

1. Espera a que `db` esté sana (`pg_isready`).
2. Corre las migraciones (`db/migrations/*.sql`, versionadas y sin duplicar en reinicios).
3. Carga el seed de demo (datos sintéticos, idempotente).
4. Levanta el servidor HTTP.

Para comprobar que está funcionando:

```bash
curl http://localhost:3000/api/health
```

```json
{ "status": "ok", "checks": { "database": "ok" } }
```

### Demo de los endpoints

El seed carga 29 logs sintéticos de 4 servicios, todos con `timestamp` dentro
del día `2026-11-01` (UTC). Con la app arriba:

```bash
# Listar con filtros combinados
curl "http://localhost:3000/api/logs?service=payments-api&level=ERROR"
```

```bash
# Ingestar un log nuevo
curl -X POST http://localhost:3000/api/logs \
  -H "Content-Type: application/json" \
  -d '{"service":"demo","level":"INFO","message":"hello","timestamp":"2026-11-06T12:00:00Z"}'
```

```bash
# Analizar el lote sembrado (devuelve 201 + el resultado ya persistido)
curl -X POST http://localhost:3000/api/logs/analyze \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-11-01T00:00:00Z","to":"2026-11-02T00:00:00Z"}'
```

```bash
# Recuperar ese mismo análisis por id (el id viene en la respuesta anterior y en el header Location)
curl http://localhost:3000/api/analysis/<id>
```

Para detenerlo y borrar también los datos:

```bash
docker compose down -v
```

## Cómo correr los tests

```bash
npm ci
npm test
```

| Comando | Qué corre | Necesita Postgres |
|---|---|---|
| `npm test` | Todos los tests | Sí (integración) |
| `npm run test:unit` | Solo unitarios | No |
| `npm run test:integration` | Solo integración | Sí |
| `npm run typecheck` | Verificación de tipos | No |

Los tests de integración usan PostgreSQL real, nunca un mock de base de datos
(ver ARCHITECTURE.md §5). Apuntan a `TEST_DATABASE_URL` (o `DATABASE_URL` si
no está definida). Para levantar solo la base de datos y correrlos desde el
host:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
```

```bash
TEST_DATABASE_URL=postgresql://smartlog:smartlog-dev@localhost:5432/smartlog npm test
```

## Desarrollo local

Para ver los cambios sin reconstruir la imagen, corré la base en Docker y la app en tu máquina:

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
npm run migrate
npm run seed
npm run dev
```

## Puertos y red

| Servicio | Puerto interno | Publicado en el host | Red |
|---|---|---|---|
| `app` | 3000 | `APP_PORT`, por defecto 3000 | `smartlog` |
| `db` | 5432 | No, salvo con `docker-compose.dev.yml` (`DB_PORT`, por defecto 5432, solo en `127.0.0.1`) | `smartlog` |

La app llega a la base por el nombre `db` dentro de la red `smartlog`. Los datos persisten en el volumen `db-data`.

## Variables de entorno

Todas son opcionales con `docker compose up` (tienen default de desarrollo).
Documentadas en [.env.example](.env.example).

| Variable | Default | Para qué sirve |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Dónde escucha la API |
| `DATABASE_URL` | la arma `docker-compose.yml` | Cadena de conexión a PostgreSQL |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `smartlog` / `smartlog-dev` / `smartlog` | Credenciales de desarrollo del contenedor `db` |
| `LOG_LEVEL` | `info` | Nivel de log de la app (Fastify/pino) |
| `HEALTH_DB_TIMEOUT_MS` | `1000` | Presupuesto de `GET /api/health` para decidir si la base no responde |
| `ANALYSIS_TIMEOUT_MS` | `5000` | Timeout del adaptador de análisis |
| `ANALYSIS_MAX_LOGS` | `100` | Tamaño máximo de lote para `POST /api/logs/analyze` |
| `ANALYSIS_MAX_BYTES` | `200000` | Tamaño serializado máximo del lote |
| `LOGS_DEFAULT_LIMIT` / `LOGS_MAX_LIMIT` | `50` / `500` | Límites de `GET /api/logs` |

La app valida su configuración al arrancar: si una variable es inválida, el
proceso no levanta e indica qué variable falló, nunca su valor.

## Verificación

Esto no es una lista de intenciones: se corrió de verdad, desde un **clon
limpio** en un directorio nuevo, el día de la entrega.

```bash
git clone <url-del-repo> smartlog-analyzer-verify && cd smartlog-analyzer-verify
docker compose up --build -d
```

Resultado real (logs del contenedor `app`):

```
[entrypoint] running migrations...
Applied 2 migration(s): 0001_create_logs.sql, 0002_create_analyses.sql
[entrypoint] seeding demo data...
Seed complete: 29 inserted, 0 already present.
[entrypoint] starting server...
{"level":30,...,"msg":"Server listening at http://127.0.0.1:3000"}
```

Demo HTTP real contra ese contenedor (health → seed → ingesta → filtros →
análisis → recuperación por id), en orden:

| Paso | Resultado real |
|---|---|
| `GET /api/health` | `200 {"status":"ok","checks":{"database":"ok"}}` |
| `GET /api/logs?limit=500` | 29 items (el seed, nada de más ni de menos) |
| `POST /api/logs` | `201` con el log creado |
| `GET /api/logs?service=demo-clone&level=WARN` | `200` con exactamente el log recién creado |
| `POST /api/logs/analyze` (rango `2026-11-01`) | `201`, `status:"succeeded"`, 5 categorías detectadas |
| `GET /api/analysis/{id}` | `200` con el mismo resultado persistido |

Tests y typecheck, también desde ese mismo clon limpio:

```bash
npm ci
npm run typecheck   # sin errores
npm test            # 66/66 passing
```

Esto cubre explícitamente lo que pide el enunciado antes de entregar:
`docker compose up` sin pasos adicionales, los tests corriendo con el
comando documentado, y ningún estado previo del entorno de desarrollo
"ensuciando" el resultado.

## Uso de IA durante el desarrollo

Se construyó con Claude Code (Anthropic) como asistente, en una sesión
dirigida e iterativa, no generación de código en bloque sin revisión. Cada
línea entregada fue leída y entendida antes de aceptarse; lo que sigue es un
resumen honesto de qué se aceptó, qué se corrigió y qué se descartó — no una
lista completa de cada prompt.

**Lo que más aportó:**
- Redactar el primer borrador de `ARCHITECTURE.md` (diagrama, modelo,
  contrato) a partir de un brief detallado, para discutirlo y ajustarlo
  antes de escribir código — ahorró el tiempo de armar la estructura desde
  cero y dejó más horas para la implementación y los tests.
- Escribir el *boilerplate* repetitivo (schemas de Fastify, repositorios SQL,
  el error handler centralizado) rápido y de forma consistente entre
  módulos.
- Diseñar los tests de integración para los casos límite de la Etapa 3
  (timeout con resolución tardía sin sobrescritura, violación real de
  constraint para simular un fallo de persistencia) — son los que más
  defienden la robustez pedida en el enunciado.

**Lo que se corrigió o descartó:**
- El primer intento de Etapa 0 (de una sesión anterior) había diseñado un
  flujo **asincrónico** (cola, `202` + polling, RFC 9457). Se descartó por
  completo a favor de un flujo síncrono más simple y verificable en el
  tiempo disponible; queda en la rama `stage-1-walking-skeleton` como
  referencia, sin mergear.
- La primera versión de Etapa 1-2 se escribió sin Docker corriendo en el
  entorno. Al verificarla de verdad contra Postgres real aparecieron 3 bugs
  reales que el *typecheck* no detecta y que se corrigieron antes de seguir:
  Fastify aceptaba y descartaba en silencio campos no declarados del body
  (`removeAdditional`), `Date.parse` no rechazaba fechas de calendario
  inexistentes como el 30 de febrero, y los archivos de test de integración
  corrían en paralelo contra la misma base real, pisándose entre sí con
  `TRUNCATE`.
- Se usó `git merge --allow-unrelated-histories` en vez de `git reset --hard`
  para reconciliar el historial del repo (el entorno bloqueó el `reset
  --hard` por destructivo) — resultado: el historial real de ambos intentos
  de diseño queda visible en vez de reescrito.

**Lección general:** el *typecheck* y la compilación nunca reemplazan correr
contra la base de datos y el contenedor reales — los tres bugs de arriba
pasaron el *typecheck* sin problema y solo aparecieron al ejecutar.

## Qué dejaste afuera (y cómo lo resolvería)

| Qué | Por qué quedó afuera | Cómo lo resolvería |
|---|---|---|
| Idempotencia de `POST /api/logs/analyze` | El enunciado no la exige y el tiempo disponible priorizó la robustez del timeout/validación sobre esto | Aceptar un header `Idempotency-Key` del cliente, `UNIQUE` sobre esa clave en `analyses`, y devolver el registro existente ante un reintento |
| Proveedor de LLM real | El enunciado permite explícitamente un mock; gastar tiempo/dinero en una API key no sumaba valor al desafío | `HttpLlmAdapter` implementando la misma interfaz `AnalysisAdapter` (documentado en ARCHITECTURE.md §4), seleccionable por variable de entorno |
| Paginación por cursor en `GET /api/logs` | El enunciado pide "filtros", no paginación; `limit` acotado alcanza para el prototipo | Cursor por `(timestamp, id)` en vez de `OFFSET`, para no degradar con volumen |
| CI (GitHub Actions) | Extra opcional del enunciado, condicionado a que lo obligatorio ya funcione | Un workflow que corra `npm run typecheck`, levante Postgres como servicio y corra `npm test` en cada push |
| Retención/borrado de logs analizados | Fuera del alcance del prototipo | Revisar la integridad referencial de `analyses.log_ids` (hoy es un array sin FK) antes de permitir borrar logs ya analizados |
| UI | El enunciado pide una API, no una interfaz | No aplica para este desafío |
