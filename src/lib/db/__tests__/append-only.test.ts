import { describe, it, expect, beforeEach } from "vitest";
import { eventRepo, decisionRepo, AppendOnlyViolation } from "../repository";
import { createTestDb, getSqlite } from "../connection";

describe("append-only enforcement", () => {
  beforeEach(() => {
    createTestDb();
    // Insert a site so FK constraints pass
    getSqlite().exec(`
      INSERT INTO sites (id, name, address, criticality_tier, zones_json, created_at)
      VALUES ('site-1', 'Test Site', '123 Main St', 3, '[]', 1000);
    `);
  });

  describe("events", () => {
    it("allows insert", () => {
      expect(() =>
        eventRepo.insert({
          id: "evt-1",
          type: "door_forced",
          siteId: "site-1",
          sourceType: "sensor",
          severity: 3,
          timestamp: 1000,
          createdAt: Date.now(),
        })
      ).not.toThrow();
    });

    it("throws on update", () => {
      expect(() => eventRepo.update()).toThrow(AppendOnlyViolation);
      expect(() => eventRepo.update()).toThrow("events is append-only: update is not allowed");
    });

    it("throws on delete", () => {
      expect(() => eventRepo.delete()).toThrow(AppendOnlyViolation);
      expect(() => eventRepo.delete()).toThrow("events is append-only: delete is not allowed");
    });
  });

  describe("decisions", () => {
    beforeEach(() => {
      // Insert prerequisite incident
      getSqlite().exec(`
        INSERT INTO incidents (id, site_id, status, event_ids_json, created_at, updated_at)
        VALUES ('inc-1', 'site-1', 'open', '["evt-1"]', 1000, 1000);
      `);
    });

    it("allows insert", () => {
      expect(() =>
        decisionRepo.insert({
          id: "dec-1",
          incidentId: "inc-1",
          inputsJson: "{}",
          factorsJson: "[]",
          chosenTier: 2,
          confidence: 0.8,
          autonomyGate: "auto",
          policyVersionHash: "v1-abc",
          timestamp: 1000,
          createdAt: Date.now(),
        })
      ).not.toThrow();
    });

    it("throws on update", () => {
      expect(() => decisionRepo.update()).toThrow(AppendOnlyViolation);
      expect(() => decisionRepo.update()).toThrow("decisions is append-only: update is not allowed");
    });

    it("throws on delete", () => {
      expect(() => decisionRepo.delete()).toThrow(AppendOnlyViolation);
      expect(() => decisionRepo.delete()).toThrow("decisions is append-only: delete is not allowed");
    });
  });
});
