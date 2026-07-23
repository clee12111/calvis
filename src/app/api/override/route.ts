import { NextResponse } from "next/server";
import { outcomeRepo, decisionRepo, incidentRepo, eventRepo } from "@/lib/db/repository";
import { updateCachedIncident, getIncidentCache } from "@/lib/engine/incident-cache";
import { getLearnedPriorStore } from "@/lib/loop/learned-priors";

/**
 * POST /api/override
 * Persist an operator override as an Outcome.
 * This is the F2 feedback substrate — without it, there's no human signal to learn from.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { incidentId, action, newTier, reason } = body as {
      incidentId: string;
      action: "approve" | "modify" | "override";
      newTier?: number;
      reason?: string;
    };

    if (!incidentId || !action) {
      return NextResponse.json(
        { error: "incidentId and action are required" },
        { status: 400 }
      );
    }

    // Find the decision for this incident
    const decisions = await decisionRepo.getByIncident(incidentId);
    if (decisions.length === 0) {
      return NextResponse.json(
        { error: `No decision found for incident ${incidentId}` },
        { status: 404 }
      );
    }

    const latestDecision = decisions[decisions.length - 1];
    const timestamp = Date.now();

    if (action === "approve") {
      // Operator approves the agent's decision — positive signal
      await outcomeRepo.insert({
        id: `out-${incidentId}-approve-${timestamp}`,
        decisionId: latestDecision.id,
        incidentId,
        source: "operator_override",
        wasReal: undefined,
        correctTier: latestDecision.chosenTier,
        notes: "Operator approved agent decision",
        timestamp,
        createdAt: timestamp,
      });

      return NextResponse.json({ ok: true, action: "approve" });
    }

    if (action === "modify" || action === "override") {
      if (newTier === undefined || newTier === null) {
        return NextResponse.json(
          { error: "newTier is required for modify/override" },
          { status: 400 }
        );
      }

      if (typeof newTier !== "number" || newTier < 0 || newTier > 4) {
        return NextResponse.json(
          { error: "newTier must be 0-4" },
          { status: 400 }
        );
      }

      if (action === "override" && !reason) {
        return NextResponse.json(
          { error: "reason is required for override" },
          { status: 400 }
        );
      }

      if (action === "override" && reason) {
        // Reject incoherent overrides:
        // 1. "False alarm" reason paired with an escalation (tier going up)
        const isEscalation = newTier > latestDecision.chosenTier;
        const falseAlarmPattern = /false\s*alarm|not\s*real|benign|equipment|malfunction/i;
        if (isEscalation && falseAlarmPattern.test(reason)) {
          return NextResponse.json(
            { error: "Incoherent override: reason says false alarm but tier is escalating. If it's a false alarm, the tier should go down." },
            { status: 400 }
          );
        }

        // 2. De-escalation with reason indicating real threat
        const realThreatPattern = /confirmed\s*threat|active\s*intruder|weapon|shots?\s*fired|hostage/i;
        const isDeescalation = newTier < latestDecision.chosenTier;
        if (isDeescalation && realThreatPattern.test(reason)) {
          return NextResponse.json(
            { error: "Incoherent override: reason indicates a real threat but tier is de-escalating. If there's a confirmed threat, the tier should go up." },
            { status: 400 }
          );
        }
      }

      // Persist the override as an Outcome
      await outcomeRepo.insert({
        id: `out-${incidentId}-${action}-${timestamp}`,
        decisionId: latestDecision.id,
        incidentId,
        source: "operator_override",
        wasReal: undefined,
        correctTier: newTier,
        notes: reason ?? `Operator ${action}: tier ${latestDecision.chosenTier} → ${newTier}`,
        timestamp,
        createdAt: timestamp,
      });

      // Update incident tier in DB and cache
      await incidentRepo.update(incidentId, {
        tier: newTier,
        updatedAt: timestamp,
      });
      updateCachedIncident(incidentId, { tier: newTier, updatedAt: timestamp });

      // F2.4: Update learned priors from override
      // The operator's tier tells us whether the incident is real (tier > 0)
      const wasRealFromOverride = newTier > 0;
      const priorStore = getLearnedPriorStore();
      const incident = await incidentRepo.getById(incidentId);
      if (incident) {
        const eventIds: string[] = JSON.parse(incident.eventIds);
        // Get event types from the cached incident data
        const cache = getIncidentCache();
        const cached = cache?.find((c) => c.id === incidentId);
        const eventTypes = cached?.events?.map((e: any) => e.type as string) ?? [];
        const uniqueTypes = [...new Set(eventTypes)];

        const priorUpdates: Array<{ eventType: string; before: number; after: number; n: number }> = [];

        for (const et of uniqueTypes) {
          const before = priorStore.getPrior({
            eventType: et,
            siteId: incident.siteId,
            zoneId: incident.zoneId ?? null,
            simTimeMs: incident.createdAt,
          });

          priorStore.update({
            eventType: et,
            siteId: incident.siteId,
            zoneId: incident.zoneId ?? null,
            simTimeMs: incident.createdAt,
            wasReal: wasRealFromOverride,
          });

          const after = priorStore.getPrior({
            eventType: et,
            siteId: incident.siteId,
            zoneId: incident.zoneId ?? null,
            simTimeMs: incident.createdAt,
          });

          priorUpdates.push({
            eventType: et,
            before: before.pReal,
            after: after.pReal,
            n: after.n,
          });
        }

        return NextResponse.json({
          ok: true,
          action,
          newTier,
          reason,
          priorUpdates,
        });
      }

      return NextResponse.json({ ok: true, action, newTier, reason });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
