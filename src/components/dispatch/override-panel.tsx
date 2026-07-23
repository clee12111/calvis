"use client";

import { useState, useEffect } from "react";

interface OverridePanelProps {
  incidentId: string;
  currentTier: number;
  autonomyGate: string;
  onAction: (action: string, newTier?: number, reason?: string) => void;
}

const TIER_OPTIONS = [
  { value: 0, label: "T0 SUPPRESS" },
  { value: 1, label: "T1 WATCH" },
  { value: 2, label: "T2 NOTIFY" },
  { value: 3, label: "T3 DISPATCH" },
  { value: 4, label: "T4 ESCALATE" },
];

export function OverridePanel({
  incidentId,
  currentTier,
  autonomyGate,
  onAction,
}: OverridePanelProps) {
  const [mode, setMode] = useState<"idle" | "modify" | "override">("idle");
  const [selectedTier, setSelectedTier] = useState(currentTier);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priorUpdates, setPriorUpdates] = useState<Array<{ eventType: string; before: number; after: number; n: number }> | null>(null);

  // Reset state when incident changes
  useEffect(() => {
    setMode("idle");
    setSelectedTier(currentTier);
    setReason("");
    setError(null);
    setPriorUpdates(null);
  }, [incidentId, currentTier]);

  const isPropose = autonomyGate === "propose";

  const handleApprove = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, action: "approve" }),
      });
      const data = await res.json();
      if (data.ok) {
        onAction("approve");
      } else {
        setError(data.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleModify = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId,
          action: "modify",
          newTier: selectedTier,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onAction("modify", selectedTier);
        setMode("idle");
      } else {
        setError(data.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOverride = async () => {
    if (!reason.trim()) {
      setError("Reason is required for override");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId,
          action: "override",
          newTier: selectedTier,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onAction("override", selectedTier, reason.trim());
        setMode("idle");
        setReason("");
        setError(null);
        if (data.priorUpdates) {
          setPriorUpdates(data.priorUpdates);
          setTimeout(() => setPriorUpdates(null), 8000);
          // Push to learning panel
          const pushFn = (globalThis as any).__calvisLearningPanelPush;
          if (pushFn) {
            pushFn(data.priorUpdates.map((u: any) => ({ ...u, timestamp: Date.now() })));
          }
        }
      } else {
        setError(data.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setMode("idle");
    setReason("");
    setSelectedTier(currentTier);
    setError(null);
  };

  return (
    <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">
          Operator Action
        </h3>
        {isPropose && (
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 bg-orange-500/20 border border-orange-500/40 rounded text-orange-400">
            Propose
          </span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="text-[10px] font-mono text-red-400 bg-red-900/20 border border-red-800/30 rounded px-2 py-1.5">
          {error}
        </div>
      )}

      {mode === "idle" && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleApprove}
            disabled={submitting}
            className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => { setMode("modify"); setError(null); }}
            disabled={submitting}
            className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors disabled:opacity-50"
          >
            Modify
          </button>
          <button
            onClick={() => { setMode("override"); setError(null); }}
            disabled={submitting}
            className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white rounded transition-colors disabled:opacity-50"
          >
            Override
          </button>
        </div>
      )}

      {mode === "modify" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-500 uppercase">New Tier</span>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(Number(e.target.value))}
              className="bg-zinc-900 border border-zinc-700 rounded text-[10px] font-mono text-zinc-300 px-2 py-1 focus:outline-none focus:border-orange-500"
            >
              {TIER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleModify}
              disabled={submitting}
              className="px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "override" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-500 uppercase">New Tier</span>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(Number(e.target.value))}
              className="bg-zinc-900 border border-zinc-700 rounded text-[10px] font-mono text-zinc-300 px-2 py-1 focus:outline-none focus:border-orange-500"
            >
              {TIER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <input
            type="text"
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(null); }}
            placeholder="Reason for override (required)"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleOverride();
              if (e.key === "Escape") handleCancel();
            }}
            className="w-full bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-300 px-2 py-1.5 placeholder:text-zinc-700 focus:outline-none focus:border-red-500"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleOverride}
              disabled={submitting || !reason.trim()}
              className="px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white rounded transition-colors disabled:opacity-50"
            >
              Confirm Override
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Prior movement display */}
      {priorUpdates && priorUpdates.length > 0 && (
        <div className="bg-emerald-900/20 border border-emerald-800/30 rounded px-2 py-1.5 space-y-1">
          <div className="text-[9px] font-mono text-emerald-500 uppercase tracking-wider">
            Prior Updated
          </div>
          {priorUpdates.map((u, idx) => {
            const delta = u.after - u.before;
            const sign = delta >= 0 ? "+" : "";
            return (
              <div key={idx} className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-zinc-400">{u.eventType}</span>
                <span className="text-zinc-500">{Math.round(u.before * 100)}%</span>
                <span className="text-zinc-600">→</span>
                <span className={delta >= 0 ? "text-red-400" : "text-emerald-400"}>
                  {Math.round(u.after * 100)}%
                </span>
                <span className="text-zinc-600">
                  ({sign}{(delta * 100).toFixed(1)}%, n={u.n})
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
