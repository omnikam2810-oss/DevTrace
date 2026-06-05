# DevTrace API Documentation

Base path: `/api/v1`

All authenticated requests use `Authorization: Bearer <access_token>`. Agent ingest requests use `X-DevTrace-Key: <api_key>`.

## Authentication

- `POST /auth/register`: create first organization admin or invite-accepted user.
- `POST /auth/login`: returns access and refresh tokens.
- `POST /auth/refresh`: rotates refresh token.
- `POST /auth/logout`: revokes refresh token.
- `GET /auth/me`: returns user, memberships, and current organization access.

## Organizations, Projects, Users

- `GET /organizations`
- `POST /organizations`
- `GET /organizations/:orgId/projects`
- `POST /organizations/:orgId/projects`
- `GET /organizations/:orgId/users`
- `POST /organizations/:orgId/invitations`
- `PATCH /organizations/:orgId/users/:userId/role`
- `GET /organizations/:orgId/audit-logs`

## API Keys

- `GET /organizations/:orgId/api-keys`
- `POST /organizations/:orgId/api-keys`
- `DELETE /organizations/:orgId/api-keys/:keyId`

API keys are shown only once at creation. The database stores `keyHash`.

## Service Registry

- `GET /projects/:projectId/services`
- `POST /projects/:projectId/services`
- `GET /services/:serviceId`
- `PATCH /services/:serviceId`
- `GET /services/:serviceId/metrics`
- `GET /services/:serviceId/deployments`
- `POST /services/:serviceId/deployments`

## Telemetry Ingestion

- `POST /ingest/heartbeat`
- `POST /ingest/metrics`
- `POST /ingest/logs`
- `POST /ingest/traces`
- `POST /ingest/dependencies`

Example metrics payload:

```json
{
  "service": {
    "name": "auth-service",
    "environment": "PRODUCTION",
    "version": "1.4.2"
  },
  "batchId": "01JZ0R2N8XY5A",
  "metrics": [
    {
      "timestamp": "2026-06-05T10:00:00.000Z",
      "cpuPercent": 72.4,
      "memoryPercent": 68.1,
      "requestCount": 218,
      "errorCount": 7,
      "avgLatencyMs": 184.2,
      "p95LatencyMs": 612.8,
      "statusCodes": { "200": 198, "500": 7, "404": 13 }
    }
  ]
}
```

## Logs

- `GET /projects/:projectId/logs?service=&environment=&level=&q=&from=&to=&cursor=`
- `GET /projects/:projectId/logs/live-token`
- `POST /projects/:projectId/logs/export`

Search examples:

- `service:auth`
- `level:error`
- `status:500`
- `"connection timeout"`

## Traces

- `GET /projects/:projectId/traces?service=&status=&from=&to=&minDurationMs=`
- `GET /traces/:traceId`
- `GET /traces/:traceId/waterfall`
- `GET /traces/:traceId/bottlenecks`

## Dashboard

- `GET /projects/:projectId/dashboard/overview`
- `GET /projects/:projectId/dashboard/timeseries?metric=&from=&to=&step=`
- `GET /projects/:projectId/dashboard/top-endpoints`
- `GET /projects/:projectId/dashboard/slowest-endpoints`

## Alerts

- `GET /projects/:projectId/alert-rules`
- `POST /projects/:projectId/alert-rules`
- `PATCH /alert-rules/:ruleId`
- `DELETE /alert-rules/:ruleId`
- `GET /projects/:projectId/alerts`
- `PATCH /alerts/:alertId/state`

## Incidents

- `GET /projects/:projectId/incidents`
- `POST /projects/:projectId/incidents`
- `GET /incidents/:incidentId`
- `PATCH /incidents/:incidentId`
- `POST /incidents/:incidentId/timeline`
- `POST /incidents/:incidentId/ai-analysis`

## Topology

- `GET /projects/:projectId/topology`
- `POST /projects/:projectId/topology/recompute`

Response shape:

```json
{
  "nodes": [
    { "id": "svc-auth", "label": "auth-service", "status": "DEGRADED", "healthScore": 62 }
  ],
  "edges": [
    { "id": "auth-db", "source": "svc-auth", "target": "svc-db", "errorRate": 0.06, "avgLatencyMs": 420 }
  ]
}
```

## Reporting

- `GET /projects/:projectId/reports`
- `POST /projects/:projectId/reports`
- `GET /reports/:reportId/download`

## Socket.IO Events

Client joins rooms after auth:

- `project:subscribe`
- `project:unsubscribe`

Server emits:

- `service.health.updated`
- `metrics.timeseries.appended`
- `logs.appended`
- `trace.completed`
- `alert.triggered`
- `incident.updated`
- `topology.updated`

