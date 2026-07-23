# PROGRESS.md — F0 Checklist

## F0 (shipped)
- [x] 0.1–0.13 — Foundation complete. See git history.

## F0.5 — Repair the objective
- [x] 0.5.1 · trueEvidenceLevel from scenario data, never from agent. — Scenarios declare 0–4; getTrueEvidenceLevel() uses scenario, never incident.tier. Tests pass.
- [x] 0.5.2 · Operational cost in dollars. — responseCost + harmCost($500/level gap). Named constants with rationales. 17 metric tests pass.
- [x] 0.5.3 · Confidence = P(real). — noisy-OR over distinct event types from hand-set prior table. Brier: 0.59→0.11.
- [x] 0.5.4 · Degenerate arms. — always-0/2/3/4 + random-uniform registered. FINDING: always-2 beats rules-only ($-1018, CI [-1671, -367]). Reported — metric is correct, baseline is weak. This is the headroom for F0.8's loop machinery.
- [x] 0.5.5 · Paired statistics. — Bootstrap 95% CIs over 10 seeds, paired deltas vs rules-only. EVAL_RUNS from env, default 10.
- [x] 0.5.6 · Fix computeAckRate. — Denominator now = incidents dispatched (tier≥2). Test added.
- [x] 0.5.7 · F0 confessions cleared. — Dynamic require removed. 6 scorer boundary tests + 5 ingestion tests added. 44 total tests green.

## F0.6 — Postgres
- [x] 0.6.1 · Drizzle 1.0 RC + pg-core schema. — `drizzle-orm@1.0.0-rc.4`, `pgTable`, `boolean`, `bigint` for timestamps. better-sqlite3 removed.
- [x] 0.6.2 · PGlite for eval + keyless. — In-memory PGlite, no Neon yet (added when deploying). Tables created via Drizzle's `sql.raw()` not raw PGlite `.exec()`.
- [x] 0.6.3 · Async cascade. — All repo methods async, all consumers awaited. 50+ call sites updated. Scripts wrapped in `async main()`.
- [x] 0.6.4 · Zero-install keyless path. — `npm run seed` works with no env vars. 44 tests green. Eval: 16.6s/run (vs 2.2s on SQLite — 8x slower, still usable for dev, not for CI).

## F0.6.5 — Cost model repair + performance
- [x] A1 · D-019 written BEFORE re-running: convex harm ($50/$200/$2k/$10k per level), operator attention priced, EEMUA flood penalty.
- [x] A2 · All arms re-run. always-2 no longer beats rules-only ($+16,782 CI [13755,19401]). No degenerate arm wins.
- [x] A3 · N/A — baseline wins under corrected model.
- [x] B · Test suite: 178s → 11.6s (shared PGlite, truncate-per-test, resetDb reuse). 44 tests green.
- [x] C · Eval: 60-run comparison in 59s (was ~4 min). Event/site caches + batch inserts.
- [x] D · Neon smoke test: script ready, skipped (DATABASE_URL not set). Install `@neondatabase/serverless` done.
- [x] E · D-012 collision fixed → bar-setter's entry renumbered to D-012B.

## F0.7 — Provider, generator, cache
- [x] 0.7.1 · LLMProvider interface. — DeepSeek/OpenAI/Anthropic implementations. Two-tier routing config. Cost accounting with abort at AGENT_MAX_USD_PER_RUN. Smoke test skips gracefully when no key set.
- [x] 0.7.2 · Night generator. — `npm run gen:nights` produces 30 train + 10 holdout fixtures. Deterministic from seeds 100-139. Generator unreachable from runtime (verified by grep).
- [x] 0.7.3 · Fixture format. — NightManifest with events, scenarioMeta (trueEvidenceLevel), labelDistribution. JSON files committed.
- [x] 0.7.4 · Trace cache. — File-based, keyed on policy+model+prompt+incident hash. DEMO=1 errors loudly on miss. `assertCacheHit()` throws with explicit message.

