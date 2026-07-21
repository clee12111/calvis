import type { LLMProvider } from "./provider";

export type { LLMProvider, LLMResponse, ChatMessage, ToolSchema, ToolCall, RoutingConfig } from "./provider";
export { resetRunCost, addRunCost, getRunCost } from "./provider";

export function createProvider(name?: string): LLMProvider {
  const providerName = name ?? process.env.LLM_PROVIDER ?? "deepseek";

  switch (providerName) {
    case "deepseek": {
      const { createDeepSeekProvider } = require("./deepseek");
      return createDeepSeekProvider();
    }
    case "openai": {
      const { createOpenAIProvider } = require("./openai");
      return createOpenAIProvider();
    }
    case "anthropic": {
      const { createAnthropicProvider } = require("./anthropic");
      return createAnthropicProvider();
    }
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${providerName}. Valid: deepseek, openai, anthropic`);
  }
}

export function getRoutingConfig(): {
  fastModel: string;
  strongModel: string;
  escalateBandLow: number;
  escalateBandHigh: number;
  maxUsdPerRun: number;
} {
  return {
    fastModel: process.env.AGENT_MODEL_FAST ?? "deepseek-v4-flash",
    strongModel: process.env.AGENT_MODEL_STRONG ?? "deepseek-v4-pro",
    escalateBandLow: Number(process.env.AGENT_ESCALATE_BAND_LOW ?? "0.35"),
    escalateBandHigh: Number(process.env.AGENT_ESCALATE_BAND_HIGH ?? "0.70"),
    maxUsdPerRun: Number(process.env.AGENT_MAX_USD_PER_RUN ?? "2.00"),
  };
}
