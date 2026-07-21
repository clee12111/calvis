# DECISION.md — running ledger

Newest at top. Form: **decision / why / precludes**. Supersede with strike-through + note; never
delete. A decision that isn't in this ledger didn't happen. Engineer's live entries are canonical
where they conflict with the advisor's; reconcile at the next commit.

---

## 2026-07-21 — F0.6.5 cost model repair (engineer)

### D-019 · Convex harm, operator attention, and flood penalty — cost model v2
**Decision:** Three changes to the cost model, written and justified before re-running any arm.

**(1) Convex per-level harm replaces flat $500 × gap.**
AVS-01 treats evidence levels as qualitatively different categories, not units of one thing.
Missing E1 (something happened, intent unknown) is a paperwork failure.
Missing E3 (confirmed property threat) is a burglary loss.
Missing E4 (confirmed life threat) is potential liability for injury or death.
A linear function erases this distinction.

| Gap | From | To | Harm $ | Anchor |
|-----|------|----|--------|--------|
| Miss E1 | 1 | 0 | $50 | Paperwork/compliance cost of undocumented event. Stated judgment. |
| Miss E2 | 2 | 0-1 | $200/level | Coverage gap cost: overtime to backfill a no-show shift (~4h × $50/h). Derived from guard hourly rate. |
| Miss E3 | 3 | 0-2 | $2,000/level | Average US commercial burglary loss ~$8k (FBI UCR 2023), discounted by recovery rate and insurance. Stated judgment anchored to FBI data. |
| Miss E4 | 4 | 0-3 | $10,000/level | Liability floor for workplace injury. No defensible public anchor; $10k is a stated judgment representing the minimum credible harm from a missed threat-to-life, not a damage estimate. |

Harm function: `HARM_PER_LEVEL[trueLevel] × max(0, trueLevel − respondedTier)`.
The convexity comes from the per-level cost increasing, not from the gap being raised to a power.

**(2) Operator attention priced on every surfaced item.**
Every incident surfaced to the operator (tier ≥ 1) costs operator-minutes at $0.58/min.
Already present in TIER_OPERATOR_MINUTES but was folded into response cost.
No code change needed — the existing structure already charges this. The decision makes it
explicit: operator attention IS the thing being optimized, and it appears in the objective.

**(3) Flood penalty — superlinear cost as surfacing rate rises.**
EEMUA 191 Ed.4 and ISA-18.2 define:
- ≤1 alarm/10min/operator: acceptable
- 1–2/10min: manageable
- >2/10min: overloaded — cognitive performance degrades, miss rate rises
- >10/10min: alarm flood — operator effectively blind

Penalty: after computing per-incident costs, add a flood surcharge.
Compute the peak 10-minute window of operator-surfaced incidents (tier ≥ 1).
If rate > 6/10min (EEMUA "overloaded" threshold, adapted from industrial to security):
  surcharge = (rate − 6)² × $20 per 10-min window above threshold.
The square penalises flood more than a bump. $20/unit² is a stated judgment.

**Why (all three together):** The previous flat harm model made always-2 ($0.96/incident) cheaper
than the baseline because missing an E3 cost only $500 more than the response. With convex harm,
missing an E3 costs $2000/level — the baseline's selective high-tier responses now earn their keep
on the incidents that matter, while always-2 pays massive harm on the E3/E4 incidents it under-covers.
The flood penalty ensures that over-surfacing (the always-2 strategy of showing everything) has a
real cost beyond just guard-minutes.
**Precludes:** Interpreting the objective as guard-minutes alone. It is now a three-component cost:
response (guard + operator time) + harm (convex, per-level) + flood (superlinear in surfacing rate).

### ~~D-005~~ · ~~Primary metric is cost-weighted triage error~~ → **superseded by D-016/D-017, now D-019**

---

## 2026-07-21 — F0.5 metric repair (engineer)

### D-018 · PGlite via Drizzle RC replaces better-sqlite3
**Decision:** Migrated to `drizzle-orm@1.0.0-rc.4` with `@electric-sql/pglite@0.5.4`. All tables created through Drizzle's `sql.raw()` (not PGlite's `.exec()`) because the Drizzle wrapper doesn't see tables created via the raw PGlite interface. Timestamps changed from `INTEGER` to `BIGINT` (Postgres's `INTEGER` is 32-bit, overflows at Unix ms timestamps). Repository layer fully async.
**Why:** Vercel has no persistent filesystem — SQLite cannot back a deployed demo. PGlite gives Postgres compatibility without requiring an external server. The 8x perf regression (16.6s vs 2.2s per eval run) is acceptable for dev; Neon will be added for production deployment.
**Precludes:** Synchronous repository API (everything is now `async/await`). The eval harness is slower but still under 3 min for a full 10-seed, 6-arm comparison.

