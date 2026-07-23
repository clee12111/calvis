/**
 * F1.1 + F2.2 — Retrieval as explicit tool calls.
 * The model calls these to gather context before deciding.
 * Tool calls make reasoning watchable — pre-stuffing hides it.
 *
 * F2 additions: get_site_prior uses learned Beta priors when available.
 * find_precedent reinstated with real episodic memory.
 */
import type { ToolSchema } from "../llm/provider";
import type { SimEvent, EventType } from "../engine/scenarios";
import { EVENT_TYPE_PRIOR } from "../engine/baseline-scorer";
import type { Guard } from "../db/schema";
import { getLearnedPriorStore } from "./learned-priors";
import { getEpisodicMemory } from "./episodic-memory";

// ═══════════════════════════════════════════════════════════════════════════
// Tool schemas — passed to the LLM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * F1 tool set — matches the cached traces (no find_precedent).
 * Used in DEMO=1 so cache keys match.
 */
export const AGENT_TOOLS_F1: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_incident_context",
      description: "Get the full context for this incident: event types, severity, zone, timestamps, raw data. Always call first.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_site_prior",
      description: "Get P(real) prior for a specific event type at this site/zone/hour. Returns the prior probability and the observation count n — a prior from 3 observations and one from 300 are different objects.",
      parameters: {
        type: "object",
        properties: {
          event_type: { type: "string", description: "One of the 12 event types" },
        },
        required: ["event_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_rules",
      description: "Get the active policy rules for this site, including any operator-promoted rules from overrides.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_available_guards",
      description: "Get guards currently on shift at this site, with their reliability stats (ack rate, avg response time).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_board_load",
      description: "Get the current operator board load: items surfaced in the last 10-minute window, and the EEMUA threshold.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

/** F2 tool set — includes find_precedent for episodic memory */
export const AGENT_TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_incident_context",
      description: "Get the full context for this incident: event types, severity, zone, timestamps, raw data. Always call first.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_site_prior",
      description: "Get P(real) prior for a specific event type at this site/zone/hour. Returns the prior probability and the observation count n — a prior from 3 observations and one from 300 are different objects.",
      parameters: {
        type: "object",
        properties: {
          event_type: { type: "string", description: "One of the 12 event types" },
        },
        required: ["event_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_precedent",
      description: "Find similar past incidents at this site/zone. Returns the k nearest precedents with the tier chosen, the outcome (was it real?), and the true evidence level. Useful for 'last N times this fired here, it was X.'",
      parameters: {
        type: "object",
        properties: {
          k: { type: "number", description: "Number of precedents to return (default 5)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_rules",
      description: "Get the active policy rules for this site, including any operator-promoted rules from overrides.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_available_guards",
      description: "Get guards currently on shift at this site, with their reliability stats (ack rate, avg response time).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_board_load",
      description: "Get the current operator board load: items surfaced in the last 10-minute window, and the EEMUA threshold.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Tool execution — returns observation strings
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolContext {
  events: SimEvent[];
  siteId: string;
  zoneId: string | null;
  boardLoad: number;
  guards: Guard[];
  /** Sim clock time */
  simTime: number;
  /** Whether to use learned priors (F2) or hand-set only */
  useLearnedPriors?: boolean;
}

export function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): string {
  switch (toolName) {
    case "get_incident_context":
      return getIncidentContext(ctx);
    case "get_site_prior":
      return getSitePrior(args.event_type as string, ctx);
    case "find_precedent":
      return findPrecedent(ctx, (args.k as number) ?? 5);
    case "get_active_rules":
      return getActiveRules();
    case "get_available_guards":
      return getAvailableGuards(ctx);
    case "get_board_load":
      return getBoardLoad(ctx);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

function getIncidentContext(ctx: ToolContext): string {
  const events = ctx.events.map((e) => ({
    type: e.type,
    severity: e.severity,
    timestamp: e.timestamp,
    sourceType: e.sourceType,
    zoneId: e.zoneId,
    rawData: e.rawDataJson ? JSON.parse(e.rawDataJson) : null,
    // Never include groundTruthLabel — the agent cannot see it
  }));
  return JSON.stringify({
    siteId: ctx.siteId,
    zoneId: ctx.zoneId,
    eventCount: events.length,
    events,
    distinctTypes: [...new Set(ctx.events.map((e) => e.type))],
    maxSeverity: Math.max(...ctx.events.map((e) => e.severity)),
    timeSpanMs: events.length > 1
      ? events[events.length - 1].timestamp - events[0].timestamp
      : 0,
  });
}

function getSitePrior(eventType: string, ctx: ToolContext): string {
  const handSetPrior = EVENT_TYPE_PRIOR[eventType as EventType];
  if (handSetPrior === undefined) {
    return JSON.stringify({ error: `Unknown event type: ${eventType}`, validTypes: Object.keys(EVENT_TYPE_PRIOR) });
  }

  // F2: use learned priors if available
  if (ctx.useLearnedPriors) {
    const store = getLearnedPriorStore();
    const result = store.getPrior({
      eventType,
      siteId: ctx.siteId,
      zoneId: ctx.zoneId,
      simTimeMs: ctx.simTime,
    });
    return JSON.stringify({
      eventType,
      pReal: result.pReal,
      n: result.n,
      source: result.source,
      alpha: result.alpha,
      beta: result.beta,
      note: result.n === 0
        ? "n=0 means this is a prior belief, not a learned estimate. Weight accordingly."
        : `n=${result.n}: this prior is backed by ${result.n} resolved outcomes.`,
    });
  }

  // F1: hand-set priors only
  return JSON.stringify({
    eventType,
    pReal: handSetPrior,
    n: 0,
    source: "hand-set prior (D-015)",
    note: "n=0 means this is a prior belief, not a learned estimate. Weight accordingly.",
  });
}

function findPrecedent(ctx: ToolContext, k: number): string {
  const memory = getEpisodicMemory();
  const eventTypes = [...new Set(ctx.events.map((e) => e.type))];
  const precedents = memory.findPrecedents({
    siteId: ctx.siteId,
    zoneId: ctx.zoneId,
    eventTypes,
    k,
  });

  if (precedents.length === 0) {
    return JSON.stringify({
      precedents: [],
      count: 0,
      note: "No similar past incidents found. This combination is novel for this site.",
    });
  }

  return JSON.stringify({
    precedents: precedents.map((p) => ({
      incidentId: p.incidentId,
      siteId: p.siteId,
      zoneId: p.zoneId,
      eventTypes: p.eventTypes,
      chosenTier: p.chosenTier,
      trueLevel: p.trueLevel,
      wasReal: p.wasReal,
      nightIndex: p.nightIndex,
    })),
    count: precedents.length,
    summary: summarizePrecedents(precedents, eventTypes),
  });
}

function summarizePrecedents(precedents: import("./episodic-memory").PrecedentEntry[], queryTypes: string[]): string {
  const realCount = precedents.filter((p) => p.wasReal).length;
  const falseCount = precedents.filter((p) => !p.wasReal).length;
  const primaryType = queryTypes[0] ?? "unknown";
  return `Last ${precedents.length} similar incidents: ${realCount} were real, ${falseCount} were false alarms. ` +
    `Most recent: ${primaryType} → tier ${precedents[0].chosenTier}, ` +
    `${precedents[0].wasReal ? "was real" : "was false alarm"} (true level E${precedents[0].trueLevel}).`;
}

function getActiveRules(): string {
  return JSON.stringify({
    rules: [
      { id: "R-001", rule: "Tier-4 actions always require human confirmation", source: "D-004" },
      { id: "R-002", rule: "Never auto-dial emergency services", source: "D-004" },
      { id: "R-003", rule: "Panic button events are almost always real (P=0.85)", source: "D-015" },
      { id: "R-004", rule: "Under flood conditions (>6/10min), suppress E0-E1 to manage operator load", source: "D-019" },
    ],
    note: "No operator-promoted rules yet. These are the fixed safety policies.",
  });
}

function getAvailableGuards(ctx: ToolContext): string {
  const siteGuards = ctx.guards.filter((g) => g.siteId === ctx.siteId);
  return JSON.stringify({
    guards: siteGuards.map((g) => ({
      id: g.id,
      name: g.name,
      armed: g.armed,
      ackRate: g.reliabilityAckRate,
      avgResponseSec: g.reliabilityAvgResponse,
      onShift: true,
    })),
    count: siteGuards.length,
  });
}

function getBoardLoad(ctx: ToolContext): string {
  return JSON.stringify({
    currentLoad: ctx.boardLoad,
    threshold: 6,
    status: ctx.boardLoad >= 6 ? "OVERLOADED" : ctx.boardLoad >= 2 ? "MANAGEABLE" : "ACCEPTABLE",
    benchmark: "EEMUA 191: ≤1/10min acceptable, >2 manageable, >6 overloaded, >10 flood",
  });
}
