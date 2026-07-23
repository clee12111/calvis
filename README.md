# Calvis

AI dispatch agent for physical security. Watches sensor events from 40+ sites overnight, decides what needs human attention, and learns from outcomes.

## Run it

```bash
git clone https://github.com/clee12111/calvis.git
cd calvis
npm install
npm run build
npm start
# Open http://localhost:3000
```

No API key. No database. Everything runs in-memory from committed data.

## Demo (30 seconds)

1. Click **Run Demo Night** — 273 incidents load
2. Click any incident — see the timeline: sensor events → agent investigation → decision
3. Click **Show full model thinking** — see the raw LLM reasoning
4. Click **Override** → set tier to T0 → type "false alarm" → watch the prior update
5. Press **J/K** to navigate the queue

## Other commands

```bash
npm test           # 160 tests
npm run dev        # Dev server with hot reload
npm run learn      # 30-night learning curve (no API key needed)
```

---

# How it works

## What I built

An AI agent that triages 273 security incidents across a 10-hour night shift. For each incident, it calls six tools — checks the event data, looks up the site's false-alarm history, searches for similar past incidents, checks operator load, checks guard availability, reviews safety rules — then makes a structured decision: how likely is this real, what response does it earn, and what evidence would change its mind.

## The queue — triage in motion

The queue is the centerpiece. It's not a static list — it's a live priority stack that reorders as the night unfolds.

**How incidents enter:** Sensor events stream in throughout the night — motion anomalies, door forced alerts, panic buttons, geofence exits, unknown license plates. The correlator groups events at the same site and zone within a 3-minute window into a single incident. A door forced event followed by an unknown plate read in the same loading dock becomes one incident, not two.

**How they're ranked:** Active incidents float to the top, sorted by severity. A panic button (E4 — threat to life) sits above a missed check-in (E2 — human presence confirmed) which sits above a robot motion anomaly (E1 — something happened). Resolved incidents drop below a divider.

**How they move:** As the agent investigates, evidence levels change. An incident that starts as E1 can escalate to E3 when the agent finds a forced door in the same zone — it moves up the queue with a ↑ arrow. Conversely, an E2 can de-escalate to E0 when the guard confirms a delivery truck — it drops below the Resolved line with a ↓. The queue is a living picture of the night's risk surface.

## How the agent reasons

Every incident goes through a three-move loop: **investigate** (ask a question to gather evidence), **commit** (respond at the evidence level), or **defer** (set a timer to recheck later).

The agent investigates by calling tools in the order it chooses:

- **get_incident_context** — what events triggered this, what sensors, what severity
- **get_site_prior** — P(real) for this event type at this site. Returns the probability AND the observation count n. A prior at n=0 is a hand-set guess; at n=50 it's backed by real outcomes. The agent treats these differently.
- **find_precedent** — "last 5 times this event type fired at this site, 3 were real, 2 were false alarms." The most legible form of learning — the agent sees history, not just a number.
- **get_board_load** — how many incidents is the operator already handling? If overloaded (>6/10min), the agent suppresses low-evidence incidents to protect operator attention.
- **get_available_guards** — who's on shift, how reliable, are they armed
- **get_active_rules** — safety constraints (tier-4 always requires human confirmation, never auto-dial emergency services)

After gathering context, the agent calls **make_decision** with a structured output:

- **prior_adjustment** — how much to shift the base probability, bounded to ±2 log-odds so it can nudge but never override the calibrated prior
- **adjustment_reasons** — why, unique per incident ("duress mode on panic button is stronger signal," "guard has 94% ack rate," "three prior false alarms at this dock")
- **what_would_change_my_mind** — the specific evidence that would flip the decision
- **novelty_flag** — true when no similar past incidents exist at this site

The final probability is computed as `sigmoid(logit(prior) + clamp(adjustment, ±2))`. The model owns the judgment. The math owns the guardrails.