### ~~D-012~~ · ~~better-sqlite3 over sql.js for SQLite driver~~ → **superseded by D-018**
**Note:** Replaced by PGlite + Drizzle RC. The sync API advantage no longer applies — async cascade completed.

### ~~D-010~~ · ~~Next.js + TypeScript + SQLite (Drizzle)~~ → **partially superseded by D-018**
**Note:** SQLite replaced by PGlite (Postgres-compatible). Everything else (Next.js, TypeScript, Drizzle, SSE) remains.

### D-017 · Degenerate-arm result: always-2 beats rules-only baseline
**Decision:** Accept the result and proceed. The metric is correct; the baseline's Bayes-optimal tier selector over-responds to most incidents (92%) while still missing some, making it more expensive than a flat tier-2 policy. The fix is F0.8's investigate/commit/defer loop — not constant-tuning.
**Why:** The prompt explicitly says "do not adjust weights until the arms look right — tuning until the control arm fails is how you fake a result." The degenerate arm check validated the metric (it correctly prices guard-minutes and harm), but exposed that a one-shot scorer with only event-type priors cannot discriminate. A system that asks one free question (is this on the delivery schedule?) before committing would dominate always-2.
**Precludes:** Claiming the rules-only baseline is a competent control arm in isolation. It's the control for the *loop*, not for constant policies. The true control comparison will be rules-only-loop vs agent-loop (F0.8 vs F1).

### D-016 · Confidence = P(real) via noisy-OR over distinct event types
**Decision:** P(real) computed from hand-set per-event-type priors using noisy-OR independence assumption over distinct types only. Duplicate event types from the same source are correlated and don't compound.
**Why:** Previous "confidence" scored signal extremity (0.40 + 0.30×extremity + 0.30×signalStrength), producing Brier 0.55 — worse than guessing 0.5 for everything. New definition: Brier 0.11.
**Precludes:** Interpreting confidence as anything other than P(real). Autonomy gating, Brier scoring, and tier selection all consume this single quantity.

### D-015 · Per-event-type P(real) prior table as explicit modelling assumption
**Decision:** Hand-set priors from domain knowledge: panic_button 0.85, door_forced 0.60, no_show 0.70, ..., robot_offline 0.05, area_advisory 0.05. These are NOT derived from ground truth — they represent an engineer's honest prior belief.
**Why:** The baseline needs a probability to make Bayes-optimal tier decisions. These priors are the thing the learning system will improve on in F2.
**Precludes:** Treating these as calibrated truth. They are assumptions that will be updated from outcomes.

### ~~D-005~~ · ~~Primary metric is cost-weighted triage error~~ → **superseded by D-016/D-017**
**Note:** D-005's `C_miss × tier_distance + C_noise × tier_distance` replaced by operational cost in dollars: `responseCost(tier) + harmCost(trueLevel, respondedLevel)`. The old metric was circular (correctTier derived from agent's tier for real incidents) and measured tier distance rather than real cost.

---

## 2026-07-20 — F0 build (engineer)

### D-014 · Tight temporal proximity as correlation criterion
**Decision:** Events at the same site + same zone within 3 minutes are correlated regardless of type relationships.
**Why:** The related-type graph is inherently incomplete — `radio_transcript_flag` only relates to `panic_button`, but in a real cascade (motion → thermal → door_forced → plate → radio → panic → geofence), the radio flag arrives before panic_button exists in the cluster. Without temporal proximity, the cascade splits into 2 incidents.
**Precludes:** Relying solely on the type graph for correlation. The 3-minute window may over-correlate at busy sites, but under-correlating a cascade is worse in F0.

### D-013 · Bidirectional type relationship checking in correlator
**Decision:** When checking if event E should join cluster C, check both "is E's type related to any type in C" AND "is any type in C related to E's type."
**Why:** The RELATED_TYPES graph is directional. `door_forced` → relates to `robot_motion_anomaly`, but if we only check forward, we miss the reverse when the cluster already contains `door_forced` and a new `robot_motion_anomaly` arrives. Bidirectional ensures relationship symmetry.
**Precludes:** Unidirectional correlation, which would require manually maintaining symmetric entries in the type graph.