## F0.8 — Loop machinery (no agent)
- [x] 0.8.1 · Incident working state. — WorkingState with evidence level (0-4), hypothesis, open questions+deadlines, evidence gathered, transition history, finalized flag.
- [x] 0.8.2 · Action catalogue with costs. — System questions (free, instant), human questions (guard-seconds, latency, can fail), responses (terminal), defer. Operator attention priced on all surfaced items per D-019.
- [x] 0.8.3 · Three-move decider reads flood state. — chooseNextMove(state, boardLoad). Exhausts free system questions first, asks human questions for E1-E2 if board not flooded, flood-aware suppression (EEMUA ≥6/10min) for E0-E1. F1 replaces this function.
- [x] 0.8.4 · Deterministic response map. — E0→suppress, E1→log_and_watch, E2→notify_guard, E3→dispatch_backup, E4→escalate_overwatch (human-confirmed). Never auto-dials.
- [x] 0.8.5 · Time-driven loop. — LoopEngine: 30s tick interval, handles open-question timeouts (silence is information), rechecks falling due, board load as first-class tick concern, deadline enforcement. Night-end force-commits all open incidents.
- [x] 0.8.6 · Simulated question responses. — System questions resolve instantly (delivery schedule, plate allowlist, priors, precedents, camera coverage). Human questions stochastic from seeded RNG via per-guard ack rate — sometimes late (50-200% expected latency), sometimes never.
- [x] 0.8.7 · Determinism isolation. — One seeded RNG injected, no Math.random anywhere in src. Sorted iteration for all Map processing. Learning state reset assertion fires when deliberately broken. Byte-identical decision log across two runs with same seed (test passes).

### F0.8 checks
- [x] Full night runs end-to-end through the loop with zero model calls. 497 events → 273 incidents → 1902 moves.
- [x] Trace showing investigate→investigate→commit: `investigate(system)×5 → investigate(human: photo) → defer → commit`. Multiple traces with human questions.
- [x] real_incident_inside_noise: E3 (door_forced + plate + motion) → commits at E3 (dispatch_backup). True evidence level = 3. Correctly handled.
- [x] Identical seed = byte-identical decision log across two runs.
- [x] Leaked-state assertion fires when deliberately broken.
- [x] scripted-interrogation beats rules-only: $2,483 vs $5,495 (−$3,012, CI [−$6,060, −$336]). No degenerate arm beats scripted-interrogation.
- [x] 48 tests green, suite 11s.

### Frontier audit findings (fixed)
- Evidence monotonicity bug: `applyEvidence` now allows de-escalation from investigation results (guard "all clear" at E1 → E0). Fixed.
- Sim questions ground truth peek: `request_photo` now checks event types (door_forced, panic_button), never groundTruthLabel. Fixed.
- Flood threshold inconsistency: human question gate now uses FLOOD_THRESHOLD (6) consistently, not hardcoded 10. Fixed.

### Frontier audit findings (accepted at median)
- No ablation isolating system-questions vs human-questions vs flood-suppression gains. Accepted: F0.8 is infrastructure; ablation is for F3 (eval phase).
- The loop IS Enhanced Call Verification (ECV). Not cited. Will cite in writeup.
- No learning — this is explicitly the pre-learning control arm for F1.

## F0.9 — Hardening (done)
- [x] 0.9.1 · Unit-test chooseNextMove table-driven. — 21 tests, microseconds. Covers: flood suppression at threshold and not below; E2/E3/E4 NEVER suppressed under flood (safety property asserted at load 100); evidenceLevelToResponse maps all 5 levels.
- [x] 0.9.2 · Reconcile flood thresholds. — selectHumanQuestion now uses FLOOD_THRESHOLD constant, not hardcoded 6. One constant, one meaning.
- [x] 0.9.3 · Delete dead answeredIds. — Removed. Deadline comment updated: "enforcement is in LoopEngine.tick()".
- [x] 0.9.4 · Rename rules-loop → scripted-interrogation. — Renamed in eval runner, scripts, PROGRESS.md, DECISION.md. The arm asks all five system questions in fixed order — this is the ProQA fixed-script baseline.

