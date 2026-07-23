import seedrandom from "seedrandom";
import { seedWorld } from "../engine/seed-world";
import { siteRepo, guardRepo, robotRepo, decisionRepo, incidentRepo, outcomeRepo, eventRepo } from "../db/repository";
import { generateEventStream, type SimEvent } from "../engine/scenarios";
import { IngestionPipeline } from "../engine/ingestion";
import { correlateEvents } from "../engine/correlator";
import { scoreAndDecide, scoreIncident, setEventCache, setSiteCache, clearCaches } from "../engine/baseline-scorer";
import { generateSimOutcomes } from "../engine/outcome-join";
import { computeAllMetrics, type AllMetrics } from "./metrics";
import { LoopEngine } from "../loop/loop-engine";
import type { Incident } from "../db/schema";

export type ArmFn = (seed: number) => Promise<AllMetrics>;

// --- Arm registry ---
const arms = new Map<string, ArmFn>();

function registerArm(name: string, fn: ArmFn) {
  arms.set(name, fn);
}

export function getArm(name: string): ArmFn | undefined {
  return arms.get(name);
}

export function listArms(): string[] {
  return Array.from(arms.keys());
}

// --- Shared setup: seed → events → incidents (no scoring) ---
async function setupWorld(seed: number): Promise<{ events: SimEvent[]; incidents: Incident[] }> {
  await seedWorld({ seed });
  const sites = await siteRepo.getAll();
  const guards = await guardRepo.getAll();
  const robots = await robotRepo.getAll();
  const events = generateEventStream({ seed, sites, guards, robots });
  const pipeline = new IngestionPipeline(events);
  await pipeline.ingestAll();
  // Pre-populate caches to avoid per-row DB queries in scorer
  const dbEvents = await eventRepo.getAll();
  setEventCache(dbEvents);
  setSiteCache(sites);
  const incidents = await correlateEvents(events);
  return { events, incidents };
}

async function collectMetrics(events: SimEvent[], incidents: Incident[], startWall: number): Promise<AllMetrics> {
  const nightEndMs = 10 * 3600 * 1000;
  await generateSimOutcomes(incidents, events, nightEndMs);
  return computeAllMetrics({
    decisions: await decisionRepo.getAll(),
    outcomes: await outcomeRepo.getAll(),
    incidents: await incidentRepo.getAll(),
    totalEvents: events.length,
    wallTimeMs: Date.now() - startWall,
  });
}

// --- Constant-tier arm factory ---
function constantTierArm(tier: number): ArmFn {
  return async (seed: number) => {
    const startWall = Date.now();
    const { events, incidents } = await setupWorld(seed);
    for (const incident of incidents) {
      // Insert decision with fixed tier, confidence from priors
      const result = await scoreIncident(incident);
      await decisionRepo.insert({
        id: `dec-${incident.id}`,
        incidentId: incident.id,
        inputsJson: JSON.stringify({ siteId: incident.siteId }),
        factorsJson: JSON.stringify([{ name: "constant", value: tier, weight: 1 }]),
        chosenTier: tier,
        confidence: result.confidence,
        autonomyGate: tier <= 2 ? "auto" : "propose",
        policyVersionHash: `always-${tier}`,
        rationaleJson: JSON.stringify({ method: `always-${tier}` }),
        timestamp: incident.createdAt,
        createdAt: incident.createdAt,
      });
      await incidentRepo.update(incident.id, { priority: result.priority, tier, confidence: result.confidence });
    }
    return await collectMetrics(events, incidents, startWall);
  };
}

// --- Random-uniform arm ---
async function randomUniformArm(seed: number): Promise<AllMetrics> {
  const startWall = Date.now();
  const { events, incidents } = await setupWorld(seed);
  const rng = seedrandom(`random-arm-${seed}`);
  for (const incident of incidents) {
    const tier = Math.floor(rng() * 5); // 0-4
    const result = await scoreIncident(incident);
    await decisionRepo.insert({
      id: `dec-${incident.id}`,
      incidentId: incident.id,
      inputsJson: JSON.stringify({ siteId: incident.siteId }),
      factorsJson: JSON.stringify([{ name: "random", value: tier, weight: 1 }]),
      chosenTier: tier,
      confidence: result.confidence,
      autonomyGate: "propose",
      policyVersionHash: "random-uniform",
      rationaleJson: JSON.stringify({ method: "random-uniform" }),
      timestamp: incident.createdAt,
      createdAt: incident.createdAt,
    });
    await incidentRepo.update(incident.id, { priority: result.priority, tier, confidence: result.confidence });
  }
  return await collectMetrics(events, incidents, startWall);
}

