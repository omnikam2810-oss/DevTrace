import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ensureDefaultProject, prisma } from "./db.js";

const stateSchema = z.object({
  state: z.enum(["TRIGGERED", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "CLOSED"])
});

const incidentPatchSchema = z.object({
  state: z.enum(["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"]).optional(),
  rootCause: z.string().optional(),
  resolutionNotes: z.string().optional()
});

const deploymentSchema = z.object({
  serviceName: z.string().min(1).max(120),
  environment: z.enum(["DEVELOPMENT", "TESTING", "STAGING", "PRODUCTION"]),
  version: z.string().min(1).max(80),
  commitSha: z.string().max(120).optional(),
  deployedBy: z.string().max(120).optional(),
  metadata: z.record(z.unknown()).optional()
});

export function createOperationsRouter() {
  const router = Router();

  router.get("/services", async (_req, res, next) => {
    try {
      const services = await prisma.service.findMany({
        orderBy: [{ status: "asc" }, { name: "asc" }],
        include: {
          metrics: { orderBy: { timestamp: "desc" }, take: 1 },
          logs: { orderBy: { timestamp: "desc" }, take: 3 },
          spans: { orderBy: { startedAt: "desc" }, take: 3 }
        }
      });
      res.json(services.map((service) => ({
        id: service.id,
        name: service.name,
        environment: service.environment,
        version: service.version,
        status: service.status,
        owner: service.owner,
        healthScore: service.healthScore,
        lastSeenAt: service.lastSeenAt,
        latestMetric: service.metrics[0] ?? null,
        recentLogs: service.logs,
        recentSpans: service.spans
      })));
    } catch (error) {
      next(error);
    }
  });

  router.get("/services/:serviceId/detail", async (req, res, next) => {
    try {
      const service = await prisma.service.findUnique({
        where: { id: req.params.serviceId },
        include: {
          metrics: {
            orderBy: { timestamp: "desc" },
            take: 24
          },
          logs: {
            orderBy: { timestamp: "desc" },
            take: 25
          },
          spans: {
            include: { trace: true },
            orderBy: { startedAt: "desc" },
            take: 25
          },
          dependenciesOut: {
            include: { target: true },
            orderBy: { lastSeenAt: "desc" }
          },
          dependenciesIn: {
            include: { source: true },
            orderBy: { lastSeenAt: "desc" }
          },
          deployments: {
            orderBy: { createdAt: "desc" },
            take: 10
          }
        }
      });

      if (!service) {
        res.status(404).json({ error: "Service not found" });
        return;
      }

      const alerts = await prisma.alert.findMany({
        where: { serviceId: service.id },
        orderBy: { triggeredAt: "desc" },
        take: 25
      });

      res.json({
        id: service.id,
        name: service.name,
        environment: service.environment,
        version: service.version,
        owner: service.owner,
        status: service.status,
        healthScore: service.healthScore,
        lastSeenAt: service.lastSeenAt,
        repositoryUrl: service.repositoryUrl,
        metrics: service.metrics.map((metric) => ({
          id: metric.id,
          timestamp: metric.timestamp,
          cpuPercent: metric.cpuPercent,
          memoryPercent: metric.memoryPercent,
          diskPercent: metric.diskPercent,
          requestCount: metric.requestCount,
          errorCount: metric.errorCount,
          avgLatencyMs: metric.avgLatencyMs,
          throughputRpm: metric.throughputRpm
        })),
        logs: service.logs.map((log) => ({
          id: log.id,
          timestamp: log.timestamp,
          level: log.level,
          message: log.message,
          traceId: log.traceId,
          spanId: log.spanId,
          attributes: log.attributes,
          service: service.name
        })),
        traces: service.spans.map((span) => ({
          id: span.traceId,
          spanId: span.id,
          name: span.name,
          startedAt: span.startedAt,
          durationMs: span.durationMs,
          status: span.status,
          traceStatus: span.trace.status
        })),
        alerts,
        dependenciesOut: service.dependenciesOut.map((dependency) => ({
          id: dependency.id,
          service: dependency.target.name,
          direction: "outbound",
          protocol: dependency.protocol,
          endpoint: dependency.endpoint,
          callCount: dependency.callCount,
          errorRate: dependency.errorRate,
          avgLatencyMs: dependency.avgLatencyMs,
          lastSeenAt: dependency.lastSeenAt
        })),
        dependenciesIn: service.dependenciesIn.map((dependency) => ({
          id: dependency.id,
          service: dependency.source.name,
          direction: "inbound",
          protocol: dependency.protocol,
          endpoint: dependency.endpoint,
          callCount: dependency.callCount,
          errorRate: dependency.errorRate,
          avgLatencyMs: dependency.avgLatencyMs,
          lastSeenAt: dependency.lastSeenAt
        })),
        deployments: service.deployments.map((deployment) => ({
          id: deployment.id,
          version: deployment.version,
          commitSha: deployment.commitSha,
          environment: deployment.environment,
          deployedBy: deployment.deployedBy,
          metadata: deployment.metadata,
          createdAt: deployment.createdAt
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/logs", async (req, res, next) => {
    try {
      const query = z.object({
        service: z.string().optional(),
        level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).optional(),
        q: z.string().optional(),
        take: z.coerce.number().int().min(1).max(200).default(80)
      }).parse(req.query);

      const logs = await prisma.logEvent.findMany({
        where: {
          level: query.level,
          message: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
          service: query.service ? { name: query.service } : undefined
        },
        include: { service: true },
        orderBy: { timestamp: "desc" },
        take: query.take
      });

      res.json(logs.map((log) => ({
        id: log.id,
        timestamp: log.timestamp,
        level: log.level,
        message: log.message,
        traceId: log.traceId,
        spanId: log.spanId,
        attributes: log.attributes,
        service: log.service.name
      })));
    } catch (error) {
      next(error);
    }
  });

  router.get("/traces", async (req, res, next) => {
    try {
      const query = z.object({
        status: z.enum(["OK", "ERROR", "TIMEOUT", "CANCELLED"]).optional(),
        minDurationMs: z.coerce.number().nonnegative().optional(),
        take: z.coerce.number().int().min(1).max(100).default(50)
      }).parse(req.query);

      const traces = await prisma.trace.findMany({
        where: {
          status: query.status,
          durationMs: query.minDurationMs ? { gte: query.minDurationMs } : undefined
        },
        include: {
          spans: {
            include: { service: true },
            orderBy: { startedAt: "asc" }
          }
        },
        orderBy: { startedAt: "desc" },
        take: query.take
      });

      res.json(traces.map((trace) => ({
        id: trace.id,
        rootService: trace.rootService,
        startedAt: trace.startedAt,
        durationMs: trace.durationMs,
        status: trace.status,
        services: [...new Set(trace.spans.map((span) => span.service.name))],
        spanCount: trace.spans.length,
        slowestSpan: [...trace.spans].sort((a, b) => b.durationMs - a.durationMs)[0] ?? null
      })));
    } catch (error) {
      next(error);
    }
  });

  router.get("/traces/:traceId", async (req, res, next) => {
    try {
      const trace = await prisma.trace.findUnique({
        where: { id: req.params.traceId },
        include: {
          spans: {
            include: { service: true },
            orderBy: { startedAt: "asc" }
          }
        }
      });

      if (!trace) {
        res.status(404).json({ error: "Trace not found" });
        return;
      }

      res.json({
        ...trace,
        criticalPath: [...trace.spans].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
        waterfall: trace.spans.map((span) => ({
          id: span.id,
          parentSpanId: span.parentSpanId,
          service: span.service.name,
          name: span.name,
          durationMs: span.durationMs,
          status: span.status,
          startedAt: span.startedAt,
          attributes: span.attributes
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/alerts", async (_req, res, next) => {
    try {
      const alerts = await prisma.alert.findMany({
        include: { incident: true },
        orderBy: { triggeredAt: "desc" },
        take: 100
      });
      res.json(alerts);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/alerts/:alertId/state", async (req, res, next) => {
    try {
      const { state } = stateSchema.parse(req.body);
      const alert = await prisma.alert.update({
        where: { id: req.params.alertId },
        data: {
          state,
          resolvedAt: ["RESOLVED", "CLOSED"].includes(state) ? new Date() : undefined
        }
      });
      res.json(alert);
    } catch (error) {
      next(error);
    }
  });

  router.get("/incidents", async (_req, res, next) => {
    try {
      const incidents = await prisma.incident.findMany({
        include: { alerts: true },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      res.json(incidents);
    } catch (error) {
      next(error);
    }
  });

  router.post("/incidents", async (req, res, next) => {
    try {
      const project = await ensureDefaultProject();
      const body = z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        severity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("WARNING")
      }).parse(req.body);

      const incident = await prisma.incident.create({
        data: {
          projectId: project.id,
          title: body.title,
          description: body.description,
          severity: body.severity,
          timeline: [{ at: new Date().toISOString(), event: "Incident opened manually" }]
        }
      });
      res.status(201).json(incident);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/incidents/:incidentId", async (req, res, next) => {
    try {
      const body = incidentPatchSchema.parse(req.body);
      const existing = await prisma.incident.findUnique({ where: { id: req.params.incidentId } });
      if (!existing) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      const timeline = Array.isArray(existing.timeline) ? existing.timeline : [];
      const incident = await prisma.incident.update({
        where: { id: existing.id },
        data: {
          ...body,
          timeline: [
            ...timeline,
            { at: new Date().toISOString(), event: `Incident updated${body.state ? ` to ${body.state}` : ""}` }
          ]
        }
      });
      res.json(incident);
    } catch (error) {
      next(error);
    }
  });

  router.get("/topology", async (_req, res, next) => {
    try {
      const services = await prisma.service.findMany({
        include: {
          dependenciesOut: true,
          metrics: { orderBy: { timestamp: "desc" }, take: 1 }
        },
        orderBy: { name: "asc" }
      });

      const edges = services.flatMap((service) => service.dependenciesOut.map((dependency) => ({
        id: dependency.id,
        source: dependency.sourceServiceId,
        target: dependency.targetServiceId,
        protocol: dependency.protocol,
        endpoint: dependency.endpoint,
        callCount: dependency.callCount,
        errorRate: dependency.errorRate,
        avgLatencyMs: dependency.avgLatencyMs
      })));

      res.json({
        nodes: services.map((service) => ({
          id: service.id,
          label: service.name,
          status: service.status,
          healthScore: service.healthScore,
          latency: service.metrics[0]?.avgLatencyMs ?? 0
        })),
        edges
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/deployments", async (_req, res, next) => {
    try {
      const deployments = await prisma.deployment.findMany({
        include: { service: true },
        orderBy: { createdAt: "desc" },
        take: 100
      });

      res.json(deployments.map((deployment) => ({
        id: deployment.id,
        serviceId: deployment.serviceId,
        service: deployment.service.name,
        version: deployment.version,
        commitSha: deployment.commitSha,
        environment: deployment.environment,
        deployedBy: deployment.deployedBy,
        metadata: deployment.metadata,
        createdAt: deployment.createdAt
      })));
    } catch (error) {
      next(error);
    }
  });

  router.get("/services/:serviceId/deployments", async (req, res, next) => {
    try {
      const deployments = await prisma.deployment.findMany({
        where: { serviceId: req.params.serviceId },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      res.json(deployments);
    } catch (error) {
      next(error);
    }
  });

  router.post("/deployments", async (req, res, next) => {
    try {
      const body = deploymentSchema.parse(req.body);
      const project = await ensureDefaultProject();
      const service = await prisma.service.upsert({
        where: {
          projectId_name_environment: {
            projectId: project.id,
            name: body.serviceName,
            environment: body.environment
          }
        },
        update: {
          version: body.version,
          lastSeenAt: new Date()
        },
        create: {
          projectId: project.id,
          name: body.serviceName,
          environment: body.environment,
          version: body.version,
          status: "OFFLINE",
          healthScore: 0,
          lastSeenAt: new Date()
        }
      });

      const deployment = await prisma.deployment.create({
        data: {
          serviceId: service.id,
          version: body.version,
          commitSha: body.commitSha,
          environment: body.environment,
          deployedBy: body.deployedBy,
          metadata: toJson(body.metadata)
        }
      });

      const openIncidents = await prisma.incident.findMany({
        where: {
          state: { in: ["OPEN", "INVESTIGATING"] },
          impactedServices: { array_contains: body.serviceName }
        },
        take: 10
      });

      await Promise.all(openIncidents.map((incident) => {
        const timeline = Array.isArray(incident.timeline) ? incident.timeline : [];
        return prisma.incident.update({
          where: { id: incident.id },
          data: {
            timeline: [
              ...timeline,
              {
                at: deployment.createdAt.toISOString(),
                event: `Deployment ${body.version} recorded for ${body.serviceName}`
              }
            ]
          }
        });
      }));

      res.status(201).json({
        id: deployment.id,
        serviceId: service.id,
        service: service.name,
        version: deployment.version,
        commitSha: deployment.commitSha,
        environment: deployment.environment,
        deployedBy: deployment.deployedBy,
        metadata: deployment.metadata,
        createdAt: deployment.createdAt
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/reports", async (_req, res, next) => {
    try {
      const reports = await prisma.report.findMany({
        orderBy: { createdAt: "desc" },
        take: 30
      });
      res.json(reports);
    } catch (error) {
      next(error);
    }
  });

  router.post("/reports", async (_req, res, next) => {
    try {
      const project = await ensureDefaultProject();
      const [serviceCount, alertCount, incidentCount, latestMetrics] = await Promise.all([
        prisma.service.count(),
        prisma.alert.count(),
        prisma.incident.count(),
        prisma.serviceMetric.findMany({ orderBy: { timestamp: "desc" }, take: 25 })
      ]);

      const report = await prisma.report.create({
        data: {
          projectId: project.id,
          period: "manual",
          title: `Reliability report ${new Date().toLocaleString("en-US")}`,
          format: "json",
          summary: {
            serviceCount,
            alertCount,
            incidentCount,
            metricSamples: latestMetrics.length,
            generatedAt: new Date().toISOString()
          }
        }
      });

      res.status(201).json(report);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined {
  return value as Prisma.InputJsonObject | undefined;
}
