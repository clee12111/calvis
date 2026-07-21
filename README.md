# Calvis Dispatch Agent

AI dispatch agent for physical security operations. Watches a stream of real-world events from guards and robots, decides how to prioritize and respond, and gets smarter over time.

## 30-Second Demo

```bash
npm install
npm run seed       # Generate deterministic world (12 sites, 30 guards, 8 robots)
npm run dev        # Start at http://localhost:3000
```

Click **Start Sim** → watch a full night replay at 10x. Click any incident to see correlated events and the baseline's scoring factors.

## Eval

```bash
npm run eval -- --arm=rules-only --seed=42 --runs=3
```

Prints a metrics table with mean ± spread across runs. Zero LLM calls in F0.

## Tests

```bash
npm test
```

26 tests covering: append-only enforcement, seed determinism, correlation (cascading + stuck sensor), outcome joins (including late labels), and metrics with hand-computed fixtures.

## Architecture (F0 — Foundation)

- **Schema**: Sites, Guards, Robots, Events (append-only), Incidents, Decisions (append-only), Outcomes, Shifts
- **Seed World**: Deterministic from a seed via seedrandom. Same seed → identical row hashes
- **Scenario Generator**: 6 adversarial scenarios + background noise, ~500 events/night
- **Virtual Clock**: All domain code uses a clock abstraction. Supports batch mode (<5s wall clock for a full night) and realtime replay at 1x/10x/100x
- **Correlator**: Groups events into incidents by site+zone proximity, related event types, and source identity
- **Rules-Only Baseline**: `severity × site_criticality × hour_factor × zone_exposure × event_count` → static tier table
- **Metrics**: Cost-weighted triage error (C_miss=10, C_noise=1), Brier score, ack rate, time-to-ack, time-to-resolution, guard-minutes
- **UI**: Three-zone layout (queue, detail, sites), SSE streaming, replay controls

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS · shadcn/ui · Drizzle ORM · better-sqlite3 · Vitest · seedrandom

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server |
| `npm run seed` | Seed deterministic world |
| `npm run sim` | Generate and inspect event stream |
| `npm run eval -- --arm=rules-only --seed=42 --runs=3` | Run eval |
| `npm test` | Run test suite |

## Phase Roadmap

- **F0** ✅ Foundation & infrastructure (current)
- **F1** Agent: LLM reasoning, structured output, action tools
- **F2** Loop: Outcome capture, priors, episodic memory, reliability models
- **F3** Eval: Three arms, ablation, learning curve
- **F4** UI: Live board, Learning tab, polish
- **F5** Writeup + deploy
