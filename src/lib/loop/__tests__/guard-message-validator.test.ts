import { describe, it, expect } from "vitest";
import { validateGuardMessage, type MessageContext } from "../guard-message-validator";

const baseContext: MessageContext = {
  knownPlates: ["FL-DELIV-2024", "UNKNOWN-XY-999"],
  knownZones: ["zone-dock-b"],
  knownDoors: ["dock-b-roll-up"],
  knownGuardNames: ["Marcus Rivera"],
  knownTimes: ["02:15"],
  siteName: "Meridian Tower",
};

describe("guard message validator", () => {
  it("accepts a message using only known entities", () => {
    const result = validateGuardMessage(
      "Plate FL-DELIV-2024 detected at dock-b-roll-up. Please verify.",
      baseContext,
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("rejects a message with an unknown plate", () => {
    const result = validateGuardMessage(
      "Plate ABC-FAKE-123 detected at dock-b-roll-up. Please verify.",
      baseContext,
    );
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain("Unknown plate");
  });

  it("rejects a message with an unknown door", () => {
    const result = validateGuardMessage(
      "Suspicious activity at door C-7. Investigate immediately.",
      baseContext,
    );
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes("Unknown door"))).toBe(true);
  });

  it("accepts a plain message with no entities", () => {
    const result = validateGuardMessage(
      "Please check the loading area and report back.",
      baseContext,
    );
    expect(result.valid).toBe(true);
  });
});
