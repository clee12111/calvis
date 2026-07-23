import { NextResponse } from "next/server";
import { seedWorld } from "@/lib/engine/seed-world";
import { initSchema } from "@/lib/db/connection";
import {
  siteRepo,
  guardRepo,
  robotRepo,
  decisionRepo,
  eventRepo,
} from "@/lib/db/repository";
import { generateEventStream } from "@/lib/engine/scenarios";
import { SimManager, setSimManager, getSimManager } from "@/lib/engine/sim-manager";
import { correlateEvents } from "@/lib/engine/correlator";
import { scoreAndDecide, scoreIncident, setEventCache, setSiteCache } from "@/lib/engine/baseline-scorer";
import {
  setIncidentCache,
  setArmCache,
  switchArm,
  setArmMetrics,
  type CachedIncident,
  type AgentTrace,
  type ArmMetrics,
} from "@/lib/engine/incident-cache";
import { LoopEngine, assessInitialEvidence } from "@/lib/loop/loop-engine";
import { chooseNextMove } from "@/lib/loop/rules-decider";
import { getTrueEvidenceLevel, type SimEvent } from "@/lib/engine/scenarios";
import { responseCostUsd, harmCostUsd, HARM_AT_LEVEL, FLOOD_THRESHOLD_PER_10MIN, FLOOD_COST_PER_UNIT_SQ } from "@/lib/eval/metrics";
import type { Incident } from "@/lib/db/schema";

/**
 * Compute eval-equivalent metrics for an arm using ground truth.
 * Same cost pipeline as eval/metrics.ts — response + harm + flood.
 */
function computeEvalMetrics(
  incidents: Incident[],
  events: SimEvent[],
  committedTiers: Map<string, number>,
  surfacedTimestamps: number[],
): { responseCost: number; harmCost: number; floodPenalty: number; misses: number; overResponses: number } {
  const eventById = new Map(events.map((e) => [e.id, e]));
  let responseCost = 0;
  let harmCost = 0;
  let misses = 0;
  let overResponses = 0;

  for (const incident of incidents) {
    const tier = committedTiers.get(incident.id) ?? 0;
    responseCost += responseCostUsd(tier);

    // Ground truth from scenario
    const ids: string[] = JSON.parse(incident.eventIds);
    const incEvents = ids.map((id) => eventById.get(id)).filter((e): e is SimEvent => !!e);
    const trueLevel = getTrueEvidenceLevel(incEvents);
    const wasReal = trueLevel > 0;

    const harm = harmCostUsd(trueLevel, tier, wasReal);
    harmCost += harm;

    if (wasReal && tier < trueLevel) misses++;
    if (!wasReal && tier > 0) overResponses++;
  }

  // Flood penalty from surfaced timestamps
  let floodPenalty = 0;
  if (surfacedTimestamps.length > 0) {
    const sorted = [...surfacedTimestamps].sort((a, b) => a - b);
    const WINDOW_MS = 10 * 60 * 1000;
    let totalPen = 0;
    for (let ws = sorted[0]; ws <= sorted[sorted.length - 1]; ws += 60_000) {
      const count = sorted.filter((t) => t >= ws && t < ws + WINDOW_MS).length;
      if (count > FLOOD_THRESHOLD_PER_10MIN) {
        const excess = count - FLOOD_THRESHOLD_PER_10MIN;
        totalPen += excess * excess * FLOOD_COST_PER_UNIT_SQ;
      }
    }
    const numWindows = Math.max(1, Math.ceil((sorted[sorted.length - 1] - sorted[0]) / 60_000));
    floodPenalty = totalPen / numWindows;
  }

  return { responseCost, harmCost, floodPenalty, misses, overResponses };
}

/**
 * Build enriched incident cache from LoopEngine results.
 * Extracts full agent trace data including tool calls, model tier, tokens, cost.
 */
