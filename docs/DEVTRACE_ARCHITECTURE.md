# DevTrace Architecture Blueprint

## 1. Product Requirement Document

DevTrace gives engineering teams one place to monitor services, APIs, infrastructure, logs, traces, alerts, incidents, dependencies, and reliability trends. The platform must answer operational questions quickly: what failed, where latency rose, which dependency caused blast radius, what happened before the incident, and what should be fixed first.

### Personas

- Organization Administrator: manages organizations, projects, users, teams, API keys, alert rules, environments, and audit posture.
- Engineering Manager: reviews service health, incidents, uptime, SLA/SLO trends, and team reliability.
- Developer: investigates logs, traces, API performance, alerts, incidents, deployments, and service details.
- Viewer: read-only dashboard and analytics access.

### MVP Scope

- Auth, tenant model, RBAC, projects, API keys, audit logs
- Service registry and health scoring
- Node.js agent, ingest endpoints, Redis queue, BullMQ workers
- Metrics, logs, traces, dependencies, alerts, incidents, notifications
- Real-time overview dashboard, log explorer, trace viewer, topology map
- Gemini-powered incident analysis
- Reporting exports and scheduled summaries

## 2. High Level Design

```text
Node Agent SDKs
  | HTTPS batches
  v
API Gateway / Ingestion API
  | validation + auth + rate limits
  v
Redis Streams / BullMQ Queues
  | workers
  +--> Metrics Aggregator --> PostgreSQL partitions --> Realtime Socket.IO
  +--> Log Processor -------> PostgreSQL partitions --> Log Explorer
  +--> Trace Processor -----> Trace/Span tables ------> Trace Viewer
  +--> Alert Evaluator -----> Alerts/Incidents -------> Notifications
  +--> Dependency Builder --> Topology graph ---------> React Flow UI
  +--> AI Analyzer ---------> Gemini summaries -------> Incident Intel
```

The first deployable shape is a modular monolith: one Express API owns bounded modules behind service/repository interfaces. Queue workers can be split into separate processes immediately and separate services later.

## 3. Low Level Design

### Bounded Modules

- Identity: users, memberships, refresh tokens, RBAC, sessions
- Tenancy: organizations, projects, API keys, audit logs
- Registry: services, deployments, environments, health status
- Ingestion: payload auth, validation, batching, idempotency, backpressure
- Metrics: rollups, percentiles, health scoring, dashboard query models
- Logs: indexing strategy, live stream, filters, export
- Tracing: trace/span persistence, waterfall reconstruction, bottleneck detection
- Alerts: rule evaluation, state machine, notification dispatch
- Incidents: timeline creation, impact graph, runbook notes, resolution workflow
- Topology: dependency discovery, graph scoring, failure propagation
- AI Intelligence: Gemini prompts, evidence gathering, generated recommendations
- Reporting: scheduled jobs, CSV/PDF/Excel exporters, SLA summaries

### Service Layer Pattern

Controllers perform auth, validation, and response mapping. Services own business rules. Repositories isolate Prisma queries. Queue processors consume domain events and call services. Socket gateways publish tenant-scoped real-time events.

## 4. System Architecture Diagram

```text
Browser Console
  | REST + Socket.IO
  v
Express API -----------> Auth/RBAC/Tenancy
  |                      Registry/Dashboard/Logs/Traces/Alerts/Incidents
  |
  +--> PostgreSQL <------ Prisma repositories
  |
  +--> Redis/BullMQ <---- worker processes
  |
  +--> Gemini API <------ AI incident intelligence

Node Agent SDK
  | API key + compressed telemetry
  v
/api/ingest/{metrics,logs,traces,heartbeat,dependencies}
```

## 5. Database Design

The Prisma schema defines users, organizations, memberships, projects, services, service metrics, logs, traces, spans, alerts, alert rules, incidents, notifications, audit logs, deployments, service dependencies, API keys, reports, and refresh tokens.

Partitioning strategy:

- `ServiceMetric`: range partition by month on `timestamp`; keep hot partitions indexed by `(serviceId, timestamp)`.
- `LogEvent`: range partition by day or week depending ingestion volume; add PostgreSQL full-text vector or OpenSearch later.
- `Trace` and `Span`: range partition by `startedAt`; retain sampled traces longer than full-fidelity traces.
- Cold retention: move old metrics/logs/traces to object storage with Parquet or compressed JSONL.

Optimization strategy:

- Write telemetry in batches inside worker transactions.
- Use summary rollup tables for dashboard time ranges beyond the hot window.
- Use covering indexes for service/time filters.
- Keep tenant and project filters in every query path.

## 6. ER Diagram

```text
User --< Membership >-- Organization --< Project --< Service --< ServiceMetric
  |                          |              |          |--< LogEvent
  |                          |              |          |--< Span >-- Trace
  |                          |              |          |--< Deployment
  |                          |              |          |--< ServiceDependency >-- Service
  |                          |              |
  |                          |              |--< AlertRule --< Alert >-- Incident
  |                          |              |--< Report
  |                          |
  |                          |--< ApiKey
  |                          |--< AuditLog
  |
  |--< RefreshToken
```

