import { seedWorld, computeWorldHash } from "../src/lib/engine/seed-world";

const seed = Number(process.argv[2]) || 42;

console.log(`Seeding world with seed=${seed}...`);
const counts = seedWorld({ seed });
const hash = computeWorldHash();

console.log(`Created: ${counts.sites} sites, ${counts.guards} guards, ${counts.robots} robots, ${counts.shifts} shifts`);
console.log(`World hash: ${hash}`);
