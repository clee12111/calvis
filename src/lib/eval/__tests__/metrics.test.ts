import { describe, it, expect } from "vitest";
import {
  computeOperationalCost,
  computeBrierScore,
  computeGuardMinutes,
  computeTimeToResolution,
  computeAckRate,
  responseCostUsd,
  harmCostUsd,
  C_HARM_PER_LEVEL,
  GUARD_RATE_PER_MIN,
  OPERATOR_RATE_PER_MIN,
  TIER_GUARD_MINUTES,
  TIER_OPERATOR_MINUTES,
} from "../metrics";
import type { Decision, Outcome, Incident } from "../../db/schema";

function makeDecision(overrides: Partial<Decision> & { id: string; chosenTier: number; confidence: number }): Decision {
  return {
    incidentId: "inc-1",
    inputsJson: "{}",
    factorsJson: "[]",
    autonomyGate: "auto",
    policyVersionHash: "test",
    rationaleJson: null,
    timestamp: 1000,
    createdAt: 1000,
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<Outcome> & { id: string; decisionId: string }): Outcome {
  return {
    incidentId: "inc-1",
    source: "guard_closeout",
    wasReal: null,
    correctTier: null,
    notes: null,
    timestamp: 2000,
    createdAt: 2000,
    ...overrides,
  };
}

describe("metrics", () => {
  describe("responseCostUsd", () => {
    it("tier 0 costs nothing", () => {
      expect(responseCostUsd(0)).toBe(0);
    });

    it("tier 3 costs guard-minutes + operator-minutes at stated rates", () => {
      const expected = 10 * GUARD_RATE_PER_MIN + 3 * OPERATOR_RATE_PER_MIN;
      expect(responseCostUsd(3)).toBeCloseTo(expected, 5);
    });

    it("tier 4 is the most expensive", () => {
      expect(responseCostUsd(4)).toBeGreaterThan(responseCostUsd(3));
    });
  });

  describe("harmCostUsd", () => {
    it("zero for benign incidents regardless of tier", () => {
      expect(harmCostUsd(0, 0, false)).toBe(0);
      expect(harmCostUsd(0, 4, false)).toBe(0);
    });

    it("zero when response meets true level", () => {
      expect(harmCostUsd(3, 3, true)).toBe(0);
      expect(harmCostUsd(3, 4, true)).toBe(0); // over-response = no harm
    });

    it("charges C_HARM × gap for under-response to real", () => {
      // true=3, responded=1, gap=2
      expect(harmCostUsd(3, 1, true)).toBe(C_HARM_PER_LEVEL * 2);
      expect(harmCostUsd(3, 1, true)).toBe(1000);
    });
  });

  describe("operational cost", () => {
    it("computes zero cost when all tiers match", () => {
      const decisions = [
        makeDecision({ id: "d1", chosenTier: 3, confidence: 0.8 }),
        makeDecision({ id: "d2", chosenTier: 0, confidence: 0.9, incidentId: "inc-2" }),
      ];
      const outcomes = [
        makeOutcome({ id: "o1", decisionId: "d1", wasReal: true, correctTier: 3 }),
        makeOutcome({ id: "o2", decisionId: "d2", wasReal: false, correctTier: 0, incidentId: "inc-2" }),
      ];

      const result = computeOperationalCost(decisions, outcomes);
      expect(result.harmCostUsd).toBe(0);
      expect(result.missCount).toBe(0);
      // Response cost is still charged (that's the point — response isn't free)
      expect(result.responseCostUsd).toBeGreaterThan(0);
    });

    it("penalizes under-response to real incident", () => {
      // Real incident (true=3), agent chose tier 1 → gap of 2
      const decisions = [makeDecision({ id: "d1", chosenTier: 1, confidence: 0.5 })];
      const outcomes = [makeOutcome({ id: "o1", decisionId: "d1", wasReal: true, correctTier: 3 })];

      const result = computeOperationalCost(decisions, outcomes);
      expect(result.harmCostUsd).toBe(C_HARM_PER_LEVEL * 2);
      expect(result.missCount).toBe(1);
    });

    it("charges response cost for over-responding to benign", () => {
      // Benign (true=0), agent chose tier 3
      const decisions = [makeDecision({ id: "d1", chosenTier: 3, confidence: 0.7 })];
      const outcomes = [makeOutcome({ id: "o1", decisionId: "d1", wasReal: false, correctTier: 0 })];

      const result = computeOperationalCost(decisions, outcomes);
      expect(result.harmCostUsd).toBe(0); // no harm from over-response
      expect(result.overResponseCount).toBe(1);
      expect(result.responseCostUsd).toBe(responseCostUsd(3)); // but you paid the response cost
    });

    it("charges response cost AND harm cost for under-responding to real", () => {
      const decisions = [makeDecision({ id: "d1", chosenTier: 0, confidence: 0.3 })];
      const outcomes = [makeOutcome({ id: "o1", decisionId: "d1", wasReal: true, correctTier: 4 })];

      const result = computeOperationalCost(decisions, outcomes);
      expect(result.responseCostUsd).toBe(responseCostUsd(0)); // 0
      expect(result.harmCostUsd).toBe(C_HARM_PER_LEVEL * 4); // $2000
      expect(result.totalCostUsd).toBe(result.responseCostUsd + result.harmCostUsd);
    });
  });

  describe("Brier score", () => {
    it("perfect calibration scores 0", () => {
      const decisions = [
        makeDecision({ id: "d1", chosenTier: 3, confidence: 1.0 }),
        makeDecision({ id: "d2", chosenTier: 0, confidence: 0.0 }),
      ];
      const outcomes = [
        makeOutcome({ id: "o1", decisionId: "d1", wasReal: true }),
        makeOutcome({ id: "o2", decisionId: "d2", wasReal: false }),
      ];
      expect(computeBrierScore(decisions, outcomes)).toBe(0);
    });

    it("anti-calibration scores 1", () => {
      const decisions = [
        makeDecision({ id: "d1", chosenTier: 3, confidence: 0.0 }),
        makeDecision({ id: "d2", chosenTier: 0, confidence: 1.0 }),
      ];
      const outcomes = [
        makeOutcome({ id: "o1", decisionId: "d1", wasReal: true }),
        makeOutcome({ id: "o2", decisionId: "d2", wasReal: false }),
      ];
      expect(computeBrierScore(decisions, outcomes)).toBe(1);
    });

    it("0.7 confidence on real event → 0.09", () => {
      const decisions = [makeDecision({ id: "d1", chosenTier: 3, confidence: 0.7 })];
      const outcomes = [makeOutcome({ id: "o1", decisionId: "d1", wasReal: true })];
      expect(computeBrierScore(decisions, outcomes)).toBeCloseTo(0.09, 5);
    });
  });

  describe("guard-minutes", () => {
    it("computes tier-based costs correctly", () => {
      const decisions = [
        makeDecision({ id: "d1", chosenTier: 0, confidence: 0.9 }),
        makeDecision({ id: "d2", chosenTier: 1, confidence: 0.8 }),
        makeDecision({ id: "d3", chosenTier: 2, confidence: 0.7 }),
        makeDecision({ id: "d4", chosenTier: 3, confidence: 0.6 }),
        makeDecision({ id: "d5", chosenTier: 4, confidence: 0.5 }),
      ];
      // 0 + 0 + 0.5 + 10 + 30 = 40.5
      expect(computeGuardMinutes(decisions)).toBe(40.5);
    });
  });

  describe("ack rate", () => {
    it("divides by dispatched incidents (tier >= 2), not all", () => {
      const decisions = [
        makeDecision({ id: "d1", chosenTier: 0, confidence: 0.9, incidentId: "inc-1" }), // not dispatched
        makeDecision({ id: "d2", chosenTier: 2, confidence: 0.7, incidentId: "inc-2" }), // dispatched
        makeDecision({ id: "d3", chosenTier: 3, confidence: 0.6, incidentId: "inc-3" }), // dispatched
      ];
      const outcomes = [
        makeOutcome({ id: "o1", decisionId: "d2", incidentId: "inc-2", source: "guard_closeout" }), // acked
        // inc-3 has no ack
      ];

      const rate = computeAckRate(decisions, outcomes);
      // 1 acked out of 2 dispatched = 0.5
      expect(rate).toBe(0.5);
    });

    it("returns 0 when nothing dispatched", () => {
      const decisions = [makeDecision({ id: "d1", chosenTier: 0, confidence: 0.9 })];
      expect(computeAckRate(decisions, [])).toBe(0);
    });
  });

  describe("time-to-resolution", () => {
    it("computes median and mean correctly", () => {
      const incidents: Incident[] = [
        {
          id: "i1", siteId: "s1", zoneId: null, status: "resolved",
          eventIds: "[]", priority: 10, tier: 1, confidence: 0.5,
          createdAt: 0, updatedAt: 0, resolvedAt: 300000,
        },
        {
          id: "i2", siteId: "s1", zoneId: null, status: "false_alarm",
          eventIds: "[]", priority: 5, tier: 0, confidence: 0.8,
          createdAt: 0, updatedAt: 0, resolvedAt: 600000,
        },
        {
          id: "i3", siteId: "s1", zoneId: null, status: "open",
          eventIds: "[]", priority: 20, tier: 2, confidence: 0.6,
          createdAt: 0, updatedAt: 0, resolvedAt: null,
        },
      ];

      const result = computeTimeToResolution(incidents);
      expect(result.count).toBe(2);
      expect(result.median).toBe(600); // [300, 600], floor(2/2) = index 1
      expect(result.mean).toBe(450);
    });
  });
});
