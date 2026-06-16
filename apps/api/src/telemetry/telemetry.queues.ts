import { Queue } from "bullmq";

export type TelemetryQueues = ReturnType<typeof createTelemetryQueues>;

const reportedRedisErrors = new Set<string>();

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
  const queues = {
    metrics: new Queue("metrics.ingest", { connection }),
    logs: new Queue("logs.ingest", { connection }),
    traces: new Queue("traces.ingest", { connection }),
    dependencies: new Queue("dependencies.ingest", { connection }),
    alerts: new Queue("alerts.evaluate", { connection }),
    realtime: new Queue("realtime.publish", { connection })
  };

  for (const [name, queue] of Object.entries(queues)) {
    queue.on("error", (error) => reportRedisError(`queue:${name}`, redisUrl, error));
  }

  return queues;
}

export function reportRedisError(source: string, redisUrl: string, error: Error) {
  const key = `${source}:${error.message}`;

  if (reportedRedisErrors.has(key)) {
    return;
  }

  reportedRedisErrors.add(key);
  console.error(
    `[redis] ${source} could not connect to ${redisUrl}: ${error.message}. ` +
      "Start Redis with `docker compose up -d redis` or update REDIS_URL."
  );
}
