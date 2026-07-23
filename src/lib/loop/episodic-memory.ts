/**
 * F2.2 — Episodic memory: past incident outcomes for find_precedent.
 * Returns the k nearest past incidents at the same site/zone with similar event types.
 * Each entry includes the tier chosen and the outcome that followed.
 *
 * State persists across nights within a run, never across runs.
 */

export interface PrecedentEntry {
  incidentId: string;
  siteId: string;
  zoneId: string | null;
  eventTypes: string[];
  chosenTier: number;
  trueLevel: number;
  wasReal: boolean;
  nightIndex: number;
  timestamp: number;
}

export class EpisodicMemory {
  private entries: PrecedentEntry[] = [];

  reset(): void {
    this.entries = [];
  }

  /**
   * Record a resolved incident for future precedent lookups.
   */
  record(entry: PrecedentEntry): void {
    this.entries.push(entry);
  }

  /**
   * Find the k nearest precedents for a query.
   * Nearest = same site + overlapping event types, ordered by recency.
   * Falls back to same event types at any site if no site-level matches.
   */
  findPrecedents(params: {
    siteId: string;
    zoneId: string | null;
    eventTypes: string[];
    k?: number;
  }): PrecedentEntry[] {
    const { siteId, zoneId, eventTypes, k = 5 } = params;
    const queryTypes = new Set(eventTypes);

    // Score each entry: same site/zone + type overlap
    const scored = this.entries.map((entry) => {
      const entryTypes = new Set(entry.eventTypes);
      const typeOverlap = [...queryTypes].filter((t) => entryTypes.has(t)).length;
      const siteMatch = entry.siteId === siteId ? 2 : 0;
      const zoneMatch = zoneId && entry.zoneId === zoneId ? 1 : 0;
      const score = typeOverlap * 3 + siteMatch + zoneMatch;
      return { entry, score };
    });

    // Filter to entries with at least one event type in common
    const relevant = scored.filter((s) => {
      const entryTypes = new Set(s.entry.eventTypes);
      return [...queryTypes].some((t) => entryTypes.has(t));
    });

    // Sort by score desc, then by recency (latest first)
    relevant.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.entry.timestamp - a.entry.timestamp;
    });

    return relevant.slice(0, k).map((s) => s.entry);
  }

  /** Check if any precedent exists for this site/event-type combination */
  hasPrecedent(siteId: string, eventTypes: string[]): boolean {
    const queryTypes = new Set(eventTypes);
    return this.entries.some((e) =>
      e.siteId === siteId && e.eventTypes.some((t) => queryTypes.has(t))
    );
  }

  /** Total entries stored */
  get size(): number {
    return this.entries.length;
  }

  /** Serialize for persistence */
  serialize(): PrecedentEntry[] {
    return [...this.entries];
  }

  /** Deserialize from previous night */
  deserialize(data: PrecedentEntry[]): void {
    this.entries = [...data];
  }
}

// Singleton
let _memory: EpisodicMemory | null = null;

export function getEpisodicMemory(): EpisodicMemory {
  if (!_memory) {
    _memory = new EpisodicMemory();
  }
  return _memory;
}

export function resetEpisodicMemory(): EpisodicMemory {
  _memory = new EpisodicMemory();
  return _memory;
}
