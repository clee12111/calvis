# Calvis — Technical Writeup

## 1. What this is

Calvis is an AI dispatch agent for physical security operations. It ingests a stream of sensor events from guards and robots across 40+ sites overnight, decides how much response each incident earns on a five-tier evidence ladder, and is measured against a dollar-denominated cost that penalizes both misses and over-response. The agent's decisions are inspectable: every tool call, probability adjustment, and stated reasoning is visible, one click from the operator's view.

## 2. How to see it

Clone and run (`npm install && npm run build && npm start`) or visit the hosted demo. No API key or database required — the agent's LLM traces are committed to the repo and replayed deterministically.

Click **Run Demo Night** to simulate a 10-hour shift. 273 incidents stream in. Click any one to see a chronological timeline: sensor events interleaved with the agent's investigation steps and its final analysis — the probability it computed, why it adjusted, and what evidence would change its mind.

For engineers: inside the agent analysis block, click **Show full model thinking** to see the raw LLM response. The model metadata is there — which tier ran (fast vs. strong), why it escalated, input/output tokens, latency, cost in dollars, cache hit/miss. This is the machinery layer. It's one click from the ops view because both audiences — the operator asking "why did it escalate?" and the engineer asking "which model handled this?" — need the same decision record, rendered differently.

## 3. The core idea and why it's shaped this way

**The unit of work is a response tier, not a severity guess.** The agent's output is a position on a five-level evidence ladder: E0 (nothing to act on) through E4 (threat to life). This structure is not invented — it mirrors ANSI/TMA AVS-01-2024, the alarm validation standard ratified by the International Association of Chiefs of Police. "Getting smarter" means incidents earning cheaper responses at the same catch rate: events migrating down the ladder without real threats slipping through.

**Investigate before committing.** The agent follows a three-move loop: investigate (ask a question to buy evidence), commit (respond at the evidence level), or defer (set a recheck timer). The investigation phase is drawn from structured emergency dispatch — ProQA/MPDS, the fixed-script protocol used in 911 centers for fifty years. The scripted arm in the eval is literally this protocol: ask five system questions in order, then human questions if ambiguous. The agent's contribution is choosing *which* question matters for *this* incident, not inventing a new protocol.

**Deterministic spine, LLM judgment.** The system's arithmetic does the scoring and the cost map. The model owns novelty, correlation, and the bounded prior adjustment. The agent's probability adjustment is clamped to ±2 log-odds from the calibrated noisy-OR prior (D-003) — it can nudge the base rate, never replace it. The agent's reported `confidence_p_real` is logged for calibration analysis but explicitly not consumed for the decision. The decision uses `sigmoid(logit(prior) + clamp(adjustment, ±2))`. This split exists for three reasons: auditability (the arithmetic half is deterministically testable), safety (the model can't free-hand the number that determines whether someone gets sent to a dark building at 2am), and calibration (the Brier score recovered from 0.22 to 0.108 after enforcing this constraint).

**Autonomy gated on confidence times reversibility.** Tier 0–2 decisions (suppress, log, notify guard) are reversible and cheap — the agent can act autonomously when confident. Tier 3–4 decisions (dispatch backup, escalate to human) are expensive and hard to reverse — they always require operator confirmation. Tier-4 actions never auto-dial emergency services (D-004). This gate creates the operator's core interaction: Approve / Modify / Override. The override is not a correction mechanism — it is the training signal for the learning loop.

**Model constant, harness improves.** Calvis does not fine-tune or retrain the LLM. It rents a frontier model (DeepSeek) and owns how it retrieves, routes, and reasons. Two-tier routing sends the fast model (deepseek-chat) to routine incidents and the strong model (deepseek-reasoner) to evidence-level-3+ incidents, P(real) in the ambiguous band (0.35–0.70), or a random 5% audit sample. The audit sample prevents the fast model from gatekeeping its own blind spots (D-007).

## 4. What "smarter" means, and the honest result

"Smarter" is defined as lower operational cost at equal or better catch rate, measured in three components: response cost (guard + operator time), harm cost (convex penalty for under-responding to real incidents, anchored to FBI UCR 2023 burglary data and stated-judgment liability floors), and flood penalty (superlinear surcharge when operator-surfaced rate exceeds 6 items/10 minutes, per EEMUA 191).

