"use client";

type LoadStatus = "ACCEPTABLE" | "MANAGEABLE" | "OVERLOADED";

function getLoadStatus(load: number, threshold: number): LoadStatus {
  const ratio = load / threshold;
  if (ratio <= 0.6) return "ACCEPTABLE";
  if (ratio <= 1.0) return "MANAGEABLE";
  return "OVERLOADED";
}

const STATUS_COLORS: Record<LoadStatus, { bar: string; text: string; bg: string }> = {
  ACCEPTABLE: { bar: "bg-emerald-500", text: "text-emerald-400", bg: "bg-emerald-500/10" },
  MANAGEABLE: { bar: "bg-yellow-500", text: "text-yellow-400", bg: "bg-yellow-500/10" },
  OVERLOADED: { bar: "bg-red-500", text: "text-red-400", bg: "bg-red-500/10" },
};

export function BoardLoad({
  load,
  threshold,
}: {
  load: number;
  threshold: number;
}) {
  const status = getLoadStatus(load, threshold);
  const colors = STATUS_COLORS[status];
  const pct = Math.min(100, Math.round((load / threshold) * 100));

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
        Board
      </span>
      <div className="flex items-center gap-1.5">
        <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${colors.bar} rounded-full transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-zinc-400">
          {load}/{threshold}
        </span>
      </div>
      <span
        className={`text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${colors.text} ${colors.bg}`}
      >
        {status}
      </span>
    </div>
  );
}
