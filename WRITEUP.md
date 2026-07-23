# Calvis — Writeup

## The prompt

Build an AI dispatch agent that watches a stream of security events, decides how to prioritize and respond, and gets smarter over time.

## What I built

An AI agent that triages 273 security incidents across a 10-hour night shift. For each incident, it calls six tools (check the event data, look up the site's false-alarm history, search for similar past incidents, check operator load, check guard availability, review safety rules), then makes a structured decision: how likely is this real, what response does it earn, and what evidence would change its mind.

The agent runs against the same night as a rules-only baseline. The agent costs $3,287 per night. The rules engine costs $12,516 — almost 4x more — because it can't tell real threats from noise and over-responds to everything.

## 01 — A working agent (inspectable)

The agent's reasoning is fully visible. Click any incident and you see a chronological timeline: sensor events arriving, the agent checking each tool, and its final analysis — the probability it computed, why it adjusted it, and what would change its decision.

For a panic button at Doral Industrial Hub, the agent:
- Saw P(real) = 85% from the site's prior (hand-set, n=0 observations)
- Adjusted +0.3 ("duress mode is stronger than a standard press; guard has 94% ack rate")
- Concluded P(real) = 88%, committed at E4 (threat to life), escalated to human
- Said what would change its mind: "Radio check from the guard confirming false alarm"

One click deeper shows the engineer layer: which model ran (DeepSeek Reasoner, the strong model, because evidence ≥ E3), 6,189 input tokens, 2,050 output, $0.0072, cache HIT.

Two-tier model routing: a fast model handles routine incidents; a strong model handles high-severity cases, ambiguous probabilities, or a random 5% audit sample. The audit sample prevents the fast model from gatekeeping its own blind spots.

## 02 — A feedback loop

The system maintains P(real) for each event type at each site as a Beta distribution. When you override a decision — "this was a false alarm" — the prior updates immediately and visibly. Panic buttons started at 85% P(real). After the learning run, they dropped to ~10% at most sites. Missed check-ins at one site during the first two hours rose from 30% to 99%. The system found real signal.

**The honest result:** After 30 training nights, calibration improved (Brier score 0.072 → 0.054) but operational cost didn't change ($2,221 → $2,221). Why: the response tier is determined by event type (panic button → E4, door forced → E3), not by the learned probability. The priors learned what's real and what's not, but that knowledge doesn't yet flow into the decision that determines cost. The fix is identified: route the learned P(real) into the response tier selection via Bayes-optimal thresholds. Scoped as next phase.

## 03 — A real UI

The console is two panels. Left: a queue of incidents sorted by severity, with active incidents above a "Resolved" divider. Right: the selected incident's full timeline — every event, every agent action, the final analysis.

The queue reorders as the simulation clock advances. Incidents show escalation (↑) and de-escalation (↓) arrows. Overriding a decision visibly updates the prior in the panel. No placeholder text, no lorem ipsum. Keyboard navigation (J/K). The empty state explains what to do.

The goal was: if an ops manager opened this at 2am, would they understand what the system decided and why? The timeline format — events interleaved with agent actions — is the answer. You read it top to bottom like a story, not a dashboard.

## 04 — Point of view

**What I prioritized:** Inspectability over autonomy. The agent proposes; the operator confirms. Every decision has a stated reason and a stated condition for reversal. The model never free-hands the number that determines whether someone gets sent to a dark building at 2am — it adjusts a calibrated prior by at most ±2 log-odds. The arithmetic is deterministic and testable. The judgment is the model's.

**Why this shape:** Physical security is a domain where an over-eager AI is a liability. The product thesis is that the human gate IS the product — Approve / Modify / Override is where the feedback signal comes from. An agent that acts autonomously generates no training data and can't be audited.

**What I'd build next:**
1. **Route learned priors into response decisions** — the structural fix that makes learning reduce cost, not just calibration
2. **Radio transcript ingestion** — "I see a truck at the loading dock" + unknown plate in the same zone = delivery, not intrusion
3. **Guard reliability-aware dispatch** — a guard with 60% ack rate at 2am shouldn't receive a tier-3 dispatch
4. **Rule promotion from overrides** — if operators consistently downgrade motion anomalies at site-007 between 22:00–00:00, propose a permanent rule

**What I deliberately cut:** Fine-tuning/RL (wrong tool at hundreds of observations; kills auditability). Real integrations (plumbing, not intelligence). Auth and multi-tenancy (deployment concern, not triage concern). Each is a deliberate rejection, not a gap.

## How to run it

```bash
git clone https://github.com/clee12111/calvis.git
cd calvis && npm install && npm run build && npm start
```

No API key. No database. Open http://localhost:3000 and click Run Demo Night.
