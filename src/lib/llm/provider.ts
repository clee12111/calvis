/**
 * LLMProvider interface — one type for all model providers.
 * Messages + tool schemas in; tool calls, text, usage, latency out.
 */

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LLMResponse {
  text: string | null;
  toolCalls: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  model: string;
  costUsd: number;
}

export interface LLMProvider {
  name: string;
  /** Send messages + tools, get response */
  chat(params: {
    model: string;
    messages: ChatMessage[];
    tools?: ToolSchema[];
    temperature?: number;
  }): Promise<LLMResponse>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Two-tier routing
// ═══════════════════════════════════════════════════════════════════════════

export interface RoutingConfig {
  provider: LLMProvider;
  fastModel: string;
  strongModel: string;
  escalateBandLow: number;  // escalate when fast confidence < this
  escalateBandHigh: number; // OR > this (ambiguous zone is between)
  maxUsdPerRun: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Cost accounting
// ═══════════════════════════════════════════════════════════════════════════

let _runCostUsd = 0;
let _maxUsdPerRun = Number(process.env.AGENT_MAX_USD_PER_RUN ?? "2.00");

export function resetRunCost(maxUsd?: number) {
  _runCostUsd = 0;
  if (maxUsd !== undefined) _maxUsdPerRun = maxUsd;
}

export function addRunCost(costUsd: number) {
  _runCostUsd += costUsd;
  if (_runCostUsd > _maxUsdPerRun) {
    throw new Error(
      `LLM cost limit exceeded: $${_runCostUsd.toFixed(4)} > $${_maxUsdPerRun.toFixed(2)}. ` +
      `Set AGENT_MAX_USD_PER_RUN to increase.`
    );
  }
}

export function getRunCost(): number {
  return _runCostUsd;
}