### D-012 · better-sqlite3 over sql.js for SQLite driver
**Decision:** Use better-sqlite3 with prebuilt native binaries rather than pure-JS sql.js.
**Why:** Synchronous API makes the repository layer and eval runner simpler — no async overhead in the hot path. Prebuilt binaries available for Windows/Mac/Linux. ~5x faster than sql.js for bulk inserts.
**Precludes:** Zero-native-dependency deployment. Accepted — better-sqlite3 has prebuilds for all CI/deploy targets.

---

## 2026-07-20 — Frontier bar set (bar-setter, independent context)

### D-012B · FRONTIER.md delivered — two axes tiered, state-vs-bar gap identified
**Note:** Originally numbered D-012 in the bar-setter's context, colliding with the engineer's D-012 (better-sqlite3). Renumbered to D-012B for unambiguous reference. The strike-through on the engineer's D-012 refers to the SQLite decision, not this one.
**Decision:** FRONTIER.md written with three tiers (median / industry / frontier) on two axes:
(a) learning-loop mechanism, (b) evaluation design. No implementation read; bar set from live
research only.

**Load-bearing anchors:**
- Axis A: ANSI/TMA-AVS-01-2024 (five-tier alarm validation scoring, ratified IACP Nov 2024) — the
  builder's cost ladder is structurally identical to an existing ratified standard and should cite it.
  EEMUA 191 Ed.4 (Nov 2024) and ANSI/ISA-18.2 provide alarm-rate benchmarks (≤1/10min acceptable,
  >10/10min flood) that are the domain's published targets for operator load. Mozannar & Sontag (2020,
  2023) formalize learning-to-defer; Imai & Li (JASA 2024) formalize policy learning with asymmetric
  counterfactual utilities — both are the proper frameworks for what the builder does heuristically.
- Axis B: Lakkaraju et al. (KDD 2017) "selective labels problem" and Helmbold et al. (2000) "apple
  tasting problem" name the censored-feedback issue the three-arm eval sidesteps via simulator oracle
  but must acknowledge. Kapoor et al. (2024) shows N=3 agent runs produce score ranges of ~19pp;
  N≥10 with bootstrap CIs is the published best practice.

**State-vs-bar gap:**
- Axis A: builder's plan sits at **industry** on mechanisms (Bayesian priors, episodic memory,
  reliability models, rule promotion) but at **median** on formalization (no formal deferral policy,
  no conformal coverage guarantees, no alarm-industry standard citations, no exploration mechanism).
  The gap is not in what the system does but in how it justifies what it does.
- Axis B: builder's plan sits at **industry-minus** — three-arm seeded comparison with ablation is
  strong, but N=3 is underpowered, selective labels are unacknowledged, claim scope is unbounded, and
  cost curves / OPE for production learning are absent. The simulator-oracle design is valid but the
  honest scope statement is missing.

**Precludes:** nothing — FRONTIER.md is a bar, not a constraint. The builder may deliberately sit
below frontier on any axis and defend the tradeoff. The bar's purpose is to make "median passed off
as frontier" visible.

---

## 2026-07-20 — Phase 0 seed (advisor, pre-build)

### D-011 · FRONTIER.md scoped to two axes only
**Decision:** run `frontier-bar` on (a) the learning-loop mechanism and (b) the eval design. Nothing else.
**Why:** those two are the only consequence-dense axes here — they're what the grade actually turns on
and where "median passed off as frontier" is invisible to a non-expert reviewer. Scaffolding, CRUD, and
the UI shell have a well-known best practice and no upside to bar-setting.
**Precludes:** claiming a frontier bar on UI craft or architecture. Those get the irreducible core only.

### D-010 · Next.js + TypeScript + SQLite (Drizzle), single repo
**Decision:** App Router, Tailwind + shadcn/ui, Drizzle over SQLite, SSE for the live stream, Anthropic SDK.
**Why:** setup friction is itself graded — reviewers read a dozen of these and the one that runs on the
first command gets the deepest read. One language, one process, no Docker. Schema stays Postgres-compatible
so "it scales" is defensible.
**Precludes:** Python-side eval/analysis tooling (pandas, sklearn); heavy concurrent ingestion; anything
needing real Postgres features. Accepted — the eval harness is small enough to write in TS.

