"use client";

import { useCallback } from "react";
import { TierBadge } from "./priority-stripe";
import { InvestigationTrace } from "./investigation-trace";
import { OverridePanel } from "./override-panel";
import type { AgentTrace } from "@/lib/engine/incident-cache";

interface EventData {
  id: string;
  type: string;
  severity: number;
  timestamp: number;
  sourceType: string;
  sourceId: string | null;
  zoneId: string | null;
}

interface IncidentDetailData {
  id: string;
  siteId: string;
  zoneId: string | null;
  status: string;
  priority: number | null;
  tier: number | null;
  confidence: number | null;
  createdAt: number;
  events: EventData[];
  decisions: any[];
  site?: { name: string; criticalityTier: number } | null;
  trace?: AgentTrace | null;
}

function formatSimTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const displayHour = (20 + hours) % 24;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  missed_check_in: "Missed Check-In",
  geofence_exit: "Geofence Exit",
  panic_button: "Panic Button",
  no_show_at_shift_start: "No-Show at Shift",
  robot_motion_anomaly: "Motion Anomaly",
  robot_thermal_anomaly: "Thermal Anomaly",
  robot_offline: "Robot Offline",
  plate_read_unknown: "Unknown Plate",
  door_forced: "Door Forced",
  radio_transcript_flag: "Radio Flag",
  client_inbound_message: "Client Message",
  area_advisory: "Area Advisory",
};

const SEVERITY_COLORS = [
  "",
  "text-zinc-400",    // 1
  "text-blue-400",    // 2
  "text-yellow-400",  // 3
  "text-orange-400",  // 4
  "text-red-400",     // 5
];

// AVS-01 evidence levels
const EVIDENCE_LABELS: Record<number, string> = {
  0: "E0 — NOTHING TO ACT ON",
  1: "E1 — SOMETHING HAPPENED",
  2: "E2 — HUMAN PRESENCE CONFIRMED",
  3: "E3 — THREAT TO PROPERTY",
  4: "E4 — THREAT TO LIFE",
};

const EVIDENCE_COLORS: Record<number, string> = {
  0: "text-zinc-500",
  1: "text-blue-400",
  2: "text-yellow-400",
  3: "text-orange-400",
  4: "text-red-400",
};

export function IncidentDetail({ incident }: { incident: IncidentDetailData | null }) {
  // OverridePanel handles the API call; this callback is for parent state updates only
  const handleOverrideAction = useCallback(
    (_action: string, _newTier?: number, _reason?: string) => {
      // No-op — OverridePanel already called /api/override
    },
    []
  );

  if (!incident) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-zinc-600 text-[11px] font-mono">
          No incident selected
        </div>
        <div className="text-zinc-700 text-[10px] font-mono">
          Select an incident from the queue, or press J/K to navigate
        </div>
      </div>
    );
  }

  // Derive evidence level from trace
  const evidenceLevel = incident.trace?.evidenceLevel ?? incident.tier ?? null;
  const latestDecision = incident.decisions.length > 0
    ? incident.decisions[incident.decisions.length - 1]
    : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-zinc-400">
            Incident Detail
          </h2>
          <span className="text-[10px] font-mono text-zinc-600">{incident.id}</span>
        </div>
        <div className="flex items-center gap-3">
          {incident.tier !== null && <TierBadge tier={incident.tier} />}
          <span className="text-xs text-zinc-300">
            {incident.site?.name ?? incident.siteId}
          </span>
          <span className="text-[10px] font-mono text-zinc-500 uppercase">
            {incident.status}
          </span>
          {evidenceLevel !== null && (
            <span
              className={`text-[10px] font-mono font-bold uppercase tracking-wider ${EVIDENCE_COLORS[evidenceLevel] ?? "text-zinc-500"}`}
            >
              {EVIDENCE_LABELS[evidenceLevel] ?? `E${evidenceLevel}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-500">
          <span>Priority: {incident.priority?.toFixed(1) ?? "—"}</span>
          <span>Site Crit: {incident.site?.criticalityTier ?? "?"}</span>
          <span>{formatSimTime(incident.createdAt)}</span>
          {incident.confidence !== null && incident.confidence !== undefined && (
            <span>P(real): {Math.round(incident.confidence * 100)}%</span>
          )}
        </div>
      </div>

      {/* Override Panel */}
      {incident.tier !== null && (
        <OverridePanel
          incidentId={incident.id}
          currentTier={incident.tier}
          autonomyGate={latestDecision?.autonomyGate ?? (incident.tier >= 3 ? "propose" : "auto")}
          onAction={handleOverrideAction}
        />
      )}

      {/* Investigation Trace */}
      <InvestigationTrace trace={incident.trace ?? null} />

      {/* Correlated Events */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 mb-2">
          Correlated Events ({incident.events.length})
        </h3>
        {incident.events.length === 0 ? (
          <div className="text-[10px] font-mono text-zinc-700">No events correlated</div>
        ) : (
          <div className="space-y-1">
            {incident.events.map((event: any) => (
              <div
                key={event.id}
                className="flex items-center gap-2 text-[11px] font-mono"
              >
                <span className="text-zinc-600 w-14 shrink-0">
                  {formatSimTime(event.timestamp)}
                </span>
                <span className={`${SEVERITY_COLORS[event.severity] ?? "text-zinc-400"} shrink-0`}>
                  S{event.severity}
                </span>
                <span className="text-zinc-300 truncate">
                  {EVENT_TYPE_LABELS[event.type] ?? event.type}
                </span>
                <span className="text-zinc-600 text-[9px] shrink-0">
                  {event.sourceType}{event.sourceId ? `/${event.sourceId.split("-").pop()}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
