import { seedWorld, computeWorldHash } from "../src/lib/engine/seed-world";

async function main() {
  const seed = Number(process.argv[2]) || 42;

  console.log(`Seeding world with seed=${seed}...`);
  const counts = await seedWorld({ seed });
  const hash = await computeWorldHash();

  console.log(`Created: ${counts.sites} sites, ${counts.guards} guards, ${counts.robots} robots, ${counts.shifts} shifts`);
  console.log(`World hash: ${hash}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
