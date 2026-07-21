import type { LLMProvider, ChatMessage, ToolSchema, LLMResponse, ToolCall } from "./provider";
import { addRunCost } from "./provider";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-4-6"];
  return (promptTokens * p.input + completionTokens * p.output) / 1_000_000;
}

export function createAnthropicProvider(): LLMProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  return {
    name: "anthropic",
    async chat({ model, messages, tools, temperature = 0 }): Promise<LLMResponse> {
      const start = Date.now();

      // Convert OpenAI-style messages to Anthropic format
      const systemMsg = messages.find((m) => m.role === "system");
      const nonSystem = messages.filter((m) => m.role !== "system");

      const anthropicTools = tools?.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));

      const body: Record<string, unknown> = {
        model,
        max_tokens: 4096,
        messages: nonSystem.map((m) => ({
          role: m.role === "tool" ? "user" : m.role,
          content: m.role === "tool"
            ? [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }]
            : m.content,
        })),
        temperature,
      };
      if (systemMsg) body.system = systemMsg.content;
      if (anthropicTools?.length) body.tools = anthropicTools;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${text}`);
      }

      const data = await res.json();
      const latencyMs = Date.now() - start;
      const usage = data.usage ?? { input_tokens: 0, output_tokens: 0 };

      // Extract tool calls from Anthropic content blocks
      const toolCalls: ToolCall[] = (data.content ?? [])
        .filter((b: any) => b.type === "tool_use")
        .map((b: any) => ({
          id: b.id,
          type: "function" as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));

      const text = (data.content ?? [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");

      const costUsd = estimateCost(model, usage.input_tokens, usage.output_tokens);
      addRunCost(costUsd);

      return {
        text: text || null,
        toolCalls,
        usage: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
        },
        latencyMs,
        model,
        costUsd,
      };
    },
  };
}
