/**
 * Trace cache for DEMO=1 mode.
 * Keyed on: policy version + model + prompt hash + incident hash.
 * DEMO=1 reads only; errors loudly on a cache miss.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { LLMResponse, ChatMessage, ToolSchema } from "./provider";

const CACHE_DIR = path.resolve(process.cwd(), "data", "trace-cache");

function computeKey(params: {
  policyVersion: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
}): string {
  const hash = crypto.createHash("sha256");
  hash.update(params.policyVersion);
  hash.update(params.model);
  hash.update(JSON.stringify(params.messages));
  if (params.tools) hash.update(JSON.stringify(params.tools));
  return hash.digest("hex").slice(0, 24);
}

export function getCachedTrace(params: {
  policyVersion: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
}): LLMResponse | null {
  const key = computeKey(params);
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export function setCachedTrace(params: {
  policyVersion: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
}, response: LLMResponse): void {
  const key = computeKey(params);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(file, JSON.stringify(response, null, 2));
}

/**
 * DEMO=1 guard: error loudly on a cache miss instead of silently calling the network.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO === "1" || !process.env.DEMO;
}

export function assertCacheHit(params: {
  policyVersion: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
}): LLMResponse {
  const cached = getCachedTrace(params);
  if (!cached) {
    const key = computeKey(params);
    throw new Error(
      `DEMO mode: cache miss for trace ${key}. ` +
      `A demo mode that quietly falls through to the network isn't a demo mode. ` +
      `Run with DEMO=0 and the appropriate API key to generate traces, then commit them.`
    );
  }
  return cached;
}