The agent beats the scripted baseline on a single seed: $1,235 vs. $2,453, a $1,218 reduction (PROGRESS.md F1.5). The mechanism: the agent reduces misses (8 vs. 17) by being more selective about suppression — it surfaces E1 incidents the script would suppress, catching real incidents the script misses. Brier score: 0.108 for both arms after the calibration fix.

**The learning result is negative, and that is the honest finding.** After 30 training nights, learned Beta priors improve calibration (Brier 0.072 → 0.054 on the holdout set) but do not reduce operational cost ($2,221 → $2,221). The priors learned real signal: panic buttons dropped from 85% to ~10% P(real) across most sites (they are mostly false alarms in the simulation data); missed check-ins at site-005 during hours 0–1 rose from 30% to 99% P(real). But cost did not move because the evidence level — the thing that determines the response tier — is set by `assessInitialEvidence` from event types, not from P(real). The learned prior feeds confidence scoring without changing the decision.

The fix is identified: route the learned P(real) into the investigate/commit choice via Bayes-optimal thresholds, so a prior backed by 50 observations at 12% P(real) earns a cheaper response tier than a hand-set prior at 85%. This is the cost-sensitive ordinal decision theory that FRONTIER.md flagged as absent (Axis A, family 5b). It is scoped as future work, not retrofitted.

## 5. How I measured it

The eval harness is the project's backbone. Seven registered arms run against the same seeded event stream:

- **rules-only**: static cost-minimization scorer, no investigation
- **scripted-interrogation**: LoopEngine with fixed-protocol decider, zero LLM calls
- **agent-fixed-policy**: LoopEngine with LLM agent decider, cached traces
- **agent-with-memory**: LoopEngine with learned Beta priors
- **always-0, always-2, always-3, always-4**: constant-tier degenerate controls
- **random-uniform**: random tier assignment

The degenerate arms are a falsification test. Early in development, always-2 beat the rules-only baseline ($-1,018, CI [-1,671, -367]). This caught a broken cost model before any agent was built — the flat $500-per-level harm function made a cheap flat policy dominate. The convex harm model (D-019) fixed it: always-2 now loses by $16,782. The degenerate arms remained as a permanent sanity check.

Paired bootstrap CIs over 10 seeds isolate signal from noise. The trace cache makes replay deterministic — every LLM call is recorded and replayed from committed JSON files, so any reviewer can reproduce the exact result without an API key. The learning curve runs 30 offline-generated nights with a 10-night held-out set, evaluated at checkpoints 0, 10, and 30.

## 6. Limitations

