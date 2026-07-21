"use client";

interface SiteInfo {
  id: string;
  name: string;
  criticalityTier: number;
  activeIncidents: number;
  guardCount: number;
}

const CRIT_COLORS = [
  "",
  "text-zinc-500",    // 1 - low
  "text-blue-400",    // 2
  "text-yellow-400",  // 3
  "text-orange-400",  // 4
  "text-red-400",     // 5 - critical
];

export function SitePanel({ sites }: { sites: SiteInfo[] }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800">
        <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-zinc-400">
          Sites / Coverage
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sites.map((site) => (
          <div
            key={site.id}
            className="px-3 py-2 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-zinc-300 truncate">
                {site.name}
              </span>
              <span
                className={`text-[9px] font-mono font-bold ${CRIT_COLORS[site.criticalityTier]}`}
              >
                C{site.criticalityTier}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[9px] font-mono text-zinc-600">
              <span>{site.guardCount} guard{site.guardCount !== 1 ? "s" : ""}</span>
              {site.activeIncidents > 0 && (
                <span className="text-orange-500">
                  {site.activeIncidents} active
                </span>
              )}
            </div>
          </div>
        ))}

        {sites.length === 0 && (
          <div className="px-3 py-8 text-center text-[11px] text-zinc-600 font-mono">
            No sites loaded
          </div>
        )}
      </div>
    </div>
  );
}
