"use client";

import { useState, useCallback } from "react";
import { OverridePanel } from "./override-panel";
import type { AgentTrace } from "@/lib/engine/incident-cache";

interface IncidentDetailData {
  id: string;
  siteId: string;
  zoneId: string | null;
  status: string;
  priority: number | null;
  tier: number | null;
  confidence: number | null;
  createdAt: number;
  events: any[];
  decisions: any[];
  site?: { name: string; criticalityTier: number } | null;
  trace?: AgentTrace | null;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const displayHour = (20 + hours) % 24;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const EVENT_LABELS: Record<string, string> = {
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

const EVIDENCE_LABELS: Record<number, string> = {
  0: "E0 — Nothing to act on",
  1: "E1 — Something happened",
  2: "E2 — Human presence confirmed",
  3: "E3 — Threat to property",
  4: "E4 — Threat to life",
};

const EVIDENCE_COLORS: Record<number, string> = {
  0: "text-zinc-500",
  1: "text-blue-400",
  2: "text-yellow-400",
  3: "text-orange-400",
  4: "text-red-400",
};

const SEVERITY_COLORS = ["", "text-zinc-400", "text-blue-400", "text-yellow-400", "text-orange-400", "text-red-400"];

const MOVE_LABELS: Record<string, string> = {
  suppress: "Suppress", log_and_watch: "Log & Watch", notify_guard: "Notify Guard",
  dispatch_backup: "Dispatch Backup", escalate_overwatch: "Escalate to Human",
  request_photo: "Request Photo", ask_guard_radio: "Radio Guard", ask_client_confirm: "Ask Client",
  recheck_5min: "Recheck in 5 min", suppress_ttl: "Suppress (TTL)",
};

/** Build a unified timeline: events + agent steps interleaved by timestamp */
function buildTimeline(incident: IncidentDetailData) {
  const items: Array<{
    time: number;
    type: "event" | "investigate" | "commit" | "defer" | "agent-reasoning";
    label: string;
    detail?: string;
    evidenceBefore?: number;
    evidenceAfter?: number;
    severity?: number;
    source?: string;
  }> = [];

  // Add events
  for (const e of incident.events ?? []) {
    items.push({
      time: e.timestamp,
      type: "event",
      label: EVENT_LABELS[e.type] ?? e.type,
      detail: `Severity ${e.severity} from ${e.sourceType}`,
      severity: e.severity,
      source: e.sourceType,
    });
  }

  // Add agent investigation steps
  if (incident.trace?.steps) {
    for (const step of incident.trace.steps) {
      items.push({
        time: step.timestamp,
        type: step.moveType as any,
        label: step.moveType === "commit"
          ? `Decision: ${step.actionName}`
          : step.moveType === "investigate"
            ? `Checked: ${step.actionName}`
            : step.actionName,
        detail: step.reason,
        evidenceBefore: step.evidenceBefore,
        evidenceAfter: step.evidenceAfter,
      });
    }
  }

  // Sort by time
  items.sort((a, b) => a.time - b.time);

  // Add agent reasoning as final entry if available
  const trace = incident.trace;
  if (trace && trace.adjustmentReasons?.length > 0) {
    const hasRealReasoning = !trace.adjustmentReasons[0]?.startsWith("system-question") &&
      !trace.adjustmentReasons[0]?.startsWith("waiting") &&
      !trace.adjustmentReasons[0]?.startsWith("fallback");

    if (hasRealReasoning || trace.rawResponse?.text) {
      items.push({
        time: (items.length > 0 ? items[items.length - 1].time : incident.createdAt) + 1,
        type: "agent-reasoning",
        label: "Agent Analysis",
      });
    }
  }

  return items;
}

export function IncidentDetail({ incident }: { incident: IncidentDetailData | null }) {
  const [showRawThinking, setShowRawThinking] = useState(false);

  const handleOverrideAction = useCallback(
    (_action: string, _newTier?: number, _reason?: string) => {},
    []
  );

  if (!incident) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-zinc-500 text-[12px] font-mono">
          Select an incident to see the full timeline
        </div>
        <div className="text-zinc-700 text-[10px] font-mono">
          Press J/K or arrow keys to navigate
        </div>
      </div>
    );
  }

