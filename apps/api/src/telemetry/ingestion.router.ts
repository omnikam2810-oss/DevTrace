import { Router } from "express";
import {
  logBatchSchema,
  metricsBatchSchema,
  traceBatchSchema
} from "./ingestion.schemas.js";
import type { TelemetryQueues } from "./telemetry.queues.js";

type Dependencies = {
  queues: TelemetryQueues;
};

export function createIngestionRouter({ queues }: Dependencies) {
  const router = Router();

  router.post("/metrics", async (req, res, next) => {
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

  router.post("/logs", async (req, res, next) => {
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

  router.post("/traces", async (req, res, next) => {
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

  return router;
}

