import { NextResponse } from "next/server";
import { seedWorld } from "@/lib/engine/seed-world";
import {
  siteRepo,
  guardRepo,
  robotRepo,
  incidentRepo,
  decisionRepo,
  eventRepo,
} from "@/lib/db/repository";
import { generateEventStream } from "@/lib/engine/scenarios";
import { SimManager, setSimManager, getSimManager } from "@/lib/engine/sim-manager";
import { correlateEvents } from "@/lib/engine/correlator";
import { scoreAndDecide } from "@/lib/engine/baseline-scorer";
import type { SimEvent } from "@/lib/engine/scenarios";
import type { Incident } from "@/lib/db/schema";

export async function POST(request: Request) {
  const body = await request.json();
  const { action, seed = 42, speed = 10 } = body;

  if (action === "start") {
    // Seed world and generate events
    seedWorld({ seed });

    const sites = siteRepo.getAll();
    const guards = guardRepo.getAll();
    const robots = robotRepo.getAll();
    const events = generateEventStream({ seed, sites, guards, robots });

    // Create sim manager
    const manager = new SimManager(events);

    // Wire up correlator and scorer
    manager.setCorrelator((evts: SimEvent[]) => {
      return correlateEvents(evts);
    });

    manager.setScorer((incident: Incident) => {
      scoreAndDecide(incident);
    });

    setSimManager(manager);

    // Start realtime playback
    manager.startRealtime(speed);

    return NextResponse.json({
      ok: true,
      totalEvents: events.length,
      speed,
    });
  }

  if (action === "pause") {
    const manager = getSimManager();
    if (manager) manager.clock.pause();
    return NextResponse.json({ ok: true });
  }

  if (action === "resume") {
    const manager = getSimManager();
    if (manager) manager.startRealtime(speed);
    return NextResponse.json({ ok: true });
  }

  if (action === "speed") {
    const manager = getSimManager();
    if (manager) manager.clock.setSpeed(speed);
    return NextResponse.json({ ok: true, speed });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function GET() {
  const manager = getSimManager();
  if (!manager) {
    return NextResponse.json({ running: false });
  }

  return NextResponse.json({
    running: manager.clock.running,
    time: manager.clock.now,
    speed: manager.clock.speed,
    eventsIngested: manager.pipeline.ingestedCount,
    totalEvents: manager.pipeline.totalEvents,
    done: manager.pipeline.done,
  });
}