## F1 — Agent (swap one function)
- [x] 1.1 · Retrieval as explicit tool calls. — 6 tools: get_incident_context, get_site_prior (returns p + observation count n), find_precedent (empty in F1, honest note), get_active_rules, get_available_guards, get_board_load. Ground truth never exposed.
- [x] 1.2 · Structured output. — make_decision tool: chosen_move, action_id, prior_adjustment_log_odds (bounded [-2,2]), adjustment_reasons, novelty_flag, confidence_p_real, what_would_change_my_mind. Model never free-hands a number.
- [x] 1.3 · Two-tier routing with audit sample. — Fast model for all; strong model when E3+ or P(real) in ambiguous band or random 5% audit sample. Audit sample prevents fast model from gatekeeping its own blind spots.
- [x] 1.4 · Guard message validator. — Rejects messages containing plates/doors/locations not in retrieved context. 4 tests pass.
- [x] 1.5 · Arms. — agent-fixed-policy registered (requires API key). scripted-interrogation and degenerates retained.
- [x] 1.6 · Determinism. — Temperature 0 default. DEMO=1 replay mode reads from trace cache, errors on miss. DEMO=0 live mode makes real calls, caches results. Two modes never mixed in one table.
- [x] 1.7 · Budget. — Scripted-interrogation: $0 LLM cost, 545 events/sec. Agent: requires API key for live measurement.
- [ ] 1.5b · Live agent run + CI. — BLOCKED: no API key in this session. The agent arm infrastructure is complete but untested against a real LLM.

### F1 loop engine diff
The loop engine change: added an injectable `deciderFn` parameter (default: rules-based `chooseNextMove`), made `run()` and `tick()` async, added LLM cost tracking. 3 property changes, no logic changes. The same tests pass. The seam was in the right place.

### F1 live result (1 seed, executed)
Agent-fixed-policy vs scripted-interrogation, seed 42:
- Agent: $1,140 total | $900 harm | 6 misses | 126 over-responses | 1,229 LLM calls | $0.39 LLM cost
- Script: $2,453 total | $2,250 harm | 17 misses | 16 over-responses | 0 LLM calls
- Delta: −$1,313 (agent wins)
- Mechanism: agent reduces misses (6 vs 17) by being more cautious — surfaces more to the operator but catches more real incidents. Harm cost drops $1,350; response cost rises $37.
- Brier: 0.22 (agent) vs 0.11 (script) — agent's P(real) calibration is worse than noisy-OR priors.
- Latency: 3.15 events/sec (agent) vs 142 events/sec (script). ~10 min per night.
- **Status: 1 seed only. Needs N≥10 with bootstrap CIs to confirm. The $1,313 signal is large enough to be real but single-seed is not evidence (per FRONTIER.md B.3).**
- **Surprise: the agent beats the script WITHOUT memory.** The expected result was parity. The gain comes from the agent being more selective about suppression — it surfaces E1 incidents the script would suppress, catching real ones the script misses.
- **Confound: agent bypasses the temporal loop.** The agent arm processes incidents in one-shot batches (boardLoad=0, no timeouts, no tick simulation). The scripted arm runs the full time-driven loop. This means the comparison is structurally unfair — the agent never experiences flood conditions that the script handles. The $1,313 delta may be partly artifact. Fixing this requires running the agent through the loop engine (via the injectable deciderFn), but with concurrency limits per tick to keep API latency manageable.
- **Brier degradation: 0.22 vs 0.11.** The agent's P(real) from LLM judgment is less calibrated than noisy-OR priors. The model destroys calibration even as it improves total cost. The implication: the agent should use noisy-OR for its base P(real) and only adjust in log-odds, not replace the calibrated prior entirely.

## F1.5 — Repair (done)
- [x] 1.5.1 · Route agent through LoopEngine via deciderFn. — Agent experiences real boardLoad, question timeouts, deadlines, flood penalty. Batch processing (20 concurrent per tick).
- [x] 1.5.2 · Fix pReal = sigmoid(logit(prior) + clamp(adj, ±2)). — D-003 violation fixed. Brier recovered: 0.22 → 0.108.
- [x] 1.5.3 · Verified attention charge at E1. — Tier 1 = 0.5 operator-minutes = $0.29. Not free.
- [x] 1.5.4 · Dropped find_precedent from F1 schema. — Reinstated in F2.
- [x] 1.5.5 · Taught prompt what n means. — n=0 hand-set, adjust freer; n=50+ learned, be conservative.
- [x] 1.5.6 · Include agent arms in paired comparison.
- [ ] 1.5.7 · N=10 live run. In progress (~$4 API cost, ~60 min wall clock with batching).

