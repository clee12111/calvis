import { VirtualClock, resetClock } from "../clock/virtual-clock";
import { IngestionPipeline, type EventCallback } from "./ingestion";
import type { SimEvent } from "./scenarios";
import type { Incident } from "../db/schema";

export type IncidentCallback = (incident: Incident) => void;

/**
 * SimManager orchestrates a simulation run:
 *  - Manages the virtual clock
 *  - Feeds events through ingestion
 *  - Triggers correlation and scoring
 *  - Publishes updates to SSE subscribers
 */
export class SimManager {
  readonly clock: VirtualClock;
  readonly pipeline: IngestionPipeline;
  private _eventListeners: Set<EventCallback> = new Set();
  private _incidentListeners: Set<IncidentCallback> = new Set();
  private _correlator: ((events: SimEvent[]) => Promise<Incident[]>) | null = null;
  private _scorer: ((incident: Incident) => Promise<void>) | null = null;

  constructor(events: SimEvent[]) {
    this.clock = resetClock(0);
    this.pipeline = new IngestionPipeline(events);

    // Wire up: when events are ingested, notify listeners
    this.pipeline.subscribe((event) => {
      for (const listener of this._eventListeners) {
        listener(event);
      }
    });
  }

  /** Register the correlator function */
  setCorrelator(fn: (events: SimEvent[]) => Promise<Incident[]>) {
    this._correlator = fn;
  }

  /** Register the scorer function */
  setScorer(fn: (incident: Incident) => Promise<void>) {
    this._scorer = fn;
  }

  /** Subscribe to events */
  onEvent(callback: EventCallback): () => void {
    this._eventListeners.add(callback);
    return () => this._eventListeners.delete(callback);
  }

  /** Subscribe to incidents */
  onIncident(callback: IncidentCallback): () => void {
    this._incidentListeners.add(callback);
    return () => this._incidentListeners.delete(callback);
  }

  private _notifyIncident(incident: Incident) {
    for (const listener of this._incidentListeners) {
      listener(incident);
    }
  }

  /**
   * Process a single tick: ingest events up to current clock time,
   * correlate, score.
   */
  async tick(): Promise<{ events: SimEvent[]; incidents: Incident[] }> {
    const events = await this.pipeline.ingestUpTo(this.clock.now);
    const incidents: Incident[] = [];

    if (events.length > 0 && this._correlator) {
      const newIncidents = await this._correlator(events);
      for (const inc of newIncidents) {
        if (this._scorer) {
          await this._scorer(inc);
        }
        this._notifyIncident(inc);
        incidents.push(inc);
      }
    }

    return { events, incidents };
  }

  /**
   * Run the entire simulation in batch mode (for eval).
   * Advances clock through all events, processing each batch.
   */
  async runBatch(): Promise<{ totalEvents: number; totalIncidents: number }> {
    this.clock.setBatchMode();
    let totalIncidents = 0;

    const allEvents = await this.pipeline.ingestAll();

    if (this._correlator) {
      const incidents = await this._correlator(allEvents);
      for (const inc of incidents) {
        if (this._scorer) {
          await this._scorer(inc);
        }
        totalIncidents++;
      }
    }

    return {
      totalEvents: allEvents.length,
      totalIncidents,
    };
  }

  /**
   * Start realtime playback at given speed.
   */
  startRealtime(speed: number = 1) {
    this.clock.start(speed);
    // Set up periodic ticking with async handling
    let ticking = false;
    const tickInterval = setInterval(async () => {
      if (!this.clock.running) {
        clearInterval(tickInterval);
        return;
      }
      if (ticking) return; // prevent overlapping async ticks
      ticking = true;
      try {
        await this.tick();
      } catch (err) {
        console.error("Tick error:", err);
      }
      ticking = false;
      if (this.pipeline.done) {
        this.clock.pause();
        clearInterval(tickInterval);
      }
    }, 100); // tick every 100ms wall time
  }

  destroy() {
    this.clock.destroy();
    this._eventListeners.clear();
    this._incidentListeners.clear();
  }
}

// Singleton for the running simulation
let _manager: SimManager | null = null;

export function getSimManager(): SimManager | null {
  return _manager;
}

export function setSimManager(manager: SimManager) {
  if (_manager) _manager.destroy();
  _manager = manager;
}

export function clearSimManager() {
  if (_manager) _manager.destroy();
  _manager = null;
}
