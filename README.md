# Calvis

AI dispatch agent for physical security operations. Watches a stream of sensor events from guards and robots across 40+ sites overnight, decides how much response each incident earns, and learns from outcomes.

> First load may take ~40s to wake if idle.

## Demo (30 seconds)

```bash
git clone https://github.com/clee12111/calvis.git
cd calvis
npm install
npm run build
npm start
# Open http://localhost:3000
```

No API key or database required. Agent traces are committed and replayed deterministically.

1. Click **Run Demo Night** — 273 incidents load in ~4 seconds
2. The queue fills. Active incidents (E1+) float to top; resolved (E0) sink to bottom
3. Click the top incident (panic button, E4) — see the full timeline:
   - Sensor event arrives (Panic Button, S5, from guard)
   - Agent checks delivery schedule, plate allowlist, prior probability, past incidents, camera coverage
   - Agent commits: **Escalate to Human** at E4
   - Agent analysis: P(real) 85% base → +0.3 adjustment → 88%. Reasons: "Duress mode is stronger signal," "Guard has 94% ack rate." Would change mind: "Radio check confirming false alarm."
4. Click **Show full model thinking** — see the raw LLM response from DeepSeek
5. Click **Override** on any incident → set tier to T0 → enter "false alarm" → watch the prior update in the panel (e.g. panic_button: 85% → 57%)
6. Press **J/K** to navigate the queue

**What you're looking at:** The main view is the ops layer — what the agent decided and why. Inside each incident's analysis block, one click reveals the engineer layer: which model tier ran, token counts, latency, cost, cache status. The queue separates active incidents from resolved ones, with ↑↓ arrows showing where evidence escalated or de-escalated during investigation.

## Local Development

```bash
npm run dev        # Dev server at http://localhost:3000
npm test           # 160 tests, 20 files
npm run learn      # 30-night learning curve (~3 min, no API key)
npm run eval       # Multi-arm eval with bootstrap CIs
```

## Live Mode (optional)

Set `DEMO=0` and provide an API key to run the agent against a real LLM:

```bash
DEMO=0
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
AGENT_MAX_USD_PER_RUN=2.00    # Hard spend cap
```

## Architecture

```
Events (seed) → Ingest → Correlate → LoopEngine
                                        │
                              ┌─────────┼─────────┐
                              │         │         │
                          investigate  commit   defer
                          (ask question) (respond) (recheck)
                              │         │
                         system/human   response map
                         questions      E0→suppress
                              │         E1→watch
                         LLM agent      E2→notify
                         (tool calls,   E3→dispatch
                          prior adj)    E4→escalate
                              │
                         outcomes → Beta priors → learned P(real)
                                   episodic memory → find_precedent
```

## Repo Map

| Path | What |
|------|------|
| `src/lib/loop/loop-engine.ts` | Tick-by-tick simulation engine |
| `src/lib/loop/agent-decider.ts` | LLM agent: tool calls, prior adjustment, two-tier routing |
| `src/lib/loop/agent-tools.ts` | Agent's retrieval tools (6 functions) |
| `src/lib/loop/learned-priors.ts` | Beta counters with cold-start backoff |
| `src/lib/loop/episodic-memory.ts` | k-nearest precedent retrieval |
| `src/lib/eval/runner.ts` | 7-arm eval with paired bootstrap CIs |
| `src/lib/eval/metrics.ts` | Cost model: response + harm + flood |
| `src/lib/engine/baseline-scorer.ts` | Rules-only scorer |
| `src/components/dispatch/` | UI components (timeline, queue, override) |
| `demo-cache/` | 1,586 committed LLM traces for keyless demo |
| `docs/DECISION.md` | 35+ decisions with rationale |
| `docs/PROGRESS.md` | Phase checklist with executed evidence |
| `WRITEUP.md` | Technical writeup (point of view, results, limitations) |

## Deploy

Push to any Node host. Render config included:

```yaml
# render.yaml
services:
  - type: web
    name: calvis-dispatch
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: DEMO
        value: "1"
```

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · Drizzle ORM · PGlite · Vitest · seedrandom
