import seedrandom from "seedrandom";
import type { SimEvent, EvidenceLevel } from "../engine/scenarios";
import { getTrueEvidenceLevel, EVENT_SEVERITY, type EventType } from "../engine/scenarios";
import type { Incident, Guard } from "../db/schema";
import type { WorkingState, OpenQuestion, Move, Action, StateTransition } from "./types";
import { SYSTEM_ACTIONS, HUMAN_ACTIONS, RESPONSE_ACTIONS, FLOOD_THRESHOLD, moveCostUsd } from "./types";
import { chooseNextMove } from "./rules-decider";
import { resolveSystemQuestion, simulateHumanResponse, type QuestionContext } from "./sim-questions";

// ═══════════════════════════════════════════════════════════════════════════
// Decision log entry — append-only, one per move
// ═══════════════════════════════════════════════════════════════════════════

export interface DecisionLogEntry {
  incidentId: string;
  timestamp: number;
  move: Move;
  evidenceLevelBefore: EvidenceLevel;
  evidenceLevelAfter: EvidenceLevel;
  reason: string;
  boardLoad: number;
  costUsd: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop result — what the engine produces for one night
// ═══════════════════════════════════════════════════════════════════════════

export interface LoopResult {
  decisionLog: DecisionLogEntry[];
  finalStates: Map<string, WorkingState>;
  totalMoveCostUsd: number;
  totalMoves: number;
  /** Incidents that went through investigate→investigate→commit (or longer) */
  multiStepTraces: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Pending human response — scheduled for future resolution
// ═══════════════════════════════════════════════════════════════════════════

interface PendingHumanResponse {
  incidentId: string;
  questionId: string;
  answeredAt: number;
  answer: string;
  newLevel: EvidenceLevel | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Recheck entry — deferred incidents waiting for a future tick
// ═══════════════════════════════════════════════════════════════════════════

interface RecheckEntry {
  incidentId: string;
  recheckAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 0.8.5 — The loop engine
// ═══════════════════════════════════════════════════════════════════════════

const TICK_INTERVAL_MS = 30_000;    // 30s sim time per tick
const DECISION_DEADLINE_MS = 600_000; // 10 min max decision time

export class LoopEngine {
  private readonly rng: seedrandom.PRNG;
  private readonly events: SimEvent[];
  private readonly guards: Guard[];
  private readonly eventsByIncident = new Map<string, SimEvent[]>();
  private readonly states = new Map<string, WorkingState>();
  private readonly decisionLog: DecisionLogEntry[] = [];
  private readonly pendingResponses: PendingHumanResponse[] = [];
  private readonly rechecks: RecheckEntry[] = [];

  // Board load tracking: timestamps of items surfaced to operator in sliding window
  private readonly surfacedTimestamps: number[] = [];
  private readonly BOARD_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

  // Question ID counter — deterministic
  private questionCounter = 0;

  // Learning state — must reset per run (0.8.7 assertion target)
  private _learningStateReset = true;

  // Decider function — F1 replaces this and nothing else.
  private readonly deciderFn: (state: WorkingState, boardLoad: number) => Move | Promise<Move>;

  // LLM cost tracking for agent arms
  private _llmCalls = 0;
  private _llmCostUsd = 0;
  private _llmLatencyMs = 0;

  get llmCalls() { return this._llmCalls; }
  get llmCostUsd() { return this._llmCostUsd; }
  get llmLatencyMs() { return this._llmLatencyMs; }

  constructor(params: {
    seed: number;
    events: SimEvent[];
    incidents: Incident[];
    guards: Guard[];
    /** Optional decider function. Defaults to the rules-based chooseNextMove. */
    deciderFn?: (state: WorkingState, boardLoad: number) => Move | Promise<Move>;
  }) {
    // 0.8.7: one seeded RNG, injected
    this.rng = seedrandom(`loop-engine-${params.seed}`);
    this.events = params.events;
    this.guards = params.guards;
    this.deciderFn = params.deciderFn ?? chooseNextMove;

    // Map events to incidents
    const eventById = new Map(params.events.map((e) => [e.id, e]));
    for (const incident of params.incidents) {
      const eventIds: string[] = JSON.parse(incident.eventIds);
      const incEvents = eventIds
        .map((id) => eventById.get(id))
        .filter((e): e is SimEvent => e !== undefined);
      this.eventsByIncident.set(incident.id, incEvents);
    }

    // Initialize working state for each incident
    // 0.8.7: sort incidents by timestamp then id for deterministic processing order
    const sortedIncidents = [...params.incidents].sort((a, b) =>
      a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id.localeCompare(b.id)
    );

    for (const incident of sortedIncidents) {
      const incEvents = this.eventsByIncident.get(incident.id) ?? [];
      const initialLevel = assessInitialEvidence(incEvents);

      this.states.set(incident.id, {
        incidentId: incident.id,
        evidenceLevel: initialLevel,
        hypothesis: initialLevel > 0
          ? `Initial assessment: E${initialLevel} from event signals`
          : "unknown",
        openQuestions: [],
        evidenceGathered: [],
        decisionDeadline: incident.createdAt + DECISION_DEADLINE_MS,
        transitions: [],
        finalized: false,
        committedLevel: null,
      });
    }
  }

