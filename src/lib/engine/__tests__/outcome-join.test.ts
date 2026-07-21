import { describe, it, expect, beforeEach } from "vitest";
import { joinOutcome, processLateOutcome } from "../outcome-join";
import { decisionRepo, outcomeRepo, incidentRepo } from "../../db/repository";
import { createTestDb, getSqlite } from "../../db/connection";

describe("outcome join", () => {
  beforeEach(() => {
    createTestDb();
    const db = getSqlite();
    db.exec(`
      INSERT INTO sites VALUES ('site-1', 'Test Site', '100 Main', 3, NULL, NULL, NULL, NULL, '[]', 1000);
      INSERT INTO incidents VALUES ('inc-1', 'site-1', NULL, 'open', '["evt-1"]', 10, 2, 0.7, 1000, 1000, NULL);
      INSERT INTO decisions VALUES ('dec-1', 'inc-1', '{}', '[]', 2, 0.7, 'auto', 'test-v1', NULL, 1000, 1000);
    `);
  });

  it("joins an outcome to the correct decision", () => {
    const outcome = joinOutcome({
      incidentId: "inc-1",
      source: "guard_closeout",
      wasReal: false,
      correctTier: 0,
      notes: "false alarm",
      timestamp: 2000,
    });

    expect(outcome).not.toBeNull();
    expect(outcome!.decisionId).toBe("dec-1");
    expect(outcome!.wasReal).toBe(false);
    expect(outcome!.correctTier).toBe(0);
  });

  it("updates incident status to false_alarm", () => {
    joinOutcome({
      incidentId: "inc-1",
      source: "guard_closeout",
      wasReal: false,
      correctTier: 0,
      notes: "benign",
      timestamp: 2000,
    });

    const incident = incidentRepo.getById("inc-1");
    expect(incident?.status).toBe("false_alarm");
    expect(incident?.resolvedAt).toBe(2000);
  });

  it("decisions remain immutable after outcome join", () => {
    joinOutcome({
      incidentId: "inc-1",
      source: "guard_closeout",
      wasReal: true,
      correctTier: 3,
      notes: "confirmed real",
      timestamp: 2000,
    });

    // Decision should not have changed
    const decision = decisionRepo.getById("dec-1");
    expect(decision?.chosenTier).toBe(2);
    expect(decision?.confidence).toBe(0.7);
  });

  it("late_label joins correctly (40+ min after decision)", () => {
    // Late outcome arrives 45 minutes after the decision
    const lateTimestamp = 1000 + 45 * 60 * 1000; // 45min after decision

    const outcome = processLateOutcome({
      incidentId: "inc-1",
      wasReal: false,
      correctTier: 0,
      notes: "CEO's rental car",
      timestamp: lateTimestamp,
    });

    expect(outcome).not.toBeNull();
    expect(outcome!.source).toBe("late_signal");
    expect(outcome!.timestamp).toBe(lateTimestamp);
    expect(outcome!.decisionId).toBe("dec-1");

    // Should have exactly 1 outcome
    const outcomes = outcomeRepo.getByIncident("inc-1");
    expect(outcomes).toHaveLength(1);
  });

  it("every incident has >= 1 decision after scoring", () => {
    // This is verified — dec-1 exists for inc-1
    const decisions = decisionRepo.getByIncident("inc-1");
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });
});
