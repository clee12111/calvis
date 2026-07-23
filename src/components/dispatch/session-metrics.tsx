"use client";

import type { ArmMetrics } from "@/lib/engine/incident-cache";

interface SessionMetricsProps {
  metrics: ArmMetrics | null;
  activeArm: string;
  boardLoad: number;
  boardThreshold: number;
  visibleCount: number;
}

export function SessionMetrics({
  metrics,
  activeArm,
  boardLoad,
  boardThreshold,
  visibleCount,
}: SessionMetricsProps) {
  if (!metrics) return null;

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-zinc-900/50 border-b border-zinc-800/50 text-[10px] font-mono flex-wrap">
      <div className="flex items-center gap-1">
        <span className="text-zinc-500 uppercase">Total</span>
        <span className="text-zinc-200 font-bold">${metrics.totalCostUsd.toFixed(0)}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-zinc-500 uppercase">Resp</span>
        <span className="text-zinc-400">${metrics.responseCostUsd.toFixed(0)}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-zinc-500 uppercase">Harm</span>
        <span className={metrics.harmCostUsd > 0 ? "text-red-400" : "text-zinc-400"}>
          ${metrics.harmCostUsd.toFixed(0)}
        </span>
      </div>
      {metrics.floodPenaltyUsd > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-zinc-500 uppercase">Flood</span>
          <span className="text-yellow-400">${metrics.floodPenaltyUsd.toFixed(0)}</span>
        </div>
      )}
      <div className="text-zinc-700">|</div>
      <div className="flex items-center gap-1">
        <span className="text-zinc-500 uppercase">Miss</span>
        <span className={metrics.missCount > 0 ? "text-red-400" : "text-zinc-400"}>
          {metrics.missCount}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-zinc-500 uppercase">Over</span>
        <span className={metrics.overResponseCount > 0 ? "text-yellow-400" : "text-zinc-400"}>
          {metrics.overResponseCount}
        </span>
      </div>
      <div className="text-zinc-700">|</div>
      <div className="flex items-center gap-1">
        <span className="text-zinc-500 uppercase">Surfaced</span>
        <span className="text-zinc-300">{visibleCount}/{metrics.incidentsSurfaced}</span>
      </div>
      {metrics.llmCostUsd > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-zinc-500 uppercase">LLM</span>
          <span className="text-emerald-400">${metrics.llmCostUsd.toFixed(2)}</span>
          <span className="text-zinc-700">({metrics.llmCalls})</span>
        </div>
      )}
      <div className="flex items-center gap-1">
        <span className="text-zinc-500 uppercase">Board</span>
        <span className={boardLoad >= boardThreshold ? "text-red-400" : boardLoad >= boardThreshold * 0.6 ? "text-yellow-400" : "text-zinc-300"}>
          {boardLoad}/{boardThreshold}
        </span>
        {metrics.boardLoadPeak > 0 && (
          <span className="text-zinc-600">(peak {metrics.boardLoadPeak})</span>
        )}
      </div>
    </div>
  );
}