  /**
   * Assert learning state was reset. Call at run start.
   * 0.8.7: leaked priors make a learning curve look wonderful and mean nothing.
   */
  assertLearningStateReset(): void {
    if (!this._learningStateReset) {
      throw new Error(
        "DETERMINISM VIOLATION: Learning state was not reset between runs. " +
        "Leaked priors make a learning curve look wonderful and mean nothing."
      );
    }
    // Mark as used — if someone tries to reuse this engine across runs, it will fire
    this._learningStateReset = false;
  }

  /**
   * Run the full night through the evidence-state loop.
   * With the default rules decider: zero model calls.
   * With the agent decider: async LLM calls.
   */
  async run(): Promise<LoopResult> {
    this.assertLearningStateReset();

    // Find the time range from events
    if (this.events.length === 0) {
      return { decisionLog: [], finalStates: this.states, totalMoveCostUsd: 0, totalMoves: 0, multiStepTraces: [] };
    }

    const sortedEvents = [...this.events].sort((a, b) =>
      a.timestamp !== b.timestamp ? a.timestamp - b.timestamp : a.id.localeCompare(b.id)
    );
    const nightStart = sortedEvents[0].timestamp;
    const nightEnd = sortedEvents[sortedEvents.length - 1].timestamp + TICK_INTERVAL_MS * 2;

    // Main tick loop
    for (let simTime = nightStart; simTime <= nightEnd; simTime += TICK_INTERVAL_MS) {
      await this.tick(simTime);
    }

    // Force-finalize any remaining open incidents at night end
    for (const [id, state] of this.sortedStates()) {
      if (!state.finalized) {
        this.forceCommit(state, nightEnd, "night-end deadline");
      }
    }

    // Identify multi-step traces (investigate→...→commit)
    const multiStepTraces: string[] = [];
    for (const [id, state] of this.states) {
      const moves = state.transitions.map((t) => t.move.type);
      const investigateCount = moves.filter((m) => m === "investigate").length;
      if (investigateCount >= 2 && moves.includes("commit")) {
        multiStepTraces.push(id);
      }
    }

    return {
      decisionLog: this.decisionLog,
      finalStates: this.states,
      totalMoveCostUsd: this.decisionLog.reduce((s, e) => s + e.costUsd, 0),
      totalMoves: this.decisionLog.length,
      multiStepTraces,
    };
  }

  /**
   * One tick of the time-driven loop.
   * Handles: pending human responses, question timeouts, rechecks, board load, decisions.
   */
  private async tick(simTime: number): Promise<void> {
    // 1. Resolve pending human responses that have arrived by this time
    this.resolvePendingResponses(simTime);

    // 2. Handle open-question timeouts — silence is information
    this.handleQuestionTimeouts(simTime);

    // 3. Process rechecks falling due
    this.processRechecks(simTime);

    // 4. Compute board load for this tick
    const boardLoad = this.computeBoardLoad(simTime);

    // 5. Process each non-finalized incident
    //    0.8.7: deterministic order — sort by timestamp then id
    //    Batch async decider calls per tick for performance (agent arm)
    const pending: { id: string; state: WorkingState }[] = [];
    for (const [id, state] of this.sortedStates()) {
      if (state.finalized) continue;
      if (simTime >= state.decisionDeadline) {
        this.forceCommit(state, simTime, "decision deadline reached");
        continue;
      }
      if (this.rechecks.some((r) => r.incidentId === id && r.recheckAt > simTime)) {
        continue;
      }
      pending.push({ id, state });
    }

    // Batch LLM calls with bounded concurrency per tick
    const BATCH_SIZE = 20;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const moves = await Promise.all(
        batch.map(({ state }) => this.deciderFn(state, boardLoad))
      );
      // Execute moves in deterministic order (same order as sorted)
      for (let j = 0; j < batch.length; j++) {
        this.executeMove(batch[j].state, moves[j], simTime, boardLoad);
      }
    }
  }

