import { describe, it, expect } from "vitest";
import { computeEventStreamHash, generateEventStream } from "../scenarios";
import { seedWorld, computeWorldHash } from "../seed-world";
import { siteRepo, guardRepo, robotRepo } from "../../db/repository";

describe("seed determinism", () => {
  it("produces identical world hashes for the same seed", () => {
    seedWorld({ seed: 42 });
    const hash1 = computeWorldHash();
    seedWorld({ seed: 42 });
    const hash2 = computeWorldHash();
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different seeds", () => {
    seedWorld({ seed: 42 });
    const hash1 = computeWorldHash();
    seedWorld({ seed: 99 });
    const hash2 = computeWorldHash();
    expect(hash1).not.toBe(hash2);
  });

  it("produces identical event stream hashes for the same seed", () => {
    seedWorld({ seed: 42 });
    const events1 = generateEventStream({
      seed: 42,
      sites: siteRepo.getAll(),
      guards: guardRepo.getAll(),
      robots: robotRepo.getAll(),
    });
    const h1 = computeEventStreamHash(events1);

    seedWorld({ seed: 42 });
    const events2 = generateEventStream({
      seed: 42,
      sites: siteRepo.getAll(),
      guards: guardRepo.getAll(),
      robots: robotRepo.getAll(),
    });
    const h2 = computeEventStreamHash(events2);

    expect(h1).toBe(h2);
  });
});
