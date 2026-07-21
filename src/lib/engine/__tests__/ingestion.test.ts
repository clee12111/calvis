import { describe, it, expect, beforeEach } from "vitest";
import { IngestionPipeline } from "../ingestion";
import { eventRepo } from "../../db/repository";
import { createTestDb, execSql } from "../../db/connection";
import type { SimEvent } from "../scenarios";

function makeEvent(id: string, timestamp: number, overrides?: Partial<SimEvent>): SimEvent {
  return {
    id,
    type: "robot_motion_anomaly",
    siteId: "site-1",
    zoneId: "zone-1",
    sourceType: "robot",
    sourceId: "robot-1",
    severity: 2,
    timestamp,
    rawDataJson: null,
    groundTruthLabel: "false_alarm",
    scenarioId: null,
    ...overrides,
  };
}

describe("IngestionPipeline", () => {
  beforeEach(async () => {
    await createTestDb();
    await execSql(`
      INSERT INTO sites VALUES ('site-1', 'Test Site', '100 Main', 3, NULL, NULL, NULL, NULL, '[]', 1000);
    `);
  });

  it("ingests all events in order", async () => {
    const events = [
      makeEvent("e-1", 1000),
      makeEvent("e-2", 2000),
      makeEvent("e-3", 3000),
    ];
    const pipeline = new IngestionPipeline(events);
    const ingested = await pipeline.ingestAll();

    expect(ingested).toHaveLength(3);
    expect(pipeline.ingestedCount).toBe(3);
    expect(pipeline.done).toBe(true);

    // Verify persisted
    expect(await eventRepo.getAll()).toHaveLength(3);
  });

  it("deduplicates events by ID", async () => {
    const events = [
      makeEvent("e-1", 1000),
      makeEvent("e-1", 1000), // duplicate
      makeEvent("e-2", 2000),
    ];
    const pipeline = new IngestionPipeline(events);
    const ingested = await pipeline.ingestAll();

    expect(ingested).toHaveLength(2); // only 2 unique
    expect(pipeline.ingestedCount).toBe(2);
    expect(await eventRepo.getAll()).toHaveLength(2);
  });

  it("partial ingestion via ingestUpTo", async () => {
    const events = [
      makeEvent("e-1", 1000),
      makeEvent("e-2", 2000),
      makeEvent("e-3", 5000),
      makeEvent("e-4", 8000),
    ];
    const pipeline = new IngestionPipeline(events);

    // Ingest only up to t=3000
    const batch1 = await pipeline.ingestUpTo(3000);
    expect(batch1).toHaveLength(2);
    expect(pipeline.ingestedCount).toBe(2);
    expect(pipeline.done).toBe(false);

    // Ingest remaining
    const batch2 = await pipeline.ingestUpTo(10000);
    expect(batch2).toHaveLength(2);
    expect(pipeline.ingestedCount).toBe(4);
    expect(pipeline.done).toBe(true);
  });

  it("notifies subscribers for each ingested event", async () => {
    const events = [makeEvent("e-1", 1000), makeEvent("e-2", 2000)];
    const pipeline = new IngestionPipeline(events);

    const received: string[] = [];
    pipeline.subscribe((event) => received.push(event.id));
    await pipeline.ingestAll();

    expect(received).toEqual(["e-1", "e-2"]);
  });

  it("unsubscribe stops notifications", async () => {
    const events = [makeEvent("e-1", 1000), makeEvent("e-2", 2000)];
    const pipeline = new IngestionPipeline(events);

    const received: string[] = [];
    const unsub = pipeline.subscribe((event) => received.push(event.id));
    await pipeline.ingestUpTo(1500);
    unsub();
    await pipeline.ingestUpTo(3000);

    expect(received).toEqual(["e-1"]); // only first event before unsub
  });
});
