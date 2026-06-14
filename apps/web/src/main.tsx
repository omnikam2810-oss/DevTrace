import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  Activity,
  AlertTriangle,
  Bell,
  FileText,
  GitBranch,
  Rocket,
  ListFilter,
  Play,
  RadioTower,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Siren,
  Waypoints
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const navItems = ["Overview", "Services", "Deployments", "Logs", "Traces", "Topology", "Alerts", "Incidents", "Reports"] as const;
type View = typeof navItems[number];

type DashboardSummary = {
  kpis: { healthScore: number; services: number; openAlerts: number; errorRate: number; activeIncidents: number };
  services: ServiceRow[];
  series: ChartPoint[];
  incidents: IncidentRow[];
  logs: LogRow[];
};

type ChartPoint = { time: string; cpu: number; memory: number; latency: number; errors: number };
type ServiceMetricPoint = {
  id: string;
  timestamp: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number | null;
  throughputRpm: number | null;
};
type ServiceRow = {
  id: string;
  name: string;
  environment: string;
  version?: string | null;
  status: string;
  healthScore?: number;
  score?: number;
  latency?: number;
  errorRate?: number;
  lastSeenAt?: string | null;
  latestMetric?: Record<string, unknown> | null;
};
type LogRow = { id: string; service: string; level: string; message: string; timestamp: string; traceId?: string | null };
type TraceRow = {
  id: string;
  rootService: string | null;
  startedAt: string;
  durationMs: number;
  status: string;
  services: string[];
  spanCount: number;
  slowestSpan?: { name: string; durationMs: number; service?: { name: string } } | null;
};
type AlertRow = { id: string; title: string; description: string; severity: string; state: string; triggeredAt: string };
type IncidentRow = {
  id: string;
  title: string;
  description?: string;
  severity: string;
  state: string;
  createdAt?: string;
  timeline?: unknown;
};
type Topology = {
  nodes: Array<{ id: string; label: string; status: string; healthScore: number; latency: number }>;
  edges: Array<{ id: string; source: string; target: string; protocol?: string | null; endpoint?: string | null; callCount: number; errorRate: number; avgLatencyMs?: number | null }>;
};
type ReportRow = { id: string; title: string; period: string; format: string; summary: Record<string, unknown>; createdAt: string };
type DeploymentRow = {
  id: string;
  serviceId: string;
  service?: string;
  version: string;
  commitSha?: string | null;
  environment: string;
  deployedBy?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};
type ServiceDependencyRow = {
  id: string;
  service: string;
  direction: "inbound" | "outbound";
  protocol?: string | null;
  endpoint?: string | null;
  callCount: number;
  errorRate: number;
  avgLatencyMs?: number | null;
  lastSeenAt: string;
};
type ServiceTraceRow = {
  id: string;
  spanId: string;
  name: string;
  startedAt: string;
  durationMs: number;
  status: string;
  traceStatus: string;
};
type ServiceDetail = ServiceRow & {
  repositoryUrl?: string | null;
  metrics: ServiceMetricPoint[];
  logs: LogRow[];
  traces: ServiceTraceRow[];
  alerts: AlertRow[];
  dependenciesOut: ServiceDependencyRow[];
  dependenciesIn: ServiceDependencyRow[];
  deployments: DeploymentRow[];
};

const emptySummary: DashboardSummary = {
  kpis: { healthScore: 0, services: 0, openAlerts: 0, errorRate: 0, activeIncidents: 0 },
  services: [],
  series: [],
  incidents: [],
  logs: []
};

