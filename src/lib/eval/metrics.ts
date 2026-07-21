import type { Decision, Outcome, Incident } from "../db/schema";

// ═══════════════════════════════════════════════════════════════════════════
// COST CONSTANTS — D-019. Each anchored or marked as stated judgment.
// ═══════════════════════════════════════════════════════════════════════════

/** $/guard-minute. Industry average for contracted security in US metro. */
export const GUARD_RATE_PER_MIN = 0.75;

/** Operator attention cost per minute — one operator covering 40+ sites at $35/hr */
export const OPERATOR_RATE_PER_MIN = 0.58;

// Response cost per tier in guard-minutes + operator-minutes
export const TIER_GUARD_MINUTES = [0, 0, 0.5, 10, 30] as const;
export const TIER_OPERATOR_MINUTES = [0, 0.5, 1, 3, 10] as const;

/** Dollar cost of responding at a given tier */
export function responseCostUsd(tier: number): number {
  const t = Math.min(4, Math.max(0, tier));
  return TIER_GUARD_MINUTES[t] * GUARD_RATE_PER_MIN +
         TIER_OPERATOR_MINUTES[t] * OPERATOR_RATE_PER_MIN;
}

/**
 * Convex per-level harm cost (D-019).
 * Each level is qualitatively different, not a unit of one thing.
 * HARM_AT_LEVEL[L] is the cost per level of gap when the true level is L.
 */
export const HARM_AT_LEVEL: readonly number[] = [
  0,       // E0: benign — no harm from missing it
  50,      // E1: something happened — paperwork/compliance cost. Stated judgment.
  200,     // E2: human presence confirmed — overtime to backfill (~4h × $50/h). Derived.
  2_000,   // E3: property threat — avg commercial burglary ~$8k (FBI UCR 2023), discounted. Anchored.
  10_000,  // E4: life threat — liability floor. No public anchor; stated judgment.
];

/**
 * harmCost: convex charge when under-responding to a real incident.
 * Uses the TRUE level's per-level cost × gap.
 */
export function harmCostUsd(trueLevel: number, respondedTier: number, wasReal: boolean): number {
  if (!wasReal) return 0;
  const gap = trueLevel - respondedTier;
  if (gap <= 0) return 0;
  const perLevel = HARM_AT_LEVEL[Math.min(trueLevel, 4)] ?? 0;
  return perLevel * gap;
}

/**
 * Flood penalty (D-019, EEMUA 191).
 * Superlinear surcharge when operator-surfaced rate exceeds threshold.
 * Threshold: 6 items per 10-min window (adapted from EEMUA "overloaded" at >2/10min
 * for industrial, scaled for security's higher baseline volume).
 */
export const FLOOD_THRESHOLD_PER_10MIN = 6;
export const FLOOD_COST_PER_UNIT_SQ = 20; // $/unit² above threshold. Stated judgment.

export function computeFloodPenalty(decisions: Decision[]): number {
  // Only tier >= 1 items surface to the operator
  const surfacedTimes = decisions
    .filter((d) => d.chosenTier >= 1)
    .map((d) => d.timestamp)
    .sort((a, b) => a - b);

  if (surfacedTimes.length === 0) return 0;

  const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  let totalPenalty = 0;

  // Sliding window: check each 10-min window aligned to first event, stepping by 1 min
  const start = surfacedTimes[0];
  const end = surfacedTimes[surfacedTimes.length - 1];

  for (let windowStart = start; windowStart <= end; windowStart += 60_000) {
    const windowEnd = windowStart + WINDOW_MS;
    const count = surfacedTimes.filter((t) => t >= windowStart && t < windowEnd).length;
    if (count > FLOOD_THRESHOLD_PER_10MIN) {
      const excess = count - FLOOD_THRESHOLD_PER_10MIN;
      totalPenalty += excess * excess * FLOOD_COST_PER_UNIT_SQ;
    }
  }

  // Normalize: don't double-count overlapping windows — take the average penalty per window
  const numWindows = Math.max(1, Math.ceil((end - start) / 60_000));
  return totalPenalty / numWindows;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIMARY METRIC: operational cost in dollars (response + harm + flood)
// ═══════════════════════════════════════════════════════════════════════════

export interface CostResult {
  totalCostUsd: number;
  responseCostUsd: number;
  harmCostUsd: number;
  floodPenaltyUsd: number;
  missCount: number;
  overResponseCount: number;
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
    totalResponseCost += responseCostUsd(d.chosenTier);

    const outcome = outcomeByDecision.get(d.id);
    if (!outcome || outcome.correctTier === null) continue;

    const wasReal = !!outcome.wasReal;
    const harm = harmCostUsd(outcome.correctTier, d.chosenTier, wasReal);
    totalHarmCost += harm;

    if (wasReal && d.chosenTier < outcome.correctTier) missCount++;
    if (!wasReal && d.chosenTier > 0) overResponseCount++;
  }

  const floodPenalty = computeFloodPenalty(decisions);

  return {
    totalCostUsd: totalResponseCost + totalHarmCost + floodPenalty,
    responseCostUsd: totalResponseCost,
    harmCostUsd: totalHarmCost,
    floodPenaltyUsd: floodPenalty,
    missCount,
    overResponseCount,
    totalDecisions: decisions.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BRIER SCORE
// ═══════════════════════════════════════════════════════════════════════════

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
  return {
    median: ackTimes[Math.floor(ackTimes.length / 2)],
    mean: ackTimes.reduce((s, t) => s + t, 0) / ackTimes.length,
    count: ackTimes.length,
  };
}

export function computeTimeToResolution(
  incidents: Incident[]
): { median: number; mean: number; count: number } {
  const times = incidents
    .filter((i) => i.resolvedAt != null)
    .map((i) => ((i.resolvedAt ?? 0) - i.createdAt) / 1000)
    .filter((t) => t > 0)
    .sort((a, b) => a - b);

  if (times.length === 0) return { median: 0, mean: 0, count: 0 };
  return {
    median: times[Math.floor(times.length / 2)],
    mean: times.reduce((s, t) => s + t, 0) / times.length,
    count: times.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GUARD-MINUTES
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
