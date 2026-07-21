"use client";

import { PriorityStripe, TierBadge } from "./priority-stripe";
import { ConfidenceBar } from "./confidence-bar";
import { WhyChips } from "./why-chip";

interface DecisionData {
  id: string;
  chosenTier: number;
  confidence: number;
  autonomyGate: string;
  factorsJson: string;
  timestamp: number;
}

function formatSimTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const displayHour = (20 + hours) % 24;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function DecisionCard({ decision }: { decision: DecisionData }) {
  const factors = JSON.parse(decision.factorsJson);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TierBadge tier={decision.chosenTier} />
          <span className="text-[10px] font-mono text-zinc-500 uppercase">
            {decision.autonomyGate === "auto" ? "AUTO" : "PROPOSE"}
          </span>
        </div>
        <span className="text-[10px] font-mono text-zinc-600">
          {formatSimTime(decision.timestamp)}
        </span>
      </div>

      <ConfidenceBar confidence={decision.confidence} />
      <WhyChips factors={factors} />
    </div>
  );
}