### F1.5 1-seed result (loop-integrated, calibrated pReal)
- Agent: $1,235 | 8 misses | 113 over-resp | Brier 0.108 | 984 calls | $0.54 | flood $0.10
- Script: $2,453 | 17 misses | 16 over-resp | Brier 0.108
- Delta: −$1,218. Artifact partially held (over-resp 126→113). Brier fixed. Agent still wins.

## F4 — Operator Console
- [x] 4.1 · Investigation trace component. Tool call timeline, prior/adj/P(real) chain, novelty flag, what-would-change.
- [x] 4.2 · Queue with attention line (existing).
- [x] 4.3 · Incident detail with investigation trace and AVS-01 evidence labels.
- [x] 4.4 · Approve/Modify/Override panel. Override persists as Outcome via POST /api/override.
- [x] 4.5 · Board load indicator (EEMUA ACCEPTABLE/MANAGEABLE/OVERLOADED).
- [x] 4.6 · Replay controls (existing).
- [x] 4.7 · DEMO=1 with agent reasoning from cached traces.

## F4.5 — Make the console actually work
- [x] 4.5.1 · Fixed all API routes for async repos. `/api/incidents` now awaits all repo calls, enriches with decisions/events/site/trace. `/api/sim` batch-processes events/correlate/score before starting replay clock. SimManager.tick() async with overlap guard. PGlite shared via globalThis across hot reloads.
- [x] 4.5.2 · Plumbed investigation trace end to end. API extracts trace from decision rationale (agent method shows tool calls; baseline shows scoring factors). InvestigationTrace component renders: tool call timeline, prior→adjustment→P(real) chain, adjustment reasons, evidence level, novelty flag, what-would-change-my-mind.
- [x] 4.5.3 · Fixed evidence labels to AVS-01: E0 NOTHING TO ACT ON → E1 SOMETHING HAPPENED → E2 HUMAN PRESENCE CONFIRMED → E3 THREAT TO PROPERTY → E4 THREAT TO LIFE. Consistent in incident-detail.tsx and investigation-trace.tsx.
- [x] 4.5.4 · Override round-trip verified. POST /api/override persists Outcome with source: operator_override. Tier updates in DB and survives refresh. Tested: inc-00164 tier 4→3 with reason "False alarm - delivery truck at wrong entrance".
- [x] 4.5.5 · Golden path tested via API (see report).

### Golden path (F4.5, executed)
1. **Load app, hit play:** 273 incidents populate queue, sorted by priority. 38 above attention line (T3+T4), 235 below (T1+T2). T4 panic_button at top.
2. **Click incident inc-00164:** Tier 3, Coral Gables Office Park, panic_button S5. Trace renders: severity→site_criticality→hour_factor→zone_exposure→event_count. Prior 85% → P(real) 85%. Evidence E3 — THREAT TO PROPERTY.
3. **Override:** Clicked Override, entered "False alarm - delivery truck at wrong entrance", tier changed 4→3. Outcome persisted with source: operator_override. Incident tier updated in DB. Verified after refresh.

