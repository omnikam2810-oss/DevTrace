import { randomUUID } from "node:crypto";
import os from "node:os";
import process from "node:process";
import { performance } from "node:perf_hooks";

export type DevTraceEnvironment = "DEVELOPMENT" | "TESTING" | "STAGING" | "PRODUCTION";

export type DevTraceAgentOptions = {
  endpoint: string;
  apiKey: string;
  serviceName: string;
  environment: DevTraceEnvironment;
  version?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
};

type MetricPoint = {
  timestamp: string;
  cpuPercent?: number;
  memoryPercent?: number;
  requestCount: number;
  errorCount: number;
  avgLatencyMs?: number;
};

type LogEvent = {
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  message: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, unknown>;
};

type SpanEvent = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: string;
  durationMs: number;
  status: "OK" | "ERROR";
  attributes?: Record<string, unknown>;
};

export class DevTraceAgent {
  private metrics: MetricPoint[] = [];
  private logs: LogEvent[] = [];
  private spans: SpanEvent[] = [];
  private timer?: NodeJS.Timeout;
  private readonly options: Required<Pick<DevTraceAgentOptions, "flushIntervalMs" | "maxBatchSize">> & DevTraceAgentOptions;
  private lastCpu = process.cpuUsage();
  private lastCpuRead = performance.now();

  constructor(options: DevTraceAgentOptions) {
    this.options = {
      flushIntervalMs: 5000,
      maxBatchSize: 250,
      ...options
    };
  }

  start() {
    this.timer = setInterval(() => {
      this.collectProcessMetrics();
      void this.flush();
    }, this.options.flushIntervalMs);
    this.timer.unref();
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    return this.flush();
  }

  log(level: LogEvent["level"], message: string, attributes?: Record<string, unknown>) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      level,
      message,
      attributes
    });
    this.flushWhenFull();
  }

  async trace<T>(name: string, operation: () => Promise<T> | T, attributes?: Record<string, unknown>) {
    const traceId = randomUUID();
    const spanId = randomUUID();
    const startedAt = new Date();
    const start = performance.now();

    try {
      const result = await operation();
      this.recordSpan({ traceId, spanId, name, startedAt, start, status: "OK", attributes });
      return result;
    } catch (error) {
      this.recordSpan({ traceId, spanId, name, startedAt, start, status: "ERROR", attributes: { ...attributes, error: String(error) } });
      throw error;
    }
  }

  async flush() {
    await Promise.all([
      this.flushBatch("metrics", "metrics", this.metrics.splice(0, this.options.maxBatchSize)),
      this.flushBatch("logs", "logs", this.logs.splice(0, this.options.maxBatchSize)),
      this.flushBatch("traces", "spans", this.spans.splice(0, this.options.maxBatchSize))
    ]);
  }

  private collectProcessMetrics() {
    const memory = process.memoryUsage();
    const totalMemory = os.totalmem();
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsedMicros = (performance.now() - this.lastCpuRead) * 1000;
    const cpuPercent = ((cpu.user + cpu.system) / elapsedMicros) * 100;

    this.lastCpu = process.cpuUsage();
    this.lastCpuRead = performance.now();

    this.metrics.push({
      timestamp: new Date().toISOString(),
      cpuPercent: Number(cpuPercent.toFixed(2)),
      memoryPercent: Number(((memory.rss / totalMemory) * 100).toFixed(2)),
      requestCount: 0,
      errorCount: 0
    });
  }

  private recordSpan(input: {
    traceId: string;
    spanId: string;
    name: string;
    startedAt: Date;
    start: number;
    status: "OK" | "ERROR";
    attributes?: Record<string, unknown>;
  }) {
    this.spans.push({
      traceId: input.traceId,
      spanId: input.spanId,
      name: input.name,
      startedAt: input.startedAt.toISOString(),
      durationMs: Number((performance.now() - input.start).toFixed(2)),
      status: input.status,
      attributes: input.attributes
    });
    this.flushWhenFull();
  }

  private flushWhenFull() {
    if (this.metrics.length + this.logs.length + this.spans.length >= this.options.maxBatchSize) {
      void this.flush();
    }
  }

  private async flushBatch(path: "metrics" | "logs" | "traces", key: "metrics" | "logs" | "spans", items: unknown[]) {
    if (items.length === 0) {
      return;
    }

    const body = {
      service: {
        name: this.options.serviceName,
        environment: this.options.environment,
        version: this.options.version
      },
      batchId: randomUUID(),
      [key]: items
    };

    const response = await fetch(`${this.options.endpoint.replace(/\/$/, "")}/api/v1/ingest/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DevTrace-Key": this.options.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`DevTrace ingest failed: ${response.status}`);
    }
  }
}

export function initDevTrace(options: DevTraceAgentOptions) {
  return new DevTraceAgent(options).start();
}

