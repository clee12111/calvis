import seedrandom from "seedrandom";
import type { Site, Guard, Robot } from "../db/schema";

// --- Event types (12 fixed from PROJECT.md §4) ---
export const EVENT_TYPES = [
  "missed_check_in",
  "geofence_exit",
  "panic_button",
  "no_show_at_shift_start",
  "robot_motion_anomaly",
  "robot_thermal_anomaly",
  "robot_offline",
  "plate_read_unknown",
  "door_forced",
  "radio_transcript_flag",
  "client_inbound_message",
  "area_advisory",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// Severity defaults by event type
export const EVENT_SEVERITY: Record<EventType, number> = {
  missed_check_in: 2,
  geofence_exit: 3,
  panic_button: 5,
  no_show_at_shift_start: 3,
  robot_motion_anomaly: 2,
  robot_thermal_anomaly: 3,
  robot_offline: 1,
  plate_read_unknown: 2,
  door_forced: 4,
  radio_transcript_flag: 3,
  client_inbound_message: 2,
  area_advisory: 1,
};

// Related-type graph for correlation
export const RELATED_TYPES: Record<EventType, EventType[]> = {
  missed_check_in: ["no_show_at_shift_start", "geofence_exit"],
  geofence_exit: ["missed_check_in", "panic_button"],
  panic_button: ["geofence_exit", "radio_transcript_flag"],
  no_show_at_shift_start: ["missed_check_in"],
  robot_motion_anomaly: ["robot_thermal_anomaly", "door_forced", "plate_read_unknown"],
  robot_thermal_anomaly: ["robot_motion_anomaly"],
  robot_offline: [],
  plate_read_unknown: ["robot_motion_anomaly", "door_forced"],
  door_forced: ["robot_motion_anomaly", "plate_read_unknown", "panic_button"],
  radio_transcript_flag: ["panic_button"],
  client_inbound_message: [],
  area_advisory: [],
};

export interface SimEvent {
  id: string;
  type: EventType;
  siteId: string;
  zoneId: string | null;
  sourceType: "robot" | "guard" | "sensor" | "client";
  sourceId: string | null;
  severity: number;
  timestamp: number; // sim clock ms
  rawDataJson: string | null;
  groundTruthLabel: string | null; // "real" | "false_alarm" | "benign" — hidden from agent
  scenarioId: string | null;
}

/**
 * Evidence levels (aligned with ANSI/TMA AVS-01):
 *  0 = nothing to act on (benign / equipment malfunction)
 *  1 = something happened, intent unknown
 *  2 = human presence confirmed, intent unknown
 *  3 = threat to property confirmed
 *  4 = threat to life confirmed
 */
export type EvidenceLevel = 0 | 1 | 2 | 3 | 4;

export interface Scenario {
  name: string;
  description: string;
  /** The correct evidence level for this scenario's incidents — declared as data, never derived from the agent */
  trueEvidenceLevel: EvidenceLevel;
  generate: (ctx: ScenarioContext) => SimEvent[];
}

export interface ScenarioContext {
  rng: seedrandom.PRNG;
  sites: Site[];
  guards: Guard[];
  robots: Robot[];
  eventCounter: { value: number };
  nightStartMs: number; // 0
  nightEndMs: number; // e.g. 36000000 (10h)
}

function makeEventId(counter: { value: number }): string {
  return `evt-${String(counter.value++).padStart(5, "0")}`;
}

function pick<T>(rng: seedrandom.PRNG, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function getZones(site: Site): { id: string; name: string; exposure: number }[] {
  return JSON.parse(site.zonesJson);
}

// ------------------------------------------------------------------
// SCENARIO 1: recurring_benign_pattern
// Dock B delivery truck arrives same time 5 nights — motion + plate read
// ------------------------------------------------------------------
const recurringBenignPattern: Scenario = {
  name: "recurring_benign_pattern",
  description: "Loading dock delivery truck arrives at ~2am for 5 consecutive nights — motion anomaly + plate read each time. All benign.",
  trueEvidenceLevel: 0, // benign — suppress
  generate(ctx) {
    const events: SimEvent[] = [];
    const site = ctx.sites[0]; // always use first site for reproducibility
    const zones = getZones(site);
    const dockZone = zones.find((z) => z.name.includes("Dock") || z.name.includes("Loading")) || zones[0];
    const robot = ctx.robots.find((r) => r.siteId === site.id) || ctx.robots[0];

    // 5 occurrences, each ~2am (2h into the night), slight jitter
    for (let night = 0; night < 5; night++) {
      const baseTime = 2 * 3600 * 1000 + Math.floor(ctx.rng() * 600000); // 2:00 ± 10min
      // Use night offset within the same sim — events spread across 10h window
      // We'll space them 30min apart to simulate "5 historical nights" in one sim
      const timeOffset = baseTime + night * 30 * 60 * 1000;

      events.push({
        id: makeEventId(ctx.eventCounter),
        type: "robot_motion_anomaly",
        siteId: site.id,
        zoneId: dockZone.id,
        sourceType: "robot",
        sourceId: robot.id,
        severity: 2,
        timestamp: timeOffset,
        rawDataJson: JSON.stringify({ pattern: "vehicle_approach", night: night + 1 }),
        groundTruthLabel: "benign",
        scenarioId: "recurring_benign_pattern",
      });

      events.push({
        id: makeEventId(ctx.eventCounter),
        type: "plate_read_unknown",
        siteId: site.id,
        zoneId: dockZone.id,
        sourceType: "robot",
        sourceId: robot.id,
        severity: 2,
        timestamp: timeOffset + 15000, // 15s later
        rawDataJson: JSON.stringify({ plate: "FL-DELIV-2024", night: night + 1 }),
        groundTruthLabel: "benign",
        scenarioId: "recurring_benign_pattern",
      });
    }
    return events;
  },
};

// ------------------------------------------------------------------
// SCENARIO 2: real_incident_inside_noise
// Genuine break-in wearing the benign pattern's clothes — same dock, same time
// ------------------------------------------------------------------
const realIncidentInsideNoise: Scenario = {
  name: "real_incident_inside_noise",
  description: "A genuine break-in at the same loading dock, same time as the recurring delivery. Motion + unknown plate + door forced.",
  trueEvidenceLevel: 3, // threat to property confirmed — forced entry
  generate(ctx) {
    const events: SimEvent[] = [];
    const site = ctx.sites[0];
    const zones = getZones(site);
    const dockZone = zones.find((z) => z.name.includes("Dock") || z.name.includes("Loading")) || zones[0];
    const robot = ctx.robots.find((r) => r.siteId === site.id) || ctx.robots[0];

    // Occurs at same ~2am window, after the recurring events
    const baseTime = 2 * 3600 * 1000 + 5 * 30 * 60 * 1000 + Math.floor(ctx.rng() * 300000);

    events.push({
      id: makeEventId(ctx.eventCounter),
      type: "robot_motion_anomaly",
      siteId: site.id,
      zoneId: dockZone.id,
      sourceType: "robot",
      sourceId: robot.id,
      severity: 3,
      timestamp: baseTime,
      rawDataJson: JSON.stringify({ pattern: "vehicle_approach", anomaly: "unusual_speed" }),
      groundTruthLabel: "real",
      scenarioId: "real_incident_inside_noise",
    });

    events.push({
      id: makeEventId(ctx.eventCounter),
      type: "plate_read_unknown",
      siteId: site.id,
      zoneId: dockZone.id,
      sourceType: "robot",
      sourceId: robot.id,
      severity: 3,
      timestamp: baseTime + 10000,
      rawDataJson: JSON.stringify({ plate: "UNKNOWN-XY-999" }),
      groundTruthLabel: "real",
      scenarioId: "real_incident_inside_noise",
    });

    events.push({
      id: makeEventId(ctx.eventCounter),
      type: "door_forced",
      siteId: site.id,
      zoneId: dockZone.id,
      sourceType: "sensor",
      sourceId: null,
      severity: 4,
      timestamp: baseTime + 45000,
      rawDataJson: JSON.stringify({ door: "dock-b-roll-up", method: "pry" }),
      groundTruthLabel: "real",
      scenarioId: "real_incident_inside_noise",
    });

    return events;
  },
};

// ------------------------------------------------------------------
// SCENARIO 3: cascading_multi_event
// One incident emitting 6+ correlated events
// ------------------------------------------------------------------
const cascadingMultiEvent: Scenario = {
  name: "cascading_multi_event",
  description: "A perimeter breach triggers a cascade of 6+ correlated events across the same zone within minutes.",
  trueEvidenceLevel: 4, // threat to life — panic button pressed, guard in danger
  generate(ctx) {
    const events: SimEvent[] = [];
    const site = ctx.sites[1]; // use second site
    const zones = getZones(site);
    const perimeterZone = zones.find((z) => z.name.includes("Perimeter") || z.name.includes("Entrance")) || zones[0];
    const robot = ctx.robots.find((r) => r.siteId === site.id) || ctx.robots[0];
    const guard = ctx.guards.find((g) => g.siteId === site.id) || ctx.guards[0];

    const baseTime = 3 * 3600 * 1000 + Math.floor(ctx.rng() * 600000); // ~3am

    const cascade: { type: EventType; offset: number; severity: number; source: "robot" | "guard" | "sensor" }[] = [
      { type: "robot_motion_anomaly", offset: 0, severity: 3, source: "robot" },
      { type: "robot_thermal_anomaly", offset: 8000, severity: 3, source: "robot" },
      { type: "door_forced", offset: 25000, severity: 4, source: "sensor" },
      { type: "plate_read_unknown", offset: 30000, severity: 2, source: "robot" },
      { type: "radio_transcript_flag", offset: 60000, severity: 3, source: "guard" },
      { type: "panic_button", offset: 90000, severity: 5, source: "guard" },
      { type: "geofence_exit", offset: 120000, severity: 3, source: "guard" },
    ];

    for (const evt of cascade) {
      events.push({
        id: makeEventId(ctx.eventCounter),
        type: evt.type,
        siteId: site.id,
        zoneId: perimeterZone.id,
        sourceType: evt.source,
        sourceId: evt.source === "robot" ? robot.id : evt.source === "guard" ? guard.id : null,
        severity: evt.severity,
        timestamp: baseTime + evt.offset,
        rawDataJson: JSON.stringify({ cascade: true, sequence: cascade.indexOf(evt) }),
        groundTruthLabel: "real",
        scenarioId: "cascading_multi_event",
      });
    }
    return events;
  },
};

// ------------------------------------------------------------------
// SCENARIO 4: unreliable_guard_no_show
// ------------------------------------------------------------------
const unreliableGuardNoShow: Scenario = {
  name: "unreliable_guard_no_show",
  description: "A guard doesn't show up for their shift, then misses check-ins. Coverage gap at their assigned site.",
  trueEvidenceLevel: 2, // human absence confirmed, coverage gap — need to reassign
  generate(ctx) {
    const events: SimEvent[] = [];
    const guard = ctx.guards[Math.min(5, ctx.guards.length - 1)];
    const site = ctx.sites.find((s) => s.id === guard.siteId) || ctx.sites[0];

    const shiftStartTime = 0; // start of night
    events.push({
      id: makeEventId(ctx.eventCounter),
      type: "no_show_at_shift_start",
      siteId: site.id,
      zoneId: null,
      sourceType: "guard",
      sourceId: guard.id,
      severity: 3,
      timestamp: shiftStartTime + 900000, // 15min grace
      rawDataJson: JSON.stringify({ guard: guard.name, scheduled: true }),
      groundTruthLabel: "real",
      scenarioId: "unreliable_guard_no_show",
    });

    // Missed check-ins every 30 min for 2 hours
    for (let i = 0; i < 4; i++) {
      events.push({
        id: makeEventId(ctx.eventCounter),
        type: "missed_check_in",
        siteId: site.id,
        zoneId: null,
        sourceType: "guard",
        sourceId: guard.id,
        severity: 2,
        timestamp: shiftStartTime + (i + 1) * 1800000, // every 30min
        rawDataJson: JSON.stringify({ guard: guard.name, checkInNumber: i + 1 }),
        groundTruthLabel: "real",
        scenarioId: "unreliable_guard_no_show",
      });
    }
    return events;
  },
};

// ------------------------------------------------------------------
// SCENARIO 5: stuck_sensor_spam
// One robot flooding with identical motion events
// ------------------------------------------------------------------
const stuckSensorSpam: Scenario = {
  name: "stuck_sensor_spam",
  description: "A robot with a stuck sensor floods 200+ identical motion anomaly events over 2 hours. All false alarms from a single malfunction.",
  trueEvidenceLevel: 0, // equipment malfunction — suppress
  generate(ctx) {
    const events: SimEvent[] = [];
    const robot = ctx.robots[Math.min(2, ctx.robots.length - 1)];
    const site = ctx.sites.find((s) => s.id === robot.siteId) || ctx.sites[0];
    const zones = getZones(site);
    const zone = zones[0];

    const startTime = 1 * 3600 * 1000; // 1am
    const count = 200;
    const interval = (2 * 3600 * 1000) / count; // spread over 2h

    for (let i = 0; i < count; i++) {
      events.push({
        id: makeEventId(ctx.eventCounter),
        type: "robot_motion_anomaly",
        siteId: site.id,
        zoneId: zone.id,
        sourceType: "robot",
        sourceId: robot.id,
        severity: 1,
        timestamp: startTime + i * interval,
        rawDataJson: JSON.stringify({ stuck: true, reading: 0.42, index: i }),
        groundTruthLabel: "false_alarm",
        scenarioId: "stuck_sensor_spam",
      });
    }
    return events;
  },
};

// ------------------------------------------------------------------
// SCENARIO 6: late_label
// Outcome resolves 40+ simulated minutes after the decision
// ------------------------------------------------------------------
const lateLabel: Scenario = {
  name: "late_label",
  description: "An event that only gets its ground-truth resolution 40+ minutes after the initial decision. Tests late outcome join.",
  trueEvidenceLevel: 0, // benign once resolved — CEO's rental car
  generate(ctx) {
    const events: SimEvent[] = [];
    const site = ctx.sites[3]; // different site
    const zones = getZones(site);
    const zone = zones.find((z) => z.name.includes("Parking") || z.name.includes("Garage")) || zones[0];

    const eventTime = 4 * 3600 * 1000; // 4am

    events.push({
      id: makeEventId(ctx.eventCounter),
      type: "plate_read_unknown",
      siteId: site.id,
      zoneId: zone.id,
      sourceType: "robot",
      sourceId: ctx.robots[0].id,
      severity: 2,
      timestamp: eventTime,
      rawDataJson: JSON.stringify({ plate: "OUT-OF-STATE-123", suspicious: true }),
      groundTruthLabel: null, // unknown at event time
      scenarioId: "late_label",
    });

    // The resolution comes 45 minutes later via client message
    events.push({
      id: makeEventId(ctx.eventCounter),
      type: "client_inbound_message",
      siteId: site.id,
      zoneId: zone.id,
      sourceType: "client",
      sourceId: null,
      severity: 1,
      timestamp: eventTime + 45 * 60 * 1000, // +45min
      rawDataJson: JSON.stringify({
        message: "That's our CEO's rental car, disregard",
        resolves: "plate_read_unknown",
      }),
      groundTruthLabel: "benign", // now we know
      scenarioId: "late_label",
    });

    return events;
  },
};

// --- Registry ---
export const SCENARIOS: Record<string, Scenario> = {
  recurring_benign_pattern: recurringBenignPattern,
  real_incident_inside_noise: realIncidentInsideNoise,
  cascading_multi_event: cascadingMultiEvent,
  unreliable_guard_no_show: unreliableGuardNoShow,
  stuck_sensor_spam: stuckSensorSpam,
  late_label: lateLabel,
};

// --- Background noise generator ---
function generateBackgroundNoise(ctx: ScenarioContext): SimEvent[] {
  const events: SimEvent[] = [];
  const { rng, sites, robots, guards, nightEndMs } = ctx;

  // Target: ~500 total events minus scenario events (~230 scenario events)
  // So generate ~270 background events
  const targetCount = 270;

  for (let i = 0; i < targetCount; i++) {
    const site = pick(rng, sites);
    const zones = getZones(site);
    const zone = pick(rng, zones);
    const timestamp = Math.floor(rng() * nightEndMs);

    // Weighted random event type — mostly low-severity robot events
    const weights: [EventType, number][] = [
      ["robot_motion_anomaly", 30],
      ["robot_thermal_anomaly", 10],
      ["robot_offline", 5],
      ["plate_read_unknown", 15],
      ["missed_check_in", 10],
      ["area_advisory", 10],
      ["client_inbound_message", 5],
      ["door_forced", 3],
      ["geofence_exit", 5],
      ["radio_transcript_flag", 4],
      ["panic_button", 1],
      ["no_show_at_shift_start", 2],
    ];

    const totalWeight = weights.reduce((s, [, w]) => s + w, 0);
    let r = rng() * totalWeight;
    let eventType: EventType = "robot_motion_anomaly";
    for (const [type, weight] of weights) {
      r -= weight;
      if (r <= 0) {
        eventType = type;
        break;
      }
    }

    // Most background events are false alarms or benign
    const isReal = rng() < 0.05; // 5% of background noise is real
    const sourceIsRobot = ["robot_motion_anomaly", "robot_thermal_anomaly", "robot_offline", "plate_read_unknown"].includes(eventType);
    const sourceIsGuard = ["missed_check_in", "geofence_exit", "panic_button", "no_show_at_shift_start", "radio_transcript_flag"].includes(eventType);

    const robot = sourceIsRobot ? (ctx.robots.find((r) => r.siteId === site.id) || pick(rng, robots)) : null;
    const guard = sourceIsGuard ? (ctx.guards.find((g) => g.siteId === site.id) || pick(rng, guards)) : null;

    events.push({
      id: makeEventId(ctx.eventCounter),
      type: eventType,
      siteId: site.id,
      zoneId: zone.id,
      sourceType: sourceIsRobot ? "robot" : sourceIsGuard ? "guard" : eventType === "client_inbound_message" ? "client" : "sensor",
      sourceId: robot?.id || guard?.id || null,
      severity: EVENT_SEVERITY[eventType] + (isReal ? 1 : 0),
      timestamp,
      rawDataJson: JSON.stringify({ background: true }),
      groundTruthLabel: isReal ? "real" : "false_alarm",
      scenarioId: null,
    });
  }

  return events;
}

// --- Main generator ---
export function generateEventStream(config: {
  seed: number;
  sites: Site[];
  guards: Guard[];
  robots: Robot[];
}): SimEvent[] {
  const rng = seedrandom(`events-${config.seed}`);
  const nightDurationMs = 10 * 3600 * 1000; // 10h night

  const ctx: ScenarioContext = {
    rng,
    sites: config.sites,
    guards: config.guards,
    robots: config.robots,
    eventCounter: { value: 0 },
    nightStartMs: 0,
    nightEndMs: nightDurationMs,
  };

  // Generate all scenario events
  const scenarioEvents: SimEvent[] = [];
  for (const scenario of Object.values(SCENARIOS)) {
    scenarioEvents.push(...scenario.generate(ctx));
  }

  // Generate background noise
  const noiseEvents = generateBackgroundNoise(ctx);

  // Combine and sort by timestamp
  const allEvents = [...scenarioEvents, ...noiseEvents].sort((a, b) => a.timestamp - b.timestamp);

  return allEvents;
}

/** Get events for a specific scenario */
export function getScenarioEvents(
  allEvents: SimEvent[],
  scenarioName: string
): SimEvent[] {
  return allEvents.filter((e) => e.scenarioId === scenarioName);
}

/**
 * Get the true evidence level for a set of events.
 * Uses scenario declarations for scenario events, defaults for background.
 * Background real events default to level 1 (something happened).
 * Background false_alarm/benign default to level 0.
 */
export function getTrueEvidenceLevel(events: SimEvent[]): EvidenceLevel {
  // If any event belongs to a scenario, use that scenario's declared level
  for (const event of events) {
    if (event.scenarioId && SCENARIOS[event.scenarioId]) {
      return SCENARIOS[event.scenarioId].trueEvidenceLevel;
    }
  }
  // Background events: real → 1, benign/false_alarm → 0
  const hasReal = events.some((e) => e.groundTruthLabel === "real");
  return hasReal ? 1 : 0;
}

/** Compute deterministic hash of the event stream */
export function computeEventStreamHash(events: SimEvent[]): string {
  const crypto = require("crypto");
  // Hash only deterministic fields, not IDs which depend on generation order
  const data = events.map((e) => ({
    type: e.type,
    siteId: e.siteId,
    zoneId: e.zoneId,
    severity: e.severity,
    timestamp: e.timestamp,
    groundTruthLabel: e.groundTruthLabel,
    scenarioId: e.scenarioId,
  }));
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
