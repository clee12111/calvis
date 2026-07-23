import { NextResponse } from "next/server";
import {
  getIncidentCache,
  getActiveArm,
  getAvailableArms,
  getArmMetrics,
  getAllArmMetrics,
} from "@/lib/engine/incident-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view");

  // Metrics endpoint
  if (view === "metrics") {
    return NextResponse.json({
      activeArm: getActiveArm(),
      availableArms: getAvailableArms(),
      metrics: getAllArmMetrics(),
    });
  }

  // Fast path: serve from in-memory cache
  const cached = getIncidentCache();
  if (cached) {
    return NextResponse.json(cached);
  }

  return NextResponse.json([]);
}