  /**
   * Execute a move on an incident's working state.
   */
  private executeMove(state: WorkingState, move: Move, simTime: number, boardLoad: number): void {
    const levelBefore = state.evidenceLevel;

    switch (move.type) {
      case "investigate": {
        const action = move.action;

        if (action.category === "system_question") {
          // Resolve immediately
          const events = this.eventsByIncident.get(state.incidentId) ?? [];
          const ctx: QuestionContext = {
            events,
            siteId: events[0]?.siteId ?? "",
            rng: this.rng,
            guardAckRate: 0.9,
          };
          const result = resolveSystemQuestion(action.id, ctx);

          const qId = this.nextQuestionId();
          const question: OpenQuestion = {
            id: qId,
            action,
            askedAt: simTime,
            deadline: simTime, // instant
            answer: result.answer,
            answeredAt: simTime,
          };
          state.openQuestions.push(question);

          // Apply evidence
          if (result.newLevel !== null) {
            this.applyEvidence(state, result.newLevel, action.name, result.answer, simTime);
          }
          state.evidenceGathered.push({
            source: action.name,
            finding: result.answer,
            timestamp: simTime,
            levelChange: result.newLevel !== null && result.newLevel !== levelBefore
              ? { from: levelBefore, to: result.newLevel }
              : null,
          });
        } else if (action.category === "human_question") {
          // Schedule for future resolution
          const qId = this.nextQuestionId();
          const question: OpenQuestion = {
            id: qId,
            action,
            askedAt: simTime,
            deadline: simTime + action.expectedLatencyMs,
            answer: null,
            answeredAt: null,
          };
          state.openQuestions.push(question);

          // Simulate the human response
          const events = this.eventsByIncident.get(state.incidentId) ?? [];
          const guard = this.findGuardForSite(events[0]?.siteId ?? "");
          const ctx: QuestionContext = {
            events,
            siteId: events[0]?.siteId ?? "",
            rng: this.rng,
            guardAckRate: guard?.reliabilityAckRate ?? 0.9,
          };
          const response = simulateHumanResponse(action, simTime, ctx);

          if (response) {
            this.pendingResponses.push({
              incidentId: state.incidentId,
              questionId: qId,
              answeredAt: response.answeredAt,
              answer: response.answer,
              newLevel: response.newLevel,
            });
          }
          // else: guard never responds — timeout will handle this
        }
        break;
      }

      case "commit": {
        state.finalized = true;
        state.committedLevel = move.level;

        // Track board load — surfaced items (tier ≥ 1)
        if (move.level >= 1) {
          this.surfacedTimestamps.push(simTime);
        }
        break;
      }

      case "defer": {
        this.rechecks.push({
          incidentId: state.incidentId,
          recheckAt: move.recheckAt,
        });
        break;
      }
    }

    // Record transition
    const transition: StateTransition = {
      timestamp: simTime,
      move,
      evidenceLevelBefore: levelBefore,
      evidenceLevelAfter: state.evidenceLevel,
      reason: this.moveReason(move, state),
    };
    state.transitions.push(transition);

    // Append to decision log
    this.decisionLog.push({
      incidentId: state.incidentId,
      timestamp: simTime,
      move,
      evidenceLevelBefore: levelBefore,
      evidenceLevelAfter: state.evidenceLevel,
      reason: transition.reason,
      boardLoad: this.computeBoardLoad(simTime),
      costUsd: moveCostUsd(move),
    });
  }

