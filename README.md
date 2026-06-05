# DevTrace

DevTrace is an enterprise observability platform for service health monitoring, telemetry ingestion, log analytics, distributed tracing, alerting, incident intelligence, service topology visualization, and AI-assisted root cause analysis.

This repository is scaffolded as a modular monorepo so the product can start as a production-grade modular monolith and evolve into separately deployable services.

## Product Surface

- Multi-tenant organizations, projects, users, teams, RBAC, API keys, and audit logs
- Node.js monitoring agent with metrics, logs, traces, buffering, batching, retry, and secure ingest
- Telemetry ingestion API for metrics, logs, spans, service heartbeats, and dependency discovery
- Redis + BullMQ processing pipeline for validation, enrichment, aggregation, alert evaluation, and fanout
- PostgreSQL + Prisma data model with normalized entities, indexes, and partition-ready telemetry tables
- Real-time dashboard updates over Socket.IO
- Splunk-style log explorer, Jaeger-style trace viewer, Grafana-style dashboards, and React Flow topology map
- Alert lifecycle, incident timeline, reporting, and Gemini-powered incident intelligence

## Repository Layout

```text
apps/
  api/          Express, Socket.IO, Prisma, BullMQ backend
  web/          React 19 + Vite observability console
  agent-node/   Node.js telemetry SDK and auto-instrumentation foundation
docs/           Product, architecture, API, UX, security, deployment, and roadmap artifacts
prisma/         PostgreSQL schema
.github/        CI workflow
```

## Local Development

```bash
npm install
docker compose up -d postgres redis
npm run dev
```

The scaffold is intentionally dependency-light in source files, but the architecture is ready for the requested stack: React, TypeScript, Vite, Tailwind, shadcn/ui, TanStack Query, Recharts, React Flow, Zustand, Express, Prisma, Redis, BullMQ, Socket.IO, JWT, bcrypt, Zod, Docker, Nginx, GitHub Actions, and Gemini.

## Primary Documents

- [Architecture Blueprint](docs/DEVTRACE_ARCHITECTURE.md)
- [API Documentation](docs/API_DOCUMENTATION.md)
- [Implementation Roadmap](docs/IMPLEMENTATION_ROADMAP.md)
- [UI/UX Wireframes](docs/UI_UX_WIREFRAMES.md)

