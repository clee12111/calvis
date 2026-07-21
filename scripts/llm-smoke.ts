/**
 * LLM provider smoke test.
 * Sends one message with one tool, verifies tool call round-trips.
 * Usage: LLM_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-... npx tsx scripts/llm-smoke.ts
 */
import { createProvider, resetRunCost, getRunCost } from "../src/lib/llm";
import type { ToolSchema } from "../src/lib/llm";

const testTool: ToolSchema = {
  type: "function",
  function: {
    name: "classify_incident",
    description: "Classify a security incident by evidence level (0-4).",
    parameters: {
      type: "object",
      properties: {
        evidence_level: {
          type: "number",
          description: "Evidence level 0-4 per AVS-01",
        },
        reasoning: {
          type: "string",
          description: "Brief explanation",
        },
      },
      required: ["evidence_level", "reasoning"],
      additionalProperties: false,
    },
  },
};

async function main() {
  const providerName = process.env.LLM_PROVIDER ?? "deepseek";
  console.log(`Provider: ${providerName}`);

  let provider;
  try {
    provider = createProvider(providerName);
  } catch (err: any) {
    console.log(`SKIPPED: ${err.message}`);
    process.exit(0);
  }

  const model = process.env.AGENT_MODEL_FAST ?? "deepseek-v4-flash";
  console.log(`Model: ${model}`);

  resetRunCost();

  const response = await provider.chat({
    model,
    messages: [
      {
        role: "system",
        content: "You are a security dispatch assistant. Use the classify_incident tool to respond.",
      },
      {
        role: "user",
        content: "Motion anomaly detected at loading dock, followed by a forced entry on the roll-up door. Classify this incident.",
      },
    ],
    tools: [testTool],
    temperature: 0,
  });

  console.log(`\nResponse:`);
  console.log(`  Text: ${response.text ?? "(none)"}`);
  console.log(`  Tool calls: ${response.toolCalls.length}`);
  for (const tc of response.toolCalls) {
    console.log(`    ${tc.function.name}(${tc.function.arguments})`);
    // Validate arguments parse as JSON with expected fields
    const args = JSON.parse(tc.function.arguments);
    if (typeof args.evidence_level !== "number") {
      throw new Error(`Expected evidence_level to be a number, got ${typeof args.evidence_level}`);
    }
    console.log(`    ✓ evidence_level=${args.evidence_level}, reasoning="${args.reasoning}"`);
  }
  console.log(`  Tokens: ${response.usage.totalTokens} (${response.usage.promptTokens}+${response.usage.completionTokens})`);
  console.log(`  Latency: ${response.latencyMs}ms`);
  console.log(`  Cost: $${response.costUsd.toFixed(6)}`);
  console.log(`  Run total: $${getRunCost().toFixed(6)}`);

  if (response.toolCalls.length === 0) {
    console.log("\n⚠️  No tool calls returned — the model may not support tool calling with this prompt.");
  } else {
    console.log("\n✓ Smoke test PASSED.");
  }
}

main().catch((err) => {
  console.error("Smoke test FAILED:", err.message);
  process.exit(1);
});
