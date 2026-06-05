# DevTrace UI/UX Wireframes

## Navigation

```text
Top Bar: Project selector | Environment filter | Time range | Search | Alerts | User
Side Nav: Overview | Services | Logs | Traces | Topology | Alerts | Incidents | Reports | Settings
```

## Overview Dashboard

```text
+--------------------------------------------------------------------------------+
| Health Score | Services | Open Alerts | Active Incidents | Requests | Error %  |
+--------------------------------------------------------------------------------+
| CPU chart              | Memory chart           | Latency chart                |
+--------------------------------------------------------------------------------+
| Throughput chart       | Error rate chart       | Status code distribution    |
+--------------------------------------------------------------------------------+
| Degraded services      | Recent incidents       | Slowest endpoints           |
+--------------------------------------------------------------------------------+
```

Design notes: dense, operational, scan-friendly. Avoid marketing hero layouts. Charts should be compact with clear status color, time controls, and drill-down affordances.

## Service Detail

```text
Service: auth-service    HEALTHY  score 94  prod  v1.4.2  owner Platform
Tabs: Overview | Metrics | Logs | Traces | Dependencies | Deployments | Alerts

Status cards
Timeseries charts
Recent errors
Slow traces
Dependency mini-map
```

## Log Explorer

```text
Filter bar: service | env | severity | date range | query | live toggle
Log table: timestamp | level | service | trace id | message | attributes
Detail drawer: formatted JSON, copy, open trace, create alert
```

## Trace Viewer

```text
Trace summary: duration | status | services | spans | critical path
Waterfall:
request
  api-gateway  42ms
    auth-service  180ms
      postgres  133ms
Span detail drawer: tags, logs, errors, related metrics
```

## Topology Map

```text
Canvas with React Flow
Nodes: service name, health status, score, error rate
Edges: request volume, latency, error rate
Controls: zoom, fit, environment, failure propagation, layout
```

## Incident Detail

```text
Header: severity | state | owner | started | impacted services
Tabs: Timeline | Evidence | AI Analysis | Alerts | Notes | Resolution
Timeline:
10:05 CPU spike
10:06 memory spike
10:07 latency increased
10:08 error rate increased
10:09 service failure
```

