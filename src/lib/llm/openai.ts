import type { LLMProvider, ChatMessage, ToolSchema, LLMResponse, ToolCall } from "./provider";
import { addRunCost } from "./provider";

const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4.1": { input: 2.00, output: 8.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] ?? PRICING["gpt-4o-mini"];
  return (promptTokens * p.input + completionTokens * p.output) / 1_000_000;
}

export function createOpenAIProvider(): LLMProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  return {
    name: "openai",
    async chat({ model, messages, tools, temperature = 0 }): Promise<LLMResponse> {
      const start = Date.now();

      const body: Record<string, unknown> = { model, messages, temperature };
      if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
      }

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${text}`);
      }

      const data = await res.json();
      const latencyMs = Date.now() - start;
      const choice = data.choices?.[0];
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));

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
