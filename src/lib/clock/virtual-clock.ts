export type ClockListener = (simTimeMs: number) => void;

/**
 * Virtual clock abstraction. All domain code uses this instead of Date.now().
 * Supports:
 *  - Wall-clock 1:1 mode (×1)
 *  - Accelerated replay (×10, ×100, etc.)
 *  - Instant/batch mode for eval (advances only when told)
 *  - Pause/resume
 */
export class VirtualClock {
  private _simTimeMs: number = 0;
  private _speed: number = 1; // multiplier: 1 = realtime, 10 = 10x, 0 = paused
  private _running: boolean = false;
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _listeners: Set<ClockListener> = new Set();
  private _tickIntervalMs: number = 100; // how often to tick in wall time
  private _mode: "realtime" | "batch" = "realtime";

  constructor(startTimeMs: number = 0) {
    this._simTimeMs = startTimeMs;
  }

  get now(): number {
    return this._simTimeMs;
  }

  get speed(): number {
    return this._speed;
  }

  get running(): boolean {
    return this._running;
  }

  get mode(): string {
    return this._mode;
  }

  /** Set to batch mode — clock only advances via advanceTo/advanceBy */
  setBatchMode() {
    this.pause();
    this._mode = "batch";
  }

  /** Set to realtime mode with given speed multiplier */
  setRealtimeMode(speed: number = 1) {
    this._mode = "realtime";
    this._speed = speed;
  }

  /** Start the clock ticking in realtime mode */
  start(speed?: number) {
    if (speed !== undefined) this._speed = speed;
    if (this._running) return;
    this._running = true;
    this._mode = "realtime";

    this._intervalId = setInterval(() => {
      if (this._speed > 0) {
        this._simTimeMs += this._tickIntervalMs * this._speed;
        this._notifyListeners();
      }
    }, this._tickIntervalMs);
  }

  pause() {
    this._running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /** Set speed multiplier (×1, ×10, etc.) */
  setSpeed(speed: number) {
    this._speed = speed;
  }

  /** Advance to a specific sim time (batch mode) */
  advanceTo(simTimeMs: number) {
    if (simTimeMs < this._simTimeMs) return;
    this._simTimeMs = simTimeMs;
    this._notifyListeners();
  }

  /** Advance by a delta (batch mode) */
  advanceBy(deltaMs: number) {
    this._simTimeMs += deltaMs;
    this._notifyListeners();
  }

  /** Jump to a specific time without notifying (for seek) */
  jumpTo(simTimeMs: number) {
    this._simTimeMs = simTimeMs;
  }

  /** Subscribe to clock ticks */
  onTick(listener: ClockListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notifyListeners() {
    for (const listener of this._listeners) {
      listener(this._simTimeMs);
    }
  }

  /** Format sim time as HH:MM:SS for display (offset from night start) */
  formatTime(simTimeMs?: number): string {
    const ms = simTimeMs ?? this._simTimeMs;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    // Display as 20:00 + offset
    const displayHour = (20 + hours) % 24;
    return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  destroy() {
    this.pause();
    this._listeners.clear();
  }
}

// Singleton for the app — never use Date.now() in domain code
let _clock: VirtualClock | null = null;

export function getClock(): VirtualClock {
  if (!_clock) {
    _clock = new VirtualClock(0);
  }
  return _clock;
}

export function resetClock(startTimeMs: number = 0): VirtualClock {
  if (_clock) _clock.destroy();
  _clock = new VirtualClock(startTimeMs);
  return _clock;
}
