import { NextResponse } from "next/server";
import { getSimManager } from "@/lib/engine/sim-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const manager = getSimManager();
      if (!manager) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: "No simulation running" })}\n\n`)
        );
        controller.close();
        return;
      }

      // Send initial state
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "init", time: manager.clock.now, speed: manager.clock.speed })}\n\n`
        )
      );

      // Subscribe to events
      const unsubEvent = manager.onEvent((event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "event", event })}\n\n`)
          );
        } catch {
          // Client disconnected
        }
      });

      // Subscribe to incidents
      const unsubIncident = manager.onIncident((incident) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "incident", incident })}\n\n`)
          );
        } catch {
          // Client disconnected
        }
      });

      // Subscribe to clock ticks (throttled — every 500ms sim time)
      let lastTickSent = 0;
      const unsubClock = manager.clock.onTick((simTime) => {
        if (simTime - lastTickSent < 500) return;
        lastTickSent = simTime;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "tick", time: simTime })}\n\n`)
          );
        } catch {
          // Client disconnected
        }
      });

      // Cleanup on close
      const cleanup = () => {
        unsubEvent();
        unsubIncident();
        unsubClock();
      };

      // Store cleanup ref
      (controller as any).__cleanup = cleanup;
    },
    cancel(controller) {
      (controller as any).__cleanup?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