// --- Rules-only arm ---
async function rulesOnlyArm(seed: number): Promise<AllMetrics> {
  const startWall = Date.now();
  const { events, incidents } = await setupWorld(seed);
  for (const incident of incidents) {
    await scoreAndDecide(incident);
  }
  return await collectMetrics(events, incidents, startWall);
}

// --- Scripted-interrogation arm (F0.8 evidence-state loop, zero model calls) ---
// Named honestly: asks all five system questions in fixed order, then human
// questions by cost priority. This is precisely the ProQA fixed-script baseline
// that emergency dispatch has run on for fifty years. F1's agent replaces the
// fixed script with chosen questioning — same machinery, different decider.
async function scriptedInterrogationArm(seed: number): Promise<AllMetrics> {
  const startWall = Date.now();
  const { events, incidents } = await setupWorld(seed);
  const guards = await guardRepo.getAll();

  // Run the loop engine
  const engine = new LoopEngine({ seed, events, incidents, guards });
  const result = await engine.run();

  // Convert loop decisions to DB decisions for metric computation
  // Each incident's final committed level becomes the decision
  for (const incident of incidents) {
    const state = result.finalStates.get(incident.id);
    const committedLevel = state?.committedLevel ?? 0;

    // Get confidence from baseline scorer (P(real) from priors)
    const scoring = await scoreIncident(incident);

    await decisionRepo.insert({
      id: `dec-${incident.id}`,
      incidentId: incident.id,
      inputsJson: JSON.stringify({
        siteId: incident.siteId,
        loopMoves: state?.transitions.length ?? 0,
        evidenceGathered: state?.evidenceGathered.length ?? 0,
      }),
      factorsJson: JSON.stringify(
        state?.transitions.map((t) => ({
          name: t.move.type,
          value: t.evidenceLevelAfter,
          weight: 1,
        })) ?? []
      ),
      chosenTier: committedLevel,
      confidence: scoring.confidence,
      autonomyGate: committedLevel <= 2 ? "auto" : "propose",
      policyVersionHash: "scripted-interrogation-v1",
      rationaleJson: JSON.stringify({
        method: "scripted-interrogation",
        totalMoves: state?.transitions.length ?? 0,
        evidenceLevel: state?.evidenceLevel ?? 0,
        hypothesis: state?.hypothesis ?? "unknown",
      }),
      timestamp: incident.createdAt,
      createdAt: incident.createdAt,
    });

    await incidentRepo.update(incident.id, {
      priority: scoring.priority,
      tier: committedLevel,
      confidence: scoring.confidence,
    });
  }

  return await collectMetrics(events, incidents, startWall);
}

// --- Register all arms ---
registerArm("rules-only", rulesOnlyArm);
registerArm("scripted-interrogation", scriptedInterrogationArm);
registerArm("always-0", constantTierArm(0));
registerArm("always-2", constantTierArm(2));
registerArm("always-3", constantTierArm(3));
registerArm("always-4", constantTierArm(4));
registerArm("random-uniform", randomUniformArm);

