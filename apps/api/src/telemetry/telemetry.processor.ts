import type { Job, Worker } from "bullmq";
import type { Prisma } from "@prisma/client";
import { Worker as BullWorker } from "bullmq";
import { prisma, ensureDefaultProject } from "../db.js";
import { publishRealtime } from "../realtime.js";
import { calculateHealthScore } from "./health-score.js";
import type { DependencyBatch, LogBatch, MetricsBatch, TraceBatch } from "./ingestion.schemas.js";
import { createRedisConnection } from "./telemetry.queues.js";

type TelemetryWorker = Worker;

export function startTelemetryProcessors(redisUrl: string) {
  const connection = createRedisConnection(redisUrl);
  const workers: TelemetryWorker[] = [
    new BullWorker<MetricsBatch>("metrics.ingest", processMetrics, { connection }),
    new BullWorker<LogBatch>("logs.ingest", processLogs, { connection }),
    new BullWorker<TraceBatch>("traces.ingest", processTraces, { connection }),
    new BullWorker<DependencyBatch>("dependencies.ingest", processDependencies, { connection })
  ];

  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      console.error(`Telemetry job failed: ${job?.queueName ?? "unknown"} ${job?.id ?? "unknown"}`, error);
    });
  }

  return workers;
}

async function resolveService(batch: MetricsBatch | LogBatch | TraceBatch | DependencyBatch) {
  const project = await ensureDefaultProject();

  return prisma.service.upsert({
    where: {
      projectId_name_environment: {
        projectId: project.id,
        name: batch.service.name,
        environment: batch.service.environment
      }
    },
    update: {
      version: batch.service.version,
      lastSeenAt: new Date(),
      status: "HEALTHY"
    },
    create: {
      projectId: project.id,
      name: batch.service.name,
      environment: batch.service.environment,
      version: batch.service.version,
      lastSeenAt: new Date(),
      status: "HEALTHY",
      healthScore: 100
    }
  });
}

async function processMetrics(job: Job<MetricsBatch>) {
  const service = await resolveService(job.data);
  const metrics = job.data.metrics.map((metric) => ({
    serviceId: service.id,
    timestamp: new Date(metric.timestamp),
    cpuPercent: metric.cpuPercent,
    memoryPercent: metric.memoryPercent,
    diskPercent: metric.diskPercent,
    requestCount: metric.requestCount,
    errorCount: metric.errorCount,
    avgLatencyMs: metric.avgLatencyMs,
    p50LatencyMs: metric.p50LatencyMs,
    p95LatencyMs: metric.p95LatencyMs,
    p99LatencyMs: metric.p99LatencyMs,
    throughputRpm: metric.throughputRpm,
    statusCodes: metric.statusCodes
  }));

  await prisma.serviceMetric.createMany({ data: metrics });

  const latest = job.data.metrics.at(-1);
  const healthScore = calculateHealthScore({
    latencyMs: latest?.avgLatencyMs,
    errorRate: latest && latest.requestCount > 0 ? latest.errorCount / latest.requestCount : undefined,
    cpuPercent: latest?.cpuPercent,
    memoryPercent: latest?.memoryPercent,
    diskPercent: latest?.diskPercent,
    lastSeenAgeSec: 0
  });

  await prisma.service.update({
    where: { id: service.id },
    data: {
      healthScore,
      status: statusFromScore(healthScore),
      lastSeenAt: new Date()
    }
  });

  await evaluateAlerts(service.id, service.name, healthScore, latest);
  publishRealtime("service.health.updated", { serviceId: service.id, healthScore });
  publishRealtime("metrics.timeseries.appended", { serviceId: service.id, metrics: job.data.metrics });
}

async function processLogs(job: Job<LogBatch>) {
  const service = await resolveService(job.data);

  await prisma.logEvent.createMany({
    data: job.data.logs.map((log) => ({
      serviceId: service.id,
      timestamp: new Date(log.timestamp),
      level: log.level,
      message: log.message,
      traceId: log.traceId,
      spanId: log.spanId,
      attributes: toJson(log.attributes)
    }))
  });
  publishRealtime("logs.appended", { serviceId: service.id, logs: job.data.logs });
}

async function processTraces(job: Job<TraceBatch>) {
  const service = await resolveService(job.data);
  const project = await ensureDefaultProject();

  for (const span of job.data.spans) {
    await prisma.trace.upsert({
      where: { id: span.traceId },
      update: {
        durationMs: { increment: span.durationMs },
        status: span.status === "OK" ? undefined : span.status
      },
      create: {
        id: span.traceId,
        projectId: project.id,
        rootService: service.name,
        startedAt: new Date(span.startedAt),
        durationMs: span.durationMs,
        status: span.status
      }
    });

    await prisma.span.upsert({
      where: { id: span.spanId },
      update: {
        durationMs: span.durationMs,
        status: span.status,
        attributes: toJson(span.attributes)
      },
      create: {
        id: span.spanId,
        traceId: span.traceId,
        parentSpanId: span.parentSpanId,
        serviceId: service.id,
        name: span.name,
        kind: span.kind,
        startedAt: new Date(span.startedAt),
        durationMs: span.durationMs,
        status: span.status,
        attributes: toJson(span.attributes)
      }
    });
  }
  publishRealtime("trace.completed", { serviceId: service.id, spans: job.data.spans });
}