function buildAgentCache(
  arm: string,
  incidents: Incident[],
  events: SimEvent[],
  sites: any[],
  loopResult: import("@/lib/loop/loop-engine").LoopResult,
  agentDecisions: Map<string, import("@/lib/loop/agent-decider").AgentDecision[]>,
): { cache: CachedIncident[]; metrics: ArmMetrics } {
  const siteMap = new Map(sites.map((s) => [s.id, s]));
  const eventMap = new Map(events.map((e) => [e.id, e]));

  let totalLlmCost = 0;
  let totalLlmCalls = 0;
  let surfacedCount = 0;
  let totalMoveCost = 0;
  const committedTiers = new Map<string, number>();
  const surfacedTimestamps: number[] = [];

  const enriched: CachedIncident[] = incidents.map((incident) => {
    const eventIds: string[] = JSON.parse(incident.eventIds);
    const incEvents = eventIds.map((eid) => eventMap.get(eid)).filter(Boolean);
    const site = siteMap.get(incident.siteId) ?? null;
    const state = loopResult.finalStates.get(incident.id);
    const decisions = agentDecisions.get(incident.id) ?? [];

    // Find the decision where the LLM actually ran (has real reasoning)
    // Fall back to the last decision if no LLM decision exists
    const llmDecision = decisions.find((d) => d.llmCalls > 0 && d.adjustmentReasons.length > 0 && !d.adjustmentReasons[0]?.startsWith("system-question") && !d.adjustmentReasons[0]?.startsWith("waiting"));
    const terminalDecision = llmDecision ?? (decisions.length > 0 ? decisions[decisions.length - 1] : null);
    const committedLevel = state?.committedLevel ?? 0;

    committedTiers.set(incident.id, committedLevel);
    if (committedLevel >= 1) {
      surfacedCount++;
      const commitT = state?.transitions.find((t) => t.move.type === "commit");
      if (commitT) surfacedTimestamps.push(commitT.timestamp);
    }
    totalMoveCost += loopResult.decisionLog
      .filter((e) => e.incidentId === incident.id)
      .reduce((s, e) => s + e.costUsd, 0);

    let trace: AgentTrace | null = null;
    if (terminalDecision) {
      totalLlmCost += terminalDecision.llmCostUsd;
      totalLlmCalls += terminalDecision.llmCalls;

      // Build tool call trace from real tool call results
      const toolCalls = terminalDecision.toolCallResults.length > 0
        ? terminalDecision.toolCallResults.map((tc) => ({
            name: tc.name,
            arguments: tc.arguments,
            result: tc.result,
            n: tc.name === "get_site_prior" ? 0 : undefined, // F1: all priors are n=0
          }))
        : terminalDecision.toolCallsUsed.map((name) => ({
            name,
            arguments: {},
            result: "",
          }));

      trace = {
        arm,
        toolCalls,
        pReal: terminalDecision.pReal,
        basePrior: terminalDecision.basePrior,
        adjustment: terminalDecision.priorAdjustmentLogOdds,
        adjustmentReasons: terminalDecision.adjustmentReasons,
        noveltyFlag: terminalDecision.noveltyFlag,
        whatWouldChange: terminalDecision.whatWouldChangeMyMind,
        move: terminalDecision.move.type === "commit"
          ? terminalDecision.move.action.id
          : terminalDecision.move.type === "investigate"
            ? terminalDecision.move.action.id
            : "defer",
        evidenceLevel: committedLevel,
        costUsd: terminalDecision.llmCostUsd,
        latencyMs: terminalDecision.llmLatencyMs,
        inputTokens: terminalDecision.inputTokens,
        outputTokens: terminalDecision.outputTokens,
        modelTier: terminalDecision.modelTier === "none" ? undefined : terminalDecision.modelTier,
        modelTierReason: terminalDecision.modelTierReason,
        modelId: terminalDecision.modelId || undefined,
        policyVersion: "agent-fixed-policy-v2",
        cacheHit: terminalDecision.cacheHit,
        promptMessages: terminalDecision.promptMessages,
        rawResponse: terminalDecision.rawResponseText !== undefined ? {
          text: terminalDecision.rawResponseText ?? null,
          toolCalls: terminalDecision.rawToolCalls ?? [],
        } : undefined,
        steps: state?.transitions.map((t) => ({
          timestamp: t.timestamp,
          moveType: t.move.type,
          actionName: t.move.type === "investigate" ? t.move.action.name
            : t.move.type === "commit" ? t.move.action.name
            : "defer",
          evidenceBefore: t.evidenceLevelBefore,
          evidenceAfter: t.evidenceLevelAfter,
          reason: t.reason,
        })) ?? [],
      };
    } else if (state) {
      // Non-agent arm — build trace from transitions
      trace = {
        arm,
        toolCalls: [],
        pReal: 0,
        basePrior: 0,
        adjustment: 0,
        adjustmentReasons: [],
        noveltyFlag: false,
        whatWouldChange: "",
        move: state.committedLevel !== null
          ? (state.transitions.find((t) => t.move.type === "commit")?.move as any)?.action?.id ?? "unknown"
          : "unknown",
        evidenceLevel: committedLevel,
        steps: state.transitions.map((t) => ({
          timestamp: t.timestamp,
          moveType: t.move.type,
          actionName: t.move.type === "investigate" ? t.move.action.name
            : t.move.type === "commit" ? t.move.action.name
            : "defer",
          evidenceBefore: t.evidenceLevelBefore,
          evidenceAfter: t.evidenceLevelAfter,
          reason: t.reason,
        })),
      };
    }

    return {
      id: incident.id,
      siteId: incident.siteId,
      zoneId: incident.zoneId ?? null,
      status: state?.finalized ? "resolved" : "open",
      eventIds: incident.eventIds,
      priority: incident.priority,
      tier: committedLevel,
      confidence: terminalDecision?.pReal ?? incident.confidence,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt ?? incident.createdAt,
      resolvedAt: state?.finalized ? (state.transitions[state.transitions.length - 1]?.timestamp ?? incident.createdAt) : null,
      decisions: [],
      events: incEvents,
      site,
      trace,
    } as CachedIncident;
  });

  enriched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // Compute eval-equivalent cost using ground truth
  const evalCost = computeEvalMetrics(incidents, events, committedTiers, surfacedTimestamps);
  const peakLoad = computeBoardLoadPeak(surfacedTimestamps);

  return {
    cache: enriched,
    metrics: {
      totalCostUsd: evalCost.responseCost + evalCost.harmCost + evalCost.floodPenalty,
      responseCostUsd: evalCost.responseCost,
      harmCostUsd: evalCost.harmCost,
      floodPenaltyUsd: evalCost.floodPenalty,
      moveCostUsd: totalMoveCost,
      incidentsSurfaced: surfacedCount,
      missCount: evalCost.misses,
      overResponseCount: evalCost.overResponses,
      llmCostUsd: totalLlmCost,
      llmCalls: totalLlmCalls,
      totalMoves: loopResult.totalMoves,
      boardLoadPeak: peakLoad,
    },
  };
}

