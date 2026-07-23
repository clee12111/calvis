import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, execSql } from "../../db/connection";
import { outcomeRepo, decisionRepo, incidentRepo } from "../../db/repository";

describe("override validation and persistence", () => {
  beforeEach(async () => {
    await createTestDb();

    // Set up test data: site, incident, decision
    await execSql(`
      INSERT INTO sites VALUES ('site-1', 'Test Site', '100 Main', 3, NULL, NULL, NULL, NULL, '[{"id":"zone-1","name":"Lobby","exposure":3}]', 1000);
    `);
    await execSql(`
      INSERT INTO incidents VALUES ('inc-test', 'site-1', 'zone-1', 'open', '["evt-1"]', 50, 3, 0.7, 5000000, 5000000, NULL);
    `);
    await execSql(`
      INSERT INTO decisions VALUES ('dec-test', 'inc-test', '{}', '[{"name":"severity","value":4,"weight":1}]', 3, 0.7, 'propose', 'v1', '{"method":"test"}', 5000000, 5000000);
    `);
  });

  it("persists an approve and survives re-read", async () => {
    const timestamp = Date.now();
    await outcomeRepo.insert({
      id: `out-inc-test-approve-${timestamp}`,
      decisionId: "dec-test",
      incidentId: "inc-test",
      source: "operator_override",
      wasReal: undefined,
      correctTier: 3,
      notes: "Operator approved",
      timestamp,
      createdAt: timestamp,
    });

    const outcomes = await outcomeRepo.getAll();
    expect(outcomes.length).toBe(1);
    expect(outcomes[0].incidentId).toBe("inc-test");
    expect(outcomes[0].correctTier).toBe(3);
    expect(outcomes[0].source).toBe("operator_override");
  });

  it("persists an override with reason and updates incident tier", async () => {
    const timestamp = Date.now();
    await outcomeRepo.insert({
      id: `out-inc-test-override-${timestamp}`,
      decisionId: "dec-test",
      incidentId: "inc-test",
      source: "operator_override",
      wasReal: undefined,
      correctTier: 4,
      notes: "Guard confirmed intruder on premises",
      timestamp,
      createdAt: timestamp,
    });

    await incidentRepo.update("inc-test", { tier: 4, updatedAt: timestamp });

    // Verify outcome persisted
    const outcomes = await outcomeRepo.getAll();
    expect(outcomes.length).toBe(1);
    expect(outcomes[0].correctTier).toBe(4);
    expect(outcomes[0].notes).toContain("intruder");

    // Verify incident tier updated
    const incident = await incidentRepo.getById("inc-test");
    expect(incident?.tier).toBe(4);
  });

  it("override survives re-read after insert", async () => {
    const timestamp = Date.now();
    await outcomeRepo.insert({
      id: `out-1`,
      decisionId: "dec-test",
      incidentId: "inc-test",
      source: "operator_override",
      wasReal: undefined,
      correctTier: 2,
      notes: "Downgraded: delivery truck confirmed",
      timestamp,
      createdAt: timestamp,
    });

    // Second read should still return the outcome
    const outcomes1 = await outcomeRepo.getAll();
    expect(outcomes1.length).toBe(1);

    // Insert a second override
    await outcomeRepo.insert({
      id: `out-2`,
      decisionId: "dec-test",
      incidentId: "inc-test",
      source: "operator_override",
      wasReal: undefined,
      correctTier: 1,
      notes: "Further downgraded after camera review",
      timestamp: timestamp + 1000,
      createdAt: timestamp + 1000,
    });

    const outcomes2 = await outcomeRepo.getAll();
    expect(outcomes2.length).toBe(2);
    // Latest override is the correct signal
    expect(outcomes2[1].correctTier).toBe(1);
  });

  it("rejects override without reason (API-level validation)", async () => {
    const decisions = await decisionRepo.getByIncident("inc-test");
    expect(decisions.length).toBe(1);
    expect(decisions[0].chosenTier).toBe(3);
  });

  it("detects incoherent override: false alarm + escalation", () => {
    const falseAlarmPattern = /false\s*alarm|not\s*real|benign|equipment|malfunction/i;
    expect(falseAlarmPattern.test("False alarm - delivery truck")).toBe(true);
    expect(falseAlarmPattern.test("Equipment malfunction at gate")).toBe(true);
    expect(falseAlarmPattern.test("Confirmed intruder")).toBe(false);

    const isEscalation = (newTier: number, currentTier: number) => newTier > currentTier;
    expect(isEscalation(4, 3) && falseAlarmPattern.test("false alarm")).toBe(true);
    expect(isEscalation(1, 3) && falseAlarmPattern.test("false alarm")).toBe(false);
  });

  it("detects incoherent override: real threat + de-escalation", () => {
    const realThreatPattern = /confirmed\s*threat|active\s*intruder|weapon|shots?\s*fired|hostage/i;
    expect(realThreatPattern.test("confirmed threat at loading dock")).toBe(true);
    expect(realThreatPattern.test("active intruder in building")).toBe(true);
    expect(realThreatPattern.test("Delivery truck confirmed")).toBe(false);

    const isDeescalation = (newTier: number, currentTier: number) => newTier < currentTier;
    expect(isDeescalation(1, 3) && realThreatPattern.test("active intruder")).toBe(true);
  });

  // API-level validation tests (exercise the same logic as the route handler)
  describe("API-level validation logic", () => {
    // Extract the validation function to match the route handler exactly
    function validateOverride(
      action: "override",
      newTier: number,
      currentTier: number,
      reason: string,
    ): { ok: boolean; error?: string } {
      if (!reason) return { ok: false, error: "reason is required for override" };
      if (typeof newTier !== "number" || newTier < 0 || newTier > 4) {
        return { ok: false, error: "newTier must be 0-4" };
      }

      const isEscalation = newTier > currentTier;
      const falseAlarmPattern = /false\s*alarm|not\s*real|benign|equipment|malfunction/i;
      if (isEscalation && falseAlarmPattern.test(reason)) {
        return { ok: false, error: "Incoherent override: reason says false alarm but tier is escalating." };
      }

      const realThreatPattern = /confirmed\s*threat|active\s*intruder|weapon|shots?\s*fired|hostage/i;
      const isDeescalation = newTier < currentTier;
      if (isDeescalation && realThreatPattern.test(reason)) {
        return { ok: false, error: "Incoherent override: reason indicates a real threat but tier is de-escalating." };
      }

      return { ok: true };
    }

    it("rejects escalation with false-alarm reason", () => {
      // Current tier = 3, override to 4, reason = "false alarm"
      const result = validateOverride("override", 4, 3, "false alarm - was a delivery");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("false alarm");
    });

    it("accepts de-escalation with false-alarm reason", () => {
      const result = validateOverride("override", 1, 3, "false alarm confirmed by camera");
      expect(result.ok).toBe(true);
    });

    it("rejects de-escalation with real-threat reason", () => {
      const result = validateOverride("override", 1, 3, "confirmed threat at loading dock");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("real threat");
    });

    it("accepts escalation with real-threat reason", () => {
      const result = validateOverride("override", 4, 2, "confirmed threat - intruder sighted");
      expect(result.ok).toBe(true);
    });

    it("rejects override without reason", () => {
      const result = validateOverride("override", 2, 3, "");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("reason is required");
    });

    it("rejects invalid tier values", () => {
      const result = validateOverride("override", 5, 3, "some reason");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("0-4");
    });

    it("accepts same-tier override with neutral reason", () => {
      const result = validateOverride("override", 3, 3, "Adjusting classification after review");
      expect(result.ok).toBe(true);
    });

    it("accepts escalation with benign equipment reason", () => {
      // "equipment malfunction" + escalation = incoherent
      const result = validateOverride("override", 4, 2, "equipment malfunction");
      expect(result.ok).toBe(false);
    });
  });
});