// --- Agent-fixed-policy arm (F1: LLM agent through LoopEngine, no memory) ---
// F1.5.1: Routes through LoopEngine via the deciderFn seam so the agent
// experiences real boardLoad, question timeouts, deadlines, and flood penalty.
async function agentFixedPolicyArm(seed: number): Promise<AllMetrics> {
  const { createProvider, getRoutingConfig, resetRunCost } = await import("../llm/index");

  let provider: import("../llm/provider").LLMProvider;
  try {
    provider = createProvider();
  } catch {
    throw new Error("agent-fixed-policy requires an LLM API key. Set DEEPSEEK_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.");
  }

  const routing = getRoutingConfig();
  resetRunCost(routing.maxUsdPerRun);
  const startWall = Date.now();
  const { events, incidents } = await setupWorld(seed);
  const guards = await guardRepo.getAll();

  const { agentChooseNextMove } = await import("../loop/agent-decider");
  const rng = seedrandom(`agent-audit-${seed}`);

  const agentConfig: import("../loop/agent-decider").AgentConfig = {
    provider,
    fastModel: routing.fastModel,
    strongModel: routing.strongModel,
    escalateBandLow: routing.escalateBandLow,
    escalateBandHigh: routing.escalateBandHigh,
    auditFraction: 0.05,
    policyVersion: "agent-fixed-policy-v2",
    rng: () => rng(),
  };

  // Build event map for tool context
  const eventById = new Map(events.map((e) => [e.id, e]));
  const eventsByIncident = new Map<string, import("../engine/scenarios").SimEvent[]>();
  for (const incident of incidents) {
    const eventIds: string[] = JSON.parse(incident.eventIds);
    eventsByIncident.set(
      incident.id,
      eventIds.map((id) => eventById.get(id)).filter((e): e is import("../engine/scenarios").SimEvent => !!e)
    );
  }

  let totalLlmCalls = 0;
  let totalLlmCostUsd = 0;

  // The agent decider — called by LoopEngine on each tick for each incident
  const agentDecider = async (state: import("../loop/types").WorkingState, boardLoad: number) => {
    const incEvents = eventsByIncident.get(state.incidentId) ?? [];
    const toolCtx: import("../loop/agent-tools").ToolContext = {
      events: incEvents,
      siteId: incEvents[0]?.siteId ?? "",
      zoneId: incEvents[0]?.zoneId ?? null,
      boardLoad,  // REAL board load from LoopEngine, not hardcoded 0
      guards,
      simTime: 0,
    };
    const decision = await agentChooseNextMove(state, toolCtx, agentConfig);
    totalLlmCalls += decision.llmCalls;
    totalLlmCostUsd += decision.llmCostUsd;
    return decision.move;
  };

  // Route through LoopEngine — agent experiences real boardLoad, timeouts, flood
  const engine = new LoopEngine({ seed, events, incidents, guards, deciderFn: agentDecider });
  const result = await engine.run();

  // Convert loop decisions to DB decisions for metric computation
  for (const incident of incidents) {
    const state = result.finalStates.get(incident.id);
    const committedLevel = state?.committedLevel ?? 0;
    const scoring = await scoreIncident(incident);

    await decisionRepo.insert({
      id: `dec-${incident.id}`,
      incidentId: incident.id,
      inputsJson: JSON.stringify({
        siteId: incident.siteId,
        loopMoves: state?.transitions.length ?? 0,
        evidenceGathered: state?.evidenceGathered.length ?? 0,
      }),
      factorsJson: JSON.stringify(
        state?.transitions.map((t) => ({
          name: t.move.type,
          value: t.evidenceLevelAfter,
          weight: 1,
        })) ?? []
      ),
      chosenTier: committedLevel,
      confidence: scoring.confidence,
      autonomyGate: committedLevel <= 2 ? "auto" : "propose",
      policyVersionHash: "agent-fixed-policy-v2",
      rationaleJson: JSON.stringify({
        method: "agent-fixed-policy",
        totalMoves: state?.transitions.length ?? 0,
        evidenceLevel: state?.evidenceLevel ?? 0,
        llmCalls: totalLlmCalls,
        llmCostUsd: totalLlmCostUsd,
      }),
      timestamp: incident.createdAt,
      createdAt: incident.createdAt,
    });

    await incidentRepo.update(incident.id, {
      priority: scoring.priority,
      tier: committedLevel,
      confidence: scoring.confidence,
    });
  }

  const metrics = await collectMetrics(events, incidents, startWall);
  metrics.llmCalls = totalLlmCalls;
  metrics.llmCostUsd = totalLlmCostUsd;
  return metrics;
}

registerArm("agent-fixed-policy", agentFixedPolicyArm);

