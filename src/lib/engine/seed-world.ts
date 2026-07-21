import seedrandom from "seedrandom";
import { siteRepo, guardRepo, robotRepo, shiftRepo } from "../db/repository";
import { initSchema, resetDb } from "../db/connection";
import crypto from "crypto";

// Deterministic ID generation
function makeId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

// Deterministic pick from array
function pick<T>(rng: seedrandom.PRNG, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN<T>(rng: seedrandom.PRNG, arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

// --- Site data ---
const SITE_NAMES = [
  "Downtown Tower",
  "Marina District HQ",
  "Brickell Financial Center",
  "Wynwood Arts Complex",
  "Coconut Grove Mall",
  "Coral Gables Office Park",
  "Doral Industrial Hub",
  "Edgewater Condos",
  "Key Biscayne Resort",
  "Little Havana Warehouse",
  "Midtown Retail Plaza",
  "Overtown Community Center",
];

const ZONE_TEMPLATES = [
  { name: "Main Entrance", exposure: 5 },
  { name: "Loading Dock", exposure: 3 },
  { name: "Parking Garage", exposure: 4 },
  { name: "Lobby", exposure: 2 },
  { name: "Server Room", exposure: 5 },
  { name: "Rooftop", exposure: 3 },
  { name: "Perimeter Fence", exposure: 4 },
  { name: "Stairwell", exposure: 2 },
  { name: "Back Entrance", exposure: 4 },
  { name: "Storage Area", exposure: 3 },
];

const GUARD_FIRST_NAMES = [
  "Carlos", "Maria", "James", "Ana", "Marcus", "Sofia", "David",
  "Elena", "Andre", "Rosa", "Michael", "Lucia", "Robert", "Carmen",
  "Diego", "Isabel", "Chris", "Patricia", "Omar", "Valentina",
  "Jamal", "Ashley", "Tyler", "Brianna", "DeShawn", "Keisha",
  "Antonio", "Yesenia", "Kevin", "Natalia",
];

const GUARD_LAST_NAMES = [
  "Rodriguez", "Smith", "Martinez", "Johnson", "Garcia", "Williams",
  "Lopez", "Brown", "Davis", "Hernandez", "Wilson", "Moore",
  "Taylor", "Thomas", "Jackson", "White", "Harris", "Martin",
  "Clark", "Lewis",
];

const SKILLS = ["patrol", "access-control", "fire-safety", "first-aid", "K9", "surveillance", "crowd-control"];
const LANGUAGES = ["en", "es", "pt", "ht"];
const SENSOR_TYPES = ["motion", "thermal", "lidar", "camera", "audio"];

const ROBOT_NAMES = [
  "Sentinel-A1", "Watchdog-B2", "Patrol-C3", "Rover-D4",
  "Scanner-E5", "Guardian-F6", "Recon-G7", "Beacon-H8",
];

export interface SeedConfig {
  seed: number;
  nightStartHour?: number; // default 20 (8pm)
  nightEndHour?: number;   // default 6 (6am)
}

export async function seedWorld(config: SeedConfig) {
  const { seed, nightStartHour = 20, nightEndHour = 6 } = config;
  const rng = seedrandom(String(seed));
  // Deterministic timestamp — seed day at midnight UTC
  const now = new Date("2026-01-01T00:00:00Z").getTime() + seed;

  await resetDb();
  await initSchema();

  // --- Generate sites (12) ---
  const siteRows: Parameters<typeof siteRepo.insertMany>[0] = [];
  for (let i = 0; i < 12; i++) {
    const numZones = 3 + Math.floor(rng() * 4); // 3-6 zones per site
    const zones = pickN(rng, ZONE_TEMPLATES, numZones).map((z, zi) => ({
      id: `zone-${i}-${zi}`,
      name: z.name,
      exposure: z.exposure,
      geofence: {
        lat: 25.76 + (rng() - 0.5) * 0.1,
        lng: -80.19 + (rng() - 0.5) * 0.1,
        radiusM: 50 + Math.floor(rng() * 200),
      },
    }));

    siteRows.push({
      id: makeId("site", i),
      name: SITE_NAMES[i],
      address: `${100 + Math.floor(rng() * 900)} ${pick(rng, ["NW", "NE", "SW", "SE"])} ${Math.floor(rng() * 200) + 1}${pick(rng, ["st", "nd", "rd", "th"])} St, Miami, FL`,
      criticalityTier: 1 + Math.floor(rng() * 5), // 1-5
      quietHoursStart: nightStartHour + Math.floor(rng() * 3), // 20-22
      quietHoursEnd: nightEndHour + Math.floor(rng() * 2), // 6-7
      clientContactName: `${pick(rng, GUARD_FIRST_NAMES)} ${pick(rng, GUARD_LAST_NAMES)}`,
      clientContactPhone: `305-${String(Math.floor(rng() * 900) + 100)}-${String(Math.floor(rng() * 9000) + 1000)}`,
      zonesJson: JSON.stringify(zones),
      createdAt: now,
    });
  }
  await siteRepo.insertMany(siteRows);

  // --- Generate guards (30) — distributed across sites ---
  const guardRows: Parameters<typeof guardRepo.insertMany>[0] = [];
  for (let i = 0; i < 30; i++) {
    const siteIndex = i % 12; // round-robin, then extras
    const shiftStart = pick(rng, [6, 14, 22]); // 3 shifts
    const shiftEnd = (shiftStart + 8) % 24;

    guardRows.push({
      id: makeId("guard", i),
      name: `${GUARD_FIRST_NAMES[i]} ${pick(rng, GUARD_LAST_NAMES)}`,
      skillsJson: JSON.stringify(pickN(rng, SKILLS, 2 + Math.floor(rng() * 3))),
      armed: rng() > 0.7,
      languagesJson: JSON.stringify(pickN(rng, LANGUAGES, 1 + Math.floor(rng() * 2))),
      shiftStart,
      shiftEnd,
      siteId: makeId("site", siteIndex),
      reliabilityAckRate: 0.7 + rng() * 0.3, // 0.7-1.0
      reliabilityAvgResponse: 120 + rng() * 480, // 2-10 min in seconds
      createdAt: now,
    });
  }
  await guardRepo.insertMany(guardRows);

  // --- Generate robots (8) — assigned to high-criticality sites ---
  const sortedSites = [...siteRows].sort((a, b) => b.criticalityTier - a.criticalityTier);
  const robotRows: Parameters<typeof robotRepo.insertMany>[0] = [];
  for (let i = 0; i < 8; i++) {
    const site = sortedSites[i % sortedSites.length];
    const zones = JSON.parse(site.zonesJson) as { id: string }[];
    const routeZones = pickN(rng, zones.map((z) => z.id), Math.min(zones.length, 3));

    robotRows.push({
      id: makeId("robot", i),
      name: ROBOT_NAMES[i],
      siteId: site.id,
      patrolRouteJson: JSON.stringify(routeZones),
      sensorsJson: JSON.stringify(pickN(rng, SENSOR_TYPES, 2 + Math.floor(rng() * 3))),
      falsePositiveRate: 0.05 + rng() * 0.25, // 5-30%
      batteryLevel: 0.8 + rng() * 0.2,
      createdAt: now,
    });
  }
  await robotRepo.insertMany(robotRows);

  // --- Generate 24h shift schedule ---
  // Night sim: 20:00 to 06:00 next day
  // Base timestamp: midnight of sim day
  const baseTs = 0; // sim clock starts at 0, represents nightStartHour
  const shiftRows: Parameters<typeof shiftRepo.insertMany>[0] = [];

  for (const guard of guardRows) {
    // Convert shift hours to sim-clock ms
    // Sim clock 0 = nightStartHour. If guard starts at 22 and night starts at 20, that's +2h
    let startOffset = ((guard.shiftStart - nightStartHour + 24) % 24) * 3600 * 1000;
    let endOffset = ((guard.shiftEnd - nightStartHour + 24) % 24) * 3600 * 1000;
    if (endOffset <= startOffset) endOffset += 24 * 3600 * 1000;

    // Only include shifts that overlap with the night window (0 to 10h)
    const nightDuration = ((nightEndHour - nightStartHour + 24) % 24) * 3600 * 1000;
    if (startOffset < nightDuration || endOffset > 0) {
      shiftRows.push({
        id: `shift-${guard.id}`,
        guardId: guard.id,
        siteId: guard.siteId!,
        startTime: startOffset,
        endTime: endOffset,
        status: "scheduled",
      });
    }
  }
  await shiftRepo.insertMany(shiftRows);

  return {
    sites: siteRows.length,
    guards: guardRows.length,
    robots: robotRows.length,
    shifts: shiftRows.length,
  };
}

/** Compute a hash of all data for determinism verification */
export async function computeWorldHash(): Promise<string> {
  const sites = await siteRepo.getAll();
  const guards = await guardRepo.getAll();
  const robots = await robotRepo.getAll();
  const shifts = await shiftRepo.getAll();

  const data = JSON.stringify({ sites, guards, robots, shifts });
  return crypto.createHash("sha256").update(data).digest("hex");
}
