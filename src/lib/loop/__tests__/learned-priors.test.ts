import { describe, it, expect, beforeEach } from "vitest";
import { LearnedPriorStore, betaMean, hourBucket } from "../learned-priors";

describe("learned-priors", () => {
  let store: LearnedPriorStore;

  beforeEach(() => {
    store = new LearnedPriorStore();
  });

  describe("initial state", () => {
    it("returns hand-set prior at n=0 for known event types", () => {
      const result = store.getPrior({
        eventType: "panic_button",
        siteId: "site-001",
        zoneId: null,
        simTimeMs: 0,
      });
      expect(result.n).toBe(0);
      expect(result.pReal).toBeCloseTo(0.85, 1);
      expect(result.source).toContain("hand-set");
    });

    it("returns hand-set prior for robot_offline at n=0", () => {
      const result = store.getPrior({
        eventType: "robot_offline",
        siteId: "site-001",
        zoneId: null,
        simTimeMs: 0,
      });
      expect(result.n).toBe(0);
      expect(result.pReal).toBeCloseTo(0.05, 1);
    });
  });

  describe("update", () => {
    it("increments alpha on real outcome", () => {
      store.update({
        eventType: "panic_button",
        siteId: "site-001",
        zoneId: null,
        simTimeMs: 0,
        wasReal: true,
      });
      const result = store.getPrior({
        eventType: "panic_button",
        siteId: "site-001",
        zoneId: null,
        simTimeMs: 0,
      });
      // After 1 real update: alpha goes from 1.7 to 2.7, beta stays at 0.3
      // Mean = 2.7 / 3.0 = 0.9
      expect(result.pReal).toBeGreaterThan(0.85);
      expect(result.n).toBe(1);
    });

    it("increments beta on false-alarm outcome", () => {
      store.update({
        eventType: "panic_button",
        siteId: "site-001",
        zoneId: null,
        simTimeMs: 0,
        wasReal: false,
      });
      const result = store.getPrior({
        eventType: "panic_button",
        siteId: "site-001",
        zoneId: null,
        simTimeMs: 0,
      });
      // After 1 false-alarm: alpha stays at 1.7, beta goes from 0.3 to 1.3
      // Mean = 1.7 / 3.0 = 0.567
      expect(result.pReal).toBeLessThan(0.85);
      expect(result.n).toBe(1);
    });

    it("updates all hierarchy levels", () => {
      store.update({
        eventType: "door_forced",
        siteId: "site-005",
        zoneId: "zone-5-1",
        simTimeMs: 3600_000, // hour bucket 0
        wasReal: true,
      });

      // Event-type level should be updated
      const typeLevel = store.getPrior({
        eventType: "door_forced",
        siteId: "site-999", // different site
        zoneId: null,
        simTimeMs: 0,
      });
      expect(typeLevel.n).toBe(1);
    });

    it("accumulates observations correctly", () => {
      for (let i = 0; i < 5; i++) {
        store.update({
          eventType: "missed_check_in",
          siteId: "site-003",
          zoneId: null,
          simTimeMs: 0,
          wasReal: true,
        });
      }
      const result = store.getPrior({
        eventType: "missed_check_in",
        siteId: "site-003",
        zoneId: null,
        simTimeMs: 0,
      });
      expect(result.n).toBe(5);
      // Started at 0.30, 5 real updates should push it higher
      expect(result.pReal).toBeGreaterThan(0.60);
    });
  });

  describe("cold-start backoff", () => {
    it("backs off from sparse hour-level to site-level", () => {
      // Add 1 observation at hour level (below MIN_N_FOR_CELL=3)
      store.update({
        eventType: "plate_read_unknown",
        siteId: "site-002",
        zoneId: null,
        simTimeMs: 7200_000, // h1
        wasReal: false,
      });

      // Should back off to event-type level (1 obs at site level too)
      const result = store.getPrior({
        eventType: "plate_read_unknown",
        siteId: "site-002",
        zoneId: null,
        simTimeMs: 7200_000,
      });
      // n=1 at all levels, below threshold of 3 → backs off to type level
      expect(result.n).toBe(1);
      expect(result.source).toContain("plate_read_unknown");
    });

    it("uses specific cell when n >= MIN_N_FOR_CELL", () => {
      // Add 4 observations at site level
      for (let i = 0; i < 4; i++) {
        store.update({
          eventType: "robot_offline",
          siteId: "site-010",
          zoneId: null,
          simTimeMs: 0,
          wasReal: false,
        });
      }

      const result = store.getPrior({
        eventType: "robot_offline",
        siteId: "site-010",
        zoneId: null,
        simTimeMs: 0,
      });
      // n=4 >= 3, so should use the site-level cell
      expect(result.n).toBe(4);
      expect(result.source).toContain("site-010");
      expect(result.source).toContain("learned");
    });
  });

  describe("serialization", () => {
    it("round-trips through serialize/deserialize", () => {
      store.update({
        eventType: "panic_button",
        siteId: "site-001",
        zoneId: null,
        simTimeMs: 0,
        wasReal: true,
      });
      store.update({
        eventType: "door_forced",
        siteId: "site-002",
        zoneId: "zone-2-1",
        simTimeMs: 3600_000,
        wasReal: false,
      });

      const serialized = store.serialize();
      const store2 = new LearnedPriorStore();
      store2.deserialize(serialized);

      const r1 = store.getPrior({ eventType: "panic_button", siteId: "site-001", zoneId: null, simTimeMs: 0 });
      const r2 = store2.getPrior({ eventType: "panic_button", siteId: "site-001", zoneId: null, simTimeMs: 0 });
      expect(r2.pReal).toBeCloseTo(r1.pReal, 6);
    });
  });

  describe("getTopMovedPriors", () => {
    it("returns priors sorted by movement from starting value", () => {
      // Big move: 10 false alarms on panic_button
      for (let i = 0; i < 10; i++) {
        store.update({
          eventType: "panic_button",
          siteId: "site-001",
          zoneId: null,
          simTimeMs: 0,
          wasReal: false,
        });
      }
      // Small move: 1 real on robot_offline
      store.update({
        eventType: "robot_offline",
        siteId: "site-001",
        zoneId: null,
        simTimeMs: 0,
        wasReal: true,
      });

      const top = store.getTopMovedPriors(5);
      expect(top.length).toBeGreaterThan(0);
      // panic_button should have biggest movement (85% → much lower)
      expect(top[0].eventType).toBe("panic_button");
      expect(top[0].movement).toBeGreaterThan(0.3);
    });

    it("returns empty array when nothing has moved", () => {
      const top = store.getTopMovedPriors(5);
      expect(top).toEqual([]);
    });
  });

  describe("reset", () => {
    it("clears all learned state", () => {
      store.update({
        eventType: "panic_button",
        siteId: "site-001",
        zoneId: null,
        simTimeMs: 0,
        wasReal: false,
      });
      expect(store.getPrior({ eventType: "panic_button", siteId: "site-001", zoneId: null, simTimeMs: 0 }).n).toBe(1);

      store.reset();
      expect(store.getPrior({ eventType: "panic_button", siteId: "site-001", zoneId: null, simTimeMs: 0 }).n).toBe(0);
    });
  });

  describe("hourBucket", () => {
    it("maps 10h night into 5 buckets of 2h each", () => {
      expect(hourBucket(0)).toBe(0);           // 20:00
      expect(hourBucket(3600_000)).toBe(0);     // 21:00
      expect(hourBucket(7200_000)).toBe(1);     // 22:00
      expect(hourBucket(14400_000)).toBe(2);    // 00:00
      expect(hourBucket(28800_000)).toBe(4);    // 04:00
    });
  });

  describe("betaMean", () => {
    it("computes posterior mean correctly", () => {
      expect(betaMean({ alpha: 1, beta: 1 })).toBeCloseTo(0.5, 5);
      expect(betaMean({ alpha: 8, beta: 2 })).toBeCloseTo(0.8, 5);
      expect(betaMean({ alpha: 1, beta: 9 })).toBeCloseTo(0.1, 5);
    });
  });
});
