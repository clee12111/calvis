"use client";

interface Factor {
  name: string;
  value: number;
  weight: number;
}

export function WhyChip({ factor }: { factor: Factor }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-800 rounded text-[10px] font-mono text-zinc-300 border border-zinc-700">
      <span className="text-zinc-500">{factor.name}</span>
      <span className="text-orange-400">{factor.value.toFixed(2)}</span>
    </span>
  );
}

export function WhyChips({ factors }: { factors: Factor[] }) {
  // Show top 3 by weight
  const sorted = [...factors].sort((a, b) => b.weight - a.weight).slice(0, 3);
  return (
    <div className="flex flex-wrap gap-1">
      {sorted.map((f) => (
        <WhyChip key={f.name} factor={f} />
      ))}
    </div>
  );
}
