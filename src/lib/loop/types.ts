import type { EvidenceLevel } from "../engine/scenarios";

// ═══════════════════════════════════════════════════════════════════════════
// 0.8.1 — Incident working state
// ═══════════════════════════════════════════════════════════════════════════

export interface WorkingState {
  incidentId: string;
  /** Current evidence level (0-4), starts at 0, only goes up */
  evidenceLevel: EvidenceLevel;
  /** Current hypothesis about what's happening */
  hypothesis: string;
  /** Questions asked but not yet answered */
  openQuestions: OpenQuestion[];
  /** Evidence gathered so far */
  evidenceGathered: EvidenceItem[];
  /** When the system must make a final decision (sim clock ms) */
  decisionDeadline: number;
  /** History of state transitions (append-only) */
  transitions: StateTransition[];
  /** Whether this incident is finalized (committed/deferred with suppress) */
  finalized: boolean;
  /** The committed response level, set when finalized */
  committedLevel: number | null;
}

export interface OpenQuestion {
  id: string;
  action: Action;
  askedAt: number; // sim clock ms
  deadline: number; // sim clock ms — silence after this is information
  answer: string | null;
  answeredAt: number | null;
}

export interface EvidenceItem {
  source: string;
  finding: string;
  timestamp: number;
  /** Did this evidence change the evidence level? */
  levelChange: { from: EvidenceLevel; to: EvidenceLevel } | null;
}

export interface StateTransition {
  timestamp: number;
  move: Move;
  evidenceLevelBefore: EvidenceLevel;
  evidenceLevelAfter: EvidenceLevel;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 0.8.2 — Action catalogue
// ═══════════════════════════════════════════════════════════════════════════

export type ActionCategory = "system_question" | "human_question" | "response" | "defer";

export interface Action {
  id: string;
  name: string;
  category: ActionCategory;
  /** Guard-minutes consumed. 0 for system questions. */
  guardMinutes: number;
  /** Operator-minutes consumed. Every surfaced item costs attention. */
  operatorMinutes: number;
  /** Expected latency in sim-ms. 0 for instant system lookups. */
  expectedLatencyMs: number;
  /** Can this action fail to produce an answer? */
  canFail: boolean;
}

// System questions — free, instant
export const SYSTEM_ACTIONS: Action[] = [
  { id: "check_delivery_schedule", name: "Check delivery schedule", category: "system_question", guardMinutes: 0, operatorMinutes: 0, expectedLatencyMs: 0, canFail: false },
  { id: "check_plate_allowlist", name: "Check plate against site allowlist", category: "system_question", guardMinutes: 0, operatorMinutes: 0, expectedLatencyMs: 0, canFail: false },
  { id: "retrieve_prior", name: "Retrieve P(real) prior for this context", category: "system_question", guardMinutes: 0, operatorMinutes: 0, expectedLatencyMs: 0, canFail: false },
  { id: "retrieve_precedent", name: "Retrieve similar past incidents", category: "system_question", guardMinutes: 0, operatorMinutes: 0, expectedLatencyMs: 0, canFail: false },
  { id: "check_camera_coverage", name: "Check camera coverage for zone", category: "system_question", guardMinutes: 0, operatorMinutes: 0, expectedLatencyMs: 0, canFail: false },
];

// Human questions — cost guard-seconds, have latency, can fail
export const HUMAN_ACTIONS: Action[] = [
  { id: "request_photo", name: "Request photo verification", category: "human_question", guardMinutes: 0.5, operatorMinutes: 1, expectedLatencyMs: 120_000, canFail: true },
  { id: "ask_guard_radio", name: "Ask guard to radio in status", category: "human_question", guardMinutes: 1, operatorMinutes: 0.5, expectedLatencyMs: 180_000, canFail: true },
  { id: "ask_client_confirm", name: "Ask client to confirm/deny", category: "human_question", guardMinutes: 0, operatorMinutes: 2, expectedLatencyMs: 300_000, canFail: true },
];

// Responses — terminal actions
export const RESPONSE_ACTIONS: Action[] = [
  { id: "suppress", name: "Suppress with note + TTL", category: "response", guardMinutes: 0, operatorMinutes: 0, expectedLatencyMs: 0, canFail: false },
  { id: "log_and_watch", name: "Log and set recheck timer", category: "response", guardMinutes: 0, operatorMinutes: 0.5, expectedLatencyMs: 0, canFail: false },
  { id: "notify_guard", name: "Notify guard / reassign patrol", category: "response", guardMinutes: 10, operatorMinutes: 3, expectedLatencyMs: 0, canFail: false },
  { id: "dispatch_backup", name: "Dispatch backup / notify client", category: "response", guardMinutes: 30, operatorMinutes: 10, expectedLatencyMs: 0, canFail: false },
  { id: "escalate_overwatch", name: "Escalate to overwatch human", category: "response", guardMinutes: 30, operatorMinutes: 15, expectedLatencyMs: 0, canFail: false },
];

// Defer — recheck timer or suppress with TTL
export const DEFER_ACTIONS: Action[] = [
  { id: "recheck_5min", name: "Recheck in 5 minutes", category: "defer", guardMinutes: 0, operatorMinutes: 0.5, expectedLatencyMs: 300_000, canFail: false },
  { id: "suppress_ttl", name: "Suppress with TTL", category: "defer", guardMinutes: 0, operatorMinutes: 0, expectedLatencyMs: 0, canFail: false },
];

export const ALL_ACTIONS = [...SYSTEM_ACTIONS, ...HUMAN_ACTIONS, ...RESPONSE_ACTIONS, ...DEFER_ACTIONS];

export function getActionById(id: string): Action | undefined {
  return ALL_ACTIONS.find((a) => a.id === id);
}

// ═══════════════════════════════════════════════════════════════════════════
// Three moves
// ═══════════════════════════════════════════════════════════════════════════

export type Move =
  | { type: "investigate"; action: Action }
  | { type: "commit"; level: number; action: Action }
  | { type: "defer"; action: Action; recheckAt: number };

/** EUMEA 191 flood threshold adapted for security */
export const FLOOD_THRESHOLD = 6; // items per 10-min window before "overloaded"

/** Dollar cost of a move (guard + operator time) */
export function moveCostUsd(move: Move): number {
  const GUARD_RATE = 0.75;
  const OPERATOR_RATE = 0.58;
  const a = move.type === "commit" ? move.action : move.type === "investigate" ? move.action : move.action;
  return a.guardMinutes * GUARD_RATE + a.operatorMinutes * OPERATOR_RATE;
}
