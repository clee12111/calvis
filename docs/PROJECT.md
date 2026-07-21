# PROJECT.md — Calvis Dispatch Agent

Stable foundations. Loaded first, every session. For live state and the reasoning behind any
choice, read **DECISION.md**. Operating rules live user-level at `~/.claude/WORKFLOW.md`.

---

## 1. What this is

A take-home for **Calvis** (AI-native physical security: multi-agency guard marketplace + an AI
copilot called Lucius in every guard's earpiece + a 24/7 human "Overwatch" team). Miami HQ, ~20
people, ~$6.6M raised, 40+ US cities.

**The brief, verbatim:** *"Physical security operations run on guards and robots generating a
constant stream of real-world events. Build an AI dispatch agent that watches that stream, decides
how to prioritize and respond, and gets smarter over time. You decide what smarter means, what to
measure, and how to show it."*

Graded on four things: (01) a working, **inspectable** agent; (02) a real feedback loop; (03) a UI
"an ops manager would actually want to open"; (04) point of view.

## 2. Who the user is

Calvis's own **Overwatch operator** — the night-and-weekend role they're actively hiring for:
*"run the live coverage board, confirm every guard, save shifts the moment they go sideways."*

One person, 40+ sites, 2am, second monitor, tired. **Their attention is the scarce resource this
entire product optimizes.** Every design question resolves by asking what a tired operator at 2am
needs. Not a client-facing dashboard, not a chatbot.

## 3. The core idea (the thing that must survive every cut)

Naive framing: *flag risky events, guard checks them out.* That's worthless — if a human
investigates everything, the agent added nothing.

Real framing: the agent assigns **the cheapest response that is still safe**, from a fixed ladder:

| Tier | Action | Cost |
|---|---|---|
| 0 | `suppress` (with note + TTL) | none |
| 1 | `log_and_watch(recheck_in=N)` | none now |
| 2 | `request_photo_verification` | ~30 guard-seconds |
| 3 | `notify_guard` / `reassign_patrol` — walk it | ~10 guard-minutes |
| 4 | `dispatch_backup` / `notify_client` / `escalate_to_overwatch_human` | expensive, **human-gated** |

**"Getting smarter" = events migrate down the ladder over time without losing catch rate.**
Same incidents caught, less human attention burned. That is the number.

## 4. Domain model

**Entities:** `Site` (zones, geofences, criticality tier, quiet hours, client contacts) ·
`Guard` (skills, armed/unarmed, languages, shift window, location, live reliability stats) ·
`Robot` (patrol route, battery, sensors, false-positive rate) · `Event` (immutable, append-only) ·
`Incident` (correlated cluster; `open → dispatched → acknowledged → on_scene → resolved |
false_alarm | abandoned`) · `Decision` (one agent turn, append-only, stamped with policy version) ·
`Outcome` (joined to a Decision later) · `PolicyRule` (versioned, per-site or global, approvable).

**Event types (12, fixed):** `missed_check_in`, `geofence_exit`, `panic_button`,
`no_show_at_shift_start`, `robot_motion_anomaly`, `robot_thermal_anomaly`, `robot_offline`,
`plate_read_unknown`, `door_forced`, `radio_transcript_flag`, `client_inbound_message`,
`area_advisory`.

**Two streams, deliberately asymmetric — do not flatten this:**
- **Robots/sensors** — high volume, low trust, mostly false. This is where triage learning lives.
- **Guards/coverage** — low volume, high trust, high consequence. This is where Calvis's actual
  business pain lives ("save the shift").

Both flow through the same correlate → score → tier → outcome → learn loop and land in one queue.

## 5. What "smarter" means (metrics — these are the deliverable)

**Primary — cost-weighted triage error.** One scalar:
`C_miss × (real incidents under-tiered) + C_noise × (benign events over-tiered)`.
The exchange rate between a missed break-in and a needless 3am page is a *stated judgment call*;
it goes in DECISION.md and gets defended in the writeup.

**Secondary:**
- **Calibration** — Brier score + reliability diagram on the agent's own stated confidence.
- **Human load** — operator override rate ↓; incidents auto-closed without escalation ↑.
- **Dispatch quality** — ack rate, median time-to-ack, time-to-resolution.
- **Ops reality** — cost and latency per 1,000 events.

**How it's shown:** three arms over an identical seeded stream — `rules-only baseline` →
`agent, no memory` → `agent + memory/priors/rules` — plus an ablation isolating which mechanism
earned the gain. Learning curve + calibration plot in the README and in the UI's Learning tab.
Fixed seeds, N≥3 runs, **variance reported**. A gain inside the noise band is not a gain.

## 6. Learning mechanisms (no fine-tuning — see DECISION.md for why)

1. **Bayesian priors** — `P(real | event_type, site, zone, hour_bucket)`, updated per resolved outcome.
2. **Episodic memory** — `(situation → action → outcome)`, k-NN retrieved at decision time; produces
   the "last 4 times this fired here it was a delivery" line in the UI.
3. **Reliability models** — EWMA of ack rate / response time / false-positive rate per guard and robot.
4. **Reflection → rule promotion** — batch job proposes a playbook rule from recent overrides and
   misses; **operator approves it in the UI**; it becomes a versioned artifact and enters the prompt.
5. **Policy versioning** — every prompt/rule/weight change is hashed and stamped on each Decision.

**Outcome labels come from four sources**, not just the guard: guard close-out, ack telemetry,
operator override + reason, and late-arriving signals (client complaint, a miss discovered later).

## 7. Hard rules

- **Never** auto-dial emergency services. Tier-4 actions are always human-confirmed.
- Autonomy is gated on `confidence × reversibility`, never confidence alone.
- Deterministic scaffolding does arithmetic; the LLM does judgment and explanation. Never let the
  model free-hand a numeric score.
- All model output is structured (tool calls / JSON schema). No free-text decisions.
- `Event` and `Decision` tables are append-only. The audit trail is the product.
- Reasoning renders as a **structured rationale** (top-3 weighted factors, retrieved precedent,
  counterfactual, confidence, what-would-change-my-mind) — not raw chain-of-thought.
- `DEMO=1` must run the whole app with **no API key**, off cached traces.
- Setup is `npm install && npm run seed && npm run dev`. Nothing else.

## 8. Non-goals (say so in the writeup, don't drift into them)

Fine-tuning or RL · real integrations (Verkada, alarm relays, telematics) · auth / multi-tenancy ·
mobile / guard-side app · a chat interface · billing · anything requiring Docker.

## 9. Phase roadmap

Each phase ends at a **gate**: run the checks, report, stop. Do not roll forward past a gate.

- **F0 — Foundation & infrastructure.** Scaffold, schema, seed world, event simulator, ingestion,
  correlation, **rules-only baseline scorer**, append-only decision log, eval runner skeleton,
  UI shell rendering a live queue. **No LLM.** The baseline built here is the permanent control arm.
- **F1 — Agent.** Retrieval, LLM reasoning with structured output, action tools, tier selection,
  confidence, autonomy gating, two-tier model routing.
- **F2 — Loop.** Outcome capture, priors, episodic memory, reliability models, override ingestion.
- **F3 — Eval.** Three arms, ablation, learning curve, calibration, variance. **Never cut.**
- **F4 — UI.** Live board → Learning tab → incident/after-action report. Real polish.
- **F5 — Writeup + deploy.** WRITEUP.md, README, Vercel link, 90-second walkthrough.

## 10. Design system (F4, stated now so F0 doesn't paint us into a corner)

Near-black surfaces, a single orange accent used **only** for things demanding action, uppercase
mono for section labels and IDs, sans for content. Dense, keyboard-first, live (no refresh).

Three fixed zones: **left** ranked queue with a horizontal *attention line* (above it needs you,
below it the agent has it) · **center** incident detail + structured rationale +
`Approve / Modify / Override` · **right** map / coverage strip.

Four primitives carry the whole UI: **priority stripe** (4 levels, color + width, never color
alone) · **confidence bar** · **why-chip** (factor + weight, e.g. `prior 0.11`) · **decision card**.

**The moment that sells it:** operator overrides → toast *"Noted — I'll weight recurring dock
motion lower here overnight"* → a proposed rule appears in the Learning tab with its evidence.
A reviewer must be able to reach that within 60 seconds of opening the app.

## 11. FRONTIER.md

Scoped to **exactly two axes**: (a) the learning-loop mechanism and (b) the eval design. Built by
`frontier-bar` in a **separate context** (proposer ≠ bar-setter), via live research. Explicitly
**not** applied to CRUD, scaffolding, or the UI shell — frontier-ifying those is cosplay.