// --- Agent-with-memory arm (F2: scripted interrogation + learned priors + episodic memory) ---
// Uses the same LoopEngine as scripted-interrogation but with learned Beta priors
// feeding into the confidence computation. No LLM calls — tests whether learning helps.
async function agentWithMemoryArm(seed: number): Promise<AllMetrics> {
  const { getLearnedPriorStore } = await import("../loop/learned-priors");
  const { getEpisodicMemory } = await import("../loop/episodic-memory");
  const { getTrueEvidenceLevel } = await import("../engine/scenarios");

  const startWall = Date.now();
  const { events, incidents } = await setupWorld(seed);
  const guards = await guardRepo.getAll();

  // Run the loop engine with rules decider (same as scripted)
  const engine = new LoopEngine({ seed, events, incidents, guards });
  const result = await engine.run();

  const priorStore = getLearnedPriorStore();
  const memory = getEpisodicMemory();
  const eventById = new Map(events.map((e) => [e.id, e]));

  for (const incident of incidents) {
    const state = result.finalStates.get(incident.id);
    const committedLevel = state?.committedLevel ?? 0;

    // Use learned priors to adjust confidence
    const eventIds: string[] = JSON.parse(incident.eventIds);
    const incEvents = eventIds
      .map((id) => eventById.get(id))
      .filter((e): e is import("../engine/scenarios").SimEvent => !!e);
    const eventTypes = [...new Set(incEvents.map((e) => e.type))];

    // Compute confidence using learned priors
    let pAllFalse = 1.0;
    for (const et of eventTypes) {
      const priorResult = priorStore.getPrior({
        eventType: et,
        siteId: incident.siteId,
        zoneId: incident.zoneId ?? null,
        simTimeMs: incident.createdAt,
      });
      pAllFalse *= (1 - priorResult.pReal);
    }
    const learnedConfidence = Math.max(0.01, Math.min(0.99, 1 - pAllFalse));

    // Ground truth for outcome recording
    const trueLevel = getTrueEvidenceLevel(incEvents);
    const wasReal = trueLevel > 0;

    // Update learned priors with outcome
    for (const et of eventTypes) {
      priorStore.update({
        eventType: et,
        siteId: incident.siteId,
        zoneId: incident.zoneId ?? null,
        simTimeMs: incident.createdAt,
        wasReal,
      });
    }

    // Record in episodic memory
    memory.record({
      incidentId: incident.id,
      siteId: incident.siteId,
      zoneId: incident.zoneId ?? null,
      eventTypes,
      chosenTier: committedLevel,
      trueLevel,
      wasReal,
      nightIndex: seed,
      timestamp: incident.createdAt,
    });

    // Persist decision with learned confidence
    const scoring = await scoreIncident(incident);
    await decisionRepo.insert({
      id: `dec-${incident.id}`,
      incidentId: incident.id,
      inputsJson: JSON.stringify({
        siteId: incident.siteId,
        loopMoves: state?.transitions.length ?? 0,
      }),
      factorsJson: JSON.stringify(
        state?.transitions.map((t) => ({
          name: t.move.type,
          value: t.evidenceLevelAfter,
          weight: 1,
        })) ?? []
      ),
      chosenTier: committedLevel,
      confidence: learnedConfidence,
      autonomyGate: committedLevel <= 2 ? "auto" : "propose",
      policyVersionHash: "agent-with-memory-v1",
      rationaleJson: JSON.stringify({
        method: "agent-with-memory",
        totalMoves: state?.transitions.length ?? 0,
        evidenceLevel: state?.evidenceLevel ?? 0,
        learnedConfidence,
        baselineConfidence: scoring.confidence,
      }),
      timestamp: incident.createdAt,
      createdAt: incident.createdAt,
    });

    await incidentRepo.update(incident.id, {
      priority: scoring.priority,
      tier: committedLevel,
      confidence: learnedConfidence,
    });
  }

  return await collectMetrics(events, incidents, startWall);
}

registerArm("agent-with-memory", agentWithMemoryArm);

// --- Multi-run support ---
export interface RunResult {
  arm: string;
  seed: number;
  metrics: AllMetrics;
}

export interface MultiRunResult {
  arm: string;
  seeds: number[];
  runs: RunResult[];
  mean: AllMetrics;
  spread: Partial<AllMetrics>;
}

function meanMetrics(metricsList: AllMetrics[]): AllMetrics {
  const n = metricsList.length;
  if (n === 0) throw new Error("No runs to average");
  if (n === 1) return metricsList[0];

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    cost: {
      totalCostUsd: avg(metricsList.map((m) => m.cost.totalCostUsd)),
      responseCostUsd: avg(metricsList.map((m) => m.cost.responseCostUsd)),
      harmCostUsd: avg(metricsList.map((m) => m.cost.harmCostUsd)),
      floodPenaltyUsd: avg(metricsList.map((m) => m.cost.floodPenaltyUsd)),
      missCount: avg(metricsList.map((m) => m.cost.missCount)),
      overResponseCount: avg(metricsList.map((m) => m.cost.overResponseCount)),
      totalDecisions: avg(metricsList.map((m) => m.cost.totalDecisions)),
    },
    brierScore: avg(metricsList.map((m) => m.brierScore)),
    ackRate: avg(metricsList.map((m) => m.ackRate)),
    timeToAck: {
      median: avg(metricsList.map((m) => m.timeToAck.median)),
      mean: avg(metricsList.map((m) => m.timeToAck.mean)),
      count: avg(metricsList.map((m) => m.timeToAck.count)),
    },
    timeToResolution: {
      median: avg(metricsList.map((m) => m.timeToResolution.median)),
      mean: avg(metricsList.map((m) => m.timeToResolution.mean)),
      count: avg(metricsList.map((m) => m.timeToResolution.count)),
    },
    guardMinutes: avg(metricsList.map((m) => m.guardMinutes)),
    llmCalls: 0,
    llmCostUsd: 0,
    eventsPerSecond: avg(metricsList.map((m) => m.eventsPerSecond)),
  };
}