**Concrete example:** For a panic button at Doral Industrial Hub, the agent:
- Retrieved P(real) = 85% (hand-set, n=0)
- Called find_precedent — no prior incidents at this site
- Adjusted +0.3 log-odds ("duress mode is stronger than a standard press; guard source has 94% reliability")
- Concluded P(real) = 88%, committed at E4 (threat to life), escalated to human
- Stated: "What would change my mind: radio check from the guard confirming false alarm, or CCTV showing no duress"

**Two-tier model routing:** A fast model (DeepSeek Chat) handles routine incidents. A strong model (DeepSeek Reasoner) handles three cases: evidence ≥ E3 (high stakes), P(real) in the ambiguous band (0.35–0.70), or a random 5% audit sample. The audit sample exists because a fast model that gatekeeps its own escalation criteria has an undetectable blind spot.

## Escalation and de-escalation

Evidence levels map to response tiers — this is the decision that costs money:

| Level | Meaning | Response |
|-------|---------|----------|
| E0 | Nothing to act on | Suppress |
| E1 | Something happened | Log & watch |
| E2 | Human presence confirmed | Notify guard |
| E3 | Threat to property | Dispatch backup |
| E4 | Threat to life | Escalate to human |

**Escalation** happens when new evidence raises the level. A robot motion anomaly (E1) plus a door forced alert at the same site bumps the incident to E3. The incident moves up the queue.

**De-escalation** happens when investigation reveals a benign cause. The guard radios "delivery truck at wrong entrance" and E3 drops to E0. The incident drops below the Resolved line. Every correct de-escalation avoids unnecessary response cost.

**The autonomy gate:** Cheap, reversible decisions (E0–E2) — the agent acts and reports. Expensive, irreversible decisions (E3–E4) — the agent proposes, the operator confirms via Approve / Modify / Override. Tier-4 never auto-dials emergency services. The override is not just a correction — it's the training signal for the learning loop.

## The feedback loop

The system maintains P(real) for each event type at each site as a Beta distribution, updated on every resolved outcome.

When you override a decision — "this was a false alarm" — the prior updates immediately and visibly. Override enough panic buttons at a site and the agent learns that site's panic buttons are usually noise. The next one starts at 40% instead of 85%.

**What the system learned after 30 nights:**
- Panic buttons: 85% → ~10% P(real) at most sites (mostly false alarms)
- Missed check-ins at site-005 during 20:00–22:00: 30% → 99% P(real) (almost always real)
- The agent sees these as n=127 observations, not guesses

**The honest result:** Calibration improved (the agent's probability estimates got more accurate) but operational cost didn't change yet. Why: the response tier is still set by event type, not by the learned probability. The priors learned what's real, but that knowledge doesn't yet flow into the tier decision. The fix — route learned P(real) into Bayes-optimal response thresholds — is identified and scoped as the next build.

## Point of view

**What I prioritized:** Inspectability over autonomy. The agent proposes; the operator confirms. The model never free-hands the number that determines whether someone gets sent to a dark building at 2am. Every decision has a stated reason and a stated reversal condition.

**Why:** Physical security is a domain where an over-eager AI is a liability. The product thesis is that the human gate IS the product — Approve / Modify / Override is where the feedback signal comes from. An autonomous agent generates no training data and can't be audited.

**What I'd build next:**
1. **Route learned priors into response tiers** — the fix that makes learning reduce cost
2. **Radio transcript ingestion** — "I see a truck at the loading dock" + unknown plate = delivery, not intrusion
3. **Guard reliability-aware dispatch** — a guard with 60% ack rate at 2am shouldn't get a tier-3 dispatch
4. **Rule promotion from overrides** — if operators consistently downgrade motion anomalies at site-007, propose a permanent rule

**What I deliberately cut:** Fine-tuning/RL (wrong tool at hundreds of observations; kills auditability). Real integrations (plumbing, not intelligence). Auth and multi-tenancy (deployment concern, not triage concern).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · PGlite · Drizzle ORM · DeepSeek
