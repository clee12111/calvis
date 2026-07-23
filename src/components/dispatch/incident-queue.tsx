"use client";

import { useEffect, useRef } from "react";
import { PriorityStripe } from "./priority-stripe";
import { ConfidenceBar } from "./confidence-bar";

interface IncidentSummary {
  id: string;
  siteId: string;
  zoneId: string | null;
  status: string;
  priority: number | null;
  tier: number | null;
  confidence: number | null;
  eventIds: string;
  createdAt: number;
  site?: { name: string } | null;
  trace?: { arm?: string; evidenceLevel?: number } | null;
}

function formatSimTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const displayHour = (20 + hours) % 24;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const ATTENTION_LINE_TIER = 2;

const EVIDENCE_SHORT: Record<number, string> = {
  0: "E0",
  1: "E1",
  2: "E2",
  3: "E3",
  4: "E4",
};

const EVIDENCE_COLORS: Record<number, string> = {
  0: "text-zinc-600",
  1: "text-blue-400",
  2: "text-yellow-400",
  3: "text-orange-400",
  4: "text-red-400",
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
  const attentionIdx = incidents.findIndex(
    (i) => (i.tier ?? 0) <= ATTENTION_LINE_TIER
  );

  // Scroll selected into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800">
        <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-zinc-400">
          Queue
        </h2>
        <span className="text-[10px] font-mono text-zinc-600">
          {incidents.length} incident{incidents.length !== 1 ? "s" : ""}
          {attentionIdx > 0 && (
            <> · <span className="text-orange-500">{attentionIdx}</span> above line</>
          )}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {incidents.map((incident, idx) => {
          let eventCount = 0;
          try { eventCount = JSON.parse(incident.eventIds).length; } catch { /* fallback */ }
          const isSelected = incident.id === selectedId;
          const evidenceLevel = incident.trace?.evidenceLevel ?? incident.tier ?? 0;

          return (
            <div key={incident.id}>
              {idx === attentionIdx && attentionIdx > 0 && (
                <div className="flex items-center gap-2 px-3 py-1">
                  <div className="flex-1 h-px bg-orange-500/50" />
                  <span className="text-[9px] font-mono text-orange-500 uppercase tracking-widest">
                    Attention Line
                  </span>
                  <div className="flex-1 h-px bg-orange-500/50" />
                </div>
              )}
              <button
                ref={isSelected ? selectedRef : undefined}
                onClick={() => onSelect(incident.id)}
                className={`w-full flex items-stretch gap-0 text-left transition-colors ${
                  isSelected
                    ? "bg-zinc-800 ring-1 ring-inset ring-orange-500/30"
                    : "hover:bg-zinc-800/50"
                }`}
              >
                <PriorityStripe tier={incident.tier ?? 0} />
                <div className="flex-1 px-2 py-2 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-mono text-zinc-300 truncate">
                      {incident.site?.name ?? incident.siteId}
                    </span>
                    <span className="text-[9px] font-mono text-zinc-600 shrink-0">
                      {formatSimTime(incident.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-mono font-bold ${EVIDENCE_COLORS[evidenceLevel]}`}>
                        {EVIDENCE_SHORT[evidenceLevel] ?? `E${evidenceLevel}`}
                      </span>
                      <span className="text-[9px] font-mono text-zinc-500">
                        {eventCount} event{eventCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {incident.confidence !== null && (
                      <div className="w-16">
                        <ConfidenceBar confidence={incident.confidence} />
                      </div>
                    )}
                  </div>
                </div>
              </button>
            </div>
          );
        })}

        {incidents.length === 0 && (
          <div className="flex flex-col items-center justify-center px-3 py-12 gap-2">
            <div className="text-[11px] text-zinc-500 font-mono">
              No incidents yet
            </div>
            <div className="text-[10px] text-zinc-700 font-mono text-center">
              Press Start Sim to begin
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
