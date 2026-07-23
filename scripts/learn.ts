/**
 * F2.3 — Learning curve: train on 30 nights, evaluate on 10 holdout.
 *
 * Usage: npx tsx scripts/learn.ts
 *
 * No LLM required — uses scripted-interrogation + learned priors.
 * Tests whether Beta prior updates improve cost over fixed priors.
 */
import { initSchema } from "../src/lib/db/connection";
import { runArm } from "../src/lib/eval/runner";
import { resetLearnedPriorStore, getLearnedPriorStore } from "../src/lib/loop/learned-priors";
import { resetEpisodicMemory, getEpisodicMemory } from "../src/lib/loop/episodic-memory";
import type { AllMetrics } from "../src/lib/eval/metrics";

const TRAIN_SEEDS = Array.from({ length: 30 }, (_, i) => 100 + i);
const HOLDOUT_SEEDS = Array.from({ length: 10 }, (_, i) => 130 + i);

interface NightResult {
  night: number;
  seed: number;
  totalCost: number;
  missCount: number;
  overResp: number;
  brier: number;
}

function meanOf(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

async function evalHoldout(arm: string, seeds: number[]): Promise<AllMetrics[]> {
  const results: AllMetrics[] = [];
  for (const seed of seeds) {
    await initSchema();
    const r = await runArm(arm, seed);
    results.push(r.metrics);
  }
  return results;
}

function fmt(n: number, decimals = 0): string {
  return n.toFixed(decimals);
}

async function main() {
  console.log("F2.3 — Learning Curve");
  console.log("=".repeat(80));
  console.log(`Train: ${TRAIN_SEEDS.length} nights | Holdout: ${HOLDOUT_SEEDS.length} nights`);
  console.log();

  // === CHECKPOINT 0: before any training ===
  console.log("Checkpoint 0: evaluating holdout BEFORE training...");
  resetLearnedPriorStore();
  resetEpisodicMemory();
  const holdout0_mem = await evalHoldout("agent-with-memory", HOLDOUT_SEEDS);
  const h0_cost = meanOf(holdout0_mem.map((m) => m.cost.totalCostUsd));
  const h0_miss = meanOf(holdout0_mem.map((m) => m.cost.missCount));
  const h0_over = meanOf(holdout0_mem.map((m) => m.cost.overResponseCount));
  const h0_brier = meanOf(holdout0_mem.map((m) => m.brierScore));
  console.log(`  Holdout cost: $${fmt(h0_cost)} | miss: ${fmt(h0_miss, 1)} | over: ${fmt(h0_over, 1)} | Brier: ${fmt(h0_brier, 3)}`);

  // Reset again before training
  resetLearnedPriorStore();
  resetEpisodicMemory();

  // Also evaluate scripted-interrogation (fixed policy, no memory) on holdout for comparison
  console.log("Evaluating scripted-interrogation baseline on holdout...");
  const holdout_script = await evalHoldout("scripted-interrogation", HOLDOUT_SEEDS);
  const hs_cost = meanOf(holdout_script.map((m) => m.cost.totalCostUsd));
  const hs_miss = meanOf(holdout_script.map((m) => m.cost.missCount));
  console.log(`  Scripted baseline: $${fmt(hs_cost)} | miss: ${fmt(hs_miss, 1)}`);

  // Reset again before training
  resetLearnedPriorStore();
  resetEpisodicMemory();

  // === TRAINING LOOP ===
  const curve: NightResult[] = [];
  console.log("\nTraining...");
  for (let i = 0; i < TRAIN_SEEDS.length; i++) {
    const seed = TRAIN_SEEDS[i];
    await initSchema();
    const r = await runArm("agent-with-memory", seed);
    curve.push({
      night: i + 1,
      seed,
      totalCost: r.metrics.cost.totalCostUsd,
      missCount: r.metrics.cost.missCount,
      overResp: r.metrics.cost.overResponseCount,
      brier: r.metrics.brierScore,
    });
    const store = getLearnedPriorStore();
    const mem = getEpisodicMemory();
    const topMoved = store.getTopMovedPriors(1);
    const topStr = topMoved.length > 0
      ? `top move: ${topMoved[0].key} ${(topMoved[0].startPReal * 100).toFixed(0)}%→${(topMoved[0].pReal * 100).toFixed(0)}% (n=${topMoved[0].n})`
      : "";
    console.log(`  Night ${String(i + 1).padStart(2)}: $${fmt(r.metrics.cost.totalCostUsd).padStart(6)} | miss=${r.metrics.cost.missCount} over=${r.metrics.cost.overResponseCount} | memory=${mem.size} ${topStr}`);

    // === CHECKPOINT 10 ===
    if (i + 1 === 10) {
      console.log("\n  Checkpoint 10: evaluating holdout...");
      const holdout10 = await evalHoldout("agent-with-memory", HOLDOUT_SEEDS);
      const h10_cost = meanOf(holdout10.map((m) => m.cost.totalCostUsd));
      const h10_miss = meanOf(holdout10.map((m) => m.cost.missCount));
      const h10_brier = meanOf(holdout10.map((m) => m.brierScore));
      console.log(`  Holdout after 10: $${fmt(h10_cost)} | miss: ${fmt(h10_miss, 1)} | Brier: ${fmt(h10_brier, 3)}`);
      console.log();
    }
  }

  // === CHECKPOINT 30: after all training ===
  console.log("\nCheckpoint 30: evaluating holdout AFTER all training...");
  const holdout30 = await evalHoldout("agent-with-memory", HOLDOUT_SEEDS);
  const h30_cost = meanOf(holdout30.map((m) => m.cost.totalCostUsd));
  const h30_miss = meanOf(holdout30.map((m) => m.cost.missCount));
  const h30_over = meanOf(holdout30.map((m) => m.cost.overResponseCount));
  const h30_brier = meanOf(holdout30.map((m) => m.brierScore));

  // === RESULTS ===
  console.log("\n");
  console.log("=".repeat(80));
  console.log("TRAINING CURVE (per-night cost)");
  console.log("=".repeat(80));
  console.log(`${"Night".padEnd(6)} ${"Cost".padStart(8)} ${"Miss".padStart(6)} ${"Over".padStart(6)} ${"Brier".padStart(8)}`);
  console.log("-".repeat(40));
  for (const r of curve) {
    console.log(`${String(r.night).padEnd(6)} ${("$" + fmt(r.totalCost)).padStart(8)} ${String(r.missCount).padStart(6)} ${String(r.overResp).padStart(6)} ${fmt(r.brier, 3).padStart(8)}`);
  }

  console.log("\n");
  console.log("=".repeat(80));
  console.log("HOLDOUT RESULTS");
  console.log("=".repeat(80));
  console.log(`${"Checkpoint".padEnd(14)} ${"Cost".padStart(10)} ${"Miss".padStart(8)} ${"Over".padStart(8)} ${"Brier".padStart(8)}`);
  console.log("-".repeat(50));
  console.log(`${"0 (before)".padEnd(14)} ${("$" + fmt(h0_cost)).padStart(10)} ${fmt(h0_miss, 1).padStart(8)} ${fmt(h0_over, 1).padStart(8)} ${fmt(h0_brier, 3).padStart(8)}`);
  console.log(`${"30 (after)".padEnd(14)} ${("$" + fmt(h30_cost)).padStart(10)} ${fmt(h30_miss, 1).padStart(8)} ${fmt(h30_over, 1).padStart(8)} ${fmt(h30_brier, 3).padStart(8)}`);
  console.log(`${"scripted".padEnd(14)} ${("$" + fmt(hs_cost)).padStart(10)} ${fmt(hs_miss, 1).padStart(8)}`);

  const delta = h30_cost - h0_cost;
  const deltaVsScript = h30_cost - hs_cost;
  console.log("\n");
  console.log("=".repeat(80));
  console.log("VERDICT");
  console.log("=".repeat(80));
  console.log(`Learning delta (30 vs 0):    ${delta >= 0 ? "+" : ""}$${fmt(delta)} (${delta < 0 ? "IMPROVED" : "NO IMPROVEMENT"})`);
  console.log(`vs scripted-interrogation:   ${deltaVsScript >= 0 ? "+" : ""}$${fmt(deltaVsScript)} (${deltaVsScript < 0 ? "BEATS" : "DOES NOT BEAT"} scripted)`);

  // Top learned priors
  const store = getLearnedPriorStore();
  const topPriors = store.getTopMovedPriors(10);
  console.log("\n");
  console.log("=".repeat(80));
  console.log("TOP 10 LEARNED PRIORS");
  console.log("=".repeat(80));
  console.log(`${"Key".padEnd(45)} ${"Start".padStart(7)} ${"Now".padStart(7)} ${"Move".padStart(7)} ${"n".padStart(5)}`);
  console.log("-".repeat(75));
  for (const p of topPriors) {
    const move = ((p.pReal - p.startPReal) >= 0 ? "+" : "") + ((p.pReal - p.startPReal) * 100).toFixed(1) + "%";
    console.log(
      `${p.key.slice(0, 44).padEnd(45)} ${(p.startPReal * 100).toFixed(1).padStart(6)}% ${(p.pReal * 100).toFixed(1).padStart(6)}% ${move.padStart(7)} ${String(p.n).padStart(5)}`
    );
  }

  console.log(`\nEpisodic memory: ${getEpisodicMemory().size} entries across 30 nights.`);
}

main().catch(console.error);