  /**
   * Resolve pending human responses that have arrived by simTime.
   */
  private resolvePendingResponses(simTime: number): void {
    const ready = this.pendingResponses.filter((r) => r.answeredAt <= simTime);

    // 0.8.7: sort for deterministic processing
    ready.sort((a, b) =>
      a.answeredAt !== b.answeredAt ? a.answeredAt - b.answeredAt : a.questionId.localeCompare(b.questionId)
    );

    for (const response of ready) {
      const state = this.states.get(response.incidentId);
      if (!state || state.finalized) continue;

      const question = state.openQuestions.find((q) => q.id === response.questionId);
      if (!question || question.answer !== null) continue;

      question.answer = response.answer;
      question.answeredAt = response.answeredAt;

      if (response.newLevel !== null) {
        this.applyEvidence(state, response.newLevel, question.action.name, response.answer, simTime);
      }

      state.evidenceGathered.push({
        source: question.action.name,
        finding: response.answer,
        timestamp: simTime,
        levelChange: response.newLevel !== null && response.newLevel !== state.evidenceLevel
          ? { from: state.evidenceLevel, to: response.newLevel }
          : null,
      });
    }

    // Remove resolved from pending
    for (let i = this.pendingResponses.length - 1; i >= 0; i--) {
      if (this.pendingResponses[i].answeredAt <= simTime) {
        this.pendingResponses.splice(i, 1);
      }
    }
  }

  /**
   * Handle question timeouts. Silence after deadline is information:
   * if a human question went unanswered, that's a signal.
   */
  private handleQuestionTimeouts(simTime: number): void {
    for (const [, state] of this.sortedStates()) {
      if (state.finalized) continue;

      for (const q of state.openQuestions) {
        if (q.answer !== null) continue;
        if (q.action.category !== "human_question") continue;
        if (simTime < q.deadline) continue;

        // Question timed out — silence is information
        q.answer = "[no response — timeout]";
        q.answeredAt = simTime;

        state.evidenceGathered.push({
          source: q.action.name,
          finding: "No response (timeout). Silence is information — possible issue.",
          timestamp: simTime,
          levelChange: null,
        });

        // Remove any pending response for this question
        const pendIdx = this.pendingResponses.findIndex(
          (p) => p.incidentId === state.incidentId && p.questionId === q.id
        );
        if (pendIdx >= 0) this.pendingResponses.splice(pendIdx, 1);
      }
    }
  }

  /**
   * Process rechecks that are due at or before simTime.
   */
  private processRechecks(simTime: number): void {
    // Remove expired rechecks so the main loop will process these incidents
    for (let i = this.rechecks.length - 1; i >= 0; i--) {
      if (this.rechecks[i].recheckAt <= simTime) {
        this.rechecks.splice(i, 1);
      }
    }
  }

  /**
   * Compute current board load: items surfaced in the last 10-min window.
   */
  private computeBoardLoad(simTime: number): number {
    const windowStart = simTime - this.BOARD_WINDOW_MS;
    return this.surfacedTimestamps.filter((t) => t >= windowStart && t <= simTime).length;
  }

  /**
   * Apply evidence — evidence level can go UP or DOWN based on investigation.
   * A guard reporting "all clear" at E1 should lower evidence to E0.
   * A photo showing forced entry at E1 should raise evidence to E3.
   * Only investigation results can change level; initial assessment stands
   * until contradicted by a concrete finding.
   */
  private applyEvidence(
    state: WorkingState,
    newLevel: EvidenceLevel,
    source: string,
    finding: string,
    timestamp: number,
  ): void {
    if (newLevel !== state.evidenceLevel) {
      const oldLevel = state.evidenceLevel;
      state.evidenceLevel = newLevel;
      state.hypothesis = newLevel > oldLevel
        ? `Evidence level raised to ${newLevel} by ${source}`
        : `Evidence level lowered to ${newLevel} by ${source}: ${finding}`;
    }
  }

  /**
   * Force-commit an incident at its current evidence level.
   */
  private forceCommit(state: WorkingState, simTime: number, reason: string): void {
    const responseAction = this.getResponseForLevel(state.evidenceLevel);
    const commitMove: Move = {
      type: "commit",
      level: state.evidenceLevel,
      action: responseAction,
    };
    state.finalized = true;
    state.committedLevel = state.evidenceLevel;

    if (state.evidenceLevel >= 1) {
      this.surfacedTimestamps.push(simTime);
    }

    state.transitions.push({
      timestamp: simTime,
      move: commitMove,
      evidenceLevelBefore: state.evidenceLevel,
      evidenceLevelAfter: state.evidenceLevel,
      reason,
    });

    this.decisionLog.push({
      incidentId: state.incidentId,
      timestamp: simTime,
      move: commitMove,
      evidenceLevelBefore: state.evidenceLevel,
      evidenceLevelAfter: state.evidenceLevel,
      reason,
      boardLoad: this.computeBoardLoad(simTime),
      costUsd: moveCostUsd(commitMove),
    });
  }

