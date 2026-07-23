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

/**
 * Attempt to repair common JSON malformations from LLMs:
 * - Unquoted string values (model writes prose instead of "prose")
 * - Trailing content after the last valid field
 */
function repairJson(raw: string): string | null {
  // Strategy: find the last field that parsed correctly by progressively
  // removing trailing content. Common pattern: everything up to the last
  // properly-quoted field is valid, then unquoted prose follows.

  // Try truncating at each "}" from the end
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] === "}") {
      const candidate = raw.slice(0, i + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch { /* continue */ }
    }
  }

  // Try wrapping the last value in quotes
  // Pattern: "key": unquoted text}
  const lastColonMatch = raw.match(/^(.*"[^"]+"\s*:\s*)([^"{\[].*)$/s);
  if (lastColonMatch) {
    const prefix = lastColonMatch[1];
    let value = lastColonMatch[2].trim();
    // Remove trailing } if present
    if (value.endsWith("}")) value = value.slice(0, -1).trim();
    // Remove trailing comma
    if (value.endsWith(",")) value = value.slice(0, -1).trim();
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const attempt = prefix + '"' + escaped + '"}';
    try {
      JSON.parse(attempt);
      return attempt;
    } catch { /* fall through */ }
  }

  return null;
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

      // Retry with exponential backoff for transient network errors
      const MAX_RETRIES = 3;
      let lastError: Error | null = null;
      let res: Response | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          res = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          });
          if (res.ok) break;
          const errText = await res.text();
          if (res.status >= 500 || res.status === 429) {
            lastError = new Error(`DeepSeek API error ${res.status}: ${errText}`);
            res = null;
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw new Error(`DeepSeek API error ${res.status}: ${errText}`);
        } catch (err: any) {
          if (err.message?.includes("API error")) throw err;
          lastError = err;
          if (attempt < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      if (!res || !res.ok) {
        throw lastError ?? new Error("DeepSeek API: all retries failed");
      }

      const data = await res.json();
      const latencyMs = Date.now() - start;
      const choice = data.choices?.[0];
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      // Validate tool call arguments against schemas
      const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc: any) => {
        let args = tc.function.arguments;
        // Validate: parse arguments, attempt repair if invalid JSON
        try {
          JSON.parse(args);
        } catch {
          // Common failure: model outputs unquoted string value for the last field.
          // Attempt repair: find the last key with a colon, wrap everything after it in quotes.
          const repaired = repairJson(args);
          if (repaired) {
            args = repaired;
          } else {
            throw new Error(`DeepSeek returned unrepairable JSON in tool call ${tc.function.name}: ${args.slice(0, 200)}`);
          }
        }
        return {
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: args,
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
