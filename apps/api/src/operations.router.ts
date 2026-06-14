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

const csvImportSchema = z.object({
  type: z.enum(["services", "deployments", "incidents", "logs", "metrics"]),
  csv: z.string().min(1)
});

export function createOperationsRouter() {
  const router = Router();

  router.get("/sources", (_req, res) => {
    res.json([
      {
        id: "demo",
        name: "Demo Data",
        description: "Populate DevTrace with realistic sample telemetry in one click.",
        status: "ready"
      },
      {
        id: "agent",
        name: "Node Agent",
        description: "Use one setup command to monitor a Node service.",
        status: "guide"
      },
      {
        id: "webhook",
        name: "Webhook",
        description: "Send deployments or custom events from CI/CD tools.",
        status: "ready"
      },
      {
        id: "csv",
        name: "CSV Import",
        description: "Import services, deployments, incidents, logs, or metrics from a spreadsheet.",
        status: "ready"
      }
    ]);
  });

  router.get("/sources/agent/setup", (_req, res) => {
    res.json({
      command: "npx devtrace-agent setup --endpoint http://localhost:4000 --service checkout-api --env production",
      env: {
        DEVTRACE_ENDPOINT: "http://localhost:4000",
        DEVTRACE_SERVICE: "checkout-api",
        DEVTRACE_ENVIRONMENT: "PRODUCTION"
      },
      steps: [
        "Run the command in the app you want to monitor.",
        "Confirm the service name and environment.",
        "Restart the app so the agent can begin sending telemetry."
      ]
    });
  });

  router.post("/sources/webhook/deployment", async (req, res, next) => {
    try {
      const body = deploymentSchema.parse(req.body);
      const deployment = await createDeployment(body);
      res.status(201).json(deployment);
    } catch (error) {
      next(error);
    }
  });

  router.post("/sources/csv/import", async (req, res, next) => {
    try {
      const body = csvImportSchema.parse(req.body);
      const rows = parseCsv(body.csv);
      const result = await importCsvRows(body.type, rows);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

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

  router.get("/incidents/:incidentId/timeline", async (req, res, next) => {
    try {
      const incident = await prisma.incident.findUnique({
        where: { id: req.params.incidentId },
        include: { alerts: true }
      });

      if (!incident) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      const impactedNames = asStringArray(incident.impactedServices);
      const alertServiceIds = incident.alerts
        .map((alert) => alert.serviceId)
        .filter((serviceId): serviceId is string => Boolean(serviceId));

      const serviceFilters = [
        alertServiceIds.length > 0 ? { id: { in: alertServiceIds } } : undefined,
        impactedNames.length > 0 ? { name: { in: impactedNames } } : undefined
      ].filter((filter): filter is { id: { in: string[] } } | { name: { in: string[] } } => Boolean(filter));

      const services = serviceFilters.length > 0
        ? await prisma.service.findMany({ where: { OR: serviceFilters } })
        : [];
      const serviceIds = services.map((service) => service.id);

      const [deployments, logs, spans, metrics] = serviceIds.length > 0
        ? await Promise.all([
          prisma.deployment.findMany({
            where: { serviceId: { in: serviceIds } },
            include: { service: true },
            orderBy: { createdAt: "desc" },
            take: 25
          }),
          prisma.logEvent.findMany({
            where: {
              serviceId: { in: serviceIds },
              level: { in: ["WARN", "ERROR"] }
            },
            include: { service: true },
            orderBy: { timestamp: "desc" },
            take: 25
          }),
          prisma.span.findMany({
            where: {
              serviceId: { in: serviceIds },
              OR: [
                { status: { not: "OK" } },
                { durationMs: { gte: 500 } }
              ]
            },
            include: { service: true, trace: true },
            orderBy: { startedAt: "desc" },
            take: 25
          }),
          prisma.serviceMetric.findMany({
            where: { serviceId: { in: serviceIds } },
            include: { service: true },
            orderBy: { timestamp: "desc" },
            take: 50
          })
        ])
        : [[], [], [], []] as const;

      const timeline = [
        {
          id: `${incident.id}-created`,
          timestamp: incident.createdAt,
          type: "incident",
          title: "Incident opened",
          description: incident.description,
          severity: incident.severity,
          service: impactedNames.join(", ") || undefined
        },
        ...timelineEntries(incident.timeline).map((entry, index) => ({
          id: `${incident.id}-timeline-${index}`,
          timestamp: entry.at,
          type: "incident",
          title: entry.event,
          description: "Incident timeline entry",
          severity: incident.severity,
          service: impactedNames.join(", ") || undefined
        })),
        ...incident.alerts.map((alert) => ({
          id: alert.id,
          timestamp: alert.triggeredAt,
          type: "alert",
          title: alert.title,
          description: alert.description,
          severity: alert.severity,
          service: services.find((service) => service.id === alert.serviceId)?.name
        })),
        ...deployments.map((deployment) => ({
          id: deployment.id,
          timestamp: deployment.createdAt,
          type: "deployment",
          title: `Deployment ${deployment.version}`,
          description: deployment.commitSha ? `Commit ${deployment.commitSha}` : "Deployment recorded",
          severity: "INFO",
          service: deployment.service.name
        })),
        ...logs.map((log) => ({
          id: log.id,
          timestamp: log.timestamp,
          type: "log",
          title: `${log.level}: ${log.message}`,
          description: log.traceId ? `Trace ${log.traceId}` : "Log evidence",
          severity: log.level === "ERROR" ? "CRITICAL" : "WARNING",
          service: log.service.name
        })),
        ...spans.map((span) => ({
          id: span.id,
          timestamp: span.startedAt,
          type: "trace",
          title: `${span.name} ${span.durationMs.toFixed(1)} ms`,
          description: `Trace ${span.traceId} / ${span.status}`,
          severity: span.status === "OK" ? "WARNING" : "CRITICAL",
          service: span.service.name
        })),
        ...metrics.flatMap((metric) => metricEvidence(metric))
      ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      res.json({
        incident: {
          id: incident.id,
          title: incident.title,
          description: incident.description,
          severity: incident.severity,
          state: incident.state,
          createdAt: incident.createdAt,
          updatedAt: incident.updatedAt,
          impactedServices: impactedNames,
          rootCause: incident.rootCause,
          resolutionNotes: incident.resolutionNotes
        },
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          status: service.status,
          healthScore: service.healthScore
        })),
        timeline
      });
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
      res.status(201).json(await createDeployment(body));
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

async function createDeployment(body: z.infer<typeof deploymentSchema>) {
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

  return {
    id: deployment.id,
    serviceId: service.id,
    service: service.name,
    version: deployment.version,
    commitSha: deployment.commitSha,
    environment: deployment.environment,
    deployedBy: deployment.deployedBy,
    metadata: deployment.metadata,
    createdAt: deployment.createdAt
  };
}

async function importCsvRows(type: z.infer<typeof csvImportSchema>["type"], rows: Array<Record<string, string>>) {
  const project = await ensureDefaultProject();
  let imported = 0;

  for (const row of rows) {
    if (type === "services") {
      const serviceName = serviceNameFromRow(row);
      await prisma.service.upsert({
        where: {
          projectId_name_environment: {
            projectId: project.id,
            name: serviceName,
            environment: parseEnvironment(csvValue(row, "environment", "env", "stage"))
          }
        },
        update: {
          version: csvValue(row, "version", "service_version", "release"),
          owner: csvValue(row, "owner", "team", "maintainer"),
          status: parseServiceStatus(csvValue(row, "status", "state")),
          deploymentInfo: serviceMetadata(row),
          lastSeenAt: new Date()
        },
        create: {
          projectId: project.id,
          name: serviceName,
          environment: parseEnvironment(csvValue(row, "environment", "env", "stage")),
          version: csvValue(row, "version", "service_version", "release"),
          owner: csvValue(row, "owner", "team", "maintainer"),
          status: parseServiceStatus(csvValue(row, "status", "state")),
          healthScore: parseNumber(csvValue(row, "healthScore", "health_score", "score"), 0),
          deploymentInfo: serviceMetadata(row),
          lastSeenAt: new Date()
        }
      });
      imported += 1;
    }

    if (type === "deployments") {
      const service = await resolveDeploymentService(project.id, row);
      await createDeployment({
        serviceName: service.name,
        environment: parseEnvironment(csvValue(row, "environment", "env", "stage")),
        version: requiredAny(row, "version", "release", "tag", "build"),
        commitSha: csvValue(row, "commitSha", "commit_sha", "commit", "sha"),
        deployedBy: csvValue(row, "deployedBy", "deployed_by", "user", "author", "actor"),
        metadata: {
          source: "csv-import",
          deploymentId: csvValue(row, "deployment_id", "deploymentId", "id"),
          sourceStatus: csvValue(row, "status", "state", "result"),
          deployedAt: csvValue(row, "deployed_at", "deployedAt", "timestamp", "time"),
          extra: extraCsvMetadata(row, [
            "service_id", "serviceId", "serviceName", "service_name", "name", "service",
            "environment", "env", "stage", "version", "release", "tag", "build",
            "commitSha", "commit_sha", "commit", "sha", "deployedBy", "deployed_by",
            "user", "author", "actor", "deployment_id", "deploymentId", "id",
            "status", "state", "result", "deployed_at", "deployedAt", "timestamp", "time"
          ])
        }
      });
      imported += 1;
    }

    if (type === "incidents") {
      const title = requiredAny(row, "title", "incident", "summary", "name");
      await prisma.incident.create({
        data: {
          projectId: project.id,
          title,
          description: csvValue(row, "description", "message", "details") || title,
          severity: parseAlertSeverity(csvValue(row, "severity", "priority", "level")),
          state: parseIncidentState(csvValue(row, "state", "status")),
          impactedServices: splitList(csvValue(row, "impactedServices", "impacted_services", "services", "service")),
          timeline: [{
            at: parseDate(csvValue(row, "timestamp", "created_at", "createdAt", "time")).toISOString(),
            event: "Incident imported from CSV",
            extra: extraCsvMetadata(row, [
              "title", "incident", "summary", "name", "description", "message", "details",
              "severity", "priority", "level", "state", "status", "impactedServices",
              "impacted_services", "services", "service", "timestamp", "created_at", "createdAt", "time"
            ])
          }]
        }
      });
      imported += 1;
    }

    if (type === "logs") {
      const service = await resolveCsvService(project.id, row);
      await prisma.logEvent.create({
        data: {
          serviceId: service.id,
          timestamp: parseDate(csvValue(row, "timestamp", "time", "created_at", "createdAt", "date")),
          level: parseLogLevel(csvValue(row, "level", "severity", "status")),
          message: requiredAny(row, "message", "msg", "body", "text", "event"),
          traceId: csvValue(row, "traceId", "trace_id", "trace"),
          spanId: csvValue(row, "spanId", "span_id", "span"),
          attributes: {
            source: "csv-import",
            logId: csvValue(row, "log_id", "logId", "id"),
            extra: extraCsvMetadata(row, [
              "service_id", "serviceId", "serviceName", "service_name", "name", "service",
              "environment", "env", "stage", "timestamp", "time", "created_at", "createdAt",
              "date", "level", "severity", "status", "message", "msg", "body", "text",
              "event", "traceId", "trace_id", "trace", "spanId", "span_id", "span", "log_id", "logId", "id"
            ])
          }
        }
      });
      imported += 1;
    }

    if (type === "metrics") {
      const service = await resolveCsvService(project.id, row);
      await prisma.serviceMetric.create({
        data: {
          serviceId: service.id,
          timestamp: parseDate(csvValue(row, "timestamp", "time", "created_at", "createdAt", "date")),
          cpuPercent: parseOptionalNumber(csvValue(row, "cpuPercent", "cpu_percent", "cpu", "cpuUsage")),
          memoryPercent: parseOptionalNumber(csvValue(row, "memoryPercent", "memory_percent", "memory", "mem", "memoryUsage")),
          diskPercent: parseOptionalNumber(csvValue(row, "diskPercent", "disk_percent", "disk", "diskUsage")),
          requestCount: parseNumber(csvValue(row, "requestCount", "request_count", "requests", "req_count"), 0),
          errorCount: parseNumber(csvValue(row, "errorCount", "error_count", "errors", "err_count"), 0),
          avgLatencyMs: parseOptionalNumber(csvValue(row, "avgLatencyMs", "avg_latency_ms", "latency", "latency_ms", "duration_ms")),
          throughputRpm: parseOptionalNumber(csvValue(row, "throughputRpm", "throughput_rpm", "throughput", "rpm"))
        }
      });
      imported += 1;
    }
  }

  return { type, imported };
}

async function resolveCsvService(projectId: string, row: Record<string, string>) {
  const serviceId = csvValue(row, "service_id", "serviceId", "service id", "svc_id", "svcId");
  if (serviceId) {
    const services = await prisma.service.findMany({ where: { projectId } });
    const matched = services.find((service) => {
      const info = service.deploymentInfo;
      return Boolean(
        info &&
        typeof info === "object" &&
        !Array.isArray(info) &&
        "serviceId" in info &&
        info.serviceId === serviceId
      );
    });

    if (matched) {
      return matched;
    }
  }

  const serviceName = csvValue(row, "serviceName", "service_name", "service", "name", "app", "application");
  if (!serviceName?.trim() && serviceId) {
    return prisma.service.upsert({
      where: {
        projectId_name_environment: {
          projectId,
          name: serviceId,
          environment: parseEnvironment(csvValue(row, "environment", "env", "stage"))
        }
      },
      update: {
        lastSeenAt: new Date()
      },
      create: {
        projectId,
        name: serviceId,
        environment: parseEnvironment(csvValue(row, "environment", "env", "stage")),
        status: "HEALTHY",
        healthScore: 100,
        deploymentInfo: { serviceId },
        lastSeenAt: new Date()
      }
    });
  }

  return prisma.service.upsert({
    where: {
      projectId_name_environment: {
        projectId,
        name: requiredServiceName(row),
        environment: parseEnvironment(csvValue(row, "environment", "env", "stage"))
      }
    },
    update: {
      lastSeenAt: new Date()
    },
    create: {
      projectId,
      name: requiredServiceName(row),
      environment: parseEnvironment(csvValue(row, "environment", "env", "stage")),
      status: "HEALTHY",
      healthScore: 100,
      lastSeenAt: new Date()
    }
  });
}

function requiredServiceName(row: Record<string, string>) {
  const value = csvValue(row, "serviceName", "service_name", "service", "name", "app", "application");
  if (!value?.trim()) {
    throw new Error("CSV row is missing serviceName, service_name, name, or service_id");
  }
  return value.trim();
}

async function resolveDeploymentService(projectId: string, row: Record<string, string>) {
  const serviceId = csvValue(row, "service_id", "serviceId", "service id", "svc_id", "svcId");
  if (serviceId) {
    const services = await prisma.service.findMany({ where: { projectId } });
    const matched = services.find((service) => {
      const info = service.deploymentInfo;
      return Boolean(
        info &&
        typeof info === "object" &&
        !Array.isArray(info) &&
        "serviceId" in info &&
        info.serviceId === serviceId
      );
    });

    if (matched) {
      return matched;
    }
  }

  const name = csvValue(row, "serviceName", "service_name", "service", "name", "app", "application");
  if (name?.trim()) {
    return prisma.service.upsert({
      where: {
        projectId_name_environment: {
          projectId,
          name: name.trim(),
          environment: parseEnvironment(csvValue(row, "environment", "env", "stage"))
        }
      },
      update: { lastSeenAt: new Date() },
      create: {
        projectId,
        name: name.trim(),
        environment: parseEnvironment(row.environment),
        status: "HEALTHY",
        healthScore: 100,
        lastSeenAt: new Date()
      }
    });
  }

  if (serviceId) {
    return prisma.service.upsert({
      where: {
        projectId_name_environment: {
          projectId,
          name: serviceId,
          environment: parseEnvironment(csvValue(row, "environment", "env", "stage"))
        }
      },
      update: { lastSeenAt: new Date() },
      create: {
        projectId,
        name: serviceId,
        environment: parseEnvironment(csvValue(row, "environment", "env", "stage")),
        status: "HEALTHY",
        healthScore: 100,
        deploymentInfo: { serviceId },
        lastSeenAt: new Date()
      }
    });
  }

  throw new Error("CSV row is missing serviceName, service_name, name, or service_id");
}

function parseCsv(input: string) {
  const rows = input.trim().split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const headers = rows.shift();
  if (!headers || headers.length === 0) {
    throw new Error("CSV must include a header row");
  }

  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]?.trim() ?? ""])));
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function required(row: Record<string, string>, key: string) {
  const value = row[key]?.trim();
  if (!value) {
    throw new Error(`CSV row is missing ${key}`);
  }
  return value;
}

function requiredAny(row: Record<string, string>, ...keys: string[]) {
  const value = csvValue(row, ...keys);
  if (!value) {
    throw new Error(`CSV row is missing one of: ${keys.join(", ")}`);
  }
  return value;
}

function serviceNameFromRow(row: Record<string, string>) {
  const value = csvValue(row, "name", "serviceName", "service_name", "service", "app", "application");
  if (!value?.trim()) {
    throw new Error("CSV row is missing name, serviceName, service_name, or service");
  }
  return value.trim();
}

function serviceMetadata(row: Record<string, string>): Prisma.InputJsonObject | undefined {
  const metadata = {
    serviceId: csvValue(row, "service_id", "serviceId", "service id", "svc_id", "svcId"),
    language: csvValue(row, "language", "lang", "runtime"),
    framework: csvValue(row, "framework", "platform"),
    extra: extraCsvMetadata(row, [
      "name", "serviceName", "service_name", "service", "app", "application",
      "environment", "env", "stage", "version", "service_version", "release",
      "owner", "team", "maintainer", "status", "state", "healthScore",
      "health_score", "score", "service_id", "serviceId", "service id",
      "svc_id", "svcId", "language", "lang", "runtime", "framework", "platform"
    ])
  };

  if (!metadata.serviceId && !metadata.language && !metadata.framework && !metadata.extra) {
    return undefined;
  }

  return metadata;
}

function csvValue(row: Record<string, string>, ...keys: string[]) {
  const normalizedAliases = new Set(keys.map(normalizeCsvKey));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.has(normalizeCsvKey(key)) && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function extraCsvMetadata(row: Record<string, string>, knownKeys: string[]) {
  const known = new Set(knownKeys.map(normalizeCsvKey));
  const extra = Object.fromEntries(
    Object.entries(row)
      .filter(([key, value]) => !known.has(normalizeCsvKey(key)) && value.trim())
      .map(([key, value]) => [key, value.trim()])
  );

  return Object.keys(extra).length > 0 ? extra : undefined;
}

function normalizeCsvKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitList(value: string | undefined) {
  if (!value?.trim()) {
    return [];
  }
  return value.split(/[|;,]/).map((item) => item.trim()).filter(Boolean);
}

function emptyToUndefined(value: string | undefined) {
  return value?.trim() ? value.trim() : undefined;
}

function parseDate(value: string | undefined) {
  return value?.trim() ? new Date(value) : new Date();
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseEnvironment(value: string | undefined) {
  const normalized = (value || "PRODUCTION").toUpperCase();
  if (["DEVELOPMENT", "TESTING", "STAGING", "PRODUCTION"].includes(normalized)) {
    return normalized as "DEVELOPMENT" | "TESTING" | "STAGING" | "PRODUCTION";
  }
  return "PRODUCTION";
}

function parseServiceStatus(value: string | undefined) {
  const normalized = (value || "HEALTHY").toUpperCase();
  if (normalized === "ACTIVE") {
    return "HEALTHY";
  }
  if (normalized === "INACTIVE") {
    return "OFFLINE";
  }
  if (["HEALTHY", "WARNING", "DEGRADED", "CRITICAL", "OFFLINE"].includes(normalized)) {
    return normalized as "HEALTHY" | "WARNING" | "DEGRADED" | "CRITICAL" | "OFFLINE";
  }
  return "HEALTHY";
}

function parseLogLevel(value: string | undefined) {
  const normalized = (value || "INFO").toUpperCase();
  if (["DEBUG", "INFO", "WARN", "ERROR"].includes(normalized)) {
    return normalized as "DEBUG" | "INFO" | "WARN" | "ERROR";
  }
  return "INFO";
}

function parseAlertSeverity(value: string | undefined) {
  const normalized = (value || "WARNING").toUpperCase();
  if (["INFO", "WARNING", "CRITICAL"].includes(normalized)) {
    return normalized as "INFO" | "WARNING" | "CRITICAL";
  }
  return "WARNING";
}

function parseIncidentState(value: string | undefined) {
  const normalized = (value || "OPEN").toUpperCase();
  if (["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"].includes(normalized)) {
    return normalized as "OPEN" | "INVESTIGATING" | "MITIGATED" | "RESOLVED" | "CLOSED";
  }
  return "OPEN";
}

function asStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function timelineEntries(value: Prisma.JsonValue): Array<{ at: Date; event: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.at !== "string" || typeof record.event !== "string") {
      return [];
    }

    return [{ at: new Date(record.at), event: record.event }];
  });
}

