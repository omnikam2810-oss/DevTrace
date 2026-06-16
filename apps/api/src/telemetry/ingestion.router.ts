import { Router } from "express";
import {
  dependencyBatchSchema,
  logBatchSchema,
  metricsBatchSchema,
  traceBatchSchema
} from "./ingestion.schemas.js";
import { createIngestAuth } from "./ingest-auth.js";
import type { TelemetryQueues } from "./telemetry.queues.js";

type Dependencies = {
  agentSecret?: string;
  queues: TelemetryQueues;
};

export function createIngestionRouter({ agentSecret, queues }: Dependencies) {
  const router = Router();
  const requireIngestKey = createIngestAuth({ agentSecret });

  router.post("/metrics", requireIngestKey, async (req, res, next) => {
    try {
      const payload = metricsBatchSchema.parse(req.body);
      await queues.metrics.add(payload.batchId, payload, {
        removeOnComplete: 1000,
        removeOnFail: 5000
      });
      res.status(202).json({ accepted: payload.metrics.length });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logs", requireIngestKey, async (req, res, next) => {
    try {
      const payload = logBatchSchema.parse(req.body);
      await queues.logs.add(payload.batchId, payload, {
        removeOnComplete: 1000,
        removeOnFail: 5000
      });
      res.status(202).json({ accepted: payload.logs.length });
    } catch (error) {
      next(error);
    }
  });

  router.post("/traces", requireIngestKey, async (req, res, next) => {
    try {
      const payload = traceBatchSchema.parse(req.body);
      await queues.traces.add(payload.batchId, payload, {
        removeOnComplete: 1000,
        removeOnFail: 5000
      });
      res.status(202).json({ accepted: payload.spans.length });
    } catch (error) {
      next(error);
    }
  });

  router.post("/dependencies", requireIngestKey, async (req, res, next) => {
    try {
      const payload = dependencyBatchSchema.parse(req.body);
      await queues.dependencies.add(payload.batchId, payload, {
        removeOnComplete: 1000,
        removeOnFail: 5000
      });
      res.status(202).json({ accepted: payload.dependencies.length });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