**Selective labels.** The simulator has an oracle (every incident's true evidence level is known from the scenario declaration). The arm comparison is valid within this sandbox, but production generalization is not claimed. In production, outcomes arrive late, partially, and with noise — the "selective labels problem" (Lakkaraju et al., KDD 2017) applies and is not addressed. The three-arm eval sidesteps it by never learning from the comparison itself.

**Confounded F2 arm.** The agent-with-memory arm ran the scripted decider with learned priors, not the LLM agent with learned priors (D-037). This was a cost decision — regenerating traces across 40 seeds with the updated tool schema would have cost ~$16. The learning experiment isolates whether priors help, but "LLM + memory" was never measured as a combination.

**N=10, not larger.** The eval ran 10 seeds with bootstrap CIs. Published best practice (Kapoor et al., 2024) shows N=3 produces score ranges of ~19 percentage points; N=10 is the minimum for stable estimates. Larger N would tighten the confidence intervals but was not run due to API cost.

**Regex-based override validation.** Incoherent overrides (false-alarm reason + escalation) are detected by pattern matching, not semantic classification. The regex catches obvious cases but misses rephrasings like "this was nothing."

**Simplified live cost.** The console's session metrics use a simplified in-session cost estimate computed from ground truth via `getTrueEvidenceLevel`. The eval harness (which generates outcomes through `generateSimOutcomes` and computes cost via `computeOperationalCost`) is authoritative.

## 7. What I deliberately cut, and why

**Fine-tuning and RL.** Wrong tool at this data scale (hundreds of labeled outcomes, not millions), kills the auditability that physical security specifically requires, and is unverifiable inside a take-home (D-007).

**Reliability models.** Per-guard ack rate EWMAs and per-robot false-positive tracking were planned (D-007 §3) but cut from F2-minimal. The guard reliability data exists in the schema (`reliability_ack_rate`, `reliability_avg_response`) and the agent already sees it via `get_available_guards`.

**Rule promotion.** Batch reflection over overrides to propose playbook rules was planned (D-007 §4) but cut. The override→prior path (F2.4) is the simpler version that shipped.

**Real integrations.** No Twilio, no Slack, no radio ASR, no camera feeds. The system simulates all external inputs. Accepted — integrations are plumbing, not intelligence.

**Auth, multi-tenancy, mobile.** Not present. The user is one overwatch operator on one screen (D-001). Multi-tenancy is a deployment concern, not a triage concern.

## 8. What I'd build next

**Route learned priors into response decisions.** The structural fix from section 4: compute Bayes-optimal response thresholds from the learned P(real), so a prior at 12% with n=50 earns a cheaper tier than a hand-set prior at 85% with n=0. This is cost-sensitive ordinal decision theory (FRONTIER.md Axis A, family 5b) — the proper framework for what the system does heuristically.

**Exploration via audit sampling.** The 5% random audit sample that routes incidents to the strong model is already a primitive exploration mechanism. Formalize it: use the audit outcomes to estimate the fast model's blind-spot rate, and adjust the sampling fraction to maintain a coverage guarantee. This is the principled answer to selective labels.

**Reliability-model-driven assignment.** Use the per-guard ack rate and response time to assign the nearest *reliable* guard, not just the nearest guard. A guard with a 60% ack rate at 2am should not receive a tier-3 dispatch.

**Reflection → rule promotion.** Batch over the last 100 overrides: if operators consistently downgrade `robot_motion_anomaly` at site-007 between 22:00–00:00, propose a permanent suppression rule for that cell. Operator approves; it becomes versioned policy. Test against a held-out A/B set before promoting.

**Radio ASR as a first-class event.** Calvis's product already uses Lucius as a live tool-call stream. Ingesting radio transcripts as `radio_transcript_flag` events with the actual transcript text (not just a keyword flag) would give the agent real-language context for correlation. "I see a truck at the loading dock" + `plate_read_unknown` in the same zone = delivery, not intrusion.

**Shift-coverage prediction.** The "save the shift" product: predict which guards are likely to no-show based on historical patterns, weather, and shift timing, and pre-position backups. This turns the dispatch agent into a scheduling agent — same evidence-level framework, different time horizon.

## 9. Where to look in the code

| Component | Path | What it does |
|-----------|------|-------------|
| Loop engine | `src/lib/loop/loop-engine.ts` | Tick-by-tick simulation: investigate/commit/defer, board load, deadlines |
| Agent decider | `src/lib/loop/agent-decider.ts` | LLM decision-making: tool calls, prior adjustment, two-tier routing |
| Agent tools | `src/lib/loop/agent-tools.ts` | `get_site_prior`, `find_precedent`, `get_incident_context`, etc. |
| Learned priors | `src/lib/loop/learned-priors.ts` | Beta counters with hierarchical cold-start backoff |
| Episodic memory | `src/lib/loop/episodic-memory.ts` | k-nearest precedent retrieval |
| Baseline scorer | `src/lib/engine/baseline-scorer.ts` | Rules-only: noisy-OR priors, cost-minimization tier |
| Cost model | `src/lib/eval/metrics.ts` | Response + harm + flood, all constants anchored |
| Eval runner | `src/lib/eval/runner.ts` | Seven arms, paired bootstrap CIs, multi-seed |
| Trace cache | `src/lib/llm/trace-cache.ts` | SHA-256 keyed, DEMO=1 guard |
| Incident timeline | `src/components/dispatch/incident-detail.tsx` | Events + agent actions interleaved chronologically |
| Agent analysis | `src/components/dispatch/investigation-trace.tsx` | Probability chain, reasoning, raw model thinking |
| Sim route | `src/app/api/sim/route.ts` | Runs all arms at startup, progressive reveal |
| Decision ledger | `docs/DECISION.md` | Every major choice with rationale and preclusions |
