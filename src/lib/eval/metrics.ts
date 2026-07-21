import type { Decision, Outcome, Incident } from "../db/schema";

// ═══════════════════════════════════════════════════════════════════════════
// COST CONSTANTS — each with a one-line dollar rationale
// ═══════════════════════════════════════════════════════════════════════════

/** $/guard-minute. Industry average for contracted security in US metro. */
export const GUARD_RATE_PER_MIN = 0.75;

/** Operator attention cost per minute — one operator covering 40+ sites at $35/hr */
export const OPERATOR_RATE_PER_MIN = 0.58;

// Response cost per tier in guard-minutes + operator-minutes
// Tier 0: suppress — 0 cost
// Tier 1: log_and_watch — 0 guard-min, 0.5 operator-min (glance at recheck)
// Tier 2: request_photo — 0.5 guard-min (~30s to snap photo), 1 operator-min
// Tier 3: notify_guard / walk it — 10 guard-min, 3 operator-min (track dispatch)
// Tier 4: dispatch_backup / escalate — 30 guard-min, 10 operator-min (coordinate)
export const TIER_GUARD_MINUTES = [0, 0, 0.5, 10, 30] as const;
export const TIER_OPERATOR_MINUTES = [0, 0.5, 1, 3, 10] as const;

/** Dollar cost of responding at a given tier */
export function responseCostUsd(tier: number): number {
  const t = Math.min(4, Math.max(0, tier));
  return TIER_GUARD_MINUTES[t] * GUARD_RATE_PER_MIN +
         TIER_OPERATOR_MINUTES[t] * OPERATOR_RATE_PER_MIN;
}

/**
 * Cost of harm when under-responding to a real incident.
 * $500 per evidence-level gap — a missed break-in (true=3, responded=0) costs $1500.
 * Rationale: average burglary loss in commercial properties is ~$8k;
 * $500/level is conservative and makes the tradeoff legible.
 */
export const C_HARM_PER_LEVEL = 500;

/**
 * harmCost: charges when the system under-responds to a real incident.
 * Zero when the incident is benign or when response meets/exceeds true level.
 */
