import { describe, it, expect } from "vitest";
import { chooseNextMove, evidenceLevelToResponse } from "../rules-decider";
import { SYSTEM_ACTIONS, HUMAN_ACTIONS, FLOOD_THRESHOLD } from "../types";
import type { WorkingState } from "../types";
import type { EvidenceLevel } from "../../engine/scenarios";

/** Fabricate a minimal WorkingState for table-driven tests */
function makeState(overrides: Partial<WorkingState> = {}): WorkingState {
  return {
    incidentId: "inc-test",
    evidenceLevel: 0,
    hypothesis: "test",
    openQuestions: [],
    evidenceGathered: [],
    decisionDeadline: 999999999,
    transitions: [],
    finalized: false,
    committedLevel: null,
    ...overrides,
  };
}

/** State with all system questions already asked */
function stateWithSystemQuestionsAsked(overrides: Partial<WorkingState> = {}): WorkingState {
  return makeState({
    openQuestions: SYSTEM_ACTIONS.map((a) => ({
      id: `q-${a.id}`,
      action: a,
      askedAt: 0,
      deadline: 0,
      answer: "done",
      answeredAt: 0,
    })),
    ...overrides,
  });
}

describe("chooseNextMove", () => {
  // ─── Branch 1: exhaust free system questions ───────────────────

  it("asks the first system question when none have been asked", () => {
    const move = chooseNextMove(makeState(), 0);
    expect(move.type).toBe("investigate");
    expect(move.type === "investigate" && move.action.category).toBe("system_question");
    expect(move.type === "investigate" && move.action.id).toBe(SYSTEM_ACTIONS[0].id);
  });

  it("asks the next unanswered system question", () => {
    const state = makeState({
      openQuestions: [{
        id: "q-1",
        action: SYSTEM_ACTIONS[0],
        askedAt: 0,
        deadline: 0,
        answer: "done",
        answeredAt: 0,
      }],
    });
    const move = chooseNextMove(state, 0);
    expect(move.type).toBe("investigate");
    if (move.type === "investigate") {
      expect(move.action.id).toBe(SYSTEM_ACTIONS[1].id);
    }
  });

  // ─── Branch 2: wait for pending human questions ────────────────

  it("defers when a human question is pending", () => {
    const state = stateWithSystemQuestionsAsked({
      evidenceLevel: 1,
      openQuestions: [
        ...SYSTEM_ACTIONS.map((a) => ({
          id: `q-${a.id}`, action: a, askedAt: 0, deadline: 0, answer: "done", answeredAt: 0,
        })),
        {
          id: "q-photo",
          action: HUMAN_ACTIONS[0],
          askedAt: 100,
          deadline: 500,
          answer: null,   // pending
          answeredAt: null,
        },
      ],
    });
    const move = chooseNextMove(state, 0);
    expect(move.type).toBe("defer");
    if (move.type === "defer") {
      expect(move.recheckAt).toBe(500);
    }
  });

  // ─── Branch 3: ask human question for E1-E2 below flood ───────

  it("asks a human question at E1 when board is not flooded", () => {
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 1 });
    const move = chooseNextMove(state, 0);
    expect(move.type).toBe("investigate");
    if (move.type === "investigate") {
      expect(move.action.category).toBe("human_question");
      expect(move.action.id).toBe("request_photo"); // cheapest first
    }
  });

  it("asks a human question at E2 when board is not flooded", () => {
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 2 });
    const move = chooseNextMove(state, 0);
    expect(move.type).toBe("investigate");
    if (move.type === "investigate") {
      expect(move.action.category).toBe("human_question");
    }
  });

  it("does NOT ask human question at E0 (too low)", () => {
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 0 });
    const move = chooseNextMove(state, 0);
    expect(move.type).toBe("commit");
  });

  it("does NOT ask human question at E3 (too high — commit immediately)", () => {
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 3 });
    const move = chooseNextMove(state, 0);
    expect(move.type).toBe("commit");
    if (move.type === "commit") {
      expect(move.level).toBe(3);
    }
  });

  it("does NOT ask human question when board is at flood threshold", () => {
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 1 });
    const move = chooseNextMove(state, FLOOD_THRESHOLD);
    // At flood threshold, E1 gets suppressed (branch 4)
    expect(move.type).toBe("commit");
    if (move.type === "commit") {
      expect(move.level).toBe(0); // suppressed
    }
  });

  it("does NOT ask human question at board load just below threshold but selectHumanQuestion blocks it", () => {
    // boardLoad = FLOOD_THRESHOLD - 1 should still pass branch 3's gate
    // but selectHumanQuestion should NOT block at this level
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 1 });
    const move = chooseNextMove(state, FLOOD_THRESHOLD - 1);
    expect(move.type).toBe("investigate");
    if (move.type === "investigate") {
      expect(move.action.category).toBe("human_question");
    }
  });

  // ─── Branch 4: flood suppression — SAFETY PROPERTY ─────────────

  it("suppresses E0 when board is flooded", () => {
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 0 });
    const move = chooseNextMove(state, FLOOD_THRESHOLD);
    expect(move.type).toBe("commit");
    if (move.type === "commit") {
      expect(move.level).toBe(0);
      expect(move.action.id).toBe("suppress");
    }
  });

  it("suppresses E1 when board is flooded", () => {
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 1 });
    const move = chooseNextMove(state, FLOOD_THRESHOLD);
    expect(move.type).toBe("commit");
    if (move.type === "commit") {
      expect(move.level).toBe(0);
      expect(move.action.id).toBe("suppress");
    }
  });

  it("does NOT suppress E1 when board is below flood threshold", () => {
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 1 });
    // All human questions already asked
    const fullState: WorkingState = {
      ...state,
      openQuestions: [
        ...state.openQuestions,
        ...HUMAN_ACTIONS.map((a) => ({
          id: `q-${a.id}`, action: a, askedAt: 0, deadline: 0, answer: "done", answeredAt: 0,
        })),
      ],
    };
    const move = chooseNextMove(fullState, FLOOD_THRESHOLD - 1);
    expect(move.type).toBe("commit");
    if (move.type === "commit") {
      expect(move.level).toBe(1); // normal commit, not suppressed
      expect(move.action.id).toBe("log_and_watch");
    }
  });

  // SAFETY: E2, E3, E4 must NEVER be flood-suppressed
  for (const level of [2, 3, 4] as EvidenceLevel[]) {
    it(`SAFETY: E${level} is NEVER suppressed even at flood load 100`, () => {
      const state = stateWithSystemQuestionsAsked({ evidenceLevel: level });
      // Also exhaust human questions so we reach the commit path
      const fullState: WorkingState = {
        ...state,
        openQuestions: [
          ...state.openQuestions,
          ...HUMAN_ACTIONS.map((a) => ({
            id: `q-${a.id}`, action: a, askedAt: 0, deadline: 0, answer: "done", answeredAt: 0,
          })),
        ],
      };
      const move = chooseNextMove(fullState, 100); // extreme flood
      expect(move.type).toBe("commit");
      if (move.type === "commit") {
        expect(move.level).toBe(level);
        expect(move.action.id).not.toBe("suppress");
      }
    });
  }

  // ─── Branch 5: normal commit ──────────────────────────────────

  it("commits E0 as suppress when all questions exhausted", () => {
    const state = stateWithSystemQuestionsAsked({ evidenceLevel: 0 });
    const move = chooseNextMove(state, 0);
    expect(move.type).toBe("commit");
    if (move.type === "commit") {
      expect(move.level).toBe(0);
      expect(move.action.id).toBe("suppress");
    }
  });
});

describe("evidenceLevelToResponse", () => {
  const expected: [EvidenceLevel, string][] = [
    [0, "suppress"],
    [1, "log_and_watch"],
    [2, "notify_guard"],
    [3, "dispatch_backup"],
    [4, "escalate_overwatch"],
  ];

  for (const [level, actionId] of expected) {
    it(`maps E${level} → ${actionId}`, () => {
      const action = evidenceLevelToResponse(level);
      expect(action.id).toBe(actionId);
    });
  }
});
