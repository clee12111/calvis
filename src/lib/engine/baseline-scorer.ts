import { siteRepo, decisionRepo, eventRepo, incidentRepo } from "../db/repository";
import type { Incident, Site } from "../db/schema";
import { EVENT_SEVERITY, type EventType } from "./scenarios";
import crypto from "crypto";

/**
 * Per-event-type prior: P(real | event_type).
 * Hand-set from domain knowledge. Declared as an explicit modelling assumption (D-015).
 * These are the baseline's belief about how often each event type is real
 * vs. false alarm, absent any site-specific or temporal context.
 */
export const EVENT_TYPE_PRIOR: Record<EventType, number> = {
  panic_button: 0.85,          // almost always real — someone pressed it
  door_forced: 0.60,           // forced entry is usually real
  geofence_exit: 0.40,         // often GPS drift or authorized exit
  no_show_at_shift_start: 0.70,// guard didn't show — real coverage problem
  radio_transcript_flag: 0.50, // keyword flagging has moderate FP rate
  missed_check_in: 0.30,       // often a dead battery or poor signal
  robot_thermal_anomaly: 0.25, // thermal sensors have environmental FPs
  plate_read_unknown: 0.15,    // most unknowns are visitors, delivery, new plates
  robot_motion_anomaly: 0.10,  // high volume, low trust — mostly animals/wind
  client_inbound_message: 0.20,// depends on message — could be complaint or heads-up
  robot_offline: 0.05,         // equipment issue, not a security event
  area_advisory: 0.05,         // informational, rarely actionable
};

// --- Constants ---
const POLICY_VERSION = "rules-only-v1";
const POLICY_HASH = crypto
  .createHash("sha256")
  .update(POLICY_VERSION)
  .digest("hex")
  .slice(0, 12);

// Hour factor: higher during quiet hours (night), lower during day
// Night = sim hours 0-10 (representing 20:00 - 06:00)
function getHourFactor(simTimeMs: number): number {
  const simHours = simTimeMs / (3600 * 1000);
  // 0-2h (20:00-22:00): transition, factor 1.2
  // 2-8h (22:00-04:00): deep night, factor 1.5
  // 8-10h (04:00-06:00): early morning, factor 1.3
  if (simHours < 2) return 1.2;
  if (simHours < 8) return 1.5;
  return 1.3;
}

// Zone exposure factor (1-5 scale, normalize to multiplier)
function getZoneExposure(site: Site, zoneId: string | null): number {
  if (!zoneId) return 1.0;
  const zones: { id: string; exposure: number }[] = JSON.parse(site.zonesJson);
  const zone = zones.find((z) => z.id === zoneId);
  return zone ? zone.exposure / 3 : 1.0; // normalize: 3 → 1.0, 5 → 1.67, 1 → 0.33
}

// Max severity from events in the incident
function getMaxSeverity(eventIdsJson: string): number {
  const eventIds: string[] = JSON.parse(eventIdsJson);
  let maxSev = 1;
  for (const eid of eventIds) {
    const event = eventRepo.getById(eid);
    if (event) {
      maxSev = Math.max(maxSev, event.severity);
    }
  }
  return maxSev;
}

// Event count factor — more correlated events = higher priority
function getEventCountFactor(eventIdsJson: string): number {
  const eventIds: string[] = JSON.parse(eventIdsJson);
  const count = eventIds.length;
  if (count <= 1) return 1.0;
  if (count <= 3) return 1.2;
  if (count <= 6) return 1.4;
  return 1.5; // cap — 200 spam events shouldn't score higher than 6 real ones
}

// --- Priority scoring ---
export interface ScoringResult {
  priority: number;
  tier: number;
  confidence: number;
  factors: { name: string; value: number; weight: number }[];
  autonomyGate: "auto" | "propose";
}

export function scoreIncident(incident: Incident): ScoringResult {
  const site = siteRepo.getById(incident.siteId);
  if (!site) {
    return {
      priority: 0,
      tier: 1,
      confidence: 0.5,
      factors: [],
      autonomyGate: "propose",
    };
  }

  const severity = getMaxSeverity(incident.eventIds);
  const siteCriticality = site.criticalityTier; // 1-5
  const hourFactor = getHourFactor(incident.createdAt);
  const zoneExposure = getZoneExposure(site, incident.zoneId);
  const eventCountFactor = getEventCountFactor(incident.eventIds);

  // Base priority = severity × site criticality × hour factor × zone exposure
  const rawPriority =
    severity * siteCriticality * hourFactor * zoneExposure * eventCountFactor;

  // Normalize to 0-100 scale
  // Max possible: 5 * 5 * 1.5 * 1.67 * 1.5 ≈ 93.75
  const priority = Math.min(100, rawPriority);

  // Confidence = P(real) from per-event-type priors via noisy-OR
  const confidence = computeConfidence(incident.eventIds);

  // Tier selection: minimize expected cost given priority and P(real)
  const tier = priorityToTier(priority, confidence);

  // Autonomy gate: D-004 — confidence × reversibility
  // Tier 0-2 are reversible (cheap), tier 3-4 are not
  const reversibility = tier <= 2 ? 1.0 : tier === 3 ? 0.5 : 0.2;
  const autonomyScore = confidence * reversibility;
  const autonomyGate: "auto" | "propose" =
    autonomyScore > 0.6 && tier <= 2 ? "auto" : "propose";

  const factors = [
    { name: "severity", value: severity, weight: 0.3 },
    { name: "site_criticality", value: siteCriticality, weight: 0.25 },
    { name: "hour_factor", value: hourFactor, weight: 0.15 },
    { name: "zone_exposure", value: zoneExposure, weight: 0.15 },
    { name: "event_count", value: eventCountFactor, weight: 0.15 },
  ];

  return { priority, tier, confidence, factors, autonomyGate };
}