function metricEvidence(metric: {
  id: string;
  timestamp: Date;
  cpuPercent: number | null;
  memoryPercent: number | null;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number | null;
  service: { name: string };
}) {
  const events: Array<{
    id: string;
    timestamp: Date;
    type: string;
    title: string;
    description: string;
    severity: string;
    service: string;
  }> = [];

  const errorRate = metric.requestCount > 0 ? metric.errorCount / metric.requestCount : 0;
  if ((metric.avgLatencyMs ?? 0) >= 500) {
    events.push({
      id: `${metric.id}-latency`,
      timestamp: metric.timestamp,
      type: "metric",
      title: `Latency crossed ${metric.avgLatencyMs} ms`,
      description: `${metric.requestCount} requests in sample`,
      severity: "WARNING",
      service: metric.service.name
    });
  }

  if (errorRate >= 0.05) {
    events.push({
      id: `${metric.id}-errors`,
      timestamp: metric.timestamp,
      type: "metric",
      title: `Error rate reached ${(errorRate * 100).toFixed(2)}%`,
      description: `${metric.errorCount} errors from ${metric.requestCount} requests`,
      severity: "CRITICAL",
      service: metric.service.name
    });
  }

  if ((metric.cpuPercent ?? 0) >= 85 || (metric.memoryPercent ?? 0) >= 85) {
    events.push({
      id: `${metric.id}-resource`,
      timestamp: metric.timestamp,
      type: "metric",
      title: `Resource pressure CPU ${metric.cpuPercent ?? 0}% / memory ${metric.memoryPercent ?? 0}%`,
      description: "Resource threshold crossed",
      severity: "WARNING",
      service: metric.service.name
    });
  }

  return events;
}
