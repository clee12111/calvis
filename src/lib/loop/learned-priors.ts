/**
 * F2.1 — Beta counters for learned priors.
 * P(real | event_type, site, zone, hour_bucket) as Beta(α, β).
 * Updated on every resolved outcome.
 *
 * Cold-start backoff: sparse cell → site-level → event-type-level.
 * State persists across nights within a run, never across runs.
 */
import { EVENT_TYPE_PRIOR } from "../engine/baseline-scorer";
import type { EventType } from "../engine/scenarios";

// ═══════════════════════════════════════════════════════════════════════════
// Beta distribution counter
// ═══════════════════════════════════════════════════════════════════════════

export interface BetaCounter {
  alpha: number;  // successes (real)
  beta: number;   // failures (false alarm)
}

/** Posterior mean = α / (α + β) */
export function betaMean(c: BetaCounter): number {
  return c.alpha / (c.alpha + c.beta);
}

/** Observation count n = α + β - prior (α₀ + β₀) */
export function betaN(c: BetaCounter, prior: BetaCounter): number {
  return (c.alpha + c.beta) - (prior.alpha + prior.beta);
}

/** Total observations α + β - 2 (minus the uniform prior base) */
export function betaObservations(c: BetaCounter): number {
  // We initialize from hand-set priors, so n = total updates applied
  return Math.max(0, (c.alpha + c.beta) - 2); // subtract the base Beta(1,1)
}

// ═══════════════════════════════════════════════════════════════════════════
// Hierarchical key structure: event_type → site → zone → hour_bucket
// ═══════════════════════════════════════════════════════════════════════════

/** Hour buckets for night shift (20:00–06:00 → 5 × 2h buckets) */
export function hourBucket(simTimeMs: number): number {
  const hours = simTimeMs / (3600 * 1000);
  return Math.floor(hours / 2); // 0-4 for 10h night
}

function cellKey(eventType: string, siteId?: string, zoneId?: string, hBucket?: number): string {
  const parts = [eventType];
  if (siteId) parts.push(siteId);
  if (zoneId) parts.push(zoneId);
  if (hBucket !== undefined) parts.push(`h${hBucket}`);
  return parts.join("|");
}

// ═══════════════════════════════════════════════════════════════════════════
// Prior store — the learning state
// ═══════════════════════════════════════════════════════════════════════════

export class LearnedPriorStore {
  private counters = new Map<string, BetaCounter>();
  private initialPriors = new Map<string, BetaCounter>();
  /** Minimum observations for a cell to be used (before backoff) */
  private readonly MIN_N_FOR_CELL = 3;

  constructor() {
    this.reset();
  }

  /**
   * Reset all learned state. Must be called between runs.
   * Initializes from hand-set EVENT_TYPE_PRIOR as Beta(α₀, β₀).
   */
  reset(): void {
    this.counters.clear();
    this.initialPriors.clear();

    // Initialize event-type-level priors from hand-set values
    for (const [eventType, pReal] of Object.entries(EVENT_TYPE_PRIOR)) {
      // Convert hand-set P(real) to Beta parameters
      // Use a weak prior: pseudo-count of 2 (α₀ + β₀ = 2)
      const alpha = Math.max(0.01, pReal * 2);
      const beta = Math.max(0.01, (1 - pReal) * 2);
      const prior = { alpha, beta };
      const key = cellKey(eventType);
      this.counters.set(key, { ...prior });
      this.initialPriors.set(key, { ...prior });
    }
  }

  /**
   * Update a prior given an outcome.
   * Updates all hierarchy levels: event_type, event_type+site, event_type+site+zone, event_type+site+zone+hour.
   */
  update(params: {
    eventType: string;
    siteId: string;
    zoneId: string | null;
    simTimeMs: number;
    wasReal: boolean;
  }): void {
    const { eventType, siteId, zoneId, simTimeMs, wasReal } = params;
    const hBucket = hourBucket(simTimeMs);

    // Update all levels of the hierarchy
    const keys = [
      cellKey(eventType),                                    // event-type level
      cellKey(eventType, siteId),                           // site level
      ...(zoneId ? [cellKey(eventType, siteId, zoneId)] : []),  // zone level
      cellKey(eventType, siteId, zoneId ?? undefined, hBucket), // hour level
    ];

    for (const key of keys) {
      const counter = this.counters.get(key) ?? this.getInitialPrior(eventType);
      if (wasReal) {
        counter.alpha += 1;
      } else {
        counter.beta += 1;
      }
      this.counters.set(key, counter);
    }
  }

