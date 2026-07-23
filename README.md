# Calvis Dispatch

AI dispatch agent for physical security operations. Watches a stream of real-world events from guards and robots across 40+ sites overnight, decides how to prioritize and respond, and learns from outcomes.

## 30-Second Demo

```bash
npm install
npm run build
npm start          # Production server at http://localhost:3000
```

1. Click **Start Sim** — 273 incidents load in ~4 seconds
2. Click the top incident (panic button, E4) — see the investigation trace: 5 system questions, evidence level chain, committed response
3. Click **?** for an overview of evidence levels, cost model, and keyboard shortcuts
4. Click **Override** on any incident, set tier to T0, enter "false alarm" — watch the prior update in the Learning panel (bottom-right)
5. Switch arms with the **Agent / Scripted / Rules** buttons — same night, different strategies, instant cost comparison

> Hosted demo may take ~40s to wake if idle.

## Local Development

```bash
npm install
npm run dev        # Dev server with hot reload at http://localhost:3000
npm test           # 160 tests (20 files)
npm run learn      # Run 30-night learning curve (~3 min, no API key needed)
```

No API key or database required. DEMO=1 (default) uses in-memory PGlite and cached LLM traces.

## Deploy to Render

Push to GitHub, then on Render:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Environment:** `DEMO=1`

Or use the included `render.yaml` for Blueprint deployment.

## What This Is

Three triage strategies compared on the same simulated night:

| Arm | How it works | Cost (seed 42) |
|-----|-------------|----------------|
| **Scripted** | Fixed protocol: 5 system questions, then human questions if ambiguous. The ProQA/MPDS model used in emergency dispatch for 50 years. | $4,433 |
| **Rules-only** | Static scorer: severity x site criticality x hour x zone. No investigation. | $12,516 |
| **Agent** | LLM reasons about each incident — calls tools, checks priors, adjusts probabilities, explains reasoning. Two-tier model routing. | $1,513 (with API key) |

Cost = response cost + harm cost (convex penalty for under-responding) + flood penalty (EEMUA 191).

## The Feedback Loop

The system maintains P(real) for each event type at each site as a Beta distribution. Operator overrides update the prior: "false alarm" pushes P(real) down, "confirmed real" pushes it up. The agent sees the observation count n — it trusts a prior backed by 50 observations more than a hand-set guess at n=0.

**Honest result:** After 30 training nights, learned priors improve calibration (Brier 0.072 → 0.054) but don't reduce operational cost. Why: evidence levels (E0-E4) are determined by event types, not P(real). The cost depends on tier vs true level. This is a structural gap documented in DECISION.md (D-035).

## Architecture

- **Next.js 16** App Router, React 19, Tailwind CSS 4, shadcn/ui
- **PGlite** (in-memory Postgres) — no external database needed
- **LoopEngine** — 30-second tick intervals, evidence-state machine (E0-E4), investigation questions, flood-aware suppression
- **Trace cache** — ~9,000 cached LLM responses for deterministic replay
- **Beta counters** — Bayesian learned priors with hierarchical cold-start backoff
- **Episodic memory** — past incident outcomes for find_precedent tool

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build |
| `npm start` | Production server |
| `npm test` | 160 tests across 20 files |
| `npm run learn` | 30-night learning curve with holdout eval |
| `npm run eval` | Multi-arm evaluation with bootstrap CIs |

## Key Decisions (from DECISION.md)

- **D-035:** Learning improves calibration but not cost — evidence levels are event-type-driven, not P(real)-driven
- **D-032:** Progressive reveal of precomputed decisions (batch correlation too costly for live)
- **D-033:** Override validation rejects incoherent submissions (false alarm + escalation)
- **D-023:** Agent seam is the decider function — replaces `chooseNextMove` and nothing else