  const trace = incident.trace;
  const evidenceLevel = trace?.evidenceLevel ?? incident.tier ?? 0;
  const timeline = buildTimeline(incident);
  const hasRealReasoning = trace?.adjustmentReasons?.length
    && !trace.adjustmentReasons[0]?.startsWith("system-question")
    && !trace.adjustmentReasons[0]?.startsWith("waiting")
    && !trace.adjustmentReasons[0]?.startsWith("fallback");

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ═══ HEADER ═══ */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-zinc-300">
            {incident.site?.name ?? incident.siteId}
          </span>
          <span className={`text-[11px] font-mono font-bold ${EVIDENCE_COLORS[evidenceLevel]}`}>
            {EVIDENCE_LABELS[evidenceLevel]}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500">
          <span>{formatTime(incident.createdAt)}</span>
          <span>{incident.events?.length ?? 0} event{(incident.events?.length ?? 0) !== 1 ? "s" : ""}</span>
          <span>{trace?.steps?.length ?? 0} agent actions</span>
          {trace?.pReal ? (
            <span>P(real): <span className="text-zinc-300">{Math.round(trace.pReal * 100)}%</span></span>
          ) : null}
          <span className="text-zinc-600">{incident.id}</span>
        </div>
      </div>

      {/* ═══ TIMELINE — the full story ═══ */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="space-y-0">
          {timeline.map((item, idx) => {
            const isEvent = item.type === "event";
            const isCommit = item.type === "commit";
            const isReasoning = item.type === "agent-reasoning";
            const levelChanged = item.evidenceBefore !== undefined && item.evidenceAfter !== undefined && item.evidenceBefore !== item.evidenceAfter;

            if (isReasoning) {
              // Render the full agent reasoning block
              return (
                <div key={idx} className="pl-5 pb-2 pt-1">
                  <AgentReasoning
                    trace={trace!}
                    showRawThinking={showRawThinking}
                    onToggleRaw={() => setShowRawThinking(!showRawThinking)}
                  />
                </div>
              );
            }

            return (
              <div key={idx} className="flex items-start gap-2">
                {/* Timeline dot + line */}
                <div className="flex flex-col items-center shrink-0 pt-1.5">
                  <div className={`w-2 h-2 rounded-full ${
                    isCommit ? "bg-orange-500" :
                    isEvent ? (item.severity && item.severity >= 4 ? "bg-red-400" : item.severity && item.severity >= 3 ? "bg-yellow-400" : "bg-zinc-600") :
                    levelChanged ? "bg-yellow-500" :
                    "bg-zinc-700"
                  }`} />
                  {idx < timeline.length - 1 && (
                    <div className="w-px flex-1 min-h-[16px] bg-zinc-800" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-zinc-600 w-14 shrink-0">
                      {formatTime(item.time)}
                    </span>

                    {isEvent ? (
                      <>
                        <span className={`text-[10px] font-mono font-bold ${SEVERITY_COLORS[item.severity ?? 1]}`}>
                          S{item.severity}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-300">
                          {item.label}
                        </span>
                        <span className="text-[9px] font-mono text-zinc-600">
                          {item.source}
                        </span>
                      </>
                    ) : isCommit ? (
                      <>
                        <span className="text-[10px] font-mono font-bold text-orange-400 uppercase">
                          Decision
                        </span>
                        <span className="text-[11px] font-mono text-orange-300">
                          {MOVE_LABELS[item.label.replace("Decision: ", "")] ?? item.label}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] font-mono text-zinc-500 uppercase">
                          {item.type === "investigate" ? "Check" : item.type}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-400">
                          {item.label.replace("Checked: ", "")}
                        </span>
                      </>
                    )}

                    {levelChanged && (
                      <span className="text-[9px] font-mono text-yellow-400 font-bold">
                        E{item.evidenceBefore} → E{item.evidenceAfter}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {timeline.length === 0 && (
            <div className="text-[10px] font-mono text-zinc-700 py-2">
              No events or actions recorded
            </div>
          )}
        </div>
      </div>

      {/* ═══ OVERRIDE ═══ */}
      {incident.tier !== null && (
        <OverridePanel
          incidentId={incident.id}
          currentTier={incident.tier}
          autonomyGate={incident.tier >= 3 ? "propose" : "auto"}
          onAction={handleOverrideAction}
        />
      )}
    </div>
  );
}

/** The agent's reasoning block — probability, why, what-would-change */
function AgentReasoning({
  trace,
  showRawThinking,
  onToggleRaw,
}: {
  trace: AgentTrace;
  showRawThinking: boolean;
  onToggleRaw: () => void;
}) {
  const hasStructured = trace.adjustmentReasons?.length > 0 &&
    !trace.adjustmentReasons[0]?.startsWith("system-question") &&
    !trace.adjustmentReasons[0]?.startsWith("waiting") &&
    !trace.adjustmentReasons[0]?.startsWith("fallback");

  const pRealPct = Math.round(trace.pReal * 100);
  const basePriorPct = Math.round(trace.basePrior * 100);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 space-y-2.5">
      <div className="text-[10px] font-mono font-bold text-orange-400 uppercase tracking-wider">
        Agent Analysis
      </div>

      {hasStructured && (
        <>
          {/* Probability chain */}
          <div className="flex items-center gap-2 text-[11px] font-mono flex-wrap">
            <span className="text-zinc-500">P(real):</span>
            <span className="text-zinc-400">{basePriorPct}% prior</span>
            <span className="text-zinc-700">→</span>
            <span className={trace.adjustment >= 0 ? "text-red-400" : "text-emerald-400"}>
              {trace.adjustment >= 0 ? "+" : ""}{trace.adjustment.toFixed(1)}
            </span>
            <span className="text-zinc-700">→</span>
            <span className="text-zinc-100 font-bold">{pRealPct}%</span>
          </div>

          {/* Reasons */}
          <div className="space-y-0.5">
            {trace.adjustmentReasons.map((reason, idx) => (
              <div key={idx} className="text-[11px] font-mono text-zinc-400 flex items-start gap-2">
                <span className="text-zinc-600 shrink-0 mt-px">-</span>
                <span>{reason}</span>
              </div>
            ))}
          </div>

          {/* What would change */}
          {trace.whatWouldChange && (
            <div className="text-[11px] font-mono pt-1 border-t border-zinc-800">
              <span className="text-zinc-500">Would change mind: </span>
              <span className="text-zinc-300">{trace.whatWouldChange}</span>
            </div>
          )}
        </>
      )}

      {/* Model info */}
      {trace.modelId && (
        <div className="text-[9px] font-mono text-zinc-600 flex items-center gap-3">
          <span>{trace.modelId}</span>
          {trace.modelTier && <span>{trace.modelTier} tier</span>}
          {trace.costUsd ? <span>${trace.costUsd.toFixed(4)}</span> : null}
          {trace.inputTokens ? <span>{trace.inputTokens + (trace.outputTokens ?? 0)} tokens</span> : null}
        </div>
      )}

      {/* Raw thinking toggle */}
      {trace.rawResponse?.text && (
        <>
          <button
            onClick={onToggleRaw}
            className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {showRawThinking ? "▾ Hide" : "▸ Show"} full model thinking
          </button>
          {showRawThinking && (
            <div className="bg-zinc-950 border border-zinc-800 rounded p-2 max-h-64 overflow-y-auto text-[10px] font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed">
              {trace.rawResponse.text}
            </div>
          )}
        </>
      )}
    </div>
  );
}
