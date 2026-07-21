import { describe, it, expect, beforeEach } from "vitest";
import { scoreIncident, EVENT_TYPE_PRIOR } from "../baseline-scorer";
import { createTestDb, getSqlite } from "../../db/connection";
import type { Incident } from "../../db/schema";

describe("baseline-scorer", () => {
  beforeEach(() => {
    createTestDb();
    getSqlite().exec(`
      INSERT INTO sites VALUES ('site-1', 'Test Site', '100 Main', 3, NULL, NULL, NULL, NULL, '[{"id":"zone-1","name":"Lobby","exposure":3}]', 1000);
    `);
  });

  function makeIncident(eventSetup: () => void, overrides?: Partial<Incident>): Incident {
    eventSetup();
    return {
      id: "inc-test",
      siteId: "site-1",
      zoneId: "zone-1",
      status: "open",
      eventIds: JSON.stringify(["evt-1"]),
      priority: null,
      tier: null,
      confidence: null,
      createdAt: 5000000, // deep night
      updatedAt: 5000000,
      resolvedAt: null,
      ...overrides,
    };
  }

  it("returns site-not-found fallback", () => {
    const incident: Incident = {
      id: "inc-test", siteId: "nonexistent", zoneId: null, status: "open",
      eventIds: '["evt-1"]', priority: null, tier: null, confidence: null,
      createdAt: 1000, updatedAt: 1000, resolvedAt: null,
    };
    const result = scoreIncident(incident);
    expect(result.tier).toBe(1);
    expect(result.confidence).toBe(0.5);
  });

  it("high-severity panic_button gets high confidence and high tier", () => {
    getSqlite().exec(`
      INSERT INTO events VALUES ('evt-1', 'panic_button', 'site-1', 'zone-1', 'guard', 'g-1', 5, 5000000, NULL, NULL, NULL, 1000);
    `);
    const incident = makeIncident(() => {}, { eventIds: '["evt-1"]' });
    const result = scoreIncident(incident);
    expect(result.confidence).toBeGreaterThan(0.8); // panic_button prior is 0.85
    expect(result.tier).toBeGreaterThanOrEqual(3);
  });

  it("low-severity area_advisory gets low confidence and low tier", () => {
    getSqlite().exec(`
      INSERT INTO events VALUES ('evt-1', 'area_advisory', 'site-1', 'zone-1', 'sensor', NULL, 1, 5000000, NULL, NULL, NULL, 1000);
    `);
    const incident = makeIncident(() => {}, { eventIds: '["evt-1"]' });
    const result = scoreIncident(incident);
    expect(result.confidence).toBeLessThan(0.10);
    expect(result.tier).toBeLessThanOrEqual(1);
  });

  it("multiple distinct event types compound via noisy-OR", () => {
    getSqlite().exec(`
      INSERT INTO events VALUES ('evt-1', 'robot_motion_anomaly', 'site-1', 'zone-1', 'robot', 'r-1', 2, 5000000, NULL, NULL, NULL, 1000);
      INSERT INTO events VALUES ('evt-2', 'door_forced', 'site-1', 'zone-1', 'sensor', NULL, 4, 5000000, NULL, NULL, NULL, 1000);
    `);
    const incident = makeIncident(() => {}, { eventIds: '["evt-1","evt-2"]' });
    const result = scoreIncident(incident);
    // noisy-OR of 0.10 and 0.60 → 1 - (0.9 × 0.4) = 0.64
    expect(result.confidence).toBeCloseTo(0.64, 1);
  });

  it("duplicate event types from same source do NOT compound", () => {
    getSqlite().exec(`
      INSERT INTO events VALUES ('evt-1', 'robot_motion_anomaly', 'site-1', 'zone-1', 'robot', 'r-1', 1, 5000000, NULL, NULL, NULL, 1000);
      INSERT INTO events VALUES ('evt-2', 'robot_motion_anomaly', 'site-1', 'zone-1', 'robot', 'r-1', 1, 5001000, NULL, NULL, NULL, 1000);
    `);
    const incident = makeIncident(() => {}, { eventIds: '["evt-1","evt-2"]' });
    const result = scoreIncident(incident);
    // Only one robot_motion_anomaly counted → prior 0.10
    expect(result.confidence).toBeCloseTo(0.10, 1);
  });

  it("confidence is a valid probability in [0.01, 0.99]", () => {
    getSqlite().exec(`
      INSERT INTO events VALUES ('evt-1', 'robot_offline', 'site-1', 'zone-1', 'robot', 'r-1', 1, 5000000, NULL, NULL, NULL, 1000);
    `);
    const incident = makeIncident(() => {}, { eventIds: '["evt-1"]' });
    const result = scoreIncident(incident);
    expect(result.confidence).toBeGreaterThanOrEqual(0.01);
    expect(result.confidence).toBeLessThanOrEqual(0.99);
  });
});
