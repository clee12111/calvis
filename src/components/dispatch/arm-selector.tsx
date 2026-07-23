"use client";

const ARM_LABELS: Record<string, { label: string; color: string }> = {
  agent: { label: "Agent", color: "text-orange-400 border-orange-500/50 bg-orange-500/10" },
  "rules-only": { label: "Rules", color: "text-zinc-400 border-zinc-500/50 bg-zinc-500/10" },
};

interface ArmSelectorProps {
  activeArm: string;
  availableArms: string[];
  onSwitch: (arm: string) => void;
  disabled?: boolean;
}

export function ArmSelector({ activeArm, availableArms, onSwitch, disabled }: ArmSelectorProps) {
  // Only show agent and rules-only
  const visibleArms = availableArms.filter((arm) => arm === "agent" || arm === "rules-only");
  if (visibleArms.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mr-1">Compare</span>
      {visibleArms.map((arm) => {
        const config = ARM_LABELS[arm] ?? { label: arm, color: "text-zinc-400 border-zinc-600/50" };
        const isActive = arm === activeArm;
        return (
          <button
            key={arm}
            onClick={() => onSwitch(arm)}
            disabled={disabled || isActive}
            className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded border transition-colors ${
              isActive
                ? config.color
                : "text-zinc-600 border-zinc-800 hover:text-zinc-400 hover:border-zinc-600"
            } disabled:cursor-default`}
          >
            {config.label}
          </button>
        );
      })}
    </div>
  );
}