async function processDependencies(job: Job<DependencyBatch>) {
  const source = await resolveService(job.data);
  const project = await ensureDefaultProject();

  for (const dependency of job.data.dependencies) {
    const target = await prisma.service.upsert({
      where: {
        projectId_name_environment: {
          projectId: project.id,
          name: dependency.target.name,
          environment: dependency.target.environment
        }
      },
      update: {
        version: dependency.target.version,
        lastSeenAt: new Date()
      },
      create: {
        projectId: project.id,
        name: dependency.target.name,
        environment: dependency.target.environment,
        version: dependency.target.version,
        status: "OFFLINE",
        healthScore: 0,
        lastSeenAt: new Date()
      }
    });

    await prisma.serviceDependency.upsert({
      where: {
        sourceServiceId_targetServiceId_endpoint: {
          sourceServiceId: source.id,
          targetServiceId: target.id,
          endpoint: dependency.endpoint ?? ""
        }
      },
      update: {
        protocol: dependency.protocol,
        callCount: { increment: dependency.callCount },
        errorRate: dependency.errorRate,
        avgLatencyMs: dependency.avgLatencyMs,
        lastSeenAt: new Date()
      },
      create: {
        sourceServiceId: source.id,
        targetServiceId: target.id,
        protocol: dependency.protocol,
        endpoint: dependency.endpoint ?? "",
        callCount: dependency.callCount,
        errorRate: dependency.errorRate,
        avgLatencyMs: dependency.avgLatencyMs
      }
    });
  }

  publishRealtime("topology.updated", { sourceServiceId: source.id });
}

function statusFromScore(score: number) {
  if (score >= 90) {
    return "HEALTHY";
  }
  if (score >= 75) {
    return "WARNING";
  }
  if (score >= 50) {
    return "DEGRADED";
  }
  return "CRITICAL";
}

async function evaluateAlerts(
  serviceId: string,
  serviceName: string,
  healthScore: number,
  latest: MetricsBatch["metrics"][number] | undefined
) {
  if (!latest) {
    return;
  }

  const requestErrorRate = latest.requestCount > 0 ? latest.errorCount / latest.requestCount : 0;
  const conditions = [
    {
      active: healthScore < 50,
      severity: "CRITICAL" as const,
      title: `${serviceName} health is critical`,
      description: `Health score dropped to ${healthScore}.`
    },
    {
      active: requestErrorRate >= 0.05,
      severity: "CRITICAL" as const,
      title: `${serviceName} error rate is high`,
      description: `Error rate is ${(requestErrorRate * 100).toFixed(2)}%.`
    },
    {
      active: (latest.avgLatencyMs ?? 0) >= 500,
      severity: "WARNING" as const,
      title: `${serviceName} latency is elevated`,
      description: `Average latency is ${latest.avgLatencyMs} ms.`
    },
    {
      active: (latest.cpuPercent ?? 0) >= 85,
      severity: "WARNING" as const,
      title: `${serviceName} CPU usage is high`,
      description: `CPU usage is ${latest.cpuPercent}%.`
    }
  ];

  for (const condition of conditions.filter((item) => item.active)) {
    const existing = await prisma.alert.findFirst({
      where: {
        serviceId,
        title: condition.title,
        state: { in: ["TRIGGERED", "ACKNOWLEDGED", "INVESTIGATING"] }
      }
    });

    if (existing) {
      continue;
    }

    const alert = await prisma.alert.create({
      data: {
        serviceId,
        title: condition.title,
        description: condition.description,
        severity: condition.severity,
        metadata: {
          healthScore,
          requestErrorRate,
          avgLatencyMs: latest.avgLatencyMs,
          cpuPercent: latest.cpuPercent
        }
      }
    });

    publishRealtime("alert.triggered", alert);

    if (condition.severity === "CRITICAL") {
      const project = await ensureDefaultProject();
      const incident = await prisma.incident.create({
        data: {
          projectId: project.id,
          title: condition.title,
          description: condition.description,
          severity: "CRITICAL",
          impactedServices: [serviceName],
          timeline: [
            { at: new Date().toISOString(), event: condition.description },
            { at: new Date().toISOString(), event: `Alert ${alert.id} opened` }
          ],
          alerts: {
            connect: { id: alert.id }
          }
        }
      });
      publishRealtime("incident.updated", incident);
    }
  }
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined {
  return value as Prisma.InputJsonObject | undefined;
}
