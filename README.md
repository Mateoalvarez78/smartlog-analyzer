# SmartLog Analyzer

Herramienta interna que recibe logs de varios microservicios, los almacena y usa un LLM para detectar patrones. Las decisiones técnicas están en [ARCHITECTURE.md](ARCHITECTURE.md).

> **Estado:** en desarrollo. Por ahora funcionan el arranque, las migraciones y `GET /api/health`.

## Requisitos

- Docker con Docker Compose, para levantar el proyecto y correr los tests de integración.
- Node.js 26, solo para desarrollar o correr los tests fuera de Docker.

## Cómo levantarlo

```bash
docker compose up --build
```

No hace falta crear un `.env`. Para comprobar que está funcionando:

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

| Comando | Qué corre | Necesita Docker |
|---|---|---|
| `npm test` | Todos los tests | Sí |
| `npm run test:unit` | Solo unitarios | No |
| `npm run test:integration` | Solo integración, con un Postgres descartable | Sí |
| `npm run typecheck` | Verificación de tipos | No |

## Desarrollo local

Para ver los cambios sin reconstruir la imagen, se corre la base en Docker y la app en tu máquina:

```bash
cp .env.example .env
```

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
```

```bash
npm run dev
```

## Puertos y red

| Servicio | Puerto interno | Publicado en el host | Red |
|---|---|---|---|
| `app` | 3000 | `APP_PORT`, por defecto 3000 | `smartlog` |
| `db` | 5432 | No se publica, salvo con `docker-compose.dev.yml` | `smartlog` |

La app llega a la base por el nombre `db` dentro de la red `smartlog`. Los datos persisten en el volumen `db-data`.

## Variables de entorno

Todas son opcionales con `docker compose up`. Están listadas en [.env.example](.env.example).

| Variable | Valor por defecto | Para qué sirve |
|---|---|---|
| `APP_PORT` | `3000` | Puerto de la API en el host |
| `POSTGRES_USER` | `smartlog` | Usuario de la base |
| `POSTGRES_PASSWORD` | `smartlog-dev` | Contraseña de la base, solo para desarrollo |
| `POSTGRES_DB` | `smartlog` | Nombre de la base |
| `LOG_LEVEL` | `info` | Nivel de los logs de la aplicación |
| `DATABASE_URL` | La arma compose | Solo se define a mano con `npm run dev` |
| `DB_PORT` | `5432` | Solo con `docker-compose.dev.yml` |
| `PORT` | `3000` | Puerto donde escucha la app; solo se cambia con `npm run dev` |
| `HOST` | `0.0.0.0` | Interfaz donde escucha la app; solo se cambia con `npm run dev` |

La app valida su configuración al arrancar: si un valor es inválido, se detiene e indica qué variable falló, sin mostrar su contenido.
