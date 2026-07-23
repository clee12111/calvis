"use client";

export function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.8
      ? "bg-emerald-500"
      : confidence >= 0.6
        ? "bg-yellow-500"
        : "bg-red-400";

  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div
        className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`P(real): ${pct}%`}
        title={`P(real): ${pct}% — probability this incident is real`}
      >
        <div
          className={`h-full ${color} rounded-full transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-zinc-400 w-8 text-right">
        {pct}%
      </span>
    </div>
  );
}