function spreadMetrics(metricsList: AllMetrics[]): Partial<AllMetrics> {
  const n = metricsList.length;
  if (n <= 1) return {};

  const std = (arr: number[]) => {
    const m = arr.reduce((s, v) => s + v, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  };

  return {
    cost: {
      totalCostUsd: std(metricsList.map((m) => m.cost.totalCostUsd)),
      responseCostUsd: std(metricsList.map((m) => m.cost.responseCostUsd)),
      harmCostUsd: std(metricsList.map((m) => m.cost.harmCostUsd)),
      floodPenaltyUsd: std(metricsList.map((m) => m.cost.floodPenaltyUsd)),
      missCount: std(metricsList.map((m) => m.cost.missCount)),
      overResponseCount: std(metricsList.map((m) => m.cost.overResponseCount)),
      totalDecisions: std(metricsList.map((m) => m.cost.totalDecisions)),
    },
    brierScore: std(metricsList.map((m) => m.brierScore)),
    guardMinutes: std(metricsList.map((m) => m.guardMinutes)),
  } as Partial<AllMetrics>;
}

export async function runArm(armName: string, seed: number): Promise<RunResult> {
  const fn = getArm(armName);
  if (!fn) throw new Error(`Unknown arm: ${armName}. Available: ${listArms().join(", ")}`);
  return { arm: armName, seed, metrics: await fn(seed) };
}

export async function runMultiple(armName: string, baseSeed: number, runs: number): Promise<MultiRunResult> {
  const seeds = Array.from({ length: runs }, (_, i) => baseSeed + i);
  const results: RunResult[] = [];

  for (const seed of seeds) {
    results.push(await runArm(armName, seed));
  }

  return {
    arm: armName,
    seeds,
    runs: results,
    mean: meanMetrics(results.map((r) => r.metrics)),
    spread: spreadMetrics(results.map((r) => r.metrics)),
  };
}

// --- Formatting ---
export function formatMetricsTable(result: MultiRunResult): string {
  const { mean, spread } = result;
  const s = spread as any;

  const fmt = (val: number, std?: number) => {
    const v = val.toFixed(2);
    return std !== undefined && std > 0 ? `${v} ± ${std.toFixed(2)}` : v;
  };

  const lines = [
    `Eval: ${result.arm} | ${result.runs.length} run(s) | seeds: [${result.seeds.join(", ")}]`,
    "─".repeat(65),
    `  Total Cost (USD)        $${fmt(mean.cost.totalCostUsd, s.cost?.totalCostUsd)}`,
    `    Response cost          $${fmt(mean.cost.responseCostUsd, s.cost?.responseCostUsd)}`,
    `    Harm cost              $${fmt(mean.cost.harmCostUsd, s.cost?.harmCostUsd)}`,
    `    Flood penalty          $${fmt(mean.cost.floodPenaltyUsd, s.cost?.floodPenaltyUsd)}`,
    `    Miss count             ${fmt(mean.cost.missCount, s.cost?.missCount)}`,
    `    Over-response count    ${fmt(mean.cost.overResponseCount, s.cost?.overResponseCount)}`,
    `  Brier Score              ${fmt(mean.brierScore, s.brierScore)}`,
    `  Ack Rate                 ${fmt(mean.ackRate)}`,
    `  Guard-Minutes            ${fmt(mean.guardMinutes, s.guardMinutes)}`,
    `  LLM Calls               ${mean.llmCalls}`,
    `  Events/sec               ${fmt(mean.eventsPerSecond)}`,
    `  Total Decisions          ${fmt(mean.cost.totalDecisions)}`,
    "─".repeat(65),
  ];

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════
// PAIRED COMPARISON with bootstrap CIs
// ═══════════════════════════════════════════════════════════════════════

export interface PairedResult {
  arm: string;
  meanCost: number;
  /** Per-seed delta: arm_cost - baseline_cost (positive = worse than baseline) */
  deltas: number[];
  meanDelta: number;
  /** Bootstrap 95% CI on the mean delta */
  ci95: [number, number];
  /** Does this arm beat the baseline? (meanDelta < 0 and CI excludes 0) */
  beatsBaseline: boolean;
}

function bootstrapCI(
  values: number[],
  nBoot: number = 10000,
  alpha: number = 0.05
): [number, number] {
  const rng = seedrandom("bootstrap");
  const n = values.length;
  const means: number[] = [];

  for (let b = 0; b < nBoot; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += values[Math.floor(rng() * n)];
    }
    means.push(sum / n);
  }

  means.sort((a, b) => a - b);
  const lo = means[Math.floor((alpha / 2) * nBoot)];
  const hi = means[Math.floor((1 - alpha / 2) * nBoot)];
  return [lo, hi];
}

export async function runAllArmsCompared(
  baseSeed: number,
  runs: number,
  baselineArm: string = "rules-only"
): Promise<{ baseline: MultiRunResult; comparisons: PairedResult[] }> {
  const seeds = Array.from({ length: runs }, (_, i) => baseSeed + i);

  // Run baseline first
  const baselineResults: RunResult[] = [];
  for (const seed of seeds) {
    baselineResults.push(await runArm(baselineArm, seed));
  }
  const baseline: MultiRunResult = {
    arm: baselineArm,
    seeds,
    runs: baselineResults,
    mean: meanMetrics(baselineResults.map((r) => r.metrics)),
    spread: spreadMetrics(baselineResults.map((r) => r.metrics)),
  };

  // Run all other arms on the same seeds
  // F1.5.6: include agent arms in paired comparison (was previously excluded)
  // agent-with-memory excluded from paired comparison: it requires persistent
  // learned state across runs, which runAllArmsCompared doesn't support (each
  // seed resets DB). Use scripts/learn.ts for the learning curve instead.
  const excludeFromPaired = new Set(["agent-with-memory"]);
  const otherArms = listArms().filter(
    (a) => a !== baselineArm && !excludeFromPaired.has(a)
  );
  const comparisons: PairedResult[] = [];

  for (const armName of otherArms) {
    const armResults: RunResult[] = [];
    for (const seed of seeds) {
      armResults.push(await runArm(armName, seed));
    }

    // Paired deltas per seed
    const deltas = armResults.map((r, i) =>
      r.metrics.cost.totalCostUsd - baselineResults[i].metrics.cost.totalCostUsd
    );
    const meanDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const ci95 = bootstrapCI(deltas);

    comparisons.push({
      arm: armName,
      meanCost: armResults.reduce((s, r) => s + r.metrics.cost.totalCostUsd, 0) / runs,
      deltas,
      meanDelta,
      ci95,
      beatsBaseline: ci95[1] < 0, // entire CI below 0 = significantly cheaper
    });
  }

  return { baseline, comparisons };
}

export function formatComparisonTable(
  baseline: MultiRunResult,
  comparisons: PairedResult[]
): string {
  const lines = [
    `Paired comparison vs ${baseline.arm} | ${baseline.runs.length} seeds`,
    "═".repeat(80),
    `${"Arm".padEnd(20)} ${"Mean $".padStart(10)} ${"Δ vs base".padStart(12)} ${"95% CI".padStart(22)} ${"Beats?".padStart(8)}`,
    "─".repeat(80),
    `${baseline.arm.padEnd(20)} ${("$" + baseline.mean.cost.totalCostUsd.toFixed(0)).padStart(10)} ${"(baseline)".padStart(12)} ${"—".padStart(22)} ${"—".padStart(8)}`,
  ];

  for (const c of comparisons) {
    const delta = (c.meanDelta >= 0 ? "+" : "") + "$" + c.meanDelta.toFixed(0);
    const ci = `[$${c.ci95[0].toFixed(0)}, $${c.ci95[1].toFixed(0)}]`;
    const beats = c.beatsBaseline ? "YES" : c.ci95[0] > 0 ? "NO" : "~";
    lines.push(
      `${c.arm.padEnd(20)} ${("$" + c.meanCost.toFixed(0)).padStart(10)} ${delta.padStart(12)} ${ci.padStart(22)} ${beats.padStart(8)}`
    );
  }

  lines.push("═".repeat(80));
  return lines.join("\n");
}
