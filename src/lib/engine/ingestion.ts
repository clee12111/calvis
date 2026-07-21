import { eventRepo } from "../db/repository";
import type { SimEvent } from "./scenarios";
import { VirtualClock } from "../clock/virtual-clock";

export type EventCallback = (event: SimEvent) => void;

/**
 * Ingestion pipeline: takes raw sim events, normalizes, persists, publishes.
 * In batch mode: processes all events up to the current clock time.
 * In realtime mode: feeds events as the clock advances.
 */
export class IngestionPipeline {
  private _events: SimEvent[] = [];
  private _nextIndex: number = 0;
  private _subscribers: Set<EventCallback> = new Set();
  private _ingestedCount: number = 0;
  private _seenIds: Set<string> = new Set();

  constructor(events: SimEvent[]) {
    // Events must be sorted by timestamp
    this._events = [...events].sort((a, b) => a.timestamp - b.timestamp);
  }

  get ingestedCount(): number {
    return this._ingestedCount;
  }

  get totalEvents(): number {
    return this._events.length;
  }

  get done(): boolean {
    return this._nextIndex >= this._events.length;
  }

  /** Subscribe to incoming events */
  subscribe(callback: EventCallback): () => void {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  /**
   * Process all events up to the given sim time.
   * Returns the events that were ingested.
   */
  ingestUpTo(simTimeMs: number): SimEvent[] {
    const ingested: SimEvent[] = [];

    while (this._nextIndex < this._events.length) {
      const event = this._events[this._nextIndex];
      if (event.timestamp > simTimeMs) break;

      // Dedup check
      if (this._seenIds.has(event.id)) {
        this._nextIndex++;
        continue;
      }

      // Persist
      eventRepo.insert({
        id: event.id,
        type: event.type,
        siteId: event.siteId,
        zoneId: event.zoneId,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        severity: event.severity,
        timestamp: event.timestamp,
        rawDataJson: event.rawDataJson,
        groundTruthLabel: event.groundTruthLabel,
        scenarioId: event.scenarioId,
        createdAt: event.timestamp, // use sim time as created_at
      });

      this._seenIds.add(event.id);
      this._ingestedCount++;
      ingested.push(event);

      // Publish to subscribers
      for (const sub of this._subscribers) {
        sub(event);
      }

      this._nextIndex++;
    }

    return ingested;
  }

  /** Ingest all remaining events at once (batch mode) */
  ingestAll(): SimEvent[] {
    return this.ingestUpTo(Infinity);
  }

  /** Reset for re-use */
  reset() {
    this._nextIndex = 0;
    this._ingestedCount = 0;
    this._seenIds.clear();
  }
}
