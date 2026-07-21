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
- [ ] 0.6.1 · Drizzle 1.0 RC, schema to pg-core
- [ ] 0.6.2 · Two targets: Neon (app) + PGlite (eval/keyless)
- [ ] 0.6.3 · Async cascade through all consumers
- [ ] 0.6.4 · Zero-install keyless path works

## F0.7 — Provider, generator, cache
- [ ] 0.7.1 · LLMProvider interface + smoke test
- [ ] 0.7.2 · Offline night generator (gen:nights)
- [ ] 0.7.3 · Fixture replay in runner
- [ ] 0.7.4 · Trace cache + DEMO=1

## F0.8 — Loop machinery (no agent)
- [ ] 0.8.1 · Incident working state
- [ ] 0.8.2 · Action catalogue with costs
- [ ] 0.8.3 · Three-move decider (rules version)
- [ ] 0.8.4 · Deterministic response map
- [ ] 0.8.5 · Time-driven loop
- [ ] 0.8.6 · Simulated question responses
- [ ] 0.8.7 · Determinism isolation