  private getResponseForLevel(level: EvidenceLevel): Action {
    const map: Record<number, string> = {
      0: "suppress",
      1: "log_and_watch",
      2: "notify_guard",
      3: "dispatch_backup",
      4: "escalate_overwatch",
    };
    return RESPONSE_ACTIONS.find((a) => a.id === map[level]) ?? RESPONSE_ACTIONS[0];
  }

  private findGuardForSite(siteId: string): Guard | undefined {
    return this.guards.find((g) => g.siteId === siteId);
  }

  private nextQuestionId(): string {
    return `q-${String(this.questionCounter++).padStart(5, "0")}`;
  }

  private moveReason(move: Move, state: WorkingState): string {
    switch (move.type) {
      case "investigate":
        return `Investigating: ${move.action.name}`;
      case "commit":
        return `Committing at evidence level ${move.level}: ${move.action.name}`;
      case "defer":
        return `Deferring: recheck at ${move.recheckAt}`;
    }
  }

  /**
   * 0.8.7: sorted iteration over states for deterministic processing.
   * Sort by creation timestamp, then by id for ties.
   */
  private sortedStates(): [string, WorkingState][] {
    return [...this.states.entries()].sort((a, b) => {
      const stateA = a[1];
      const stateB = b[1];
      const timeA = stateA.transitions[0]?.timestamp ?? stateA.decisionDeadline - DECISION_DEADLINE_MS;
      const timeB = stateB.transitions[0]?.timestamp ?? stateB.decisionDeadline - DECISION_DEADLINE_MS;
      return timeA !== timeB ? timeA - timeB : a[0].localeCompare(b[0]);
    });
  }

  /**
   * Format a full trace for one incident (for display/debugging).
   */
  static formatTrace(state: WorkingState): string {
    const lines: string[] = [
      `Incident ${state.incidentId}:`,
      `  Evidence: E${state.evidenceLevel} | Committed: ${state.committedLevel ?? "none"} | Finalized: ${state.finalized}`,
    ];

    for (const t of state.transitions) {
      const arrow = t.evidenceLevelBefore !== t.evidenceLevelAfter
        ? ` [E${t.evidenceLevelBefore}→E${t.evidenceLevelAfter}]`
        : "";
      lines.push(`  ${t.move.type.padEnd(12)} ${t.reason}${arrow}`);
    }

    return lines.join("\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Initial evidence assessment from event signals
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assess initial evidence level from the events in an incident.
 * This is what the events themselves tell us BEFORE any investigation.
 *
 * E0 = nothing to act on (low-severity sensor noise)
 * E1 = something happened, intent unknown (moderate signals)
 * E2 = human presence confirmed (guard events, multiple correlated signals)
 * E3 = threat to property confirmed (forced entry, unknown plate + motion)
 * E4 = threat to life confirmed (panic button, geofence exit + radio flag)
 *
 * Never uses ground truth — only observable event types and severity.
 */
export function assessInitialEvidence(events: SimEvent[]): EvidenceLevel {
  if (events.length === 0) return 0;

  const types = new Set(events.map((e) => e.type as EventType));
  const maxSeverity = Math.max(...events.map((e) => e.severity));

  // E4: panic button or geofence exit with radio transcript
  if (types.has("panic_button")) return 4;
  if (types.has("geofence_exit") && types.has("radio_transcript_flag")) return 4;

  // E3: door forced, or multiple high-severity correlated signals
  if (types.has("door_forced")) return 3;
  if (maxSeverity >= 4 && types.size >= 2) return 3;

  // E2: guard-related events confirm human presence
  if (types.has("no_show_at_shift_start")) return 2;
  if (types.has("missed_check_in") && events.filter((e) => e.type === "missed_check_in").length >= 2) return 2;
  if (types.has("plate_read_unknown") && types.size >= 2 && maxSeverity >= 3) return 2;

  // E1: moderate signals — something happened
  if (maxSeverity >= 3) return 1;
  if (types.size >= 2 && maxSeverity >= 2) return 1;
  if (types.has("plate_read_unknown")) return 1;
  if (types.has("radio_transcript_flag")) return 1;
  if (types.has("missed_check_in")) return 1;

  // E0: low-severity noise
  return 0;
}
