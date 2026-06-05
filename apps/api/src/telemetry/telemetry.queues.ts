import { Queue } from "bullmq";

export type TelemetryQueues = ReturnType<typeof createTelemetryQueues>;

export function createTelemetryQueues(redisUrl: string) {
  const url = new URL(redisUrl);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null
  };

  return {
    metrics: new Queue("metrics.ingest", { connection }),
    logs: new Queue("logs.ingest", { connection }),
    traces: new Queue("traces.ingest", { connection }),
    alerts: new Queue("alerts.evaluate", { connection }),
    realtime: new Queue("realtime.publish", { connection })
  };
}