### D-009 · `DEMO=1` runs the entire app with no API key, off cached LLM traces
**Decision:** ship recorded traces for the seeded scenario set; demo mode replays them.
**Why:** a reviewer who can run it instantly evaluates it deeply; one who has to provision a key may not
run it at all. Also makes the eval harness reproducible and CI-able.
**Precludes:** nondeterministic demo behavior; free-form user input in demo mode (no cached trace for it).

### D-008 · Outcome labels come from four sources, not just the guard
**Decision:** guard close-out · ack telemetry · operator override + reason · late signals (client
complaint, miss discovered afterward).
**Why:** guard close-out alone is biased — a guard who never finds anything labels everything false, and
the expensive failure mode (a real incident nobody was sent to) generates no guard label at all.
**Precludes:** treating the label as clean ground truth. Label noise and label latency must be modeled in
the simulator and acknowledged in the writeup.

### D-007 · No fine-tuning, no RL
**Decision:** learning is Bayesian priors + episodic memory + reliability EWMAs + human-approved rule promotion.
**Why:** wrong tool at this data scale (hundreds of labeled outcomes, not millions); unverifiable inside a
take-home; and it destroys the auditability that physical security specifically requires. A regulator or a
client asking "why did you not send anyone" needs an answer, and weights aren't one.
**Precludes:** claiming model-level learning. The writeup must state this as a deliberate rejection with
this reasoning, not as a gap.

### D-006 · Three-arm eval over an identical seeded stream, with ablation
**Decision:** `rules-only` → `agent, no memory` → `agent + memory`. Fixed seeds, N≥3 runs, variance reported.
Held-out scenario set never used during tuning.
**Why:** this is the only thing that converts "it gets smarter" from a claim into a measurement, and it's
what almost no other submission will have. Ablation answers *which* mechanism earned the gain.
**Precludes:** tuning against the eval set; reporting a headline gain without its noise band.

### D-005 · Primary metric is cost-weighted triage error; secondary is calibration
**Decision:** `C_miss × under-tiered real incidents + C_noise × over-tiered benign events`, weights stated
explicitly. Secondary: Brier score on the agent's own confidence.
**Why:** a single scalar forces the exchange rate between a missed break-in and a needless 3am page to be
*stated and defended* — that statement is the point of view the brief asks for. Calibration is cheap,
visually striking, and rare in submissions.
**Precludes:** accuracy/F1 as headline metrics — they hide the asymmetry that matters in this domain.

### D-004 · Autonomy gated on `confidence × reversibility`; tier-4 always human-confirmed; never auto-dial 911
**Decision:** cheap + reversible + confident → agent acts and reports. Expensive or irreversible → propose,
operator confirms.
**Why:** in physical security an over-eager agent is a liability, not a feature. It also creates the UI's
core interaction (Approve / Modify / Override), which is where the feedback signal comes from.
**Precludes:** a fully autonomous demo. Accepted — the human gate *is* the product thesis, not a limitation.

### D-003 · Hybrid scoring: deterministic base score, LLM adjusts and explains
**Decision:** rules compute `severity × site criticality × hour × learned prior`; the LLM adjusts, correlates,
and writes the rationale. The model never free-hands a number.
**Why:** LLMs score inconsistently and can't be unit-tested; rules can't handle novelty or "these three events
are one truck." Splitting them makes half the system deterministically testable.
**Precludes:** end-to-end LLM scoring; also precludes claiming the whole system is "an LLM agent" — it isn't,
and the writeup should say so.

### D-002 · The unit of work is a **response tier**, not a binary escalation
**Decision:** five-tier ladder (suppress → watch → photo → walk it → backup/client). "Smarter" is defined as
events migrating down the ladder without losing catch rate.
**Why:** binary escalate/don't adds no value if a human investigates everything anyway. The tier ladder is
what makes the agent's contribution measurable in real units (guard-minutes saved).
**Precludes:** severity-only triage; any metric that ignores response cost.

### D-001 · The user is Calvis's internal Overwatch operator, not a client site manager
**Decision:** build the night-shift coverage board — one operator, 40+ sites, 2am.
**Why:** it's the role Calvis is actively hiring for and describes as "the human guarantee behind every
shift"; the commercially meaningful metric is therefore attention bought back per operator, which maps
directly to their headcount.
**Precludes:** per-client scoping, tenant isolation, client-friendly language, and marketing-style
visualizations. Everything optimizes one tired professional's attention.
