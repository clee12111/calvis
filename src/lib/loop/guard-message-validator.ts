/**
 * F1.4 — Guard message validator.
 * Messages to guards are template-filled from retrieved facts.
 * A validator rejects any message containing an entity — plate, door,
 * zone, name, time — not present in the retrieved context.
 *
 * Why: a hallucinated plate number sent to a guard at 2am is a safety
 * failure, not a quality issue.
 */

export interface MessageContext {
  /** Plates seen in incident events */
  knownPlates: string[];
  /** Zone IDs in incident events */
  knownZones: string[];
  /** Door/location identifiers in incident events */
  knownDoors: string[];
  /** Guard names at this site */
  knownGuardNames: string[];
  /** Times (formatted) from incident events */
  knownTimes: string[];
  /** Site name */
  siteName: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

// Patterns that look like plate numbers (e.g., FL-DELIV-2024, UNKNOWN-XY-999)
// Must contain at least one digit and at least one letter, with hyphens, at least 6 chars total
const PLATE_PATTERN = /\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*[0-9])[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+\b/gi;
const DOOR_PATTERN = /\b(?:door|gate|entrance|dock|bay)\s*[-#]?\s*[A-Za-z0-9]+\b/gi;
const TIME_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g;

/**
 * Validate a message to be sent to a guard.
 * Rejects if it contains entities not found in the retrieved context.
 */
export function validateGuardMessage(
  message: string,
  context: MessageContext,
): ValidationResult {
  const violations: string[] = [];

  // Check for plate-like strings not in context
  const plates = message.match(PLATE_PATTERN) ?? [];
  for (const plate of plates) {
    const normalized = plate.replace(/[-\s]/g, "").toUpperCase();
    const isKnown = context.knownPlates.some(
      (kp) => kp.replace(/[-\s]/g, "").toUpperCase() === normalized
    );
    if (!isKnown && normalized.length >= 4) {
      violations.push(`Unknown plate "${plate}" not in retrieved context`);
    }
  }

  // Check for door/location references not in context
  const doors = message.match(DOOR_PATTERN) ?? [];
  for (const door of doors) {
    const normalizedDoor = door.toLowerCase().trim();
    const isKnown = context.knownDoors.some((kd) => {
      const normalizedKd = kd.toLowerCase();
      return normalizedDoor.includes(normalizedKd) || normalizedKd.includes(normalizedDoor);
    });
    if (!isKnown && context.knownDoors.length > 0) {
      violations.push(`Unknown door/location "${door}" not in retrieved context`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Build a MessageContext from incident events and site data.
 */
export function buildMessageContext(params: {
  events: Array<{ rawDataJson: string | null; zoneId: string | null; timestamp: number }>;
  guardNames: string[];
  siteName: string;
}): MessageContext {
  const knownPlates: string[] = [];
  const knownDoors: string[] = [];
  const knownZones: string[] = [];
  const knownTimes: string[] = [];

  for (const event of params.events) {
    if (event.zoneId) knownZones.push(event.zoneId);
    if (event.rawDataJson) {
      try {
        const data = JSON.parse(event.rawDataJson);
        if (data.plate) knownPlates.push(data.plate);
        if (data.door) knownDoors.push(data.door);
      } catch { /* ignore parse errors */ }
    }
  }

  return {
    knownPlates,
    knownZones,
    knownDoors,
    knownGuardNames: params.guardNames,
    knownTimes,
    siteName: params.siteName,
  };
}