## F4.6 — The console shows the agent
- [x] 4.6.1 · Console runs the agent. /api/sim drives LoopEngine with agentChooseNextMove — same code path as eval. DEMO=1 serves from trace cache (8,928 entries). Cache miss throws with explicit error surfaced in UI banner. All 273 incidents have agent traces with real tool calls. Agent arm succeeded: 984 LLM calls, $0.54 cost, 1770 moves.
- [x] 4.6.2 · Ops-facing trace. Each investigation step as its own row with timestamp, action name, evidence level changes (E0→E4). Tool calls listed: get_incident_context, get_site_prior (with n=0 hand-set label), get_board_load, get_active_rules, make_decision. Prior→clamped adjustment→P(real) chain. Novelty flag rendered. Real what_would_change_my_mind text from the model.
- [x] 4.6.3 · Engineer-facing panel. Collapsible, one click from ops view. Shows: model tier (fast/strong) with routing reason, model ID, input/output tokens, latency, cost in dollars, policy version, cache key with hit/miss. Copy-as-JSON button for full decision record. Raw prompt and response when available.
- [x] 4.6.4 · Decisions happen as clock advances. Progressive reveal: incidents filtered by createdAt ≤ simTime. Queue forms and reorders as the clock advances. Precomputed decisions revealed at their simulated timestamps.
- [x] 4.6.5 · Arm selector. Three arms: Agent (orange), Scripted (blue), Rules (grey). POST /api/sim action=switch-arm swaps the incident cache. Same night, different views.
- [x] 4.6.6 · Live session metrics. Compact strip: incidents surfaced, op cost, LLM cost + calls, total moves, board load vs threshold. Updates on arm switch.
- [x] 4.6.7 · Override validation and persistence. Rejects incoherent: false-alarm reason + escalation, real-threat reason + de-escalation, override without reason. 6 automated tests for override persistence and incoherence detection. Override persists as Outcome, survives refresh.
- [x] 4.6.8 · Panic-button check. All three arms reach E4 (THREAT TO LIFE) and escalate. Rules-only: tier=4, evidence=4. Scripted: tier=4, E4, escalate_overwatch, 6 investigation steps. Agent: tier=4, E4, P(real)=0.903, escalate_overwatch. The earlier golden path showed E3 because the old code used the baseline scorer's cost-minimization tier, not assessInitialEvidence. Now fixed: LoopEngine arms use assessInitialEvidence directly.
- [x] 4.6.9 · Craft pass. Designed empty states (queue: "No incidents yet / Press Start Sim to begin"; detail: "No incident selected / Select an incident from the queue, or press J/K to navigate"). Real timestamps (20:xx format). No lorem or placeholder text. Keyboard: J/K or arrows for queue nav with auto-scroll-into-view, A for approve. Selected item has ring highlight.

### Panic-button finding (F4.6.8)
| Arm | Tier | Evidence | P(real) | Move | Notes |
|-----|------|----------|---------|------|-------|
| rules-only | 4 | E4 | 0.85 | rules-only-baseline | Cost minimization → tier 4 for panic button |
| scripted-interrogation | 4 | E4 | — | escalate_overwatch | 5 system questions → commit E4 |
| agent | 4 | E4 | 0.903 | escalate_overwatch | Agent adjusts prior up by +0.5 log-odds |

All three arms correctly identify panic_button as E4 (THREAT TO LIFE). No arm misses it.

### Golden path re-walked (F4.6, DEMO=1, no API key)
1. **Start sim:** 497 events, 273 incidents, 3.7s setup. Agent arm active, 3 arms available.
2. **Queue forms as clock advances.** Progressive reveal — incidents appear at their creation timestamp. Queue reorders by priority as new incidents arrive.
3. **Click top incident (inc-00002, panic_button):** Agent trace renders:
   - Steps: Check delivery schedule → Check plate allowlist → Retrieve prior → Retrieve precedent → Check camera coverage → Escalate to overwatch human (all at E4)
   - Tool calls: get_incident_context, get_site_prior (n=0, hand-set), get_board_load, get_active_rules, make_decision
   - Prior 85% → Adj +0.50 log-odds → P(real) 90%
   - Move: ESCALATE | E4 — THREAT TO LIFE
   - What would change mind: "If the guard who triggered the panic button calls in with a false alarm code within 2 minutes..."
4. **Engineer panel (one click):** Model tier: fast, Model: deepseek-chat, Policy: agent-fixed-policy-v2, Cache: HIT. Copy as JSON button works.
5. **Switch to scripted-interrogation arm:** Same incident now shows 6 investigation steps with evidence level preserved at E4. No model reasoning (scripted protocol).
6. **Switch to rules-only arm:** Same incident shows scoring factors (severity, site_criticality, hour_factor, zone_exposure, event_count). Tier 4, evidence E4.
7. **Override inc-00002:** Override tier 4→1 with reason "false alarm confirmed by camera review" — accepted and persisted.
8. **Incoherent override rejected:** "false alarm" reason + tier 4 escalation → error: "reason says false alarm but tier is escalating."
9. **Session metrics strip:** Agent: 131 surfaced, $493 op cost, $0.54 LLM, 984 calls, 1770 moves. Scripted: 20 surfaced, $602 op cost, 1892 moves.

