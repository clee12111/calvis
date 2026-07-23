import { describe, it, expect, beforeEach } from "vitest";
import { EpisodicMemory, type PrecedentEntry } from "../episodic-memory";

function entry(overrides: Partial<PrecedentEntry> = {}): PrecedentEntry {
  return {
    incidentId: "inc-001",
    siteId: "site-001",
    zoneId: "zone-1-0",
    eventTypes: ["door_forced"],
    chosenTier: 3,
    trueLevel: 3,
    wasReal: true,
    nightIndex: 0,
    timestamp: 1000,
    ...overrides,
  };
}

describe("episodic-memory", () => {
  let memory: EpisodicMemory;

  beforeEach(() => {
    memory = new EpisodicMemory();
  });

  describe("empty state", () => {
    it("returns empty array for findPrecedents", () => {
      const result = memory.findPrecedents({
        siteId: "site-001",
        zoneId: null,
        eventTypes: ["door_forced"],
      });
      expect(result).toEqual([]);
    });

    it("hasPrecedent returns false", () => {
      expect(memory.hasPrecedent("site-001", ["door_forced"])).toBe(false);
    });

    it("size is 0", () => {
      expect(memory.size).toBe(0);
    });
  });

  describe("record and retrieve", () => {
    it("records an entry and finds it", () => {
      memory.record(entry());
      const result = memory.findPrecedents({
        siteId: "site-001",
        zoneId: "zone-1-0",
        eventTypes: ["door_forced"],
      });
      expect(result.length).toBe(1);
      expect(result[0].incidentId).toBe("inc-001");
    });

    it("hasPrecedent returns true after recording", () => {
      memory.record(entry());
      expect(memory.hasPrecedent("site-001", ["door_forced"])).toBe(true);
    });

    it("hasPrecedent returns false for different site/type", () => {
      memory.record(entry());
      expect(memory.hasPrecedent("site-999", ["panic_button"])).toBe(false);
    });
  });

  describe("scoring and ordering", () => {
    it("ranks same-site matches higher than different-site", () => {
      memory.record(entry({ incidentId: "inc-A", siteId: "site-001" }));
      memory.record(entry({ incidentId: "inc-B", siteId: "site-002" }));

      const result = memory.findPrecedents({
        siteId: "site-001",
        zoneId: null,
        eventTypes: ["door_forced"],
      });
      expect(result.length).toBe(2);
      expect(result[0].incidentId).toBe("inc-A"); // same site = higher score
    });

    it("ranks zone match higher", () => {
      memory.record(entry({ incidentId: "inc-A", zoneId: "zone-1-0" }));
      memory.record(entry({ incidentId: "inc-B", zoneId: "zone-1-1" }));

      const result = memory.findPrecedents({
        siteId: "site-001",
        zoneId: "zone-1-0",
        eventTypes: ["door_forced"],
      });
      expect(result[0].incidentId).toBe("inc-A"); // zone match
    });

    it("ranks more type overlap higher", () => {
      memory.record(entry({
        incidentId: "inc-A",
        eventTypes: ["door_forced", "plate_read_unknown"],
      }));
      memory.record(entry({
        incidentId: "inc-B",
        eventTypes: ["door_forced"],
      }));

      const result = memory.findPrecedents({
        siteId: "site-001",
        zoneId: null,
        eventTypes: ["door_forced", "plate_read_unknown"],
      });
      expect(result[0].incidentId).toBe("inc-A"); // 2 type matches > 1
    });

    it("breaks ties by recency (latest first)", () => {
      memory.record(entry({ incidentId: "inc-old", timestamp: 1000 }));
      memory.record(entry({ incidentId: "inc-new", timestamp: 9000 }));

      const result = memory.findPrecedents({
        siteId: "site-001",
        zoneId: "zone-1-0",
        eventTypes: ["door_forced"],
      });
      expect(result[0].incidentId).toBe("inc-new"); // more recent
    });
  });

  describe("k limit", () => {
    it("respects k parameter", () => {
      for (let i = 0; i < 10; i++) {
        memory.record(entry({ incidentId: `inc-${i}`, timestamp: i * 1000 }));
      }

      const result = memory.findPrecedents({
        siteId: "site-001",
        zoneId: null,
        eventTypes: ["door_forced"],
        k: 3,
      });
      expect(result.length).toBe(3);
    });

    it("defaults to k=5", () => {
      for (let i = 0; i < 10; i++) {
        memory.record(entry({ incidentId: `inc-${i}`, timestamp: i * 1000 }));
      }

      const result = memory.findPrecedents({
        siteId: "site-001",
        zoneId: null,
        eventTypes: ["door_forced"],
      });
      expect(result.length).toBe(5);
    });
  });

  describe("filters irrelevant entries", () => {
    it("does not return entries with no type overlap", () => {
      memory.record(entry({ eventTypes: ["panic_button"] }));

      const result = memory.findPrecedents({
        siteId: "site-001",
        zoneId: null,
        eventTypes: ["robot_offline"],
      });
      expect(result.length).toBe(0);
    });
  });

  describe("reset", () => {
    it("clears all entries", () => {
      memory.record(entry());
      memory.record(entry({ incidentId: "inc-002" }));
      expect(memory.size).toBe(2);

      memory.reset();
      expect(memory.size).toBe(0);
      expect(memory.findPrecedents({
        siteId: "site-001",
        zoneId: null,
        eventTypes: ["door_forced"],
      })).toEqual([]);
    });
  });

  describe("serialization", () => {
    it("round-trips through serialize/deserialize", () => {
      memory.record(entry({ incidentId: "inc-A" }));
      memory.record(entry({ incidentId: "inc-B", siteId: "site-002" }));

      const serialized = memory.serialize();
      const memory2 = new EpisodicMemory();
      memory2.deserialize(serialized);

      expect(memory2.size).toBe(2);
      expect(memory2.hasPrecedent("site-001", ["door_forced"])).toBe(true);
      expect(memory2.hasPrecedent("site-002", ["door_forced"])).toBe(true);
    });
  });
});