  /**
   * Get the posterior P(real) and observation count for a query.
   * Implements cold-start backoff:
   *   1. Try event_type+site+zone+hour
   *   2. Fall back to event_type+site+zone
   *   3. Fall back to event_type+site
   *   4. Fall back to event_type (always has hand-set prior)
   */
  getPrior(params: {
    eventType: string;
    siteId: string;
    zoneId: string | null;
    simTimeMs: number;
  }): { pReal: number; n: number; source: string; alpha: number; beta: number } {
    const { eventType, siteId, zoneId, simTimeMs } = params;
    const hBucket = hourBucket(simTimeMs);
    const initialPrior = this.getInitialPrior(eventType);

    // Try most specific first, back off on sparse cells
    const candidates = [
      { key: cellKey(eventType, siteId, zoneId ?? undefined, hBucket), source: `${eventType}/${siteId}/${zoneId ?? "*"}/h${hBucket}` },
      ...(zoneId ? [{ key: cellKey(eventType, siteId, zoneId), source: `${eventType}/${siteId}/${zoneId}` }] : []),
      { key: cellKey(eventType, siteId), source: `${eventType}/${siteId}` },
      { key: cellKey(eventType), source: `${eventType} (global)` },
    ];

    for (const { key, source } of candidates) {
      const counter = this.counters.get(key);
      if (!counter) continue;
      const n = this.observationCount(key, eventType);
      if (n >= this.MIN_N_FOR_CELL) {
        return {
          pReal: betaMean(counter),
          n,
          source: `learned (${source}, n=${n})`,
          alpha: counter.alpha,
          beta: counter.beta,
        };
      }
    }

    // Fall back to event-type level (always exists)
    const baseKey = cellKey(eventType);
    const baseCounter = this.counters.get(baseKey) ?? initialPrior;
    const n = this.observationCount(baseKey, eventType);
    return {
      pReal: betaMean(baseCounter),
      n,
      source: n > 0 ? `learned (${eventType}, n=${n})` : `hand-set prior (D-015)`,
      alpha: baseCounter.alpha,
      beta: baseCounter.beta,
    };
  }

  /** Get the number of observations added to a cell beyond the initial prior */
  private observationCount(key: string, eventType: string): number {
    const counter = this.counters.get(key);
    if (!counter) return 0;
    const initial = this.initialPriors.get(key) ?? this.getInitialPrior(eventType);
    return Math.max(0, Math.round((counter.alpha + counter.beta) - (initial.alpha + initial.beta)));
  }

  private getInitialPrior(eventType: string): BetaCounter {
    const key = cellKey(eventType);
    const existing = this.initialPriors.get(key);
    if (existing) return { ...existing };

    const pReal = EVENT_TYPE_PRIOR[eventType as EventType] ?? 0.1;
    return { alpha: Math.max(0.01, pReal * 2), beta: Math.max(0.01, (1 - pReal) * 2) };
  }

  /**
   * Get the top N priors that have moved the most from their starting values.
   * Used for the Learning tab display.
   */
  getTopMovedPriors(topN: number = 10): Array<{
    key: string;
    eventType: string;
    pReal: number;
    startPReal: number;
    movement: number;
    n: number;
    alpha: number;
    beta: number;
  }> {
    const results: Array<{
      key: string;
      eventType: string;
      pReal: number;
      startPReal: number;
      movement: number;
      n: number;
      alpha: number;
      beta: number;
    }> = [];

    for (const [key, counter] of this.counters) {
      const eventType = key.split("|")[0];
      const initial = this.initialPriors.get(cellKey(eventType)) ?? this.getInitialPrior(eventType);
      const n = this.observationCount(key, eventType);
      if (n === 0) continue;

      const pReal = betaMean(counter);
      const startPReal = betaMean(initial);
      const movement = Math.abs(pReal - startPReal);

      results.push({ key, eventType, pReal, startPReal, movement, n, alpha: counter.alpha, beta: counter.beta });
    }

    results.sort((a, b) => b.movement - a.movement);
    return results.slice(0, topN);
  }

  /** Serialize for persistence between nights */
  serialize(): Record<string, BetaCounter> {
    const result: Record<string, BetaCounter> = {};
    for (const [key, counter] of this.counters) {
      result[key] = counter;
    }
    return result;
  }

  /** Deserialize from a previous night */
  deserialize(data: Record<string, BetaCounter>): void {
    for (const [key, counter] of Object.entries(data)) {
      this.counters.set(key, counter);
    }
  }

  /** Get all counters for display */
  getAllCounters(): Map<string, BetaCounter> {
    return new Map(this.counters);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton for learning runs
// ═══════════════════════════════════════════════════════════════════════════

let _store: LearnedPriorStore | null = null;

export function getLearnedPriorStore(): LearnedPriorStore {
  if (!_store) {
    _store = new LearnedPriorStore();
  }
  return _store;
}

export function resetLearnedPriorStore(): LearnedPriorStore {
  _store = new LearnedPriorStore();
  return _store;
}
