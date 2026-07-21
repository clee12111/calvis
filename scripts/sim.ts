import { seedWorld } from "../src/lib/engine/seed-world";
import { siteRepo, guardRepo, robotRepo } from "../src/lib/db/repository";
import {
  generateEventStream,
  getScenarioEvents,
  computeEventStreamHash,
  SCENARIOS,
} from "../src/lib/engine/scenarios";

const seed = Number(process.argv[2]) || 42;

console.log(`Generating event stream with seed=${seed}...`);
seedWorld({ seed });

const sites = siteRepo.getAll();
const guards = guardRepo.getAll();
const robots = robotRepo.getAll();

const events = generateEventStream({ seed, sites, guards, robots });
const hash = computeEventStreamHash(events);

console.log(`Generated ${events.length} events`);
console.log(`Event stream hash: ${hash}`);
console.log();

// Report per-scenario counts
for (const name of Object.keys(SCENARIOS)) {
  const scenarioEvents = getScenarioEvents(events, name);
  console.log(`  ${name}: ${scenarioEvents.length} events`);
}

const backgroundCount = events.filter((e) => !e.scenarioId).length;
console.log(`  background_noise: ${backgroundCount} events`);
