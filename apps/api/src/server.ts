import { createServer } from "node:http";
import compression from "compression";
import cors from "cors";
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { z } from "zod";
import { createDashboardRouter } from "./dashboard.router.js";
import { createOperationsRouter } from "./operations.router.js";
import { realtime } from "./realtime.js";
import { shouldWarnAboutDefaultIngestSecret } from "./telemetry/ingest-auth.js";
import { createIngestionRouter } from "./telemetry/ingestion.router.js";
import { startTelemetryProcessors } from "./telemetry/telemetry.processor.js";
import { createTelemetryQueues } from "./telemetry/telemetry.queues.js";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  AGENT_INGEST_SECRET: z.string().optional()
});

const env = envSchema.parse(process.env);
const app = express();
const httpServer = createServer(app);
const allowedOrigins = env.FRONTEND_ORIGIN.split(",").map((origin) => origin.trim());
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

const queues = createTelemetryQueues(env.REDIS_URL);
const workers = startTelemetryProcessors(env.REDIS_URL);

app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(compression());
app.use(express.json({ limit: "2mb" }));

app.get("/api/v1/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "devtrace-api",
    timestamp: new Date().toISOString()
  });
});

if (shouldWarnAboutDefaultIngestSecret(env.AGENT_INGEST_SECRET)) {
  console.warn("AGENT_INGEST_SECRET is using the default development placeholder.");
}

app.use("/api/v1/ingest", createIngestionRouter({ agentSecret: env.AGENT_INGEST_SECRET, queues }));
app.use("/api/v1/dashboard", createDashboardRouter());
app.use("/api/v1", createOperationsRouter());

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  res.status(400).json({ error: message });
});

io.on("connection", (socket) => {
  socket.on("project:subscribe", (projectId: string) => {
    socket.join(`project:${projectId}`);
  });

  socket.on("project:unsubscribe", (projectId: string) => {
    socket.leave(`project:${projectId}`);
  });
});

for (const eventName of [
  "service.health.updated",
  "metrics.timeseries.appended",
  "logs.appended",
  "trace.completed",
  "alert.triggered",
  "incident.updated",
  "topology.updated"
] as const) {
  realtime.on(eventName, (payload) => {
    io.emit(eventName, payload);
  });
}

httpServer.listen(env.PORT, () => {
  console.log(`DevTrace API listening on http://localhost:${env.PORT}`);
});

async function shutdown() {
  await Promise.all(workers.map((worker) => worker.close()));
  httpServer.close();
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
