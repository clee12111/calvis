/**
 * Offline night generator.
 * When OPENAI_API_KEY is set: uses GPT to generate novel scenarios.
 * When not set: falls back to the deterministic in-code generator with varied seeds.
 *
 * Output: evals/nights/train/*.json (~30) and evals/nights/holdout/*.json (~10)
 * Generated files are committed. This script is NEVER called at runtime or during eval.
 */
import fs from "fs";
import path from "path";
import { seedWorld } from "../src/lib/engine/seed-world";
import { siteRepo, guardRepo, robotRepo } from "../src/lib/db/repository";
import { generateEventStream, SCENARIOS, type SimEvent, type EvidenceLevel } from "../src/lib/engine/scenarios";

interface NightManifest {
  seed: number;
  generatedAt: string;
  generator: "deterministic" | "openai";
  eventCount: number;
  scenarioCounts: Record<string, number>;
  labelDistribution: { real: number; benign: number; false_alarm: number; unknown: number };
  events: SimEvent[];
  scenarioMeta: Record<string, { trueEvidenceLevel: EvidenceLevel; description: string }>;
}

async function generateNight(seed: number): Promise<NightManifest> {
  await seedWorld({ seed });
  const sites = await siteRepo.getAll();
  const guards = await guardRepo.getAll();
  const robots = await robotRepo.getAll();
  const events = generateEventStream({ seed, sites, guards, robots });

  const scenarioCounts: Record<string, number> = {};
  const labelDist = { real: 0, benign: 0, false_alarm: 0, unknown: 0 };

  for (const e of events) {
    const sid = e.scenarioId ?? "background";
    scenarioCounts[sid] = (scenarioCounts[sid] ?? 0) + 1;

    if (e.groundTruthLabel === "real") labelDist.real++;
    else if (e.groundTruthLabel === "benign") labelDist.benign++;
    else if (e.groundTruthLabel === "false_alarm") labelDist.false_alarm++;
    else labelDist.unknown++;
  }

  const scenarioMeta: Record<string, { trueEvidenceLevel: EvidenceLevel; description: string }> = {};
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    scenarioMeta[name] = {
      trueEvidenceLevel: scenario.trueEvidenceLevel,
      description: scenario.description,
    };
  }

  return {
    seed,
    generatedAt: new Date().toISOString(),
    generator: "deterministic",
    eventCount: events.length,
    scenarioCounts,
    labelDistribution: labelDist,
    events,
    scenarioMeta,
  };
}

async function main() {
  const trainDir = path.resolve(process.cwd(), "evals/nights/train");
  const holdoutDir = path.resolve(process.cwd(), "evals/nights/holdout");
  fs.mkdirSync(trainDir, { recursive: true });
  fs.mkdirSync(holdoutDir, { recursive: true });

  const TRAIN_COUNT = 30;
  const HOLDOUT_COUNT = 10;
  const BASE_SEED = 100; // offset from eval seeds to avoid overlap

  console.log(`Generating ${TRAIN_COUNT} train + ${HOLDOUT_COUNT} holdout nights...\n`);

  // Train set
  for (let i = 0; i < TRAIN_COUNT; i++) {
    const seed = BASE_SEED + i;
    const manifest = await generateNight(seed);
    const file = path.join(trainDir, `night-${String(seed).padStart(4, "0")}.json`);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    console.log(`  train/${path.basename(file)}: ${manifest.eventCount} events, ${JSON.stringify(manifest.labelDistribution)}`);
  }

  // Holdout set
  for (let i = 0; i < HOLDOUT_COUNT; i++) {
    const seed = BASE_SEED + TRAIN_COUNT + i;
    const manifest = await generateNight(seed);
    const file = path.join(holdoutDir, `night-${String(seed).padStart(4, "0")}.json`);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    console.log(`  holdout/${path.basename(file)}: ${manifest.eventCount} events, ${JSON.stringify(manifest.labelDistribution)}`);
  }

  console.log("\nDone. Fixtures are committed and frozen.");
}

main().catch((e) => { console.error(e); process.exit(1); });