function App() {
  const [activeView, setActiveView] = useState<View>("Overview");
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [topology, setTopology] = useState<Topology>({ nodes: [], edges: [] });
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [serviceDetail, setServiceDetail] = useState<ServiceDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Loading live telemetry");
  const [isSendingDemo, setIsSendingDemo] = useState(false);
  const [logLevel, setLogLevel] = useState("");
  const [logQuery, setLogQuery] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [dashboardData, serviceData, deploymentData, logData, traceData, alertData, incidentData, topologyData, reportData] = await Promise.all([
        api<DashboardSummary>("/api/v1/dashboard/summary"),
        api<ServiceRow[]>("/api/v1/services"),
        api<DeploymentRow[]>("/api/v1/deployments"),
        api<LogRow[]>(`/api/v1/logs${toQuery({ level: logLevel, q: logQuery })}`),
        api<TraceRow[]>("/api/v1/traces"),
        api<AlertRow[]>("/api/v1/alerts"),
        api<IncidentRow[]>("/api/v1/incidents"),
        api<Topology>("/api/v1/topology"),
        api<ReportRow[]>("/api/v1/reports")
      ]);

      setSummary(dashboardData);
      setServices(serviceData);
      setDeployments(deploymentData);
      setLogs(logData);
      setTraces(traceData);
      setAlerts(alertData);
      setIncidents(incidentData);
      setTopology(topologyData);
      setReports(reportData);
      setStatus("ready");
      setMessage("Live telemetry connected");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to load data");
    }
  }, [logLevel, logQuery]);

  const openServiceDetail = useCallback(async (serviceId: string) => {
    try {
      setSelectedServiceId(serviceId);
      setActiveView("Services");
      setMessage("Loading service detail");
      setServiceDetail(await api<ServiceDetail>(`/api/v1/services/${serviceId}/detail`));
      setStatus("ready");
      setMessage("Service detail loaded");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to load service detail");
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const socket = io(apiBaseUrl, { transports: ["websocket", "polling"] });
    const reload = () => {
      void loadAll();
      if (selectedServiceId) {
        void openServiceDetail(selectedServiceId);
      }
    };
    for (const eventName of [
      "service.health.updated",
      "metrics.timeseries.appended",
      "logs.appended",
      "trace.completed",
      "alert.triggered",
      "incident.updated",
      "topology.updated"
    ]) {
      socket.on(eventName, reload);
    }
    socket.on("connect", () => setMessage("Realtime connected"));
    socket.on("disconnect", () => setMessage("Realtime reconnecting"));
    return () => {
      socket.disconnect();
    };
  }, [loadAll, openServiceDetail, selectedServiceId]);

  const sendDemoTelemetry = async () => {
    setIsSendingDemo(true);
    setMessage("Sending demo telemetry");
    try {
      await sendDemoBatch();
      await wait(900);
      await loadAll();
      setMessage("Demo telemetry ingested");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to send demo telemetry");
    } finally {
      setIsSendingDemo(false);
    }
  };

  const createReport = async () => {
    await api<ReportRow>("/api/v1/reports", { method: "POST" });
    await loadAll();
  };

  const createDemoDeployment = async () => {
    await api<DeploymentRow>("/api/v1/deployments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceName: "checkout-api",
        environment: "PRODUCTION",
        version: `1.${Math.floor(Math.random() * 9) + 1}.${Math.floor(Math.random() * 20)}`,
        commitSha: crypto.randomUUID().slice(0, 8),
        deployedBy: "local-demo",
        metadata: { source: "dashboard-demo" }
      })
    });
    await loadAll();
  };

  const chartSeries = useMemo(() => summary.series.length > 0 ? summary.series : [
    { time: "--:--", cpu: 0, memory: 0, latency: 0, errors: 0 }
  ], [summary.series]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><RadioTower size={22} /> DevTrace</div>
        {navItems.map((item) => (
          <button className={item === activeView ? "nav active" : "nav"} key={item} onClick={() => setActiveView(item)}>
            {item}
          </button>
        ))}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{activeView}</h1>
            <p>Default Project / Production / No-auth local mode</p>
          </div>
          <div className="actions">
            <div className={`connection ${status}`}>{message}</div>
            <button className="iconButton" onClick={() => void loadAll()} title="Refresh dashboard"><RefreshCw size={18} /></button>
            <button className="demoButton" onClick={() => void sendDemoTelemetry()} disabled={isSendingDemo}>
              <Play size={17} /> {isSendingDemo ? "Sending" : "Demo"}
            </button>
          </div>
        </header>

        {activeView === "Overview" && <Overview summary={summary} chartSeries={chartSeries} onOpenService={(id) => void openServiceDetail(id)} />}
        {activeView === "Services" && (
          <Services
            services={services}
            selectedServiceId={selectedServiceId}
            detail={serviceDetail}
            onOpen={(id) => void openServiceDetail(id)}
            onBack={() => {
              setSelectedServiceId(null);
              setServiceDetail(null);
            }}
          />
        )}
        {activeView === "Deployments" && (
          <Deployments
            deployments={deployments}
            onCreate={() => void createDemoDeployment()}
            onOpenService={(id) => void openServiceDetail(id)}
          />
        )}
        {activeView === "Logs" && (
          <Logs logs={logs} level={logLevel} query={logQuery} onLevel={setLogLevel} onQuery={setLogQuery} onSearch={() => void loadAll()} />
        )}
        {activeView === "Traces" && <Traces traces={traces} />}
        {activeView === "Topology" && <TopologyView topology={topology} />}
        {activeView === "Alerts" && <Alerts alerts={alerts} onChange={loadAll} />}
        {activeView === "Incidents" && <Incidents incidents={incidents} onChange={loadAll} />}
        {activeView === "Reports" && <Reports reports={reports} onCreate={() => void createReport()} />}
      </section>
    </main>
  );
}

