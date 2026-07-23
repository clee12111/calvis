/**
 * AVS-01 evidence level labels — single source of truth.
 * Used by the engine, UI components, and API routes.
 * ANSI/TMA AVS-01-2024 five-tier alarm validation scoring.
 */

export const EVIDENCE_LABELS: Record<number, string> = {
  0: "E0 — NOTHING TO ACT ON",
  1: "E1 — SOMETHING HAPPENED",
  2: "E2 — HUMAN PRESENCE CONFIRMED",
  3: "E3 — THREAT TO PROPERTY",
  4: "E4 — THREAT TO LIFE",
};

export const EVIDENCE_SHORT: Record<number, string> = {
  0: "E0",
  1: "E1",
  2: "E2",
  3: "E3",
  4: "E4",
};

export const EVIDENCE_COLORS: Record<number, string> = {
  0: "text-zinc-500",
  1: "text-blue-400",
  2: "text-yellow-400",
  3: "text-orange-400",
  4: "text-red-400",
};
