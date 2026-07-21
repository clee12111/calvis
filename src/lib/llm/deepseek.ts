import type { LLMProvider, ChatMessage, ToolSchema, LLMResponse, ToolCall } from "./provider";
import { addRunCost } from "./provider";

// DeepSeek pricing (per 1M tokens, July 2026)
const PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-v4-flash": { input: 0.07, output: 0.28 },    // cheap tier
  "deepseek-v4-pro": { input: 0.50, output: 2.00 },      // strong tier
  "deepseek-chat": { input: 0.07, output: 0.28 },         // deprecated alias
  "deepseek-reasoner": { input: 0.50, output: 2.00 },     // deprecated alias
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] ?? PRICING["deepseek-v4-flash"];
  return (promptTokens * p.input + completionTokens * p.output) / 1_000_000;
}

export function createDeepSeekProvider(): LLMProvider {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  return {
    name: "deepseek",
    async chat({ model, messages, tools, temperature = 0 }): Promise<LLMResponse> {
      const start = Date.now();

      const body: Record<string, unknown> = {
        model,
        messages,
        temperature,
      };
      if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
      }

      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`DeepSeek API error ${res.status}: ${text}`);
      }

      const data = await res.json();
      const latencyMs = Date.now() - start;
      const choice = data.choices?.[0];
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      // Validate tool call arguments against schemas
      const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc: any) => {
        // Validate: parse arguments, reject if not valid JSON
        try {
          JSON.parse(tc.function.arguments);
        } catch {
          throw new Error(`DeepSeek returned invalid JSON in tool call ${tc.function.name}: ${tc.function.arguments}`);
        }
        return {
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        };
      });

      const costUsd = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);
      addRunCost(costUsd);

      return {
        text: choice?.message?.content ?? null,
        toolCalls,
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
        latencyMs,
        model,
        costUsd,
      };
    },
  };
}
