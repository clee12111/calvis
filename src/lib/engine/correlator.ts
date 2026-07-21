import { incidentRepo } from "../db/repository";
import type { SimEvent } from "./scenarios";
import { RELATED_TYPES, type EventType } from "./scenarios";
import type { Incident } from "../db/schema";

const CORRELATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface EventCluster {
  events: SimEvent[];
  siteId: string;
  zoneId: string | null;
  latestTimestamp: number;
  earliestTimestamp: number;
}

/**
 * Deterministic correlator. Groups events into incidents based on:
 * 1. Same site + zone within a time window
 * 2. Related event types (from the type graph)
 * 3. Same source (same robot spamming = same incident)
 */
export async function correlateEvents(events: SimEvent[]): Promise<Incident[]> {
  if (events.length === 0) return [];

  // Sort by timestamp
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  // Build clusters
  const clusters: EventCluster[] = [];

  for (const event of sorted) {
    let merged = false;

    // Try to merge into an existing cluster
    for (const cluster of clusters) {
      if (shouldCorrelate(event, cluster)) {
        cluster.events.push(event);
        cluster.latestTimestamp = Math.max(cluster.latestTimestamp, event.timestamp);
        cluster.earliestTimestamp = Math.min(cluster.earliestTimestamp, event.timestamp);
        // If zone was null and this event has a zone, adopt it
        if (!cluster.zoneId && event.zoneId) {
          cluster.zoneId = event.zoneId;
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push({
        events: [event],
        siteId: event.siteId,
        zoneId: event.zoneId,
        latestTimestamp: event.timestamp,
        earliestTimestamp: event.timestamp,
      });
    }
  }

  // Convert clusters to incidents
  const incidents: Incident[] = [];
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const id = `inc-${String(i).padStart(5, "0")}`;

    // Determine max severity across events
    const maxSeverity = Math.max(...cluster.events.map((e) => e.severity));

    const incident: Incident = {
      id,
      siteId: cluster.siteId,
      zoneId: cluster.zoneId,
      status: "open",
      eventIds: JSON.stringify(cluster.events.map((e) => e.id)),
      priority: null,
      tier: null,
      confidence: null,
      createdAt: cluster.earliestTimestamp,
      updatedAt: cluster.latestTimestamp,
      resolvedAt: null,
    };

    // Persist
    await incidentRepo.insert({
      ...incident,
      eventIds: incident.eventIds,
    });

    incidents.push(incident);
  }

  return incidents;
}

function shouldCorrelate(event: SimEvent, cluster: EventCluster): boolean {
  // Must be same site
  if (event.siteId !== cluster.siteId) return false;

  // Must be within time window
  if (event.timestamp - cluster.latestTimestamp > CORRELATION_WINDOW_MS) return false;

  // Same zone (if both have zones)
  const sameZone =
    !event.zoneId ||
    !cluster.zoneId ||
    event.zoneId === cluster.zoneId;

  if (!sameZone) return false;

  // Check if event type is related to any event in the cluster (bidirectional)
  const eventTypes = new Set(cluster.events.map((e) => e.type as EventType));
  const newEventRelated = RELATED_TYPES[event.type as EventType]?.some((rt) =>
    eventTypes.has(rt)
  );
  const clusterRelatedToNew = Array.from(eventTypes).some((ct) =>
    RELATED_TYPES[ct]?.includes(event.type as EventType)
  );
  const relatedToAny = newEventRelated || clusterRelatedToNew;

  // Same source = same incident (e.g., stuck sensor)
  const sameSource =
    event.sourceId &&
    cluster.events.some(
      (e) => e.sourceId === event.sourceId && e.sourceType === event.sourceType
    );

  // Tight temporal proximity at same zone = likely same incident
  // (within 3 minutes at the same exact zone)
  const TIGHT_WINDOW_MS = 3 * 60 * 1000;
  const tightTemporal =
    event.zoneId &&
    cluster.zoneId &&
    event.zoneId === cluster.zoneId &&
    event.timestamp - cluster.latestTimestamp <= TIGHT_WINDOW_MS;

  return relatedToAny || !!sameSource || !!tightTemporal;
}

/**
 * Get correlation stats for testing/eval
 */
export function getCorrelationStats(events: SimEvent[], incidents: Incident[]) {
  const eventCount = events.length;
  const incidentCount = incidents.length;
  const compressionRatio = eventCount > 0 ? incidentCount / eventCount : 0;

  // Check scenario correlation
  const scenarioStats: Record<string, { events: number; incidents: number }> = {};

  for (const event of events) {
    const scenarioId = event.scenarioId || "background";
    if (!scenarioStats[scenarioId]) {
      scenarioStats[scenarioId] = { events: 0, incidents: 0 };
    }
    scenarioStats[scenarioId].events++;
  }

  // Map incidents to scenarios
  for (const incident of incidents) {
    const eventIds: string[] = JSON.parse(incident.eventIds);
    const scenarioIds = new Set(
      events
        .filter((e) => eventIds.includes(e.id))
        .map((e) => e.scenarioId || "background")
    );
    for (const sid of scenarioIds) {
      if (scenarioStats[sid]) {
        scenarioStats[sid].incidents++;
      }
    }
  }

  return {
    eventCount,
    incidentCount,
    compressionRatio,
    scenarioStats,
  };
}
