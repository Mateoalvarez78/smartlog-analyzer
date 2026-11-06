import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { AppError } from "./errors.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerLogsRoutes } from "./routes/logs.js";

export function buildApp(config: AppConfig, pool: Pool): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
    // Fastify's AJV default silently strips unknown body/query properties
    // instead of failing `additionalProperties: false`. Disabling that
    // makes an unexpected field a real 400 instead of a silently-dropped
    // typo (e.g. a client sending "sevice" would otherwise lose data
    // without any indication).
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }

    if (error.validation) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: "The request does not match the expected schema." },
      });
    }

    app.log.error(error);
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error." },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });

  registerHealthRoute(app, pool, config.healthDbTimeoutMs);
  registerLogsRoutes(app, pool, config);

  return app;
}
