import { EventEmitter } from "node:events";

export type RealtimeEvent =
  | "service.health.updated"
  | "metrics.timeseries.appended"
  | "logs.appended"
  | "trace.completed"
  | "alert.triggered"
  | "incident.updated"
  | "topology.updated";

export const realtime = new EventEmitter();

export function publishRealtime(event: RealtimeEvent, payload: unknown) {
  realtime.emit(event, payload);
}
