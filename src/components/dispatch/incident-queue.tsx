"use client";

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
}

function formatSimTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const displayHour = (20 + hours) % 24;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const ATTENTION_LINE_TIER = 2; // Above this tier = needs human attention

export function IncidentQueue({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: IncidentSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const attentionIdx = incidents.findIndex(
    (i) => (i.tier ?? 0) <= ATTENTION_LINE_TIER
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800">
        <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-zinc-400">
          Queue
        </h2>
        <span className="text-[10px] font-mono text-zinc-600">
          {incidents.length} incidents
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {incidents.map((incident, idx) => {
          const eventCount = JSON.parse(incident.eventIds).length;
          const isSelected = incident.id === selectedId;
          const isAboveAttention = attentionIdx < 0 || idx < attentionIdx;

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
                onClick={() => onSelect(incident.id)}
                className={`w-full flex items-stretch gap-0 text-left hover:bg-zinc-800/50 transition-colors ${
                  isSelected ? "bg-zinc-800" : ""
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
                    <span className="text-[9px] font-mono text-zinc-500">
                      {eventCount} event{eventCount !== 1 ? "s" : ""} · {incident.status}
                    </span>
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
          <div className="px-3 py-8 text-center text-[11px] text-zinc-600 font-mono">
            No incidents yet. Start a simulation.
          </div>
        )}
      </div>
    </div>
  );
}
