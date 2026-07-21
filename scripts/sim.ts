import { seedWorld } from "../src/lib/engine/seed-world";
import { siteRepo, guardRepo, robotRepo } from "../src/lib/db/repository";
import {
  generateEventStream,
  getScenarioEvents,
  computeEventStreamHash,
  SCENARIOS,
} from "../src/lib/engine/scenarios";

async function main() {
  const seed = Number(process.argv[2]) || 42;

  console.log(`Generating event stream with seed=${seed}...`);
  await seedWorld({ seed });

  const sites = await siteRepo.getAll();
  const guards = await guardRepo.getAll();
  const robots = await robotRepo.getAll();

  const events = generateEventStream({ seed, sites, guards, robots });
  const hash = computeEventStreamHash(events);

  console.log(`Generated ${events.length} events`);
  console.log(`Event stream hash: ${hash}`);
  console.log();

  for (const name of Object.keys(SCENARIOS)) {
    const scenarioEvents = getScenarioEvents(events, name);
    console.log(`  ${name}: ${scenarioEvents.length} events`);
  }

  const backgroundCount = events.filter((e) => !e.scenarioId).length;
  console.log(`  background_noise: ${backgroundCount} events`);
}

main().catch((e) => { console.error(e); process.exit(1); });
