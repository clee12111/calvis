"use client";

const TIER_COLORS = [
  "bg-zinc-600",      // Tier 0: suppress — muted
  "bg-blue-500",      // Tier 1: log_and_watch — info
  "bg-yellow-500",    // Tier 2: request_photo — warning
  "bg-orange-500",    // Tier 3: notify_guard — urgent
  "bg-red-500",       // Tier 4: dispatch_backup — critical
];

const TIER_WIDTHS = [
  "w-1",   // Tier 0
  "w-1.5", // Tier 1
  "w-2",   // Tier 2
  "w-2.5", // Tier 3
  "w-3",   // Tier 4
];

const TIER_LABELS = [
  "SUPPRESS",
  "WATCH",
  "PHOTO",
  "WALK IT",
  "DISPATCH",
];

export function PriorityStripe({ tier }: { tier: number }) {
  const t = Math.min(4, Math.max(0, tier));
  return (
    <div
      className={`${TIER_COLORS[t]} ${TIER_WIDTHS[t]} h-full rounded-sm shrink-0`}
      title={`Tier ${t}: ${TIER_LABELS[t]}`}
    />
  );
}

export function TierBadge({ tier }: { tier: number }) {
  const t = Math.min(4, Math.max(0, tier));
  return (
    <span
      className={`${TIER_COLORS[t]} text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider`}
    >
      T{t} {TIER_LABELS[t]}
    </span>
  );
}