function Overview({ summary, chartSeries, onOpenService }: {
  summary: DashboardSummary;
  chartSeries: ChartPoint[];
  onOpenService: (serviceId: string) => void;
}) {
  const hasTelemetry = summary.services.length > 0 || summary.series.length > 0;
  return (
    <>
      <div className="search"><Search size={18} /><span>service:error latency status</span></div>
      <section className="kpis">
        <Metric icon={<ShieldCheck />} label="Health Score" value={String(summary.kpis.healthScore)} tone="good" />
        <Metric icon={<Server />} label="Services" value={String(summary.kpis.services)} tone="neutral" />
        <Metric icon={<Bell />} label="Open Alerts" value={String(summary.kpis.openAlerts)} tone="warn" />
        <Metric icon={<Activity />} label="Error Rate" value={`${summary.kpis.errorRate}%`} tone="bad" />
        <Metric icon={<Siren />} label="Active Incidents" value={String(summary.kpis.activeIncidents)} tone="warn" />
      </section>
      {!hasTelemetry && <EmptyState title="No telemetry stored yet" text="Click Demo to exercise API, Redis workers, Postgres storage, and realtime refresh." />}
      <section className="grid">
        <Panel title="Resource Pressure">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartSeries}>
              <defs>
                <linearGradient id="cpu" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#243142" />
              <XAxis dataKey="time" stroke="#8da0b8" />
              <YAxis stroke="#8da0b8" />
              <Tooltip />
              <Area dataKey="cpu" stroke="#22c55e" fill="url(#cpu)" />
              <Line dataKey="memory" stroke="#38bdf8" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Latency and Errors">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartSeries}>
              <CartesianGrid stroke="#243142" />
              <XAxis dataKey="time" stroke="#8da0b8" />
              <YAxis stroke="#8da0b8" />
              <Tooltip />
              <Line dataKey="latency" stroke="#f59e0b" strokeWidth={2} />
              <Line dataKey="errors" stroke="#ef4444" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </section>
      <section className="tables">
        <ServiceTable services={summary.services} onOpenService={onOpenService} />
        <LogTable logs={summary.logs} />
      </section>
    </>
  );
}

function Services({ services, selectedServiceId, detail, onOpen, onBack }: {
  services: ServiceRow[];
  selectedServiceId: string | null;
  detail: ServiceDetail | null;
  onOpen: (serviceId: string) => void;
  onBack: () => void;
}) {
  if (selectedServiceId) {
    return <ServiceDetailView detail={detail} onBack={onBack} />;
  }

  return (
    <section className="listGrid">
      {services.map((service) => (
        <button className="serviceTile serviceTileButton" key={service.id} onClick={() => onOpen(service.id)}>
          <div>
            <strong>{service.name}</strong>
            <span>{service.environment} / {service.version ?? "unversioned"}</span>
          </div>
          <span className={`pill ${service.status.toLowerCase()}`}>{formatStatus(service.status)}</span>
          <dl>
            <div><dt>Score</dt><dd>{service.healthScore ?? service.score ?? 0}</dd></div>
            <div><dt>Last seen</dt><dd>{formatTime(service.lastSeenAt)}</dd></div>
          </dl>
        </button>
      ))}
      {services.length === 0 && <EmptyState title="No services" text="Send telemetry to register services automatically." />}
    </section>
  );
}

