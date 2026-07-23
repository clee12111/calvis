import { describe, it, expect, beforeEach } from "vitest";
import { LoopEngine } from "../loop-engine";
import { seedWorld } from "../../engine/seed-world";
import { generateEventStream, type SimEvent } from "../../engine/scenarios";
import { correlateEvents } from "../../engine/correlator";
import { siteRepo, guardRepo, robotRepo, eventRepo } from "../../db/repository";
import { createTestDb } from "../../db/connection";
import type { Incident } from "../../db/schema";

async function setupWorld(seed: number): Promise<{
  events: SimEvent[];
  incidents: Incident[];
  guards: Awaited<ReturnType<typeof guardRepo.getAll>>;
}> {
  await createTestDb();
  await seedWorld({ seed });
  const sites = await siteRepo.getAll();
  const guards = await guardRepo.getAll();
  const robots = await robotRepo.getAll();
  const events = generateEventStream({ seed, sites, guards, robots });

  await eventRepo.insertMany(
    events.map((e) => ({
      id: e.id,
      type: e.type,
      siteId: e.siteId,
      zoneId: e.zoneId,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      severity: e.severity,
      timestamp: e.timestamp,
      rawDataJson: e.rawDataJson,
      groundTruthLabel: e.groundTruthLabel,
      scenarioId: e.scenarioId,
      createdAt: e.timestamp,
    }))
  );

  const incidents = await correlateEvents(events);
  return { events, incidents, guards };
}

describe("loop engine", () => {
  it("runs a full night with zero model calls", async () => {
    const { events, incidents, guards } = await setupWorld(42);

    const engine = new LoopEngine({
      seed: 42,
      events,
      incidents,
      guards,
    });

    const result = await engine.run();

    expect(result.decisionLog.length).toBeGreaterThan(0);
    expect(result.totalMoves).toBeGreaterThan(0);

    // Every incident should be finalized
    for (const [, state] of result.finalStates) {
      expect(state.finalized).toBe(true);
      expect(state.committedLevel).not.toBeNull();
    }
  }, 30_000);

  it("produces investigate→investigate→commit traces including human questions", async () => {
    const { events, incidents, guards } = await setupWorld(42);

    const engine = new LoopEngine({
      seed: 42,
      events,
      incidents,
      guards,
    });

    const result = await engine.run();

    expect(result.multiStepTraces.length).toBeGreaterThan(0);

    // Check for traces with system questions
    const traceId = result.multiStepTraces[0];
    const state = result.finalStates.get(traceId)!;
    const moves = state.transitions.map((t) => t.move.type);
    const investigateCount = moves.filter((m) => m === "investigate").length;
    expect(investigateCount).toBeGreaterThanOrEqual(2);
    expect(moves).toContain("commit");

    // Check for at least one trace with a human question
    let hasHumanTrace = false;
    for (const tid of result.multiStepTraces) {
      const s = result.finalStates.get(tid)!;
      const hasHuman = s.transitions.some((t) =>
        t.move.type === "investigate" &&
        (t.move as { action: { category: string } }).action.category === "human_question"
      );
      if (hasHuman) {
        hasHumanTrace = true;
        console.log("\n=== Trace with human question ===");
        console.log(LoopEngine.formatTrace(s));
        break;
      }
    }
    expect(hasHumanTrace).toBe(true);
  }, 30_000);

  it("produces byte-identical decision log across two runs with same seed", async () => {
    // Run 1
    const world1 = await setupWorld(42);
    const engine1 = new LoopEngine({
      seed: 42,
      events: world1.events,
      incidents: world1.incidents,
      guards: world1.guards,
    });
    const result1 = await engine1.run();

    // Run 2 — fresh DB, same seed
    const world2 = await setupWorld(42);
    const engine2 = new LoopEngine({
      seed: 42,
      events: world2.events,
      incidents: world2.incidents,
      guards: world2.guards,
    });
    const result2 = await engine2.run();

    // Compare decision logs — must be identical
    expect(result1.decisionLog.length).toBe(result2.decisionLog.length);

    for (let i = 0; i < result1.decisionLog.length; i++) {
      const a = result1.decisionLog[i];
      const b = result2.decisionLog[i];
      expect(a.incidentId).toBe(b.incidentId);
      expect(a.timestamp).toBe(b.timestamp);
      expect(a.move.type).toBe(b.move.type);
      expect(a.evidenceLevelBefore).toBe(b.evidenceLevelBefore);
      expect(a.evidenceLevelAfter).toBe(b.evidenceLevelAfter);
      expect(a.reason).toBe(b.reason);
      expect(a.costUsd).toBe(b.costUsd);
    }
  }, 60_000);

  it("fires leaked-learning-state assertion when deliberately broken", async () => {
    const { events, incidents, guards } = await setupWorld(42);

    const engine = new LoopEngine({
      seed: 42,
      events,
      incidents,
      guards,
    });

    // First run: assertion passes (state fresh) then marks state as used
    await engine.run();

    // Trying to assert again should throw — engine was already used
    expect(() => engine.assertLearningStateReset()).toThrow("DETERMINISM VIOLATION");
  }, 30_000);
});
