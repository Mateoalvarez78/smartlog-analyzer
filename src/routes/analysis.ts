import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { runAnalysis } from "../analysis/orchestrator.js";
import { getAnalysisById, isValidAnalysisId } from "../analysis/repository.js";
import { postAnalyzeBodySchema } from "../analysis/schema.js";
import type { AnalysisAdapter } from "../analysis/types.js";
import type { AppConfig } from "../config.js";
import { badRequest, notFound, unprocessable } from "../errors.js";
import type { LogLevel } from "../logs/types.js";
import { assertValidTimestamp } from "../time.js";

interface PostAnalyzeBody {
  from: string;
  to: string;
  service?: string;
  level?: LogLevel;
}

export function registerAnalysisRoutes(app: FastifyInstance, pool: Pool, config: AppConfig, adapter: AnalysisAdapter): void {
  app.post<{ Body: PostAnalyzeBody }>(
    "/api/logs/analyze",
    { schema: { body: postAnalyzeBodySchema } },
    async (request, reply) => {
      const { from, to, service, level } = request.body;
      assertValidTimestamp(from);
      assertValidTimestamp(to);

      const outcome = await runAnalysis(
        pool,
        config,
        adapter,
        {
          from,
          to,
          ...(service !== undefined ? { service } : {}),
          ...(level !== undefined ? { level } : {}),
        },
        request.log,
      );

      if (outcome.outcome === "rejected") {
        throw unprocessable(outcome.code, outcome.message);
      }

      if (outcome.outcome === "failed") {
        // Extends the standard {error:{code,message}} envelope with
        // analysisId on purpose: the brief requires the failed attempt to
        // stay consultable via GET /api/analysis/{id} (ARCHITECTURE.md §3),
        // and the caller shouldn't have to guess the id to look it up.
        return reply.code(outcome.httpStatus).send({
          error: {
            code: outcome.record.errorCode,
            message:
              outcome.record.errorCode === "ADAPTER_TIMEOUT"
                ? "The analysis adapter did not respond within the configured timeout."
                : "The analysis adapter returned an error or an invalid result.",
          },
          analysisId: outcome.record.id,
        });
      }

      return reply.code(201).header("Location", `/api/analysis/${outcome.record.id}`).send(outcome.record);
    },
  );

  app.get<{ Params: { id: string } }>("/api/analysis/:id", async (request, reply) => {
    const { id } = request.params;
    if (!isValidAnalysisId(id)) {
      throw badRequest("INVALID_ANALYSIS_ID", `"${id}" is not a valid analysis id.`);
    }

    const record = await getAnalysisById(pool, id);
    if (!record) {
      throw notFound("ANALYSIS_NOT_FOUND", `No analysis found with id "${id}".`);
    }

    return reply.code(200).send(record);
  });
}
