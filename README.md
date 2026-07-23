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
3. Click **Show full model thinking** on the agent analysis — see the raw LLM reasoning
4. Click **Override** → set tier to T0 → type "false alarm" → watch the prior update
5. Press **J/K** to navigate the queue

## What you're looking at

**Left panel:** Incident queue sorted by severity. Active incidents (E1+) above, resolved (E0) below. ↑↓ arrows show where evidence escalated or de-escalated.

**Right panel:** Timeline for the selected incident. Sensor events interleaved with agent actions, followed by the agent's analysis: probability chain, reasoning, and what would change its mind. One click deeper shows model metadata (which model, tokens, cost, cache).

## Other commands

```bash
npm test           # 160 tests
npm run dev        # Dev server with hot reload
npm run learn      # 30-night learning curve (no API key needed)
```

## Live mode (optional)

```bash
# Set in .env
DEMO=0
DEEPSEEK_API_KEY=sk-...
AGENT_MAX_USD_PER_RUN=2.00
```

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · PGlite · Drizzle ORM · DeepSeek
