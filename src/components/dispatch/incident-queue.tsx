"use client";

import { useEffect, useRef } from "react";

interface IncidentSummary {
  id: string;
  siteId: string;
  status: string;
  priority: number | null;
  tier: number | null;
  confidence: number | null;
  eventIds: string;
  createdAt: number;
  resolvedAt: number | null;
  site?: { name: string } | null;
  events?: any[];
  trace?: {
    arm?: string;
    evidenceLevel?: number;
    move?: string;
    steps?: Array<{ moveType: string; evidenceBefore: number; evidenceAfter: number }>;
  } | null;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const displayHour = (20 + hours) % 24;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const EVIDENCE_SHORT: Record<number, string> = { 0: "E0", 1: "E1", 2: "E2", 3: "E3", 4: "E4" };
const EVIDENCE_COLORS: Record<number, string> = {
  0: "text-zinc-600", 1: "text-blue-400", 2: "text-yellow-400", 3: "text-orange-400", 4: "text-red-400",
};

const MOVE_SHORT: Record<string, string> = {
  suppress: "Suppressed", log_and_watch: "Watching", notify_guard: "Guard notified",
  dispatch_backup: "Dispatched", escalate_overwatch: "Escalated",
};

const EVENT_LABELS: Record<string, string> = {
  missed_check_in: "Missed Check-In", geofence_exit: "Geofence Exit",
  panic_button: "Panic Button", no_show_at_shift_start: "No-Show",
  robot_motion_anomaly: "Motion", robot_thermal_anomaly: "Thermal",
  robot_offline: "Robot Offline", plate_read_unknown: "Unknown Plate",
  door_forced: "Door Forced", radio_transcript_flag: "Radio Flag",
  client_inbound_message: "Client Msg", area_advisory: "Advisory",
};

export function IncidentQueue({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: IncidentSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  // Group using live state from page.tsx (_liveActive) or fall back to evidence level
  const active = incidents.filter((i: any) => i._liveActive ?? ((i.trace?.evidenceLevel ?? i.tier ?? 0) >= 1));
  const resolved = incidents.filter((i: any) => !(i._liveActive ?? ((i.trace?.evidenceLevel ?? i.tier ?? 0) >= 1)));

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800">
        <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-zinc-400">
          Incidents
        </h2>
        <div className="text-[10px] font-mono text-zinc-600">
          {active.length > 0 && <span className="text-orange-400">{active.length} active</span>}
          {active.length > 0 && resolved.length > 0 && <span> · </span>}
          {resolved.length > 0 && <span>{resolved.length} resolved</span>}
          {active.length === 0 && resolved.length === 0 && <span>No incidents yet</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Active incidents */}
        {active.map((incident) => (
          <QueueItem
            key={incident.id}
            incident={incident}
            isSelected={incident.id === selectedId}
            onSelect={onSelect}
            ref={incident.id === selectedId ? selectedRef : undefined}
          />
        ))}

        {/* Divider */}
        {active.length > 0 && resolved.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-[9px] font-mono text-zinc-700 uppercase tracking-widest">
              Resolved
            </span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>
        )}

        {/* Resolved */}
        {resolved.map((incident) => (
          <QueueItem
            key={incident.id}
            incident={incident}
            isSelected={incident.id === selectedId}
            onSelect={onSelect}
            ref={incident.id === selectedId ? selectedRef : undefined}
          />
        ))}

        {incidents.length === 0 && (
          <div className="flex flex-col items-center justify-center px-3 py-12 gap-2">
            <div className="text-[11px] text-zinc-500 font-mono">Waiting for events</div>
          </div>
        )}
      </div>
    </div>
  );
}

import { forwardRef } from "react";

const QueueItem = forwardRef<HTMLButtonElement, {
  incident: IncidentSummary;
  isSelected: boolean;
  onSelect: (id: string) => void;
}>(({ incident, isSelected, onSelect }, ref) => {
  const inc = incident as any;
  const evidenceLevel = inc._liveEvidence ?? incident.trace?.evidenceLevel ?? incident.tier ?? 0;
  const isResolved = !(inc._liveActive ?? (evidenceLevel >= 1));
  const move = incident.trace?.move;
  const moveLabel = move ? MOVE_SHORT[move] ?? move : null;

  // Get the primary event type
  const primaryEvent = incident.events?.[0]?.type;
  const eventLabel = primaryEvent ? (EVENT_LABELS[primaryEvent] ?? primaryEvent) : "";

  // Did evidence level change during investigation?
  const steps = incident.trace?.steps ?? [];
  const hadEscalation = steps.some((s) => s.evidenceAfter > s.evidenceBefore);
  const hadDeescalation = steps.some((s) => s.evidenceAfter < s.evidenceBefore);

  return (
    <button
      ref={ref}
      onClick={() => onSelect(incident.id)}
      className={`w-full text-left px-3 py-2 border-b border-zinc-800/50 transition-colors ${
        isSelected
          ? "bg-zinc-800 ring-1 ring-inset ring-orange-500/30"
          : "hover:bg-zinc-800/30"
      } ${isResolved ? "opacity-60" : ""}`}
    >
      {/* Top row: site + time */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono text-zinc-300 truncate">
          {incident.site?.name ?? incident.siteId}
        </span>
        <span className="text-[9px] font-mono text-zinc-600 shrink-0">
          {formatTime(incident.createdAt)}
        </span>
      </div>

      {/* Bottom row: evidence + event type + status */}
      <div className="flex items-center gap-2 mt-0.5">
        <span className={`text-[10px] font-mono font-bold ${EVIDENCE_COLORS[evidenceLevel]}`}>
          {EVIDENCE_SHORT[evidenceLevel]}
        </span>
        <span className="text-[10px] font-mono text-zinc-500 truncate flex-1">
          {eventLabel}
          {(incident.events?.length ?? 0) > 1 && (
            <span className="text-zinc-700"> +{(incident.events?.length ?? 1) - 1}</span>
          )}
        </span>
        {hadEscalation && <span className="text-[9px] text-red-400">↑</span>}
        {hadDeescalation && <span className="text-[9px] text-emerald-400">↓</span>}
        {moveLabel && (
          <span className={`text-[9px] font-mono shrink-0 ${isResolved ? "text-zinc-600" : "text-zinc-500"}`}>
            {moveLabel}
          </span>
        )}
      </div>
    </button>
  );
});

QueueItem.displayName = "QueueItem";
