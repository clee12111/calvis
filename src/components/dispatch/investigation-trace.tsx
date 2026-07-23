"use client";

import { useState, useRef } from "react";
import type { AgentTrace } from "@/lib/engine/incident-cache";

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

const MOVE_LABELS: Record<string, string> = {
  suppress: "Suppress",
  log_and_watch: "Log & Watch",
  request_photo: "Request Photo",
  notify_guard: "Notify Guard",
  dispatch_backup: "Dispatch Backup",
  escalate_overwatch: "Escalate to Human",
  recheck_5min: "Recheck in 5 min",
  suppress_ttl: "Suppress (TTL)",
};

export function InvestigationTrace({ trace }: { trace: AgentTrace | null }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showEngineer, setShowEngineer] = useState(false);
  // Use a ref to track which trace we're showing details for — survives re-renders from polling
  const lastTraceId = useRef<string | null>(null);

  if (!trace) {
    return (
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="text-[11px] font-mono text-zinc-600">
          Select an incident to see how the system analyzed it
        </div>
      </div>
    );
  }

  // Reset expanded state when switching to a different incident
  const currentId = `${trace.arm}-${trace.evidenceLevel}-${trace.pReal}-${trace.move}`;
  if (lastTraceId.current !== currentId) {
    lastTraceId.current = currentId;
    // Don't reset — let user's expanded state persist across polls
  }

  const isAgent = trace.arm === "agent";
  const isScripted = trace.arm === "scripted-interrogation";
  const isRules = trace.arm === "rules-only";
  const pRealPct = Math.round(trace.pReal * 100);
  const basePriorPct = Math.round(trace.basePrior * 100);

  // Does this trace have real LLM reasoning, or just the rules-decider fallback?
  const hasLlmReasoning = isAgent &&
    trace.adjustmentReasons.length > 0 &&
    !trace.adjustmentReasons[0]?.startsWith("system-question") &&
    !trace.adjustmentReasons[0]?.startsWith("waiting") &&
    !trace.adjustmentReasons[0]?.startsWith("fallback");

  return (
    <div className="px-4 py-3 border-b border-zinc-800 space-y-3">
      {/* ═══ DECISION SUMMARY — the first thing you read ═══ */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">
              Analysis
            </span>
            <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
              isAgent
                ? "text-orange-400 bg-orange-500/10 border-orange-500/30"
                : isScripted
                  ? "text-blue-400 bg-blue-500/10 border-blue-500/30"
                  : "text-zinc-400 bg-zinc-700/30 border-zinc-600/30"
            }`}>
              {isAgent ? "AI Agent" : isScripted ? "Scripted Protocol" : "Rules Engine"}
            </span>
          </div>
        </div>

        {/* Decision box — the answer */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-mono font-bold text-orange-400">
              {MOVE_LABELS[trace.move] ?? trace.move}
            </span>
            <span className={`text-[11px] font-mono font-bold ${EVIDENCE_COLORS[trace.evidenceLevel] ?? "text-zinc-500"}`}>
              {EVIDENCE_LABELS[trace.evidenceLevel] ?? `E${trace.evidenceLevel}`}
            </span>
          </div>

          {/* Agent reasoning — real LLM analysis */}
          {hasLlmReasoning && (
            <div className="space-y-2 pt-1 border-t border-zinc-800">
              {/* Probability chain */}
              <div className="flex items-center gap-2 text-[11px] font-mono flex-wrap">
                <span className="text-zinc-500">Probability this is real:</span>
                <span className="text-zinc-400">{basePriorPct}% base</span>
                <span className="text-zinc-600">→</span>
                <span className={trace.adjustment >= 0 ? "text-red-400" : "text-emerald-400"}>
                  {trace.adjustment >= 0 ? "+" : ""}{trace.adjustment.toFixed(1)} adjustment
                </span>
                <span className="text-zinc-600">→</span>
                <span className="text-zinc-100 font-bold">{pRealPct}%</span>
              </div>

              {/* Why the agent adjusted — UNIQUE per incident */}
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-zinc-500">Why:</span>
                {trace.adjustmentReasons.map((reason, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-[11px] font-mono text-zinc-400 pl-2">
                    <span className="text-zinc-600 shrink-0">-</span>
                    <span>{reason}</span>
                  </div>
                ))}
              </div>

              {/* What would change the decision */}
              {trace.whatWouldChange && (
                <div className="pt-1 border-t border-zinc-800">
                  <span className="text-[10px] font-mono text-zinc-500">What would change this decision: </span>
                  <span className="text-[11px] font-mono text-zinc-300">{trace.whatWouldChange}</span>
                </div>
              )}
            </div>
          )}

          {/* Agent without structured reasoning — show raw model thinking if available */}
          {isAgent && !hasLlmReasoning && (
            <div className="space-y-2 pt-1 border-t border-zinc-800">
              {trace.rawResponse?.text ? (
                <div className="text-[11px] font-mono text-zinc-400 leading-relaxed whitespace-pre-wrap">
                  {trace.rawResponse.text.slice(0, 600)}{trace.rawResponse.text.length > 600 ? "..." : ""}
                </div>
              ) : (
                <div className="text-[11px] font-mono text-zinc-500">
                  {trace.evidenceLevel === 0
                    ? "Low-priority — resolved by standard checks without AI analysis."
                    : trace.evidenceLevel >= 3
                      ? "High-severity — escalated immediately based on event type."
                      : "Resolved during investigation protocol before AI reasoning stage."
                  }
                </div>
              )}
            </div>
          )}

          {/* Scripted arm — explain what it did */}
          {isScripted && (
            <div className="text-[11px] font-mono text-zinc-500 pt-1 border-t border-zinc-800">
              Fixed protocol: checked delivery schedule, plate allowlist, prior probability,
              past incidents, and camera coverage — then committed at the evidence level
              determined by the event types. No model reasoning.
            </div>
          )}

          {/* Rules arm — explain what it did */}
          {isRules && (
            <div className="text-[11px] font-mono text-zinc-500 pt-1 border-t border-zinc-800">
              Static score: severity &times; site criticality &times; hour &times; zone exposure &times; event count.
              No investigation, no questions asked.
            </div>
          )}
        </div>

        {/* Novelty flag */}
        {trace.noveltyFlag && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-1.5 py-0.5 bg-orange-500/20 border border-orange-500/40 rounded text-[10px] font-mono font-bold text-orange-400 uppercase tracking-wider">
              Novel
            </span>
            <span className="text-[10px] font-mono text-zinc-500">
              No similar past incidents found at this site — first time seeing this pattern
            </span>
          </div>
        )}
      </div>

      {/* ═══ TOOL CALLS — what the agent checked ═══ */}
      {isAgent && trace.toolCalls.length > 0 && (
        <div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showDetails ? "▾" : "▸"} What the agent checked ({trace.toolCalls.length} lookups)
          </button>

          {showDetails && (
            <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-zinc-800">
              {trace.toolCalls.map((call, idx) => {
                let summary = "";
                try {
                  const r = JSON.parse(call.result);
                  if (call.name === "get_incident_context") {
                    summary = `${r.eventCount} event${r.eventCount !== 1 ? "s" : ""}: ${r.distinctTypes?.join(", ")} (max severity ${r.maxSeverity})`;
                  } else if (call.name === "get_site_prior") {
                    summary = `P(real) = ${(r.pReal * 100).toFixed(0)}%, n=${r.n} ${r.n === 0 ? "(hand-set guess)" : `(${r.n} past outcomes)`}`;
                  } else if (call.name === "find_precedent") {
                    if (r.count === 0) {
                      summary = "No similar past incidents found";
                    } else {
                      summary = r.summary || `${r.count} precedent${r.count !== 1 ? "s" : ""} found`;
                    }
                  } else if (call.name === "get_board_load") {
                    summary = `${r.currentLoad} items in queue — ${r.status}`;
                  } else if (call.name === "get_available_guards") {
                    summary = `${r.count} guard${r.count !== 1 ? "s" : ""} on shift`;
                  } else if (call.name === "get_active_rules") {
                    summary = `${r.rules?.length ?? 0} active safety rules`;
                  }
                } catch { /* no parseable result */ }

                const label =
                  call.name === "get_incident_context" ? "Checked events" :
                  call.name === "get_site_prior" ? "Checked site prior" :
                  call.name === "find_precedent" ? "Searched past incidents" :
                  call.name === "get_board_load" ? "Checked operator load" :
                  call.name === "get_available_guards" ? "Checked guards" :
                  call.name === "get_active_rules" ? "Checked safety rules" :
                  call.name;

                return (
                  <div key={idx} className="text-[10px] font-mono">
                    <span className="text-zinc-400">{label}</span>
                    {summary && (
                      <span className="text-zinc-600"> — {summary}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ INVESTIGATION STEPS — collapsible, for detail-oriented users ═══ */}
      {trace.steps && trace.steps.length > 0 && (
        <div>
          <button
            onClick={() => setShowDetails(prev => !prev || trace.toolCalls.length === 0)}
            className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {trace.steps.length} investigation steps
          </button>
        </div>
      )}

      {/* ═══ ENGINEER PANEL ═══ */}
      {isAgent && (
        <>
          <button
            onClick={() => setShowEngineer(!showEngineer)}
            className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 uppercase tracking-wider transition-colors"
          >
            {showEngineer ? "▾ Hide" : "▸ Show"} Engineer Details
          </button>
          {showEngineer && <EngineerPanel trace={trace} />}
        </>
      )}
    </div>
  );
}

function EngineerPanel({ trace }: { trace: AgentTrace }) {
  const [copied, setCopied] = useState(false);

  const decisionRecord = {
    arm: trace.arm,
    pReal: trace.pReal,
    basePrior: trace.basePrior,
    adjustment: trace.adjustment,
    adjustmentReasons: trace.adjustmentReasons,
    noveltyFlag: trace.noveltyFlag,
    whatWouldChange: trace.whatWouldChange,
    move: trace.move,
    evidenceLevel: trace.evidenceLevel,
    model: { tier: trace.modelTier, reason: trace.modelTierReason, id: trace.modelId },
    usage: { inputTokens: trace.inputTokens, outputTokens: trace.outputTokens, latencyMs: trace.latencyMs, costUsd: trace.costUsd },
    policy: { version: trace.policyVersion, cacheKey: trace.cacheKey, cacheHit: trace.cacheHit },
    toolCalls: trace.toolCalls,
    steps: trace.steps,
    promptMessages: trace.promptMessages,
    rawResponse: trace.rawResponse,
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(decisionRecord, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3 space-y-3 text-[10px] font-mono">
      {/* Model routing */}
      <div className="space-y-1">
        <div className="text-zinc-500 uppercase tracking-wider text-[9px]">Model Routing</div>
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-zinc-400">
            {trace.modelTier === "strong" ? "Strong model" : "Fast model"}: {trace.modelId ?? "—"}
          </span>
          {trace.modelTierReason && (
            <span className="text-zinc-600">({trace.modelTierReason})</span>
          )}
        </div>
      </div>

      {/* Usage */}
      <div className="flex items-center gap-4 flex-wrap text-zinc-400">
        <span>{trace.inputTokens?.toLocaleString() ?? "—"} in / {trace.outputTokens?.toLocaleString() ?? "—"} out</span>
        <span>{trace.latencyMs ? `${(trace.latencyMs / 1000).toFixed(1)}s` : "—"}</span>
        <span className="text-emerald-400">${trace.costUsd?.toFixed(4) ?? "—"}</span>
        <span className={trace.cacheHit ? "text-emerald-400" : "text-red-400"}>
          Cache {trace.cacheHit ? "HIT" : "MISS"}
        </span>
      </div>

      {/* Raw response */}
      {trace.rawResponse?.text && (
        <div className="space-y-1">
          <div className="text-zinc-500 uppercase tracking-wider text-[9px]">Agent's Reasoning</div>
          <div className="bg-zinc-950 border border-zinc-800 rounded p-2 max-h-48 overflow-y-auto text-zinc-400 whitespace-pre-wrap break-words leading-relaxed">
            {trace.rawResponse.text}
          </div>
        </div>
      )}

      {/* Copy */}
      <button
        onClick={handleCopy}
        className="px-2 py-1 text-[9px] font-mono uppercase tracking-wider bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded border border-zinc-700 transition-colors"
      >
        {copied ? "Copied" : "Copy Full Trace as JSON"}
      </button>
    </div>
  );
}
