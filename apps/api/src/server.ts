import { createServer } from "node:http";
import compression from "compression";
import cors from "cors";
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { z } from "zod";
import { createIngestionRouter } from "./telemetry/ingestion.router.js";
import { createTelemetryQueues } from "./telemetry/telemetry.queues.js";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  REDIS_URL: z.string().default("redis://localhost:6379")
});

const env = envSchema.parse(process.env);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: env.FRONTEND_ORIGIN,
    credentials: true
  }
});

const queues = createTelemetryQueues(env.REDIS_URL);

app.use(helmet());
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
app.use(compression());
app.use(express.json({ limit: "2mb" }));

app.get("/api/v1/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "devtrace-api",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/v1/ingest", createIngestionRouter({ queues }));

io.on("connection", (socket) => {
  socket.on("project:subscribe", (projectId: string) => {
    socket.join(`project:${projectId}`);
  });

  socket.on("project:unsubscribe", (projectId: string) => {
    socket.leave(`project:${projectId}`);
  });
});

httpServer.listen(env.PORT, () => {
  console.log(`DevTrace API listening on http://localhost:${env.PORT}`);
});

