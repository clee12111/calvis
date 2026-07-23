import seedrandom from "seedrandom";
import type { SimEvent, EvidenceLevel } from "../engine/scenarios";
import type { Action, OpenQuestion } from "./types";

/**
 * 0.8.6 — Simulated question responses.
 * System questions resolve instantly with deterministic answers.
 * Human questions resolve stochastically from per-guard parameters.
 * Sometimes late, sometimes never — if questions always get answered,
 * asking is free and the information-economics layer is fiction.
 */

export interface QuestionContext {
  events: SimEvent[];
  siteId: string;
  rng: seedrandom.PRNG;
  guardAckRate: number; // from guard's reliabilityAckRate
}

/**
 * Resolve a system question instantly.
 * Returns the answer string and any evidence-level change.
 */
export function resolveSystemQuestion(
  actionId: string,
  ctx: QuestionContext,
): { answer: string; newLevel: EvidenceLevel | null } {
  switch (actionId) {
    case "check_delivery_schedule": {
      // Check if events include recurring benign pattern indicators
      const hasDeliveryPattern = ctx.events.some((e) =>
        e.scenarioId === "recurring_benign_pattern" ||
        (e.rawDataJson && JSON.parse(e.rawDataJson).pattern === "vehicle_approach" && !JSON.parse(e.rawDataJson).anomaly)
      );
      if (hasDeliveryPattern) {
        return { answer: "Scheduled delivery found for this time window.", newLevel: 0 };
      }
      return { answer: "No scheduled delivery at this time.", newLevel: null };
    }

    case "check_plate_allowlist": {
      const plateEvents = ctx.events.filter((e) => e.type === "plate_read_unknown");
      if (plateEvents.length > 0) {
        const data = JSON.parse(plateEvents[0].rawDataJson ?? "{}");
        if (data.plate?.includes("DELIV")) {
          return { answer: `Plate ${data.plate} is on delivery allowlist.`, newLevel: 0 };
        }
        return { answer: `Plate ${data.plate} NOT on allowlist.`, newLevel: null };
      }
      return { answer: "No plate events to check.", newLevel: null };
    }

    case "retrieve_prior":
      return { answer: "Prior retrieved from event-type table.", newLevel: null };

    case "retrieve_precedent":
      return { answer: "No matching precedent in episodic memory.", newLevel: null };

    case "check_camera_coverage":
      return { answer: "Camera coverage available for this zone.", newLevel: null };

    default:
      return { answer: "Unknown system question.", newLevel: null };
  }
}

/**
 * Determine if and when a human question gets answered.
 * Returns null if the question goes unanswered (guard doesn't respond).
 */
export function simulateHumanResponse(
  action: Action,
  askedAt: number,
  ctx: QuestionContext,
): { answeredAt: number; answer: string; newLevel: EvidenceLevel | null } | null {
  // Does the guard respond at all?
  if (ctx.rng() > ctx.guardAckRate) {
    return null; // No response — silence is information
  }

  // Response delay: exponential distribution around expected latency
  const baseLatency = action.expectedLatencyMs;
  const delay = baseLatency * (0.5 + ctx.rng() * 1.5); // 50%-200% of expected
  const answeredAt = askedAt + Math.floor(delay);

  // What do they find?
  switch (action.id) {
    case "request_photo": {
      // Photo assessment based on observable event types and severity,
      // never from groundTruthLabel. The guard sees what the sensors saw,
      // plus visual context — not an oracle.
      const hasForcedEntry = ctx.events.some((e) => e.type === "door_forced");
      const hasPanic = ctx.events.some((e) => e.type === "panic_button");
      if (hasForcedEntry || hasPanic) {
        return { answeredAt, answer: "Photo shows forced entry / suspicious individual.", newLevel: 3 };
      }
      const hasMotionOnly = ctx.events.every((e) =>
        e.type === "robot_motion_anomaly" || e.type === "robot_thermal_anomaly"
      );
      if (hasMotionOnly) {
        return { answeredAt, answer: "Photo shows empty area — likely animal or wind.", newLevel: 0 };
      }
      return { answeredAt, answer: "Photo inconclusive.", newLevel: null };
    }

    case "ask_guard_radio": {
      const hasNoShow = ctx.events.some((e) => e.type === "no_show_at_shift_start");
      if (hasNoShow) {
        return { answeredAt, answer: "No response from guard — confirming no-show.", newLevel: 2 };
      }
      return { answeredAt, answer: "Guard reports all clear.", newLevel: 0 };
    }

    case "ask_client_confirm": {
      const isLateLabel = ctx.events.some((e) => e.scenarioId === "late_label");
      if (isLateLabel) {
        return { answeredAt, answer: "Client confirms: authorized vehicle.", newLevel: 0 };
      }
      return { answeredAt, answer: "Client has no additional information.", newLevel: null };
    }

    default:
      return { answeredAt, answer: "Response received.", newLevel: null };
  }
}
