import React from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertTriangle, GitBranch, RadioTower, Search, Server, ShieldCheck } from "lucide-react";
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

const series = [
  { time: "10:00", cpu: 52, memory: 61, latency: 142, errors: 0.8 },
  { time: "10:05", cpu: 58, memory: 63, latency: 168, errors: 1.2 },
  { time: "10:10", cpu: 67, memory: 70, latency: 244, errors: 2.8 },
  { time: "10:15", cpu: 72, memory: 76, latency: 318, errors: 4.1 },
  { time: "10:20", cpu: 64, memory: 72, latency: 210, errors: 1.9 },
  { time: "10:25", cpu: 59, memory: 68, latency: 181, errors: 1.1 }
];

const services = [
  { name: "api-gateway", status: "Healthy", score: 96, latency: "82 ms", errorRate: "0.2%" },
  { name: "auth-service", status: "Degraded", score: 62, latency: "612 ms", errorRate: "6.1%" },
  { name: "user-service", status: "Warning", score: 78, latency: "214 ms", errorRate: "1.8%" },
  { name: "billing-worker", status: "Healthy", score: 91, latency: "134 ms", errorRate: "0.5%" }
];

const incidents = [
  { id: "INC-1042", title: "Login latency regression", severity: "Critical", state: "Investigating", service: "auth-service" },
  { id: "INC-1041", title: "Billing queue depth elevated", severity: "Warning", state: "Acknowledged", service: "billing-worker" }
];

function App() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><RadioTower size={22} /> DevTrace</div>
        {["Overview", "Services", "Logs", "Traces", "Topology", "Alerts", "Incidents", "Reports", "Settings"].map((item) => (
          <button className={item === "Overview" ? "nav active" : "nav"} key={item}>{item}</button>
        ))}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Production Observability</h1>
            <p>Payments Platform · Production · Last 30 minutes</p>
          </div>
          <div className="search"><Search size={18} /><span>service:auth level:error</span></div>
        </header>

        <section className="kpis">
          <Metric icon={<ShieldCheck />} label="Health Score" value="86" tone="good" />
          <Metric icon={<Server />} label="Services" value="24" tone="neutral" />
          <Metric icon={<AlertTriangle />} label="Open Alerts" value="7" tone="warn" />
          <Metric icon={<Activity />} label="Error Rate" value="1.9%" tone="bad" />
          <Metric icon={<GitBranch />} label="Active Incidents" value="2" tone="warn" />
        </section>

        <section className="grid">
          <Panel title="Resource Pressure">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series}>
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
              <LineChart data={series}>
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
          <Panel title="Service Health">
            <table>
              <tbody>
                {services.map((service) => (
                  <tr key={service.name}>
                    <td>{service.name}</td>
                    <td><span className={`pill ${service.status.toLowerCase()}`}>{service.status}</span></td>
                    <td>{service.score}</td>
                    <td>{service.latency}</td>
                    <td>{service.errorRate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Incident Intelligence">
            <table>
              <tbody>
                {incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>{incident.id}</td>
                    <td>{incident.title}</td>
                    <td>{incident.severity}</td>
                    <td>{incident.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </section>
      </section>
    </main>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return <div className={`metric ${tone}`}><div>{icon}</div><span>{label}</span><strong>{value}</strong></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

createRoot(document.getElementById("root")!).render(<App />);

