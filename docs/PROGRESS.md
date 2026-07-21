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
- [ ] 0.8.1 · Incident working state
- [ ] 0.8.2 · Action catalogue with costs
- [ ] 0.8.3 · Three-move decider (rules version)
- [ ] 0.8.4 · Deterministic response map
- [ ] 0.8.5 · Time-driven loop
- [ ] 0.8.6 · Simulated question responses
- [ ] 0.8.7 · Determinism isolation