function ServiceDetailView({ detail, onBack }: { detail: ServiceDetail | null; onBack: () => void }) {
  if (!detail) {
    return <EmptyState title="Loading service detail" text="Fetching metrics, logs, traces, alerts, and dependency data." />;
  }

  const latestMetric = detail.metrics[0];
  const metricSeries = [...detail.metrics].reverse().map((metric) => ({
    time: formatTime(metric.timestamp),
    cpu: metric.cpuPercent ?? 0,
    memory: metric.memoryPercent ?? 0,
    latency: metric.avgLatencyMs ?? 0,
    errors: metric.requestCount > 0 ? Number(((metric.errorCount / metric.requestCount) * 100).toFixed(2)) : 0
  }));

  return (
    <section className="serviceDetail">
      <div className="detailHeader">
        <button className="demoButton" onClick={onBack}>Back</button>
        <div>
          <h2>{detail.name}</h2>
          <p>{detail.environment} / {detail.version ?? "unversioned"} / last seen {formatTime(detail.lastSeenAt)}</p>
        </div>
        <span className={`pill ${detail.status.toLowerCase()}`}>{formatStatus(detail.status)}</span>
      </div>

      <section className="kpis">
        <Metric icon={<ShieldCheck />} label="Health Score" value={String(detail.healthScore ?? detail.score ?? 0)} tone="good" />
        <Metric icon={<Activity />} label="Latency" value={`${latestMetric?.avgLatencyMs ?? 0} ms`} tone="warn" />
        <Metric icon={<AlertTriangle />} label="Errors" value={String(latestMetric?.errorCount ?? 0)} tone="bad" />
        <Metric icon={<GitBranch />} label="Requests" value={String(latestMetric?.requestCount ?? 0)} tone="neutral" />
        <Metric icon={<Waypoints />} label="Dependencies" value={String(detail.dependenciesOut.length + detail.dependenciesIn.length)} tone="neutral" />
      </section>

      <section className="grid">
        <Panel title="Service Resource Trend">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={metricSeries.length > 0 ? metricSeries : [{ time: "--:--", cpu: 0, memory: 0, latency: 0, errors: 0 }]}>
              <CartesianGrid stroke="#243142" />
              <XAxis dataKey="time" stroke="#8da0b8" />
              <YAxis stroke="#8da0b8" />
              <Tooltip />
              <Area dataKey="cpu" stroke="#22c55e" fill="#1d6b4633" />
              <Line dataKey="memory" stroke="#38bdf8" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Service Latency and Errors">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={metricSeries.length > 0 ? metricSeries : [{ time: "--:--", cpu: 0, memory: 0, latency: 0, errors: 0 }]}>
              <CartesianGrid stroke="#243142" />
              <XAxis dataKey="time" stroke="#8da0b8" />
              <YAxis stroke="#8da0b8" />
              <Tooltip />
              <Line dataKey="latency" stroke="#f59e0b" strokeWidth={2} />
              <Line dataKey="errors" stroke="#ef4444" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </section>

      <section className="tables">
        <Panel title="Recent Logs">
          <CompactLogTable logs={detail.logs} />
        </Panel>
        <Panel title="Recent Traces">
          <table>
            <tbody>
              {detail.traces.map((trace) => (
                <tr key={`${trace.id}-${trace.spanId}`}>
                  <td className="mono">{trace.id.slice(0, 8)}</td>
                  <td>{trace.name}</td>
                  <td><span className={`pill ${trace.status.toLowerCase()}`}>{trace.status}</span></td>
                  <td>{trace.durationMs.toFixed(1)} ms</td>
                </tr>
              ))}
              {detail.traces.length === 0 && <EmptyRow label="No traces for this service yet" />}
            </tbody>
          </table>
        </Panel>
      </section>

      <section className="tables">
        <Panel title="Active Alerts">
          <table>
            <tbody>
              {detail.alerts.map((alert) => (
                <tr key={alert.id}>
                  <td><span className={`pill ${alert.severity.toLowerCase()}`}>{alert.severity}</span></td>
                  <td>{alert.title}</td>
                  <td>{alert.state}</td>
                  <td>{formatTime(alert.triggeredAt)}</td>
                </tr>
              ))}
              {detail.alerts.length === 0 && <EmptyRow label="No alerts for this service" />}
            </tbody>
          </table>
        </Panel>
        <Panel title="Dependencies">
          <table>
            <tbody>
              {[...detail.dependenciesOut, ...detail.dependenciesIn].map((dependency) => (
                <tr key={`${dependency.direction}-${dependency.id}`}>
                  <td>{dependency.direction}</td>
                  <td>{dependency.service}</td>
                  <td>{dependency.protocol ?? "unknown"}</td>
                  <td>{dependency.avgLatencyMs ?? 0} ms</td>
                  <td>{(dependency.errorRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
              {detail.dependenciesOut.length + detail.dependenciesIn.length === 0 && <EmptyRow label="No dependencies for this service" />}
            </tbody>
          </table>
        </Panel>
      </section>

      <Panel title="Deployment History">
        <DeploymentTable deployments={detail.deployments} />
      </Panel>
    </section>
  );
}

function Deployments({ deployments, onCreate, onOpenService }: {
  deployments: DeploymentRow[];
  onCreate: () => void;
  onOpenService: (serviceId: string) => void;
}) {
  return (
    <>
      <section className="filterBar">
        <Rocket size={18} />
        <span>Record releases and correlate changes with service health.</span>
        <button className="demoButton" onClick={onCreate}>Record Demo</button>
      </section>
      <Panel title="Deployments">
        <DeploymentTable deployments={deployments} onOpenService={onOpenService} />
      </Panel>
    </>
  );
}

function Logs({ logs, level, query, onLevel, onQuery, onSearch }: {
  logs: LogRow[];
  level: string;
  query: string;
  onLevel: (value: string) => void;
  onQuery: (value: string) => void;
  onSearch: () => void;
}) {
  return (
    <>
      <section className="filterBar">
        <ListFilter size={18} />
        <select value={level} onChange={(event) => onLevel(event.target.value)}>
          <option value="">All levels</option>
          <option value="DEBUG">Debug</option>
          <option value="INFO">Info</option>
          <option value="WARN">Warn</option>
          <option value="ERROR">Error</option>
        </select>
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search message" />
        <button className="demoButton" onClick={onSearch}>Search</button>
      </section>
      <LogTable logs={logs} />
    </>
  );
}

function Traces({ traces }: { traces: TraceRow[] }) {
  return (
    <Panel title="Trace Explorer">
      <table>
        <tbody>
          {traces.map((trace) => (
            <tr key={trace.id}>
              <td className="mono">{trace.id.slice(0, 8)}</td>
              <td>{trace.rootService ?? "unknown"}</td>
              <td><span className={`pill ${trace.status.toLowerCase()}`}>{trace.status}</span></td>
              <td>{trace.durationMs.toFixed(1)} ms</td>
              <td>{trace.spanCount} spans</td>
              <td>{trace.slowestSpan?.name ?? "none"}</td>
            </tr>
          ))}
          {traces.length === 0 && <EmptyRow label="No traces ingested yet" />}
        </tbody>
      </table>
    </Panel>
  );
}

function TopologyView({ topology }: { topology: Topology }) {
  return (
    <section className="topologyLayout">
      <Panel title="Services">
        <div className="topologyNodes">
          {topology.nodes.map((node) => (
            <div className={`topologyNode ${node.status.toLowerCase()}`} key={node.id}>
              <strong>{node.label}</strong>
              <span>{node.status} / score {node.healthScore}</span>
              <small>{node.latency} ms latency</small>
            </div>
          ))}
          {topology.nodes.length === 0 && <EmptyState title="No topology" text="Send dependency telemetry to draw service relationships." />}
        </div>
      </Panel>
      <Panel title="Dependencies">
        <table>
          <tbody>
            {topology.edges.map((edge) => {
              const source = topology.nodes.find((node) => node.id === edge.source)?.label ?? edge.source.slice(0, 8);
              const target = topology.nodes.find((node) => node.id === edge.target)?.label ?? edge.target.slice(0, 8);
              return (
                <tr key={edge.id}>
                  <td><Waypoints size={16} /></td>
                  <td>{`${source} -> ${target}`}</td>
                  <td>{edge.protocol ?? "http"}</td>
                  <td>{edge.avgLatencyMs ?? 0} ms</td>
                  <td>{(edge.errorRate * 100).toFixed(1)}%</td>
                </tr>
              );
            })}
            {topology.edges.length === 0 && <EmptyRow label="No dependencies discovered yet" />}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function Alerts({ alerts, onChange }: { alerts: AlertRow[]; onChange: () => Promise<void> }) {
  const updateState = async (alertId: string, state: string) => {
    await api(`/api/v1/alerts/${alertId}/state`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    await onChange();
  };

  return (
    <Panel title="Alerts">
      <table>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id}>
              <td><span className={`pill ${alert.severity.toLowerCase()}`}>{alert.severity}</span></td>
              <td>{alert.title}</td>
              <td>{alert.state}</td>
              <td>{formatTime(alert.triggeredAt)}</td>
              <td>
                <select value={alert.state} onChange={(event) => void updateState(alert.id, event.target.value)}>
                  {["TRIGGERED", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "CLOSED"].map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {alerts.length === 0 && <EmptyRow label="No alerts triggered yet" />}
        </tbody>
      </table>
    </Panel>
  );
}

function Incidents({ incidents, onChange }: { incidents: IncidentRow[]; onChange: () => Promise<void> }) {
  const updateState = async (incidentId: string, state: string) => {
    await api(`/api/v1/incidents/${incidentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    await onChange();
  };

  return (
    <Panel title="Incidents">
      <table>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id}>
              <td><span className={`pill ${incident.severity.toLowerCase()}`}>{incident.severity}</span></td>
              <td>{incident.title}</td>
              <td>{incident.state}</td>
              <td>{formatTime(incident.createdAt)}</td>
              <td>
                <select value={incident.state} onChange={(event) => void updateState(incident.id, event.target.value)}>
                  {["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"].map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {incidents.length === 0 && <EmptyRow label="No incidents opened yet" />}
        </tbody>
      </table>
    </Panel>
  );
}

function Reports({ reports, onCreate }: { reports: ReportRow[]; onCreate: () => void }) {
  return (
    <>
      <section className="filterBar">
        <FileText size={18} />
        <span>Manual reliability snapshots</span>
        <button className="demoButton" onClick={onCreate}>Generate</button>
      </section>
      <Panel title="Reports">
        <table>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id}>
                <td>{report.title}</td>
                <td>{report.period}</td>
                <td>{report.format}</td>
                <td>{formatTime(report.createdAt)}</td>
                <td className="mono">{JSON.stringify(report.summary)}</td>
              </tr>
            ))}
            {reports.length === 0 && <EmptyRow label="No reports generated yet" />}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

function DeploymentTable({ deployments, onOpenService }: {
  deployments: DeploymentRow[];
  onOpenService?: (serviceId: string) => void;
}) {
  return (
    <table>
      <tbody>
        {deployments.map((deployment) => (
          <tr
            className={onOpenService ? "clickRow" : undefined}
            key={deployment.id}
            onClick={() => onOpenService?.(deployment.serviceId)}
          >
            <td>{deployment.service ?? "service"}</td>
            <td><span className="pill info">{deployment.version}</span></td>
            <td className="mono">{deployment.commitSha ?? "no commit"}</td>
            <td>{deployment.environment}</td>
            <td>{deployment.deployedBy ?? "unknown"}</td>
            <td>{formatDateTime(deployment.createdAt)}</td>
          </tr>
        ))}
        {deployments.length === 0 && <EmptyRow label="No deployments recorded yet" />}
      </tbody>
    </table>
  );
}

function ServiceTable({ services, onOpenService }: { services: ServiceRow[]; onOpenService?: (serviceId: string) => void }) {
  return (
    <Panel title="Service Health">
      <table>
        <tbody>
          {services.map((service) => (
            <tr className={onOpenService ? "clickRow" : undefined} key={service.id} onClick={() => onOpenService?.(service.id)}>
              <td>{service.name}</td>
              <td><span className={`pill ${service.status.toLowerCase()}`}>{formatStatus(service.status)}</span></td>
              <td>{service.score ?? service.healthScore ?? 0}</td>
              <td>{service.latency ?? 0} ms</td>
              <td>{service.errorRate ?? 0}%</td>
            </tr>
          ))}
          {services.length === 0 && <EmptyRow label="No services have reported yet" />}
        </tbody>
      </table>
    </Panel>
  );
}

function LogTable({ logs }: { logs: LogRow[] }) {
  return (
    <Panel title="Logs">
      <table>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{log.service}</td>
              <td><span className={`pill ${log.level.toLowerCase()}`}>{log.level}</span></td>
              <td>{log.message}</td>
              <td>{formatTime(log.timestamp)}</td>
            </tr>
          ))}
          {logs.length === 0 && <EmptyRow label="No logs ingested yet" />}
        </tbody>
      </table>
    </Panel>
  );
}

function CompactLogTable({ logs }: { logs: LogRow[] }) {
  return (
    <table>
      <tbody>
        {logs.map((log) => (
          <tr key={log.id}>
            <td><span className={`pill ${log.level.toLowerCase()}`}>{log.level}</span></td>
            <td>{log.message}</td>
            <td>{formatTime(log.timestamp)}</td>
          </tr>
        ))}
        {logs.length === 0 && <EmptyRow label="No logs for this service yet" />}
      </tbody>
    </table>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return <div className={`metric ${tone}`}><div>{icon}</div><span>{label}</span><strong>{value}</strong></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <section className="emptyState"><strong>{title}</strong><span>{text}</span></section>;
}

function EmptyRow({ label }: { label: string }) {
  return <tr><td className="mutedCell" colSpan={6}>{label}</td></tr>;
}

function formatStatus(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatTime(value?: string | null) {
  if (!value) {
    return "never";
  }
  return new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "never";
  }
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toQuery(params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function sendDemoBatch() {
  const now = Date.now();
  const batchId = crypto.randomUUID();
  const service = { name: "checkout-api", environment: "PRODUCTION", version: "1.0.0" };
  const dependency = { name: "payments-db", environment: "PRODUCTION", version: "16" };
  const requests = 90 + Math.floor(Math.random() * 80);
  const errors = Math.floor(Math.random() * 12);
  const traceId = crypto.randomUUID();
  const spanId = crypto.randomUUID();

  const responses = await Promise.all([
    fetch(`${apiBaseUrl}/api/v1/ingest/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service,
        batchId: `${batchId}-metrics`,
        metrics: Array.from({ length: 6 }, (_, index) => ({
          timestamp: new Date(now - (5 - index) * 60_000).toISOString(),
          cpuPercent: 45 + Math.round(Math.random() * 45),
          memoryPercent: 52 + Math.round(Math.random() * 32),
          requestCount: requests + index * 3,
          errorCount: errors,
          avgLatencyMs: 120 + Math.round(Math.random() * 620),
          throughputRpm: 320 + Math.round(Math.random() * 160)
        }))
      })
    }),
    fetch(`${apiBaseUrl}/api/v1/ingest/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service,
        batchId: `${batchId}-logs`,
        logs: [{
          timestamp: new Date(now).toISOString(),
          level: errors > 6 ? "ERROR" : errors > 3 ? "WARN" : "INFO",
          message: errors > 6 ? "Payment authorization failed" : errors > 3 ? "Checkout latency elevated" : "Checkout service processed traffic",
          traceId,
          spanId,
          attributes: { source: "demo", requests, errors }
        }]
      })
    }),
    fetch(`${apiBaseUrl}/api/v1/ingest/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service,
        batchId: `${batchId}-traces`,
        spans: [{
          traceId,
          spanId,
          name: "POST /checkout",
          kind: "SERVER",
          startedAt: new Date(now - 250).toISOString(),
          durationMs: 180 + Math.round(Math.random() * 420),
          status: errors > 8 ? "ERROR" : "OK",
          attributes: { route: "/checkout", source: "demo" }
        }]
      })
    }),
    fetch(`${apiBaseUrl}/api/v1/ingest/dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service,
        batchId: `${batchId}-dependencies`,
        dependencies: [{
          target: dependency,
          protocol: "postgres",
          endpoint: "payments-db:5432",
          callCount: requests,
          errorRate: requests > 0 ? errors / requests : 0,
          avgLatencyMs: 80 + Math.round(Math.random() * 260)
        }]
      })
    }),
    fetch(`${apiBaseUrl}/api/v1/deployments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceName: service.name,
        environment: service.environment,
        version: service.version,
        commitSha: crypto.randomUUID().slice(0, 8),
        deployedBy: "dashboard-demo",
        metadata: { source: "demo", batchId }
      })
    })
  ]);

  const failed = responses.find((response) => !response.ok);
  if (failed) {
    throw new Error(`Demo ingest failed with ${failed.status}`);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

createRoot(document.getElementById("root")!).render(<App />);