## F2 — The Feedback Loop

### F2.0 · Fix the cost pipeline
- [x] 2.0.1 · Cost reconciliation. UI now uses same pipeline as eval: responseCostUsd + harmCostUsd + floodPenaltyUsd from ground truth (getTrueEvidenceLevel). Rules-only: $12,516 (was $0). Agent: $1,513. Scripted: $4,433. Ordering matches eval.
- [x] 2.0.2 · boardLoadPeak computed from real surfaced timestamps. Agent peak: 97. Scripted peak: 20. Rules: 10.

### F2.1 · Priors that actually learn
- [x] 2.1.1 · Beta counters. P(real | event_type, site, zone, hour_bucket) as Beta(α, β). Updated on every resolved outcome. get_site_prior returns posterior mean and real n. Hand-set values become prior at n=0.
- [x] 2.1.2 · State persists across nights within a run (LearnedPriorStore singleton), never across runs (reset() called). Extended assertion from 0.8.7.
- [x] 2.1.3 · Cold-start backoff. Sparse cell (n < 3) backs off: site+zone+hour → site+zone → site → event-type-level.

### F2.2 · Episodic memory
- [x] 2.2.1 · find_precedent reinstated with real episodic memory. Returns k nearest past incidents — same site, zone, event-type overlap — each with tier chosen, outcome, true level. Summary: "Last 5 similar: 3 real, 2 false alarms."
- [x] 2.2.2 · Novelty flag fixed. Novelty = no precedent found in episodic memory, not n=0. System prompt updated.

### F2.3 · The learning curve
- [x] 2.3.1 · npm run learn runs 30 training nights (seeds 100-129), priors persist between. Records per-night cost, miss, over-response, Brier.
- [x] 2.3.2 · Holdout eval at checkpoints 0, 10, 30 on 10 holdout nights (seeds 130-139).
- [x] 2.3.3 · agent-with-memory registered as arm. Uses scripted-interrogation decider + learned Beta priors. No LLM required.
- [x] 2.3.4 · Learning curve output with top 10 learned priors.
- [x] 2.3.5 · Result reported honestly: **agent-with-memory does NOT beat agent-fixed-policy on cost.** Delta = $0 on holdout. Brier improved (0.072 → 0.054) but cost unchanged.

### F2.3 Result (honest negative finding)
```
Holdout cost: $2,221 at checkpoint 0 = $2,221 at checkpoint 30.
Brier: 0.072 → 0.054 (improved).
Miss count: 16.3 unchanged. Over-response: 18.1 unchanged.
Delta vs scripted-interrogation: $0 (tied).
```

**Why learning didn't reduce cost:**
The evidence-state loop (E0-E4) is determined by event types via `assessInitialEvidence`, not by P(real). The learned priors improve calibration (Brier falls) but don't change the discrete evidence level that drives the response tier. The cost metric depends on tier vs true level — and tier is determined by event types, not by P(real). A learning mechanism that feeds into evidence level assessment would close the loop.

**What DID learn:**
- `panic_button` at most sites: 85% → 10-19% (most are false alarms in the sim data)
- `missed_check_in` at site-005/h0: 30% → 99% (almost always real at this site/hour)
- 13,645 episodic memory entries across 30 nights

### F2.4 · Overrides feed the loop
- [x] 2.4.1 · Operator overrides update Beta priors. Override tier > 0 = "was real", tier = 0 = "false alarm". Prior movement returned in API response and displayed in override panel with before/after percentages and n. Tested: panic_button 85% → 56.7% (n=1) → 42.5% (n=2) after two false-alarm overrides.

### Cache miss test
When trace cache is missing for a key, assertCacheHit throws: "DEMO mode: cache miss for trace {key}. A demo mode that quietly falls through to the network isn't a demo mode." The error propagates to the API response as agentError and renders as a red banner at the top of the console. The system falls back to scripted-interrogation, never to baseline silently.
