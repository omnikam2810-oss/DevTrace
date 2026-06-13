import { Queue } from "bullmq";

export type TelemetryQueues = ReturnType<typeof createTelemetryQueues>;

export function createRedisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null
  };
}

export function createTelemetryQueues(redisUrl: string) {
  const connection = createRedisConnection(redisUrl);

  return {
    metrics: new Queue("metrics.ingest", { connection }),
    logs: new Queue("logs.ingest", { connection }),
    traces: new Queue("traces.ingest", { connection }),
    dependencies: new Queue("dependencies.ingest", { connection }),
    alerts: new Queue("alerts.evaluate", { connection }),
    realtime: new Queue("realtime.publish", { connection })
  };
}
