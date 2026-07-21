import { outcomeRepo, decisionRepo, incidentRepo } from "../db/repository";
import type { Incident, Decision, Outcome } from "../db/schema";
import { getTrueEvidenceLevel, type SimEvent } from "./scenarios";

/**
 * Join an outcome to a decision/incident.
 * Handles the late_label case: outcomes can arrive after the decision is closed.
 */
export async function joinOutcome(params: {
  incidentId: string;
  source: "guard_closeout" | "ack_telemetry" | "operator_override" | "late_signal";
  wasReal: boolean | null;
  correctTier: number | null;
  notes: string | null;
  timestamp: number;
}): Promise<Outcome | null> {
  const { incidentId, source, wasReal, correctTier, notes, timestamp } = params;

  // Find the decision(s) for this incident
  const decisions = await decisionRepo.getByIncident(incidentId);
  if (decisions.length === 0) return null;

  // Join to the most recent decision
  const latestDecision = decisions[decisions.length - 1];

  const outcomeId = `out-${incidentId}-${source}-${timestamp}`;

  const outcome: typeof import("../db/schema").outcomes.$inferInsert = {
    id: outcomeId,
    decisionId: latestDecision.id,
    incidentId,
    source,
    wasReal: wasReal ?? undefined,
    correctTier: correctTier ?? undefined,
    notes: notes ?? undefined,
    timestamp,
    createdAt: timestamp,
  };

  await outcomeRepo.insert(outcome);

  // Update incident status if appropriate
  const incident = await incidentRepo.getById(incidentId);
  if (incident) {
    if (wasReal === false) {
      await incidentRepo.update(incidentId, {
        status: "false_alarm",
        resolvedAt: timestamp,
        updatedAt: timestamp,
      });
    } else if (wasReal === true && incident.status === "open") {
      // Don't change status — the incident is confirmed real but still needs handling
      await incidentRepo.update(incidentId, { updatedAt: timestamp });
    }
  }

  return {
    id: outcomeId,
    decisionId: latestDecision.id,
    incidentId,
    source,
    wasReal: wasReal ?? null,
    correctTier: correctTier ?? null,
    notes: notes ?? null,
    timestamp,
    createdAt: timestamp,
  };
}

/**
 * Process late-arriving outcomes. These are outcomes that arrive
 * after the decision has already been made and the incident may
 * have been resolved or closed in the UI.
 *
 * The late_label scenario tests this: an outcome that resolves
 * 40+ simulated minutes after the decision.
 */
export async function processLateOutcome(params: {
  incidentId: string;
  wasReal: boolean;
  correctTier: number | null;
  notes: string;
  timestamp: number;
}): Promise<Outcome | null> {
  return await joinOutcome({
    ...params,
    source: "late_signal",
  });
}

/**
 * Generate outcomes from simulation ground truth.
 * trueEvidenceLevel comes from the scenario declaration — never from the agent's tier.
 * This is the fix for the circular metric (recon finding 1).
 */
export async function generateSimOutcomes(
  incidents: Incident[],
  allSimEvents: SimEvent[],
  simTimeMs: number
): Promise<Outcome[]> {
  const results: Outcome[] = [];
  const eventById = new Map(allSimEvents.map((e) => [e.id, e]));

  for (const incident of incidents) {
    const eventIds: string[] = JSON.parse(incident.eventIds);
    const incidentEvents = eventIds
      .map((eid) => eventById.get(eid))
      .filter((e): e is SimEvent => e !== undefined);

    if (incidentEvents.length === 0) continue;

    // Ground truth from scenario declarations, not derived from agent
    const trueLevel = getTrueEvidenceLevel(incidentEvents);
    const wasReal = trueLevel > 0;

    // Determine timing — late_label events arrive later
    const isLateScenario = incidentEvents.some((e) => e.groundTruthLabel === null);
    const outcomeTime = isLateScenario
      ? simTimeMs
      : (incident.createdAt ?? 0) + 300000;

    const outcome = await joinOutcome({
      incidentId: incident.id,
      source: isLateScenario ? "late_signal" : "guard_closeout",
      wasReal,
      correctTier: trueLevel, // from scenario, not from agent
      notes: wasReal ? `real (evidence level ${trueLevel})` : "benign (evidence level 0)",
      timestamp: outcomeTime,
    });

    if (outcome) results.push(outcome);
  }

  return results;
}
