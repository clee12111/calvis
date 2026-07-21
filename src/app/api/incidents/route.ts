import { NextResponse } from "next/server";
import { incidentRepo, decisionRepo, eventRepo, siteRepo } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const incidents = incidentRepo.getAll();

    // Enrich incidents with decision and event data
    const enriched = incidents.map((incident) => {
      const decisions = decisionRepo.getByIncident(incident.id);
      const eventIds: string[] = JSON.parse(incident.eventIds);
      const events = eventIds
        .map((eid) => eventRepo.getById(eid))
        .filter(Boolean);
      const site = siteRepo.getById(incident.siteId);

      return {
        ...incident,
        decisions,
        events,
        site,
      };
    });

    // Sort by priority (highest first), then by creation time
    enriched.sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pb !== pa) return pb - pa;
      return b.createdAt - a.createdAt;
    });

    return NextResponse.json(enriched);
  } catch {
    return NextResponse.json([]);
  }
}
