import { Router } from "express";
import { prisma } from "./db.js";
import { calculateHealthScore } from "./telemetry/health-score.js";

export function createDashboardRouter() {
  const router = Router();

  router.get("/summary", async (_req, res, next) => {
    try {
      const services = await prisma.service.findMany({
        orderBy: [{ updatedAt: "desc" }],
        include: {
          metrics: {
            orderBy: { timestamp: "desc" },
            take: 12
          },
          logs: {
            orderBy: { timestamp: "desc" },
            take: 5
          }
        }
      });

      const alerts = await prisma.alert.findMany({
        where: { state: { in: ["TRIGGERED", "ACKNOWLEDGED", "INVESTIGATING"] } },
        orderBy: { triggeredAt: "desc" },
        take: 10
      });

      const incidents = await prisma.incident.findMany({
        where: { state: { in: ["OPEN", "INVESTIGATING", "MITIGATED"] } },
        orderBy: { createdAt: "desc" },
        take: 10
      });

      const latestMetrics = services.flatMap((service) => service.metrics.slice(0, 1));
      const avg = (values: number[]) => {
        if (values.length === 0) {
          return 0;
        }
        return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
      };
      const totalRequests = latestMetrics.reduce((sum, metric) => sum + metric.requestCount, 0);
      const totalErrors = latestMetrics.reduce((sum, metric) => sum + metric.errorCount, 0);
      const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;
      const healthScore = avg(services.map((service) => service.healthScore));

      res.json({
        kpis: {
          healthScore,
          services: services.length,
          openAlerts: alerts.length,
          errorRate: Number((errorRate * 100).toFixed(2)),
          activeIncidents: incidents.length
        },
        services: services.map((service) => {
          const latestMetric = service.metrics[0];
          const lastSeenAgeSec = service.lastSeenAt
            ? (Date.now() - service.lastSeenAt.getTime()) / 1000
            : undefined;
          const score = calculateHealthScore({
            latencyMs: latestMetric?.avgLatencyMs ?? undefined,
            errorRate: latestMetric && latestMetric.requestCount > 0 ? latestMetric.errorCount / latestMetric.requestCount : undefined,
            cpuPercent: latestMetric?.cpuPercent ?? undefined,
            memoryPercent: latestMetric?.memoryPercent ?? undefined,
            diskPercent: latestMetric?.diskPercent ?? undefined,
            lastSeenAgeSec
          });

          return {
            id: service.id,
            name: service.name,
            environment: service.environment,
            status: service.status,
            score,
            latency: latestMetric?.avgLatencyMs ?? 0,
            errorRate: latestMetric && latestMetric.requestCount > 0
              ? Number(((latestMetric.errorCount / latestMetric.requestCount) * 100).toFixed(2))
              : 0,
            lastSeenAt: service.lastSeenAt
          };
        }),
        series: buildSeries(services.flatMap((service) => service.metrics)),
        incidents: incidents.map((incident) => ({
          id: incident.id,
          title: incident.title,
          severity: incident.severity,
          state: incident.state
        })),
        logs: services.flatMap((service) => service.logs.map((log) => ({
          id: log.id,
          service: service.name,
          level: log.level,
          message: log.message,
          timestamp: log.timestamp
        }))).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function buildSeries(metrics: Array<{
  timestamp: Date;
  cpuPercent: number | null;
  memoryPercent: number | null;
  avgLatencyMs: number | null;
  requestCount: number;
  errorCount: number;
}>) {
  return metrics
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .slice(-24)
    .map((metric) => ({
      time: metric.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
      cpu: metric.cpuPercent ?? 0,
      memory: metric.memoryPercent ?? 0,
      latency: metric.avgLatencyMs ?? 0,
      errors: metric.requestCount > 0 ? Number(((metric.errorCount / metric.requestCount) * 100).toFixed(2)) : 0
    }));
}
