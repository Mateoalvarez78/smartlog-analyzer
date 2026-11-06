# SmartLog Analyzer

Prototipo interno que recibe logs de varios microservicios, los almacena y usa un
adaptador de IA (mock determinista, intercambiable por un proveedor real) para
generar un resumen, categorías y sugerencias. Las decisiones técnicas y el
contrato HTTP completo están en [ARCHITECTURE.md](ARCHITECTURE.md).

> **Estado:** en desarrollo (Etapa 1 de 5). Por ahora funcionan el arranque,
> las migraciones, el seed y `GET /api/health`. Ingesta/listado de logs y
> análisis llegan en las próximas etapas.

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

## Uso de IA durante el desarrollo

Se completa en la Etapa 4, con el detalle de qué se aceptó y qué se descartó.

## Qué falta (pendientes)

Se completa en la Etapa 4 con el estado final. Por ahora, fuera de alcance
documentado en [ARCHITECTURE.md §8](ARCHITECTURE.md#8-fuera-de-alcance-documentado-no-implementado).