/** Compute peak board load from surfaced timestamps */
function computeBoardLoadPeak(surfacedTimestamps: number[]): number {
  if (surfacedTimestamps.length === 0) return 0;
  const sorted = [...surfacedTimestamps].sort((a, b) => a - b);
  const WINDOW_MS = 10 * 60 * 1000;
  let peak = 0;
  for (let ws = sorted[0]; ws <= sorted[sorted.length - 1]; ws += 60_000) {
    const count = sorted.filter((t) => t >= ws && t < ws + WINDOW_MS).length;
    peak = Math.max(peak, count);
  }
  return peak;
}

/**
 * Build enriched cache from baseline scorer (rules-only arm).
 */
function buildBaselineCache(
  arm: string,
  incidents: Incident[],
  events: SimEvent[],
  sites: any[],
  decisions: any[],
): { cache: CachedIncident[]; metrics: ArmMetrics } {
  const siteMap = new Map(sites.map((s) => [s.id, s]));
  const eventMap = new Map(events.map((e) => [e.id, e]));
  const decisionsByIncident = new Map<string, any[]>();
  for (const d of decisions) {
    const list = decisionsByIncident.get(d.incidentId) ?? [];
    list.push(d);
    decisionsByIncident.set(d.incidentId, list);
  }

  let surfacedCount = 0;
  const committedTiers = new Map<string, number>();
  const surfacedTimestamps: number[] = [];

  const enriched: CachedIncident[] = incidents.map((incident) => {
    const eventIds: string[] = JSON.parse(incident.eventIds);
    const incEvents = eventIds.map((eid) => eventMap.get(eid)).filter(Boolean);
    const site = siteMap.get(incident.siteId) ?? null;
    const incDecisions = decisionsByIncident.get(incident.id) ?? [];
    const latest = incDecisions.length > 0 ? incDecisions[incDecisions.length - 1] : null;

    // Use decision's tier/confidence since incident obj may not be updated
    const tier = latest?.chosenTier ?? incident.tier ?? 0;
    const confidence = latest?.confidence ?? incident.confidence;
    committedTiers.set(incident.id, tier);
    if (tier >= 1) {
      surfacedCount++;
      surfacedTimestamps.push(incident.createdAt);
    }

    let trace: AgentTrace | null = null;
    if (latest) {
      const rationale = JSON.parse(latest.rationaleJson ?? "{}");
      const factors = JSON.parse(latest.factorsJson ?? "[]");
      trace = {
        arm,
        toolCalls: factors.map((f: any) => ({
          name: f.name,
          arguments: {},
          result: typeof f.value === "number" ? f.value.toFixed(3) : String(f.value),
        })),
        pReal: latest.confidence,
        basePrior: latest.confidence,
        adjustment: 0,
        adjustmentReasons: factors.map((f: any) =>
          `${f.name}: ${typeof f.value === "number" ? f.value.toFixed(2) : f.value}`
        ).filter(Boolean),
        noveltyFlag: false,
        whatWouldChange: arm === "rules-only"
          ? "Rules-only baseline has no reasoning — see agent arm"
          : "Scripted interrogation follows fixed protocol",
        move: rationale.method ?? arm,
        evidenceLevel: tier,
      };
    }

    // Priority from rationale (rules-only) or incident
    const rationale2 = latest ? JSON.parse(latest.rationaleJson ?? "{}") : {};
    const priority = rationale2.priority ?? incident.priority;

    return {
      ...incident,
      priority,
      tier,
      confidence,
      decisions: incDecisions,
      events: incEvents,
      site,
      trace,
    } as CachedIncident;
  });

  enriched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const evalCost = computeEvalMetrics(incidents, events, committedTiers, surfacedTimestamps);
  const peakLoad = computeBoardLoadPeak(surfacedTimestamps);

  return {
    cache: enriched,
    metrics: {
      totalCostUsd: evalCost.responseCost + evalCost.harmCost + evalCost.floodPenalty,
      responseCostUsd: evalCost.responseCost,
      harmCostUsd: evalCost.harmCost,
      floodPenaltyUsd: evalCost.floodPenalty,
      moveCostUsd: 0,
      incidentsSurfaced: surfacedCount,
      missCount: evalCost.misses,
      overResponseCount: evalCost.overResponses,
      llmCostUsd: 0,
      llmCalls: 0,
      totalMoves: 0,
      boardLoadPeak: peakLoad,
    },
  };
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action, seed = 42, speed = 10 } = body;

  if (action === "start") {
    const t0 = Date.now();

    // Initialize DB schema and seed world
    await initSchema();
    await seedWorld({ seed });

    const sites = await siteRepo.getAll();
    const guards = await guardRepo.getAll();
    const robots = await robotRepo.getAll();
    const events = generateEventStream({ seed, sites, guards, robots });

    // Pre-populate caches for scorer
    const { IngestionPipeline } = await import("@/lib/engine/ingestion");
    const pipeline = new IngestionPipeline(events);
    await pipeline.ingestAll();
    const dbEvents = await eventRepo.getAll();
    setEventCache(dbEvents);
    setSiteCache(sites);

    const allIncidents = await correlateEvents(events);

    // ═══════════════════════════════════════════════════════════════
    // ARM 1: rules-only baseline (score each incident)
    // ═══════════════════════════════════════════════════════════════
    for (const inc of allIncidents) {
      await scoreAndDecide(inc);
    }
    const allDecisions = await decisionRepo.getAll();
    const rulesResult = buildBaselineCache("rules-only", allIncidents, events, sites, allDecisions);
    setArmCache("rules-only", rulesResult.cache);
    setArmMetrics("rules-only", rulesResult.metrics);

    // ═══════════════════════════════════════════════════════════════
    // ARM 2: scripted-interrogation (LoopEngine with rules decider)
    // ═══════════════════════════════════════════════════════════════
    const scriptedEngine = new LoopEngine({ seed, events, incidents: allIncidents, guards });
    const scriptedResult = await scriptedEngine.run();
    const scriptedCache = buildScriptedCache("scripted-interrogation", allIncidents, events, sites, scriptedResult);
    setArmCache("scripted-interrogation", scriptedCache.cache);
    setArmMetrics("scripted-interrogation", scriptedCache.metrics);

    // ═══════════════════════════════════════════════════════════════
    // ARM 3: agent (LoopEngine with agent decider, DEMO=1 from cache)
    // ═══════════════════════════════════════════════════════════════
    let agentError: string | null = null;
    try {
      const { agentChooseNextMove } = await import("@/lib/loop/agent-decider");
      const { createProvider, getRoutingConfig } = await import("@/lib/llm/index");
      const seedrandom = (await import("seedrandom")).default;

      const routing = getRoutingConfig();
      let provider: import("@/lib/llm/provider").LLMProvider;
      try {
        provider = createProvider();
      } catch {
        // No API key — that's OK in DEMO=1, trace cache handles it
        provider = {
          name: "demo-stub",
          async chat() {
            throw new Error("No LLM provider — DEMO mode requires trace cache hits");
          },
        };
      }

      const rng = seedrandom(`agent-audit-${seed}`);
      const agentConfig: import("@/lib/loop/agent-decider").AgentConfig = {
        provider,
        fastModel: routing.fastModel,
        strongModel: routing.strongModel,
        escalateBandLow: routing.escalateBandLow,
        escalateBandHigh: routing.escalateBandHigh,
        auditFraction: 0.05,
        policyVersion: "agent-fixed-policy-v2",
        rng: () => rng(),
      };

      // Collect per-incident agent decisions for trace extraction
      const agentDecisionMap = new Map<string, import("@/lib/loop/agent-decider").AgentDecision[]>();
      const eventById = new Map(events.map((e) => [e.id, e]));
      const eventsByIncident = new Map<string, SimEvent[]>();
      for (const incident of allIncidents) {
        const ids: string[] = JSON.parse(incident.eventIds);
        eventsByIncident.set(
          incident.id,
          ids.map((id) => eventById.get(id)).filter((e): e is SimEvent => !!e)
        );
      }

      const agentDecider = async (state: import("@/lib/loop/types").WorkingState, boardLoad: number) => {
        const incEvents = eventsByIncident.get(state.incidentId) ?? [];
        const toolCtx: import("@/lib/loop/agent-tools").ToolContext = {
          events: incEvents,
          siteId: incEvents[0]?.siteId ?? "",
          zoneId: incEvents[0]?.zoneId ?? null,
          boardLoad,
          guards,
          simTime: 0,
        };
        const decision = await agentChooseNextMove(state, toolCtx, agentConfig);

        // Collect decisions per incident
        const list = agentDecisionMap.get(state.incidentId) ?? [];
        list.push(decision);
        agentDecisionMap.set(state.incidentId, list);

        return decision.move;
      };

      const agentEngine = new LoopEngine({ seed, events, incidents: allIncidents, guards, deciderFn: agentDecider });
      const agentResult = await agentEngine.run();

      const { cache: agentCache, metrics: agentMetrics } = buildAgentCache(
        "agent",
        allIncidents,
        events,
        sites,
        agentResult,
        agentDecisionMap,
      );
      setArmCache("agent", agentCache);
      setArmMetrics("agent", agentMetrics);
    } catch (err: any) {
      agentError = err.message;
      console.error("Agent arm failed:", agentError);
    }

    // Set active arm — prefer agent, fall back to scripted
    if (!agentError) {
      switchArm("agent");
    } else {
      switchArm("scripted-interrogation");
    }

    // Create sim manager for clock/replay
    const manager = new SimManager(events);
    setSimManager(manager);
    manager.clock.start(speed);

    const elapsed = Date.now() - t0;
    return NextResponse.json({
      ok: true,
      totalEvents: events.length,
      totalIncidents: allIncidents.length,
      speed,
      setupMs: elapsed,
      activeArm: agentError ? "scripted-interrogation" : "agent",
      agentError,
      availableArms: ["agent", "scripted-interrogation", "rules-only"],
    });
  }

  if (action === "switch-arm") {
    const { arm } = body;
    const ok = switchArm(arm);
    if (!ok) {
      return NextResponse.json({ error: `Arm "${arm}" not available` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, arm });
  }

  if (action === "pause") {
    const manager = getSimManager();
    if (manager) manager.clock.pause();
    return NextResponse.json({ ok: true });
  }

  if (action === "resume") {
    const manager = getSimManager();
    if (manager) manager.startRealtime(speed);
    return NextResponse.json({ ok: true });
  }

  if (action === "speed") {
    const manager = getSimManager();
    if (manager) manager.clock.setSpeed(speed);
    return NextResponse.json({ ok: true, speed });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function GET() {
  const manager = getSimManager();
  if (!manager) {
    return NextResponse.json({ running: false });
  }

  return NextResponse.json({
    running: manager.clock.running,
    time: manager.clock.now,
    speed: manager.clock.speed,
    eventsIngested: manager.pipeline.ingestedCount,
    totalEvents: manager.pipeline.totalEvents,
    done: manager.pipeline.done,
  });
}

/**
 * Build cache from scripted-interrogation LoopEngine results.
 */
function buildScriptedCache(
  arm: string,
  incidents: Incident[],
  events: SimEvent[],
  sites: any[],
  loopResult: import("@/lib/loop/loop-engine").LoopResult,
): { cache: CachedIncident[]; metrics: ArmMetrics } {
  const siteMap = new Map(sites.map((s) => [s.id, s]));
  const eventMap = new Map(events.map((e) => [e.id, e]));

  let surfacedCount = 0;
  let totalMoveCostScripted = 0;
  const committedTiersScripted = new Map<string, number>();
  const surfacedTimestampsScripted: number[] = [];

  const enriched: CachedIncident[] = incidents.map((incident) => {
    const eventIds: string[] = JSON.parse(incident.eventIds);
    const incEvents = eventIds.map((eid) => eventMap.get(eid)).filter(Boolean);
    const site = siteMap.get(incident.siteId) ?? null;
    const state = loopResult.finalStates.get(incident.id);
    const committedLevel = state?.committedLevel ?? 0;

    committedTiersScripted.set(incident.id, committedLevel);
    if (committedLevel >= 1) {
      surfacedCount++;
      const commitT = state?.transitions.find((t) => t.move.type === "commit");
      if (commitT) surfacedTimestampsScripted.push(commitT.timestamp);
    }
    totalMoveCostScripted += loopResult.decisionLog
      .filter((e) => e.incidentId === incident.id)
      .reduce((s, e) => s + e.costUsd, 0);

    const trace: AgentTrace = {
      arm,
      toolCalls: [],
      pReal: 0,
      basePrior: 0,
      adjustment: 0,
      adjustmentReasons: [],
      noveltyFlag: false,
      whatWouldChange: "Scripted interrogation follows fixed protocol — no model reasoning",
      move: state?.transitions.find((t) => t.move.type === "commit")
        ? (state.transitions.find((t) => t.move.type === "commit")!.move as any).action?.id ?? "unknown"
        : "unknown",
      evidenceLevel: committedLevel,
      steps: state?.transitions.map((t) => ({
        timestamp: t.timestamp,
        moveType: t.move.type,
        actionName: t.move.type === "investigate" ? t.move.action.name
          : t.move.type === "commit" ? t.move.action.name
          : "defer",
        evidenceBefore: t.evidenceLevelBefore,
        evidenceAfter: t.evidenceLevelAfter,
        reason: t.reason,
      })) ?? [],
    };

    return {
      id: incident.id,
      siteId: incident.siteId,
      zoneId: incident.zoneId ?? null,
      status: state?.finalized ? "resolved" : "open",
      eventIds: incident.eventIds,
      priority: incident.priority,
      tier: committedLevel,
      confidence: incident.confidence,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt ?? incident.createdAt,
      resolvedAt: null,
      decisions: [],
      events: incEvents,
      site,
      trace,
    } as CachedIncident;
  });

  enriched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const evalCostScripted = computeEvalMetrics(incidents, events, committedTiersScripted, surfacedTimestampsScripted);
  const peakLoadScripted = computeBoardLoadPeak(surfacedTimestampsScripted);

  return {
    cache: enriched,
    metrics: {
      totalCostUsd: evalCostScripted.responseCost + evalCostScripted.harmCost + evalCostScripted.floodPenalty,
      responseCostUsd: evalCostScripted.responseCost,
      harmCostUsd: evalCostScripted.harmCost,
      floodPenaltyUsd: evalCostScripted.floodPenalty,
      moveCostUsd: totalMoveCostScripted,
      incidentsSurfaced: surfacedCount,
      missCount: evalCostScripted.misses,
      overResponseCount: evalCostScripted.overResponses,
      llmCostUsd: 0,
      llmCalls: 0,
      totalMoves: loopResult.totalMoves,
      boardLoadPeak: peakLoadScripted,
    },
  };
}
