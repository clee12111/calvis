import seedrandom from "seedrandom";
import type { Guard, Incident } from "../db/schema";
import { VirtualClock } from "../clock/virtual-clock";

export interface ResponseResult {
  guardId: string;
  incidentId: string;
  acked: boolean;
  ackTimeMs: number | null; // sim time of ack
  arrivedTimeMs: number | null; // sim time of arrival
  responseSeconds: number | null; // how long it took to respond
}

export interface ResponderConfig {
  guards: Guard[];
  rng: seedrandom.PRNG;
}

/**
 * Simulated responders. Given an incident and assigned guard,
 * stochastically determine:
 *  - Whether they ack (based on guard's reliabilityAckRate)
 *  - How long to respond (based on guard's reliabilityAvgResponse)
 *  - Whether they arrive at all
 */
export function simulateResponse(
  guard: Guard,
  incident: Incident,
  dispatchTimeMs: number,
  rng: seedrandom.PRNG
): ResponseResult {
  const ackRate = guard.reliabilityAckRate ?? 0.9;
  const avgResponse = guard.reliabilityAvgResponse ?? 300;

  const acked = rng() < ackRate;

  if (!acked) {
    return {
      guardId: guard.id,
      incidentId: incident.id,
      acked: false,
      ackTimeMs: null,
      arrivedTimeMs: null,
      responseSeconds: null,
    };
  }

  // Ack delay: exponential distribution around 30-120s
  const ackDelay = 30 + Math.floor(-Math.log(1 - rng()) * 60); // 30s base + exp
  const ackTimeMs = dispatchTimeMs + ackDelay * 1000;

  // Arrival: based on average response time with some variance
  const responseSeconds = Math.max(
    60,
    Math.floor(avgResponse + (rng() - 0.5) * avgResponse * 0.6)
  );
  const arrivedTimeMs = ackTimeMs + responseSeconds * 1000;

  return {
    guardId: guard.id,
    incidentId: incident.id,
    acked: true,
    ackTimeMs,
    arrivedTimeMs,
    responseSeconds,
  };
}

/**
 * Batch-simulate all responses for a set of dispatched incidents.
 * Used in eval mode where we process everything at once.
 */
export function simulateAllResponses(
  dispatches: { guard: Guard; incident: Incident; dispatchTimeMs: number }[],
  rng: seedrandom.PRNG
): ResponseResult[] {
  return dispatches.map(({ guard, incident, dispatchTimeMs }) =>
    simulateResponse(guard, incident, dispatchTimeMs, rng)
  );
}