## 7. Frontend Architecture

- React Router controls product areas: overview, services, logs, traces, topology, alerts, incidents, reports, settings.
- TanStack Query owns server state, caching, and background refresh.
- Zustand stores UI state: selected project, time range, environment, live-mode toggles, topology layout.
- Socket.IO receives tenant-scoped updates and invalidates affected query keys.
- Recharts renders metrics; React Flow renders service topology; virtualized lists render logs and spans.

## 8. Backend Architecture

- Express app with API versioning under `/api/v1`.
- Middleware order: request id, security headers, CORS, body limits, rate limits, auth, tenant context, audit.
- Zod validates all request bodies and query parameters.
- Prisma repositories perform tenant-scoped reads/writes.
- BullMQ queues separate telemetry ingestion from persistence and alert evaluation.
- Socket.IO rooms use `org:{id}` and `project:{id}` scoping.

## 9. Monitoring Agent Architecture

The Node agent exposes `initDevTrace({ serviceName, environment, apiKey, endpoint })` and auto-instruments HTTP, Express middleware, performance hooks, async context, process metrics, and logger adapters. It batches events, compresses payloads, retries with exponential backoff, buffers offline data to disk, and applies sampling/rate limits before transmission.

Future SDKs should share the same ingest protobuf/JSON contract and API key security model.

## 10. Telemetry Ingestion Architecture

Ingestion validates API keys, enforces tenant/project scopes, rejects oversized payloads, normalizes timestamps, adds ingestion metadata, then enqueues jobs:

- `metrics.ingest`
- `logs.ingest`
- `traces.ingest`
- `alerts.evaluate`
- `topology.update`
- `realtime.publish`

Workers are horizontally scalable and idempotent. Duplicate spans use `(traceId, spanId)` upserts.

## 11. Distributed Tracing Architecture

Traces are reconstructed from spans using `traceId`, `spanId`, and `parentSpanId`. The trace viewer computes critical path, failed spans, service latency contribution, external call overhead, database time, and dependency fanout.

## 12. Alert Engine Design

Rules evaluate metric windows such as CPU, memory, latency, error rate, throughput, and service heartbeat age. The state machine is:

`TRIGGERED -> ACKNOWLEDGED -> INVESTIGATING -> RESOLVED -> CLOSED`

Rules support severity, cooldown, dedupe key, notification channels, and webhook payload templates.

## 13. Incident Workflow

Incidents are created from correlated critical alerts. The incident engine groups alerts by project, impacted service, dependency path, and time window. Timeline entries are generated from metrics, deployments, alerts, and logs. Engineers can assign owners, add notes, attach traces, and close with resolution notes.

## 14. AI Analysis Workflow

Gemini receives structured evidence, not raw unbounded logs: service deltas, top errors, recent deployments, failed spans, dependency changes, alert sequence, and capacity signals. The AI response must include confidence, likely root cause, contributing factors, suggested fixes, and links to supporting evidence.

## 15. Security Architecture

- JWT access tokens and rotating refresh tokens
- bcrypt password hashes
- API key hashes, never plaintext storage
- Helmet, strict CORS, body size limits, per-key rate limits
- Zod input validation and tenant isolation in repository methods
- Audit logs for auth, settings, API key, alert, incident, export, and admin actions
- Secrets supplied through environment variables or managed secret stores

## 16. Deployment Architecture

Development uses Docker Compose for PostgreSQL, Redis, and Nginx. Production should use:

- API containers behind load balancer
- Dedicated worker deployment scaled by queue depth
- Managed PostgreSQL with read replicas and backups
- Managed Redis with persistence and eviction policy tuned for queues
- Object storage for exported reports and cold telemetry
- Nginx or cloud ingress with TLS
- Observability for DevTrace itself

## 17. Scaling Strategy

- Separate API and worker processes
- Partition high-volume telemetry tables
- Batch writes and avoid synchronous alert evaluation in ingest requests
- Introduce OpenSearch/ClickHouse when log and metric cardinality exceed PostgreSQL comfort
- Use adaptive trace sampling and tail-based sampling for errors/slow requests
- Cache dashboard rollups by project/time window

## 18. Testing Strategy

- Unit tests for health scoring, alert thresholds, RBAC, query parsers, and span tree reconstruction
- Integration tests for ingest endpoints, Prisma repositories, queue processors, and Socket.IO events
- Contract tests for agent payload schemas
- Load tests for 100,000+ metrics/hour and sub-2-second dashboard fanout
- E2E tests for core workflows: login, service detail, log search, trace inspection, incident resolution

## 19. Performance Optimization Strategy

- Compress agent batches
- Use bounded queues and backpressure
- Store telemetry with bulk inserts
- Use rollups for dashboard charts
- Limit live log stream fanout by project subscriptions
- Add query guards for large date ranges
- Prefer pagination cursors over offset pagination for logs/traces

