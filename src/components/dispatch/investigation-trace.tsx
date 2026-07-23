"use client";

import { useState, useEffect } from "react";
import type { AgentTrace } from "@/lib/engine/incident-cache";

const TOOL_CALL_LABELS: Record<string, string> = {
  get_incident_context: "Incident Context",
  get_site_prior: "Site Prior (P(real) + n)",
  get_board_load: "Board Load (EEMUA)",
  get_active_rules: "Active Rules",
  get_available_guards: "Available Guards",
  make_decision: "Decision",
};

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

const MOVE_LABELS: Record<string, string> = {
  suppress: "SUPPRESS",
  log_and_watch: "LOG & WATCH",
  request_photo: "REQUEST PHOTO",
  notify_guard: "WALK IT",
  dispatch_backup: "DISPATCH",
  escalate_overwatch: "ESCALATE",
  recheck_5min: "RECHECK 5MIN",
  suppress_ttl: "SUPPRESS TTL",
};

function formatSimTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const displayHour = (20 + hours) % 24;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function InvestigationTrace({ trace }: { trace: AgentTrace | null }) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [showEngineer, setShowEngineer] = useState(false);

  // Reset when trace changes (new incident selected)
  useEffect(() => {
    setExpandedStep(null);
    setShowEngineer(false);
  }, [trace]);

  if (!trace) {
    return (
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 mb-2">
          Investigation Trace
        </h3>
        <div className="text-[11px] font-mono text-zinc-600">
          No trace available for this incident
        </div>
      </div>
    );
  }

  const isAgent = trace.arm === "agent";
  const isScripted = trace.arm === "scripted-interrogation";
  const pRealPct = Math.round(trace.pReal * 100);
  const basePriorPct = Math.round(trace.basePrior * 100);
  const adjustmentSign = trace.adjustment >= 0 ? "+" : "";
  const hasSteps = trace.steps && trace.steps.length > 0;

  return (
    <div className="px-4 py-3 border-b border-zinc-800 space-y-3">
      {/* Header with arm label */}
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">
          Investigation Trace
        </h3>
        <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
          isAgent
            ? "text-orange-400 bg-orange-500/10 border-orange-500/30"
            : isScripted
              ? "text-blue-400 bg-blue-500/10 border-blue-500/30"
              : "text-zinc-400 bg-zinc-700/30 border-zinc-600/30"
        }`}>
          {trace.arm}
        </span>
      </div>

      {/* Investigation steps (from LoopEngine transitions) */}
      {hasSteps && (
        <div className="space-y-0">
          {trace.steps!.map((step, idx) => {
            const isExpanded = expandedStep === idx;
            const isCommit = step.moveType === "commit";
            const levelChanged = step.evidenceBefore !== step.evidenceAfter;
            return (
              <button
                key={idx}
                onClick={() => setExpandedStep(isExpanded ? null : idx)}
                className="w-full flex items-start gap-2 text-left group"
              >
                {/* Timeline connector */}
                <div className="flex flex-col items-center shrink-0 pt-1">
                  <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    isCommit
                      ? "bg-orange-500"
                      : levelChanged
                        ? "bg-yellow-500"
                        : "bg-zinc-600 group-hover:bg-orange-500"
                  }`} />
                  {idx < trace.steps!.length - 1 && (
                    <div className="w-px h-4 bg-zinc-800" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-zinc-600 w-14 shrink-0">
                      {formatSimTime(step.timestamp)}
                    </span>
                    <span className={`text-[10px] font-mono transition-colors ${
                      isCommit ? "text-orange-400 font-bold" : "text-zinc-400 group-hover:text-zinc-200"
                    }`}>
                      {step.actionName}
                    </span>
                    {levelChanged && (
                      <span className="text-[9px] font-mono text-yellow-400">
                        E{step.evidenceBefore}→E{step.evidenceAfter}
                      </span>
                    )}
                    <span className="text-[9px] font-mono text-zinc-700">
                      {isExpanded ? "▾" : "▸"}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="mt-1 text-[10px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-2 py-1">
                      {step.reason}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Agent tool calls (for agent arm) */}
      {isAgent && trace.toolCalls.length > 0 && (
        <div className="space-y-0">
          <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mb-1">
            Agent Tool Calls
          </div>
          {trace.toolCalls.map((call, idx) => {
            const label = TOOL_CALL_LABELS[call.name] ?? call.name;
            return (
              <div key={idx} className="flex items-center gap-2 text-[10px] font-mono py-0.5">
                <div className="w-1 h-1 rounded-full bg-zinc-700 shrink-0" />
                <span className="text-zinc-400">{label}</span>
                {call.name === "get_site_prior" && call.n !== undefined && (
                  <span className="text-[9px] text-zinc-600">
                    n={call.n}{call.n === 0 ? " (hand-set)" : ` (${call.n} observations)`}
                  </span>
                )}
                {call.result && (
                  <span className="text-zinc-600 truncate">{call.result}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Prior + Adjustment chain (agent only) */}
      {isAgent && trace.basePrior > 0 && (
        <div className="flex items-center gap-3 text-[10px] font-mono flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-zinc-600 uppercase">Prior</span>
            <span className="text-zinc-300">{basePriorPct}%</span>
          </div>
          <span className="text-zinc-700">→</span>
          <div className="flex items-center gap-1">
            <span className="text-zinc-600 uppercase">Adj</span>
            <span className={trace.adjustment >= 0 ? "text-red-400" : "text-emerald-400"}>
              {adjustmentSign}{trace.adjustment.toFixed(2)} log-odds
            </span>
          </div>
          <span className="text-zinc-700">→</span>
          <div className="flex items-center gap-1">
            <span className="text-zinc-600 uppercase">P(real)</span>
            <span className="text-zinc-100 font-bold">{pRealPct}%</span>
          </div>
        </div>
      )}

      {/* Adjustment reasons */}
      {trace.adjustmentReasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {trace.adjustmentReasons.map((reason, idx) => (
            <span
              key={idx}
              className="inline-flex items-center px-1.5 py-0.5 bg-zinc-800 rounded text-[10px] font-mono text-zinc-400 border border-zinc-700"
            >
              {reason}
            </span>
          ))}
        </div>
      )}

      {/* Decision: move + evidence level */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-mono text-zinc-600 uppercase">Move</span>
        <span className="text-[10px] font-mono font-bold text-orange-400">
          {MOVE_LABELS[trace.move] ?? trace.move.toUpperCase()}
        </span>
        <span className="text-[10px] font-mono text-zinc-700">|</span>
        <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${EVIDENCE_COLORS[trace.evidenceLevel] ?? "text-zinc-500"}`}>
          {EVIDENCE_LABELS[trace.evidenceLevel] ?? `E${trace.evidenceLevel}`}
        </span>
      </div>

      {/* Novelty flag */}
      {trace.noveltyFlag && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 bg-orange-500/20 border border-orange-500/40 rounded text-[10px] font-mono font-bold text-orange-400 uppercase tracking-wider">
            Novelty
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            Pattern not seen in training data
          </span>
        </div>
      )}

      {/* What would change my mind */}
      {trace.whatWouldChange && (
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600 uppercase">Would change mind: </span>
          <span className="text-zinc-400 italic">{trace.whatWouldChange}</span>
        </div>
      )}

      {/* Engineer panel toggle */}
      {isAgent && (
        <button
          onClick={() => setShowEngineer(!showEngineer)}
          className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 uppercase tracking-wider transition-colors"
        >
          {showEngineer ? "▾ Hide" : "▸ Show"} Engineer Details
        </button>
      )}

      {/* Engineer panel (collapsible) */}
      {showEngineer && isAgent && <EngineerPanel trace={trace} />}
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
    model: {
      tier: trace.modelTier,
      reason: trace.modelTierReason,
      id: trace.modelId,
    },
    usage: {
      inputTokens: trace.inputTokens,
      outputTokens: trace.outputTokens,
      latencyMs: trace.latencyMs,
      costUsd: trace.costUsd,
    },
    policy: {
      version: trace.policyVersion,
      cacheKey: trace.cacheKey,
      cacheHit: trace.cacheHit,
    },
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
        <div className="text-zinc-600 uppercase tracking-wider text-[9px]">Model Routing</div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Tier:</span>
            <span className={trace.modelTier === "strong" ? "text-orange-400 font-bold" : "text-zinc-300"}>
              {trace.modelTier ?? "—"}
            </span>
          </div>
          {trace.modelTierReason && (
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">Reason:</span>
              <span className="text-zinc-400">{trace.modelTierReason}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Model:</span>
            <span className="text-zinc-300">{trace.modelId ?? "—"}</span>
          </div>
        </div>
      </div>

      {/* Token usage */}
      <div className="space-y-1">
        <div className="text-zinc-600 uppercase tracking-wider text-[9px]">Usage</div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">In:</span>
            <span className="text-zinc-300">{trace.inputTokens?.toLocaleString() ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Out:</span>
            <span className="text-zinc-300">{trace.outputTokens?.toLocaleString() ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Latency:</span>
            <span className="text-zinc-300">{trace.latencyMs ? `${trace.latencyMs}ms` : "—"}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Cost:</span>
            <span className="text-emerald-400">${trace.costUsd?.toFixed(4) ?? "—"}</span>
          </div>
        </div>
      </div>

      {/* Policy + cache */}
      <div className="space-y-1">
        <div className="text-zinc-600 uppercase tracking-wider text-[9px]">Policy &amp; Cache</div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Policy:</span>
            <span className="text-zinc-300">{trace.policyVersion ?? "—"}</span>
          </div>
          {trace.cacheKey && (
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">Key:</span>
              <span className="text-zinc-400">{trace.cacheKey.slice(0, 12)}...</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Cache:</span>
            <span className={trace.cacheHit ? "text-emerald-400" : "text-red-400"}>
              {trace.cacheHit ? "HIT" : "MISS"}
            </span>
          </div>
        </div>
      </div>

      {/* Prompt (if available) */}
      {trace.promptMessages && trace.promptMessages.length > 0 && (
        <div className="space-y-1">
          <div className="text-zinc-600 uppercase tracking-wider text-[9px]">Prompt</div>
          <div className="bg-zinc-950 border border-zinc-800 rounded p-2 max-h-40 overflow-y-auto">
            {trace.promptMessages.map((msg, idx) => (
              <div key={idx} className="mb-1">
                <span className="text-zinc-500">[{msg.role}]</span>{" "}
                <span className="text-zinc-400 whitespace-pre-wrap break-all">{msg.content.slice(0, 500)}{msg.content.length > 500 ? "..." : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw response (if available) */}
      {trace.rawResponse && (
        <div className="space-y-1">
          <div className="text-zinc-600 uppercase tracking-wider text-[9px]">Raw Response</div>
          <div className="bg-zinc-950 border border-zinc-800 rounded p-2 max-h-40 overflow-y-auto">
            {trace.rawResponse.text && (
              <div className="text-zinc-400 whitespace-pre-wrap break-all mb-1">
                {trace.rawResponse.text.slice(0, 1000)}{trace.rawResponse.text.length > 1000 ? "..." : ""}
              </div>
            )}
            {trace.rawResponse.toolCalls.map((tc, idx) => (
              <div key={idx} className="text-zinc-500">
                <span className="text-orange-400">{tc.name}</span>({tc.arguments})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Copy button */}
      <button
        onClick={handleCopy}
        className="px-2 py-1 text-[9px] font-mono uppercase tracking-wider bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded border border-zinc-700 transition-colors"
      >
        {copied ? "Copied" : "Copy as JSON"}
      </button>
    </div>
  );
}
