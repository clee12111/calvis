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
  async ingestUpTo(simTimeMs: number): Promise<SimEvent[]> {
    const ingested: SimEvent[] = [];

    // Collect events to ingest
    while (this._nextIndex < this._events.length) {
      const event = this._events[this._nextIndex];
      if (event.timestamp > simTimeMs) break;
      if (this._seenIds.has(event.id)) { this._nextIndex++; continue; }
      this._seenIds.add(event.id);
      this._ingestedCount++;
      ingested.push(event);
      this._nextIndex++;
    }

    // Batch persist
    if (ingested.length > 0) {
      await eventRepo.insertMany(
        ingested.map((e) => ({
          id: e.id,
          type: e.type,
          siteId: e.siteId,
          zoneId: e.zoneId,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
          severity: e.severity,
          timestamp: e.timestamp,
          rawDataJson: e.rawDataJson,
          groundTruthLabel: e.groundTruthLabel,
          scenarioId: e.scenarioId,
          createdAt: e.timestamp,
        }))
      );
    }

    // Notify subscribers
    for (const event of ingested) {
      for (const sub of this._subscribers) sub(event);
    }

    return ingested;
  }

  /** Ingest all remaining events at once (batch mode) */
  async ingestAll(): Promise<SimEvent[]> {
    return await this.ingestUpTo(Infinity);
  }

  /** Reset for re-use */
  reset() {
    this._nextIndex = 0;
    this._ingestedCount = 0;
    this._seenIds.clear();
  }
}
