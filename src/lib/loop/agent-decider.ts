/**
 * F1 — Agent decider. Replaces chooseNextMove and nothing else.
 * Same machinery, same costs, same response map, same tests.
 *
 * The model returns a structured decision via tool call.
 * It never free-hands a number that matters (D-003):
 *   pReal = sigmoid(logit(basePrior) + clamp(adjustment, ±2))
 * The model's confidence_p_real is a reported belief — logged, never consumed.
 */
import type { LLMProvider, ChatMessage, ToolSchema, ToolCall, LLMResponse } from "../llm/provider";
import { getCachedTrace, setCachedTrace, isDemoMode, assertCacheHit } from "../llm/trace-cache";
import { AGENT_TOOLS, AGENT_TOOLS_F1, executeTool, type ToolContext } from "./agent-tools";
import { evidenceLevelToResponse, chooseNextMove } from "./rules-decider";
import { EVENT_TYPE_PRIOR } from "../engine/baseline-scorer";
import type { WorkingState, Move, Action } from "./types";
import { SYSTEM_ACTIONS, HUMAN_ACTIONS, RESPONSE_ACTIONS, DEFER_ACTIONS, FLOOD_THRESHOLD } from "./types";
import type { EvidenceLevel, EventType } from "../engine/scenarios";

// ═══════════════════════════════════════════════════════════════════════════
// Math helpers for calibrated pReal
// ═══════════════════════════════════════════════════════════════════════════