/**
 * Tier selection using expected cost minimization.
 * For each candidate tier, compute:
 *   responseCost(tier) + P(real) × E[harmCost | real, responded at tier]
 *
 * The expected true level given P(real):
 *  - We don't know exactly what level a real incident is, so we use the
 *    severity/priority signal as a proxy for expected true level.
 *  - Expected harm = P(real) × sum over possible true levels of their probability × gap cost
 *
 * Simplified: assume if real, true level = severity-based estimate (from priority).
 */
function priorityToTier(priority: number, pReal: number): number {
  const GUARD_RATE = 0.75;
  const OPERATOR_RATE = 0.58;
  const C_HARM = 500;
  const GUARD_MIN = [0, 0, 0.5, 10, 30];
  const OP_MIN = [0, 0.5, 1, 3, 10];

  // Expected true level if incident IS real, estimated from priority
  // More aggressive mapping: even moderate priority suggests level 2-3
  const estTrueIfReal = priority < 5 ? 1 : priority < 12 ? 2 : priority < 30 ? 3 : 4;

  let bestTier = 0;
  let bestCost = Infinity;

  for (let tier = 0; tier <= 4; tier++) {
    const respCost = GUARD_MIN[tier] * GUARD_RATE + OP_MIN[tier] * OPERATOR_RATE;
    const gap = Math.max(0, estTrueIfReal - tier);
    const expectedHarm = pReal * C_HARM * gap;
    const totalExpected = respCost + expectedHarm;

    if (totalExpected < bestCost) {
      bestCost = totalExpected;
      bestTier = tier;
    }
  }

  return bestTier;
}

/**
 * Compute P(real) for an incident from per-event-type priors.
 * Uses noisy-OR over DISTINCT event types (not count).
 * Same-type duplicates from the same source are correlated, not independent.
 * Multiple distinct types are treated as independent evidence channels.
 */
function computeConfidence(eventIdsJson: string): number {
  const eventIds: string[] = JSON.parse(eventIdsJson);
  const seenTypes = new Set<string>();
  let pAllFalse = 1.0;

  for (const eid of eventIds) {
    const event = eventRepo.getById(eid);
    if (!event) continue;

    // Only count each event type once (correlated duplicates don't add info)
    const key = `${event.type}`;
    if (seenTypes.has(key)) continue;
    seenTypes.add(key);

    const prior = EVENT_TYPE_PRIOR[event.type as EventType] ?? 0.1;
    pAllFalse *= (1 - prior);
  }

  // P(real) = 1 - P(all false)
  // Clamp to [0.01, 0.99] to avoid degenerate Brier scores
  return Math.max(0.01, Math.min(0.99, 1 - pAllFalse));
}

/**
 * Score an incident and persist the decision.
 * This is the main entry point used by the pipeline.
 */
export function scoreAndDecide(incident: Incident): ScoringResult {
  const result = scoreIncident(incident);

  // Persist decision (append-only)
  decisionRepo.insert({
    id: `dec-${incident.id}`,
    incidentId: incident.id,
    inputsJson: JSON.stringify({
      siteId: incident.siteId,
      zoneId: incident.zoneId,
      eventIds: incident.eventIds,
      createdAt: incident.createdAt,
    }),
    factorsJson: JSON.stringify(result.factors),
    chosenTier: result.tier,
    confidence: result.confidence,
    autonomyGate: result.autonomyGate,
    policyVersionHash: POLICY_HASH,
    rationaleJson: JSON.stringify({
      method: "rules-only-baseline",
      priority: result.priority,
      tierTable: "static",
    }),
    timestamp: incident.createdAt,
    createdAt: incident.createdAt,
  });

  // Update incident with scoring results
  incidentRepo.update(incident.id, {
    priority: result.priority,
    tier: result.tier,
    confidence: result.confidence,
  });

  return result;
}
