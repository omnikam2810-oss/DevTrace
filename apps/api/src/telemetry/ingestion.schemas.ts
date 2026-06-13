import { z } from "zod";

export const environmentSchema = z.enum([
  "DEVELOPMENT",
  "TESTING",
  "STAGING",
  "PRODUCTION"
]);

export const serviceIdentitySchema = z.object({
  name: z.string().min(1).max(120),
  environment: environmentSchema,
  version: z.string().max(80).optional()
});

export const metricPointSchema = z.object({
  timestamp: z.string().datetime(),
  cpuPercent: z.number().min(0).max(100).optional(),
  memoryPercent: z.number().min(0).max(100).optional(),
  diskPercent: z.number().min(0).max(100).optional(),
  requestCount: z.number().int().nonnegative().default(0),
  errorCount: z.number().int().nonnegative().default(0),
  avgLatencyMs: z.number().nonnegative().optional(),
  p50LatencyMs: z.number().nonnegative().optional(),
  p95LatencyMs: z.number().nonnegative().optional(),
  p99LatencyMs: z.number().nonnegative().optional(),
  throughputRpm: z.number().nonnegative().optional(),
  statusCodes: z.record(z.string(), z.number().int().nonnegative()).optional()
});

export const metricsBatchSchema = z.object({
  service: serviceIdentitySchema,
  batchId: z.string().min(8).max(128),
  metrics: z.array(metricPointSchema).min(1).max(1000)
});

export const logBatchSchema = z.object({
  service: serviceIdentitySchema,
  batchId: z.string().min(8).max(128),
  logs: z.array(z.object({
    timestamp: z.string().datetime(),
    level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
    message: z.string().min(1).max(16000),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    attributes: z.record(z.unknown()).optional()
  })).min(1).max(1000)
});

export const traceBatchSchema = z.object({
  service: serviceIdentitySchema,
  batchId: z.string().min(8).max(128),
  spans: z.array(z.object({
    traceId: z.string().min(1),
    spanId: z.string().min(1),
    parentSpanId: z.string().optional(),
    name: z.string().min(1).max(240),
    kind: z.string().optional(),
    startedAt: z.string().datetime(),
    durationMs: z.number().nonnegative(),
    status: z.enum(["OK", "ERROR", "TIMEOUT", "CANCELLED"]).default("OK"),
    attributes: z.record(z.unknown()).optional()
  })).min(1).max(2000)
});

export const dependencyBatchSchema = z.object({
  service: serviceIdentitySchema,
  batchId: z.string().min(8).max(128),
  dependencies: z.array(z.object({
    target: serviceIdentitySchema,
    protocol: z.string().max(40).optional(),
    endpoint: z.string().max(240).optional(),
    callCount: z.number().int().nonnegative().default(0),
    errorRate: z.number().min(0).max(1).default(0),
    avgLatencyMs: z.number().nonnegative().optional()
  })).min(1).max(1000)
});

export type MetricsBatch = z.infer<typeof metricsBatchSchema>;
export type LogBatch = z.infer<typeof logBatchSchema>;
export type TraceBatch = z.infer<typeof traceBatchSchema>;
export type DependencyBatch = z.infer<typeof dependencyBatchSchema>;
