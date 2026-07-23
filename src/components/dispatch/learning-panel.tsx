"use client";

import { useState, useEffect, useCallback } from "react";

interface PriorUpdate {
  eventType: string;
  before: number;
  after: number;
  n: number;
  timestamp: number;
}

interface LearnedPrior {
  key: string;
  eventType: string;
  pReal: number;
  startPReal: number;
  movement: number;
  n: number;
}

export function LearningPanel() {
  const [recentUpdates, setRecentUpdates] = useState<PriorUpdate[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // Listen for override events to show prior movement
  const addUpdate = useCallback((updates: PriorUpdate[]) => {
    setRecentUpdates((prev) => [...updates, ...prev].slice(0, 20));
  }, []);

  // Expose globally so override panel can push updates
  useEffect(() => {
    (globalThis as any).__calvisLearningPanelPush = addUpdate;
    return () => { delete (globalThis as any).__calvisLearningPanelPush; };
  }, [addUpdate]);

  return (
    <div className="border-t border-zinc-800">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-zinc-400">
            Learning
          </h2>
          {recentUpdates.length > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded border border-emerald-500/30">
              {recentUpdates.length} update{recentUpdates.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span className="text-[9px] font-mono text-zinc-600">
          {isExpanded ? "▾" : "▸"}
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* How it works */}
          <div className="text-[10px] font-mono text-zinc-600 leading-relaxed">
            When you override a decision, the system updates its priors.
            Each override is one observation — "this event type at this site was{" "}
            <span className="text-emerald-500">real</span> or{" "}
            <span className="text-red-400">false alarm</span>."
            Over time, the agent learns which sites and event types
            need more attention.
          </div>

          {/* Recent prior updates */}
          {recentUpdates.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
                Recent Prior Updates
              </div>
              {recentUpdates.map((u, idx) => {
                const delta = u.after - u.before;
                return (
                  <div key={idx} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="text-zinc-400 truncate flex-1">{u.eventType}</span>
                    <span className="text-zinc-600">{Math.round(u.before * 100)}%</span>
                    <span className="text-zinc-700">→</span>
                    <span className={delta >= 0 ? "text-red-400" : "text-emerald-400"}>
                      {Math.round(u.after * 100)}%
                    </span>
                    <span className="text-zinc-700 text-[9px]">n={u.n}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[10px] font-mono text-zinc-700 py-2">
              No overrides yet. Override an incident to see the system learn.
            </div>
          )}

          {/* What "getting smarter" means */}
          <div className="bg-zinc-900 border border-zinc-800 rounded p-2 space-y-1.5">
            <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">
              What "getting smarter" means
            </div>
            <div className="text-[10px] font-mono text-zinc-500 leading-relaxed">
              The system maintains a probability estimate P(real) for each event type
              at each site. A panic button starts at 85% — but if three overrides
              say "false alarm," it drops to 42%. The agent sees this as{" "}
              <span className="text-zinc-300">n=3</span> observations, not a
              guess. It adjusts more conservatively when n is high.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
