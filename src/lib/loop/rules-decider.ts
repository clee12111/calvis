import type { WorkingState, Move, Action } from "./types";
import { SYSTEM_ACTIONS, HUMAN_ACTIONS, RESPONSE_ACTIONS, DEFER_ACTIONS, FLOOD_THRESHOLD } from "./types";
import type { EvidenceLevel } from "../engine/scenarios";

/**
 * 0.8.3 — Rules-based decider. chooseNextMove(state) → investigate | commit | defer.
 * Fixed heuristics:
 *  1. Always exhaust free system questions first.
 *  2. Ask costly human questions per a static policy table.
 *  3. Commit when evidence level is confirmed or deadline reached.
 *
 * F1 replaces this function and nothing else.
 */
export function chooseNextMove(
  state: WorkingState,
  boardLoad: number, // items surfaced to operator in current 10-min window
): Move {
  // Deadline enforcement is in LoopEngine.tick() — it force-commits before calling this.

  // 1. Exhaust free system questions
  const askedIds = new Set(state.openQuestions.map((q) => q.action.id));
  const unansweredSystem = SYSTEM_ACTIONS.filter(
    (a) => !askedIds.has(a.id) && isRelevantSystemQuestion(a.id, state)
  );

  if (unansweredSystem.length > 0) {
    return { type: "investigate", action: unansweredSystem[0] };
  }

  // 2. Check if we have pending human questions — wait for them
  const pendingHuman = state.openQuestions.filter(
    (q) => q.action.category === "human_question" && q.answer === null
  );
  if (pendingHuman.length > 0) {
    // Already waiting — defer until the question deadline
    const earliest = Math.min(...pendingHuman.map((q) => q.deadline));
    return { type: "defer", action: DEFER_ACTIONS[0], recheckAt: earliest };
  }

  // 3. Decide whether to ask a human question or commit
  // Static policy: ask a human question if evidence is ambiguous (level 1-2)
  // and board isn't flooded
  if (state.evidenceLevel >= 1 && state.evidenceLevel <= 2 && boardLoad < FLOOD_THRESHOLD) {
    const unaskedHuman = HUMAN_ACTIONS.filter((a) => !askedIds.has(a.id));
    if (unaskedHuman.length > 0) {
      // Ask the cheapest relevant human question
      const best = selectHumanQuestion(state, unaskedHuman, boardLoad);
      if (best) {
        return { type: "investigate", action: best };
      }
    }
  }

  // 4. Flood-aware commit: when board is flooded, suppress low-evidence incidents
  // rather than surfacing them. EEMUA 191: >6/10min = overloaded.
  // Only suppress if evidence is genuinely low (level 0-1) — never suppress E3/E4.
  if (boardLoad >= FLOOD_THRESHOLD && state.evidenceLevel <= 1) {
    const suppress = RESPONSE_ACTIONS.find((a) => a.id === "suppress")!;
    return { type: "commit", level: 0, action: suppress };
  }

  // 5. Commit at the response level matching the current evidence
  const responseAction = evidenceLevelToResponse(state.evidenceLevel);
  return { type: "commit", level: state.evidenceLevel, action: responseAction };
}

function isRelevantSystemQuestion(actionId: string, state: WorkingState): boolean {
  // Only ask questions relevant to the events in this incident
  switch (actionId) {
    case "check_delivery_schedule":
    case "check_plate_allowlist":
      // Relevant if incident has plate_read or motion at a dock
      return true; // simplified: always ask (free anyway)
    case "retrieve_prior":
    case "retrieve_precedent":
      return true; // always relevant
    case "check_camera_coverage":
      return true; // always relevant
    default:
      return false;
  }
}

function selectHumanQuestion(
  state: WorkingState,
  available: Action[],
  boardLoad: number,
): Action | null {
  // When board load is at/above flood threshold, don't add more items
  if (boardLoad >= FLOOD_THRESHOLD) return null;

  // Prefer photo first (cheapest), then radio, then client
  const priority = ["request_photo", "ask_guard_radio", "ask_client_confirm"];
  for (const id of priority) {
    const action = available.find((a) => a.id === id);
    if (action) return action;
  }
  return null;
}

/**
 * 0.8.4 — Deterministic response map.
 * Evidence level + site policy → response action.
 * Tier-4-equivalent always human-confirmed. Never auto-dial emergency services.
 */
function evidenceLevelToResponse(level: EvidenceLevel): Action {
  switch (level) {
    case 0: return RESPONSE_ACTIONS.find((a) => a.id === "suppress")!;
    case 1: return RESPONSE_ACTIONS.find((a) => a.id === "log_and_watch")!;
    case 2: return RESPONSE_ACTIONS.find((a) => a.id === "notify_guard")!;
    case 3: return RESPONSE_ACTIONS.find((a) => a.id === "dispatch_backup")!;
    case 4: return RESPONSE_ACTIONS.find((a) => a.id === "escalate_overwatch")!; // human-confirmed
    default: return RESPONSE_ACTIONS[0];
  }
}

export { evidenceLevelToResponse };
