"use client";

function formatSimTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const displayHour = (20 + hours) % 24;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ReplayControls({
  time,
  speed,
  running,
  eventsIngested,
  totalEvents,
  onStart,
  onPause,
  onResume,
  onSpeedChange,
}: {
  time: number;
  speed: number;
  running: boolean;
  eventsIngested: number;
  totalEvents: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onSpeedChange: (speed: number) => void;
}) {
  const nightDuration = 10 * 3600 * 1000; // 10 hours
  const progress = Math.min(100, (time / nightDuration) * 100);

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-zinc-900 border-b border-zinc-800">
      {/* Play/Pause */}
      <div className="flex items-center gap-1">
        {totalEvents === 0 ? (
          <button
            onClick={onStart}
            className="px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors"
          >
            Start Sim
          </button>
        ) : running ? (
          <button
            onClick={onPause}
            className="px-2 py-1 text-[11px] font-mono text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
          >
            ⏸ Pause
          </button>
        ) : (
          <button
            onClick={onResume}
            className="px-2 py-1 text-[11px] font-mono text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
          >
            ▶ Play
          </button>
        )}
      </div>

      {/* Speed buttons */}
      <div className="flex items-center gap-1">
        {[1, 10, 100, 1000].map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
              speed === s
                ? "bg-orange-600/30 text-orange-400 border border-orange-600/50"
                : "text-zinc-500 hover:text-zinc-300 bg-zinc-800 hover:bg-zinc-700"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Clock */}
      <div className="text-sm font-mono text-zinc-200 tabular-nums">
        {formatSimTime(time)}
      </div>

      {/* Progress bar */}
      <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-orange-500/60 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Event counter */}
      <div className="text-[10px] font-mono text-zinc-500 shrink-0">
        {eventsIngested}/{totalEvents} events
      </div>
    </div>
  );
}