export function harmCostUsd(trueLevel: number, respondedTier: number, wasReal: boolean): number {
  if (!wasReal) return 0;
  const gap = trueLevel - respondedTier;
  if (gap <= 0) return 0; // met or exceeded — no harm
  return C_HARM_PER_LEVEL * gap;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIMARY METRIC: operational cost in dollars
// ═══════════════════════════════════════════════════════════════════════════

export interface CostResult {
  /** Total operational cost: response + harm */
  totalCostUsd: number;
  /** Sum of response costs (guard + operator time) */
  responseCostUsd: number;
  /** Sum of harm costs from under-responding to real incidents */
  harmCostUsd: number;
  /** Number of under-responded real incidents */
  missCount: number;
  /** Number of over-responded benign incidents (tier > 0 on benign) */
  overResponseCount: number;
  /** Total decisions evaluated */
  totalDecisions: number;
}

export function computeOperationalCost(
  decisions: Decision[],
  outcomes: Outcome[]
): CostResult {
  const outcomeByDecision = new Map<string, Outcome>();
  for (const o of outcomes) {
    outcomeByDecision.set(o.decisionId, o);
  }

  let totalResponseCost = 0;
  let totalHarmCost = 0;
  let missCount = 0;
  let overResponseCount = 0;

  for (const d of decisions) {
    // Every decision incurs its response cost
    totalResponseCost += responseCostUsd(d.chosenTier);

    const outcome = outcomeByDecision.get(d.id);
    if (!outcome || outcome.correctTier === null) continue;

    const wasReal = !!outcome.wasReal;
    const harm = harmCostUsd(outcome.correctTier, d.chosenTier, wasReal);
    totalHarmCost += harm;

    if (wasReal && d.chosenTier < outcome.correctTier) {
      missCount++;
    }
    if (!wasReal && d.chosenTier > 0) {
      overResponseCount++;
    }
  }

  return {
    totalCostUsd: totalResponseCost + totalHarmCost,
    responseCostUsd: totalResponseCost,
    harmCostUsd: totalHarmCost,
    missCount,
    overResponseCount,
    totalDecisions: decisions.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BRIER SCORE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Brier score: mean squared error of stated confidence vs actual outcome.
 * confidence → P(real), outcome → 1 if real, 0 if false
 * Lower is better. Perfect = 0, worst = 1.
 */
export function computeBrierScore(
  decisions: Decision[],
  outcomes: Outcome[]
): number {
  const outcomeByDecision = new Map<string, Outcome>();
  for (const o of outcomes) {
    outcomeByDecision.set(o.decisionId, o);
  }

  let sum = 0;
  let count = 0;

  for (const d of decisions) {
    const outcome = outcomeByDecision.get(d.id);
    if (!outcome || outcome.wasReal === null) continue;

    const predicted = d.confidence;
    const actual = outcome.wasReal ? 1 : 0;
    sum += (predicted - actual) ** 2;
    count++;
  }

  return count > 0 ? sum / count : 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPATCH QUALITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ack rate: fraction of dispatched incidents (tier >= 2) that got an ack.
 * Denominator = incidents actually dispatched, not all outcomes.
 */
export function computeAckRate(
  decisions: Decision[],
  outcomes: Outcome[]
): number {
  const dispatched = decisions.filter((d) => d.chosenTier >= 2);
  if (dispatched.length === 0) return 0;

  const dispatchedIds = new Set(dispatched.map((d) => d.incidentId));
  const ackedIds = new Set(
    outcomes
      .filter((o) => dispatchedIds.has(o.incidentId) &&
        (o.source === "ack_telemetry" || o.source === "guard_closeout"))
      .map((o) => o.incidentId)
  );

  return ackedIds.size / dispatchedIds.size;
}

export function computeTimeToAck(
  incidents: Incident[],
  outcomes: Outcome[]
): { median: number; mean: number; count: number } {
  const incidentById = new Map(incidents.map((i) => [i.id, i]));
  const ackTimes: number[] = [];

  for (const o of outcomes) {
    if (o.source !== "ack_telemetry" && o.source !== "guard_closeout") continue;
    const incident = incidentById.get(o.incidentId);
    if (!incident) continue;
    const delta = o.timestamp - incident.createdAt;
    if (delta > 0) ackTimes.push(delta / 1000);
  }

  if (ackTimes.length === 0) return { median: 0, mean: 0, count: 0 };

  ackTimes.sort((a, b) => a - b);
  const median = ackTimes[Math.floor(ackTimes.length / 2)];
  const mean = ackTimes.reduce((s, t) => s + t, 0) / ackTimes.length;

  return { median, mean, count: ackTimes.length };
}

export function computeTimeToResolution(
  incidents: Incident[]
): { median: number; mean: number; count: number } {
  const resolved = incidents.filter(
    (i) => i.resolvedAt !== null && i.resolvedAt !== undefined
  );

  if (resolved.length === 0) return { median: 0, mean: 0, count: 0 };

  const times = resolved
    .map((i) => ((i.resolvedAt ?? 0) - i.createdAt) / 1000)
    .filter((t) => t > 0)
    .sort((a, b) => a - b);

  if (times.length === 0) return { median: 0, mean: 0, count: 0 };

  const median = times[Math.floor(times.length / 2)];
  const mean = times.reduce((s, t) => s + t, 0) / times.length;

  return { median, mean, count: times.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// GUARD-MINUTES (now derived from response cost)
// ═══════════════════════════════════════════════════════════════════════════

export function computeGuardMinutes(decisions: Decision[]): number {
  return decisions.reduce((sum, d) => {
    const t = Math.min(4, Math.max(0, d.chosenTier));
    return sum + TIER_GUARD_MINUTES[t];
  }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE
// ═══════════════════════════════════════════════════════════════════════════

export interface AllMetrics {
  cost: CostResult;
  brierScore: number;
  ackRate: number;
  timeToAck: { median: number; mean: number; count: number };
  timeToResolution: { median: number; mean: number; count: number };
  guardMinutes: number;
  llmCalls: number;
  llmCostUsd: number;
  eventsPerSecond: number;
}

export function computeAllMetrics(params: {
  decisions: Decision[];
  outcomes: Outcome[];
  incidents: Incident[];
  totalEvents: number;
  wallTimeMs: number;
}): AllMetrics {
  const { decisions, outcomes, incidents, totalEvents, wallTimeMs } = params;

  return {
    cost: computeOperationalCost(decisions, outcomes),
    brierScore: computeBrierScore(decisions, outcomes),
    ackRate: computeAckRate(decisions, outcomes),
    timeToAck: computeTimeToAck(incidents, outcomes),
    timeToResolution: computeTimeToResolution(incidents),
    guardMinutes: computeGuardMinutes(decisions),
    llmCalls: 0,
    llmCostUsd: 0,
    eventsPerSecond: wallTimeMs > 0 ? (totalEvents / wallTimeMs) * 1000 : 0,
  };
}
