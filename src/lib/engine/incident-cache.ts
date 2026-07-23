/**
 * In-memory cache for enriched incidents.
 * F4.6: supports multi-arm storage (agent, scripted, rules-only)
 * and enriched agent trace data for ops + engineer panels.
 */

/** A single tool call with its arguments and return value */
export interface TraceToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  /** For get_site_prior: the observation count */
  n?: number;
}

/** Full agent trace — ops + engineer data in one object */
export interface AgentTrace {
  /** Arm that produced this trace */
  arm: string;
  /** Tool calls with args and returns */
  toolCalls: TraceToolCall[];
  /** Calibrated P(real) = sigmoid(logit(prior) + adj) */
  pReal: number;
  /** Base prior from noisy-OR */
  basePrior: number;
  /** Model's adjustment in log-odds */
  adjustment: number;
  /** Why the model adjusted */
  adjustmentReasons: string[];
  /** Novelty flag — pattern not in precedents */
  noveltyFlag: boolean;
  /** What evidence would change the decision */
  whatWouldChange: string;
  /** The move chosen */
  move: string;
  /** Evidence level at decision time */
  evidenceLevel: number;
  /** --- Engineer panel data --- */
  /** Full system + user prompt sent to LLM */
  promptMessages?: Array<{ role: string; content: string }>;
  /** Raw LLM response (text + tool calls) */
  rawResponse?: {
    text: string | null;
    toolCalls: Array<{ name: string; arguments: string }>;
  };
  /** Which model tier ran */
  modelTier?: "fast" | "strong";
  /** Why this tier was chosen */
  modelTierReason?: string;
  /** Model ID */
  modelId?: string;
  /** Input tokens */
  inputTokens?: number;
  /** Output tokens */
  outputTokens?: number;
  /** LLM latency in ms */
  latencyMs?: number;
  /** LLM cost in USD */
  costUsd?: number;
  /** Policy version hash */
  policyVersion?: string;
  /** Trace cache key */
  cacheKey?: string;
  /** Whether this was a cache hit */
  cacheHit?: boolean;
  /** Investigation steps (from LoopEngine transitions) */
  steps?: Array<{
    timestamp: number;
    moveType: string;
    actionName: string;
    evidenceBefore: number;
    evidenceAfter: number;
    reason: string;
  }>;
}

export interface CachedIncident {
  id: string;
  siteId: string;
  zoneId: string | null;
  status: string;
  eventIds: string;
  priority: number | null;
  tier: number | null;
  confidence: number | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  decisions: any[];
  events: any[];
  site: any;
  trace: AgentTrace | null;
}

/** Per-arm session metrics — same cost pipeline as eval */
export interface ArmMetrics {
  /** Eval-equivalent: response + harm + flood */
  totalCostUsd: number;
  responseCostUsd: number;
  harmCostUsd: number;
  floodPenaltyUsd: number;
  /** Investigation move cost (guard + operator time during investigation) */
  moveCostUsd: number;
  incidentsSurfaced: number;
  missCount: number;
  overResponseCount: number;
  llmCostUsd: number;
  llmCalls: number;
  totalMoves: number;
  boardLoadPeak: number;
}

const globalCache = globalThis as unknown as {
  __calvisIncidentCache?: CachedIncident[];
  __calvisArmCaches?: Map<string, CachedIncident[]>;
  __calvisActiveArm?: string;
  __calvisArmMetrics?: Map<string, ArmMetrics>;
};

export function setIncidentCache(incidents: CachedIncident[]) {
  globalCache.__calvisIncidentCache = incidents;
}

export function getIncidentCache(): CachedIncident[] | null {
  return globalCache.__calvisIncidentCache ?? null;
}

export function updateCachedIncident(id: string, updates: Partial<CachedIncident>) {
  const cache = globalCache.__calvisIncidentCache;
  if (!cache) return;
  const idx = cache.findIndex((inc) => inc.id === id);
  if (idx >= 0) {
    cache[idx] = { ...cache[idx], ...updates };
  }
}

export function clearIncidentCache() {
  globalCache.__calvisIncidentCache = undefined;
  globalCache.__calvisArmCaches = undefined;
  globalCache.__calvisActiveArm = undefined;
  globalCache.__calvisArmMetrics = undefined;
}

/** Store pre-computed results for an arm */
export function setArmCache(arm: string, incidents: CachedIncident[]) {
  if (!globalCache.__calvisArmCaches) {
    globalCache.__calvisArmCaches = new Map();
  }
  globalCache.__calvisArmCaches.set(arm, incidents);
}

/** Get cached results for a specific arm */
export function getArmCache(arm: string): CachedIncident[] | null {
  return globalCache.__calvisArmCaches?.get(arm) ?? null;
}

/** Switch active arm — updates the primary cache */
export function switchArm(arm: string): boolean {
  const armData = globalCache.__calvisArmCaches?.get(arm);
  if (!armData) return false;
  globalCache.__calvisIncidentCache = armData;
  globalCache.__calvisActiveArm = arm;
  return true;
}

/** Get the active arm name */
export function getActiveArm(): string {
  return globalCache.__calvisActiveArm ?? "agent";
}

/** Get available arms */
export function getAvailableArms(): string[] {
  if (!globalCache.__calvisArmCaches) return [];
  return Array.from(globalCache.__calvisArmCaches.keys());
}

/** Store metrics for an arm */
export function setArmMetrics(arm: string, metrics: ArmMetrics) {
  if (!globalCache.__calvisArmMetrics) {
    globalCache.__calvisArmMetrics = new Map();
  }
  globalCache.__calvisArmMetrics.set(arm, metrics);
}

/** Get metrics for the active arm */
export function getArmMetrics(arm?: string): ArmMetrics | null {
  const target = arm ?? getActiveArm();
  return globalCache.__calvisArmMetrics?.get(target) ?? null;
}

/** Get all arm metrics */
export function getAllArmMetrics(): Record<string, ArmMetrics> {
  const result: Record<string, ArmMetrics> = {};
  if (globalCache.__calvisArmMetrics) {
    for (const [arm, metrics] of globalCache.__calvisArmMetrics) {
      result[arm] = metrics;
    }
  }
  return result;
}
