import { seedWorld } from "../src/lib/engine/seed-world";
import { siteRepo, guardRepo, robotRepo, decisionRepo, incidentRepo, outcomeRepo } from "../src/lib/db/repository";
import { generateEventStream, getScenarioEvents, SCENARIOS } from "../src/lib/engine/scenarios";
import { IngestionPipeline } from "../src/lib/engine/ingestion";
import { correlateEvents } from "../src/lib/engine/correlator";
import { scoreAndDecide } from "../src/lib/engine/baseline-scorer";
import { generateSimOutcomes } from "../src/lib/engine/outcome-join";
import { responseCostUsd, harmCostUsd } from "../src/lib/eval/metrics";

async function main() {
  const seed = 42;
  await seedWorld({ seed });
  const events = generateEventStream({ seed, sites: await siteRepo.getAll(), guards: await guardRepo.getAll(), robots: await robotRepo.getAll() });
  await new IngestionPipeline(events).ingestAll();
  const incidents = await correlateEvents(events);
  for (const inc of incidents) await scoreAndDecide(inc);
  await generateSimOutcomes(incidents, events, 10 * 3600 * 1000);

  console.log("=== NEW HEADROOM (operational cost in $) ===\n");
  console.log(`${"Scenario".padEnd(30)} ${"Tier".padStart(5)} ${"True".padStart(5)} ${"Resp$".padStart(8)} ${"Harm$".padStart(8)} ${"Total$".padStart(8)}`);
  console.log("─".repeat(75));

  for (const name of Object.keys(SCENARIOS)) {
    const scenarioEvents = getScenarioEvents(events, name);
    const allInc = await incidentRepo.getAll();
    const matched = allInc.filter((inc) => {
      const eids: string[] = JSON.parse(inc.eventIds);
      return eids.some((eid) => scenarioEvents.some((se) => se.id === eid));
    });

    for (const inc of matched) {
      const decs = await decisionRepo.getByIncident(inc.id);
      const outs = await outcomeRepo.getByIncident(inc.id);
      if (decs.length === 0) continue;
      const d = decs[0];
      const o = outs[0];
      const resp = responseCostUsd(d.chosenTier);
      const harm = o ? harmCostUsd(o.correctTier ?? 0, d.chosenTier, !!o.wasReal) : 0;
      console.log(`${name.padEnd(30)} ${String(d.chosenTier).padStart(5)} ${String(o?.correctTier ?? "?").padStart(5)} ${("$" + resp.toFixed(2)).padStart(8)} ${("$" + harm.toFixed(0)).padStart(8)} ${("$" + (resp + harm).toFixed(2)).padStart(8)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
