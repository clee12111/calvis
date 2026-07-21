import { describe, it, expect, beforeEach } from "vitest";
import { correlateEvents } from "../correlator";
import { generateEventStream, getScenarioEvents } from "../scenarios";
import { siteRepo, guardRepo, robotRepo } from "../../db/repository";
import { createTestDb, getSqlite } from "../../db/connection";

describe("correlator", () => {
  beforeEach(() => {
    createTestDb();
    const db = getSqlite();

    // Insert sites
    db.exec(`
      INSERT INTO sites VALUES ('site-000', 'Site 0', '100 Main', 3, NULL, NULL, NULL, NULL, '[{"id":"zone-0-0","name":"Loading Dock","exposure":3},{"id":"zone-0-1","name":"Lobby","exposure":2}]', 1000);
      INSERT INTO sites VALUES ('site-001', 'Site 1', '200 Main', 4, NULL, NULL, NULL, NULL, '[{"id":"zone-1-0","name":"Main Entrance","exposure":5},{"id":"zone-1-1","name":"Perimeter Fence","exposure":4}]', 1000);
      INSERT INTO sites VALUES ('site-002', 'Site 2', '300 Main', 2, NULL, NULL, NULL, NULL, '[{"id":"zone-2-0","name":"Parking","exposure":4}]', 1000);
      INSERT INTO sites VALUES ('site-003', 'Site 3', '400 Main', 5, NULL, NULL, NULL, NULL, '[{"id":"zone-3-0","name":"Parking Garage","exposure":4}]', 1000);
    `);

    // Insert enough guards (scenarios expect index up to 5)
    for (let i = 0; i < 8; i++) {
      db.exec(`INSERT INTO guards VALUES ('guard-${String(i).padStart(3, '0')}', 'Guard ${i}', '["patrol"]', 0, '["en"]', 22, 6, 'site-${String(i % 4).padStart(3, '0')}', 0.9, 300, 1000);`);
    }

    // Insert robots (scenarios expect index up to 2)
    db.exec(`
      INSERT INTO robots VALUES ('robot-000', 'Sentinel', 'site-000', '["zone-0-0"]', '["motion"]', 0.1, 1.0, 1000);
      INSERT INTO robots VALUES ('robot-001', 'Watchdog', 'site-001', '["zone-1-0"]', '["motion"]', 0.1, 1.0, 1000);
      INSERT INTO robots VALUES ('robot-002', 'Patrol', 'site-002', '["zone-2-0"]', '["motion"]', 0.15, 1.0, 1000);
    `);
  });

  it("collapses cascading_multi_event to exactly 1 incident", () => {
    const events = generateEventStream({
      seed: 42,
      sites: siteRepo.getAll(),
      guards: guardRepo.getAll(),
      robots: robotRepo.getAll(),
    });

    const cascadingEvents = getScenarioEvents(events, "cascading_multi_event");
    expect(cascadingEvents.length).toBeGreaterThanOrEqual(6);

    // Clear ingested events to avoid conflicts
    getSqlite().exec("DELETE FROM events;");

    const incidents = correlateEvents(cascadingEvents);
    expect(incidents).toHaveLength(1);

    const eventIds = JSON.parse(incidents[0].eventIds);
    expect(eventIds).toHaveLength(cascadingEvents.length);
  });

  it("collapses stuck_sensor_spam to 1 incident, not 200", () => {
    const events = generateEventStream({
      seed: 42,
      sites: siteRepo.getAll(),
      guards: guardRepo.getAll(),
      robots: robotRepo.getAll(),
    });

    const spamEvents = getScenarioEvents(events, "stuck_sensor_spam");
    expect(spamEvents).toHaveLength(200);

    getSqlite().exec("DELETE FROM events;");

    const incidents = correlateEvents(spamEvents);
    expect(incidents).toHaveLength(1);

    const eventIds = JSON.parse(incidents[0].eventIds);
    expect(eventIds).toHaveLength(200);
  });
});