function logit(p: number): number {
  const clamped = Math.max(0.001, Math.min(0.999, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute pReal from calibrated prior + bounded model adjustment.
 * The model can shift the prior by at most ±2 log-odds.
 * This ensures the calibrated noisy-OR prior is the base,
 * and the model can only nudge it — never replace it.
 */
export function computeCalibratedPReal(basePrior: number, adjustmentLogOdds: number): number {
  const clamped = Math.max(-2, Math.min(2, adjustmentLogOdds));
  return sigmoid(logit(basePrior) + clamped);
}

// ═══════════════════════════════════════════════════════════════════════════
// F1.2 — Structured output: the decision tool the agent must call
// ═══════════════════════════════════════════════════════════════════════════

const DECIDE_TOOL: ToolSchema = {
  type: "function",
  function: {
    name: "make_decision",
    description: "Submit your decision for this incident. You MUST call this exactly once after gathering context. Your prior_adjustment_log_odds adjusts the calibrated prior — positive means more likely real, negative means less. The actual P(real) used for the decision is computed as sigmoid(logit(prior) + your_adjustment), NOT from confidence_p_real. confidence_p_real is your reported belief for logging only.",
    parameters: {
      type: "object",
      properties: {
        chosen_move: {
          type: "string",
          enum: ["investigate", "commit", "defer"],
          description: "The move to make: investigate (ask a question), commit (respond), or defer (recheck later)",
        },
        action_id: {
          type: "string",
          description: "The action to take. For investigate: a question action id. For commit: a response action id. For defer: 'recheck_5min' or 'suppress_ttl'.",
        },
        prior_adjustment_log_odds: {
          type: "number",
          description: "Bounded adjustment to the retrieved prior, in log-odds. Positive = more likely real, negative = less. Must be in [-2, 2]. This is the number that matters — the decision is computed from sigmoid(logit(prior) + this).",
        },
        adjustment_reasons: {
          type: "array",
          items: { type: "string" },
          description: "Why you adjusted the prior (1-3 short reasons)",
        },
        novelty_flag: {
          type: "boolean",
          description: "True if this incident has features not seen in precedents or priors — signal for future learning",
        },
        confidence_p_real: {
          type: "number",
          description: "Your reported belief about P(real). This is logged for calibration analysis but NOT used for the decision — the decision uses the calibrated prior + your adjustment.",
        },
        what_would_change_my_mind: {
          type: "string",
          description: "What evidence would change your decision?",
        },
      },
      required: [
        "chosen_move",
        "action_id",
        "prior_adjustment_log_odds",
        "adjustment_reasons",
        "novelty_flag",
        "confidence_p_real",
        "what_would_change_my_mind",
      ],
    },
  },
};

export interface AgentDecision {
  move: Move;
  /** Calibrated pReal = sigmoid(logit(prior) + clamp(adj)) — used for decision */
  pReal: number;
  /** Model's reported belief — logged only, never consumed */
  reportedPReal: number;
  /** The base prior from noisy-OR */
  basePrior: number;
  priorAdjustmentLogOdds: number;
  adjustmentReasons: string[];
  noveltyFlag: boolean;
  whatWouldChangeMyMind: string;
  llmCalls: number;
  llmCostUsd: number;
  llmLatencyMs: number;
  toolCallsUsed: string[];
  /** F4.6: engineer-facing data */
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  modelTier: "fast" | "strong" | "none";
  modelTierReason: string;
  cacheHit: boolean;
  /** Full prompt messages sent to LLM */
  promptMessages?: Array<{ role: string; content: string }>;
  /** Raw LLM response text */
  rawResponseText?: string | null;
  /** Raw tool calls from LLM */
  rawToolCalls?: Array<{ name: string; arguments: string }>;
  /** Tool call results keyed by name */
  toolCallResults: Array<{ name: string; arguments: Record<string, unknown>; result: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// System prompt — F1.5.5: teaches what n means
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are Lucius, the AI dispatch copilot for a physical security operations center.
You are assisting a single overwatch operator covering 40+ sites on the night shift.

YOUR JOB: For each incident, decide what to do next: investigate (ask a question to buy evidence), commit (respond at the evidence level), or defer (set a recheck timer).

EVIDENCE LEVELS (ANSI/TMA AVS-01):
  E0 = nothing to act on (benign / equipment malfunction)
  E1 = something happened, intent unknown
  E2 = human presence confirmed, intent unknown
  E3 = threat to property confirmed
  E4 = threat to life confirmed

PROCESS:
1. ALWAYS call get_incident_context first to see the events.
2. Call get_site_prior for each distinct event type to get P(real) and n.
3. Call find_precedent to check if similar incidents have occurred at this site before.
4. Call get_board_load to check operator load.
5. Optionally call get_active_rules, get_available_guards.
6. Call make_decision with your structured decision.

NOVELTY FLAG:
- Set novelty_flag=true ONLY when find_precedent returns zero precedents.
- Novelty means this site/event-type combination has never been seen before.
- Do NOT set novelty based on n=0 — a hand-set prior with no observations is the initial state, not novelty.

HOW P(REAL) WORKS — READ CAREFULLY:
- Each get_site_prior returns a probability AND an observation count n.
- n is the number of resolved outcomes behind that prior.
- n=0 means a HAND-SET ASSUMPTION with NO evidence behind it. Treat it as a weak starting point, not as strong evidence. Your adjustment should be FREER when n is small.
- n=50+ means a LEARNED ESTIMATE backed by real data. Your adjustment should be MORE CONSERVATIVE — the prior has earned its weight.
- Your prior_adjustment_log_odds shifts the prior: the decision uses sigmoid(logit(prior) + your_adjustment). Your confidence_p_real is logged but NOT used for the decision.

RULES:
- Never auto-dial emergency services. E4 responses require human confirmation.
- Under flood conditions (board load ≥ 6), suppress E0-E1 to protect the operator.
- Your prior_adjustment_log_odds must be bounded to [-2, 2].
- Cheap, free questions (system lookups) are always worth asking.
- Silence from a guard is information.

The operator is tired. Every item you surface costs their attention. The scarcest resource is not your compute — it's their focus at 2am.`;

// ═══════════════════════════════════════════════════════════════════════════
// F1.3 — Two-tier routing
// ═══════════════════════════════════════════════════════════════════════════

export interface AgentConfig {
  provider: LLMProvider;
  fastModel: string;
  strongModel: string;
  escalateBandLow: number;
  escalateBandHigh: number;
  auditFraction: number;
  policyVersion: string;
  rng: () => number;
}

function shouldUseStrongModel(
  initialEvidence: EvidenceLevel,
  pReal: number | null,
  config: AgentConfig,
): { useStrong: boolean; reason: string } {
  if (initialEvidence >= 3) return { useStrong: true, reason: "evidence level ≥ 3" };
  if (pReal !== null && pReal >= config.escalateBandLow && pReal <= config.escalateBandHigh) {
    return { useStrong: true, reason: `P(real)=${pReal.toFixed(2)} in ambiguous band` };
  }
  if (config.rng() < config.auditFraction) return { useStrong: true, reason: "random audit sample" };
  return { useStrong: false, reason: "fast model sufficient" };
}

// ═══════════════════════════════════════════════════════════════════════════
// Compute base prior from incident events (noisy-OR, same as baseline scorer)
// ═══════════════════════════════════════════════════════════════════════════

function computeBasePrior(events: Array<{ type: string }>): number {
  const seenTypes = new Set<string>();
  let pAllFalse = 1.0;
  for (const e of events) {
    if (seenTypes.has(e.type)) continue;
    seenTypes.add(e.type);
    const prior = EVENT_TYPE_PRIOR[e.type as EventType] ?? 0.1;
    pAllFalse *= (1 - prior);
  }
  return Math.max(0.01, Math.min(0.99, 1 - pAllFalse));
}

// ═══════════════════════════════════════════════════════════════════════════
// Main entry point — replaces chooseNextMove
// ═══════════════════════════════════════════════════════════════════════════

export async function agentChooseNextMove(
  state: WorkingState,
  toolCtx: ToolContext,
  config: AgentConfig,
): Promise<AgentDecision> {
  // Use rules decider for system-question phase (free, instant, no judgment needed)
  const askedIds = new Set(state.openQuestions.map((q) => q.action.id));
  const unansweredSystem = SYSTEM_ACTIONS.filter((a) => !askedIds.has(a.id));
  if (unansweredSystem.length > 0) {
    // Still exhausting free system questions — no LLM needed
    const rulesMove = chooseNextMove(state, toolCtx.boardLoad);
    const basePrior = computeBasePrior(toolCtx.events);
    return {
      move: rulesMove,
      pReal: basePrior,
      reportedPReal: basePrior,
      basePrior,
      priorAdjustmentLogOdds: 0,
      adjustmentReasons: ["system-question phase — rules decider"],
      noveltyFlag: false,
      whatWouldChangeMyMind: "N/A (system question)",
      llmCalls: 0,
      llmCostUsd: 0,
      llmLatencyMs: 0,
      toolCallsUsed: [],
      inputTokens: 0,
      outputTokens: 0,
      modelId: "",
      modelTier: "none",
      modelTierReason: "system-question phase — no LLM needed",
      cacheHit: false,
      toolCallResults: [],
    };
  }

  // Check for pending human questions — defer (rules handles this)
  const pendingHuman = state.openQuestions.filter(
    (q) => q.action.category === "human_question" && q.answer === null
  );
  if (pendingHuman.length > 0) {
    const rulesMove = chooseNextMove(state, toolCtx.boardLoad);
    const basePrior = computeBasePrior(toolCtx.events);
    return {
      move: rulesMove,
      pReal: basePrior,
      reportedPReal: basePrior,
      basePrior,
      priorAdjustmentLogOdds: 0,
      adjustmentReasons: ["waiting for human response — defer"],
      noveltyFlag: false,
      whatWouldChangeMyMind: "N/A (waiting)",
      llmCalls: 0,
      llmCostUsd: 0,
      llmLatencyMs: 0,
      toolCallsUsed: [],
      inputTokens: 0,
      outputTokens: 0,
      modelId: "",
      modelTier: "none",
      modelTierReason: "waiting for human response — no LLM needed",
      cacheHit: false,
      toolCallResults: [],
    };
  }

  // Decision point: system questions exhausted, no pending human questions.
  // Now the agent decides: ask a human question, commit, or defer.
  const allTools = [...AGENT_TOOLS, DECIDE_TOOL];
  const basePrior = computeBasePrior(toolCtx.events);
  const routing = shouldUseStrongModel(state.evidenceLevel, basePrior, config);
  const model = routing.useStrong ? config.strongModel : config.fastModel;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Incident ${state.incidentId}: Evidence level E${state.evidenceLevel}. ` +
        `Base P(real) from priors: ${basePrior.toFixed(3)}. ` +
        `Board load: ${toolCtx.boardLoad} items/10min (threshold: ${FLOOD_THRESHOLD}). ` +
        `Hypothesis: "${state.hypothesis}". ` +
        `${state.openQuestions.length} questions asked (${state.openQuestions.filter(q => q.answer !== null).length} answered). ` +
        `${state.evidenceGathered.length} evidence items. What is your next move?`,
    },
  ];

  let llmCalls = 0;
  let llmCostUsd = 0;
  let llmLatencyMs = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let anyCacheHit = true; // starts true, set false if any miss
  const toolCallsUsed: string[] = [];
  const toolCallResults: Array<{ name: string; arguments: Record<string, unknown>; result: string }> = [];
  let lastResponseText: string | null = null;
  let lastResponseToolCalls: Array<{ name: string; arguments: string }> = [];
  const MAX_TOOL_ROUNDS = 8;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const cacheParams = {
      policyVersion: config.policyVersion,
      model,
      messages,
      tools: allTools,
    };

    let response: LLMResponse;
    let wasCacheHit = false;
    if (isDemoMode()) {
      response = assertCacheHit(cacheParams);
      wasCacheHit = true;
    } else {
      const cached = getCachedTrace(cacheParams);
      if (cached) {
        response = cached;
        wasCacheHit = true;
      } else {
        response = await config.provider.chat({
          model,
          messages,
          tools: allTools,
          temperature: 0,
        });
        setCachedTrace(cacheParams, response);
        wasCacheHit = false;
        anyCacheHit = false;
      }
    }

    llmCalls++;
    llmCostUsd += response.costUsd;
    llmLatencyMs += response.latencyMs;
    totalInputTokens += response.usage.promptTokens;
    totalOutputTokens += response.usage.completionTokens;
    lastResponseText = response.text;
    lastResponseToolCalls = response.toolCalls.map((tc) => ({
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    if (response.toolCalls.length === 0) {
      return makeDefaultDecision(state, basePrior, llmCalls, llmCostUsd, llmLatencyMs, toolCallsUsed, "model returned text without tool call", {
        inputTokens: totalInputTokens, outputTokens: totalOutputTokens, modelId: model,
        modelTier: (routing.useStrong ? "strong" : "fast") as "fast" | "strong",
        modelTierReason: routing.reason, cacheHit: anyCacheHit, toolCallResults,
      });
    }

    for (const tc of response.toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // Attempt to use the raw string as a fallback
        args = {};
      }
      toolCallsUsed.push(tc.function.name);

      const validatedArgs = validateToolArgs(tc.function.name, args);
      if (validatedArgs.error) {
        messages.push({ role: "assistant", content: "", tool_calls: [tc] });
        messages.push({ role: "tool", content: JSON.stringify({ error: validatedArgs.error }), tool_call_id: tc.id });
        continue;
      }

      if (tc.function.name === "make_decision") {
        const engineerData = {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          modelId: model,
          modelTier: (routing.useStrong ? "strong" : "fast") as "fast" | "strong",
          modelTierReason: routing.reason,
          cacheHit: anyCacheHit,
          toolCallResults,
          promptMessages: messages.filter((m) => m.role === "system" || m.role === "user").map((m) => ({ role: m.role, content: m.content })),
          rawResponseText: lastResponseText,
          rawToolCalls: lastResponseToolCalls,
        };
        return parseAgentDecision(validatedArgs.args!, state, basePrior, toolCtx.boardLoad, llmCalls, llmCostUsd, llmLatencyMs, toolCallsUsed, engineerData);
      }

      const result = executeTool(tc.function.name, validatedArgs.args!, toolCtx);
      toolCallResults.push({ name: tc.function.name, arguments: validatedArgs.args!, result });
      messages.push({ role: "assistant", content: "", tool_calls: [tc] });
      messages.push({ role: "tool", content: result, tool_call_id: tc.id });
    }
  }

  return makeDefaultDecision(state, basePrior, llmCalls, llmCostUsd, llmLatencyMs, toolCallsUsed, "exceeded max tool rounds", {
    inputTokens: totalInputTokens, outputTokens: totalOutputTokens, modelId: model,
    modelTier: (routing.useStrong ? "strong" : "fast") as "fast" | "strong",
    modelTierReason: routing.reason, cacheHit: anyCacheHit, toolCallResults,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Validate tool arguments
// ═══════════════════════════════════════════════════════════════════════════

function validateToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): { args: Record<string, unknown> | null; error: string | null } {
  const allToolDefs = [...AGENT_TOOLS, DECIDE_TOOL];
  const schema = allToolDefs.find((t) => t.function.name === toolName);
  if (!schema) return { args: null, error: `Unknown tool: ${toolName}` };

  const params = schema.function.parameters as { properties?: Record<string, unknown>; required?: string[] };
  const validKeys = new Set(Object.keys(params.properties ?? {}));

  for (const key of Object.keys(args)) {
    if (!validKeys.has(key)) {
      return { args: null, error: `Out-of-schema parameter "${key}" for tool ${toolName}. Valid: ${[...validKeys].join(", ")}` };
    }
  }

  for (const req of params.required ?? []) {
    if (!(req in args)) {
      return { args: null, error: `Missing required parameter "${req}" for tool ${toolName}` };
    }
  }

  if (toolName === "make_decision" && typeof args.prior_adjustment_log_odds === "number") {
    args.prior_adjustment_log_odds = Math.max(-2, Math.min(2, args.prior_adjustment_log_odds));
  }

  return { args, error: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// Parse the structured decision — F1.5.2: pReal from prior + adjustment
// ═══════════════════════════════════════════════════════════════════════════

interface EngineerData {
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  modelTier: "fast" | "strong";
  modelTierReason: string;
  cacheHit: boolean;
  toolCallResults: Array<{ name: string; arguments: Record<string, unknown>; result: string }>;
  promptMessages?: Array<{ role: string; content: string }>;
  rawResponseText?: string | null;
  rawToolCalls?: Array<{ name: string; arguments: string }>;
}

function parseAgentDecision(
  args: Record<string, unknown>,
  state: WorkingState,
  basePrior: number,
  boardLoad: number,
  llmCalls: number,
  llmCostUsd: number,
  llmLatencyMs: number,
  toolCallsUsed: string[],
  engineerData: EngineerData,
): AgentDecision {
  const chosenMove = args.chosen_move as string;
  const actionId = args.action_id as string;
  const priorAdj = (args.prior_adjustment_log_odds as number) ?? 0;
  const reportedPReal = (args.confidence_p_real as number) ?? 0.5;

  // F1.5.2: pReal = sigmoid(logit(basePrior) + clamp(adjustment, ±2))
  // The model's confidence_p_real is DEMOTED to a reported belief.
  const pReal = computeCalibratedPReal(basePrior, priorAdj);

  let move: Move;

  switch (chosenMove) {
    case "investigate": {
      const action = [...SYSTEM_ACTIONS, ...HUMAN_ACTIONS].find((a) => a.id === actionId);
      if (!action) {
        return makeDefaultDecision(state, basePrior, llmCalls, llmCostUsd, llmLatencyMs, toolCallsUsed, `unknown investigate action: ${actionId}`, engineerData);
      }
      move = { type: "investigate", action };
      break;
    }
    case "commit": {
      // Evidence level from calibrated pReal, not from model's free-handed number
      const evidenceFromPReal = pRealToEvidenceLevel(pReal, state.evidenceLevel);

      // Flood-aware: if board is flooded and evidence is low, suppress
      if (boardLoad >= FLOOD_THRESHOLD && evidenceFromPReal <= 1) {
        const suppress = RESPONSE_ACTIONS.find((a) => a.id === "suppress")!;
        move = { type: "commit", level: 0, action: suppress };
      } else {
        const responseAction = evidenceLevelToResponse(evidenceFromPReal);
        move = { type: "commit", level: evidenceFromPReal, action: responseAction };
      }
      break;
    }
    case "defer": {
      const deferAction = DEFER_ACTIONS.find((a) => a.id === actionId) ?? DEFER_ACTIONS[0];
      move = { type: "defer", action: deferAction, recheckAt: Date.now() + 300_000 };
      break;
    }
    default:
      return makeDefaultDecision(state, basePrior, llmCalls, llmCostUsd, llmLatencyMs, toolCallsUsed, `unknown move type: ${chosenMove}`, engineerData);
  }

  return {
    move,
    pReal,
    reportedPReal,
    basePrior,
    priorAdjustmentLogOdds: priorAdj,
    adjustmentReasons: (args.adjustment_reasons as string[]) ?? [],
    noveltyFlag: (args.novelty_flag as boolean) ?? false,
    whatWouldChangeMyMind: (args.what_would_change_my_mind as string) ?? "",
    llmCalls,
    llmCostUsd,
    llmLatencyMs,
    toolCallsUsed,
    inputTokens: engineerData.inputTokens,
    outputTokens: engineerData.outputTokens,
    modelId: engineerData.modelId,
    modelTier: engineerData.modelTier,
    modelTierReason: engineerData.modelTierReason,
    cacheHit: engineerData.cacheHit,
    promptMessages: engineerData.promptMessages,
    rawResponseText: engineerData.rawResponseText,
    rawToolCalls: engineerData.rawToolCalls,
    toolCallResults: engineerData.toolCallResults,
  };
}

function pRealToEvidenceLevel(pReal: number, currentEvidence: EvidenceLevel): EvidenceLevel {
  if (pReal >= 0.85) return Math.max(currentEvidence, 3) as EvidenceLevel;
  if (pReal >= 0.60) return Math.max(currentEvidence, 2) as EvidenceLevel;
  if (pReal >= 0.30) return Math.max(currentEvidence, 1) as EvidenceLevel;
  if (pReal < 0.15 && currentEvidence <= 1) return 0;
  return currentEvidence;
}

function makeDefaultDecision(
  state: WorkingState,
  basePrior: number,
  llmCalls: number,
  llmCostUsd: number,
  llmLatencyMs: number,
  toolCallsUsed: string[],
  reason: string,
  engineerData?: Partial<EngineerData>,
): AgentDecision {
  const responseAction = evidenceLevelToResponse(state.evidenceLevel);
  return {
    move: { type: "commit", level: state.evidenceLevel, action: responseAction },
    pReal: basePrior,
    reportedPReal: 0.5,
    basePrior,
    priorAdjustmentLogOdds: 0,
    adjustmentReasons: [`fallback: ${reason}`],
    noveltyFlag: false,
    whatWouldChangeMyMind: "N/A (fallback decision)",
    llmCalls,
    llmCostUsd,
    llmLatencyMs,
    toolCallsUsed,
    inputTokens: engineerData?.inputTokens ?? 0,
    outputTokens: engineerData?.outputTokens ?? 0,
    modelId: engineerData?.modelId ?? "",
    modelTier: engineerData?.modelTier ?? "none",
    modelTierReason: engineerData?.modelTierReason ?? `fallback: ${reason}`,
    cacheHit: engineerData?.cacheHit ?? false,
    toolCallResults: engineerData?.toolCallResults ?? [],
  };
}
