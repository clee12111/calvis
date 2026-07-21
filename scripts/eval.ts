import {
  runMultiple,
  formatMetricsTable,
  runAllArmsCompared,
  formatComparisonTable,
} from "../src/lib/eval/runner";
import fs from "fs";
import path from "path";

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string, def: string) => {
    const idx = args.findIndex((a) => a.startsWith(`--${name}=`));
    return idx >= 0 ? args[idx].split("=")[1] : def;
  };

  const armName = getArg("arm", "all");
  const baseSeed = Number(getArg("seed", "42"));
  const runs = Number(getArg("runs", process.env.EVAL_RUNS ?? "10"));

  const outDir = path.resolve(process.cwd(), "evals", "results");
  fs.mkdirSync(outDir, { recursive: true });

  if (armName === "all") {
    console.log(`Running all arms: seed=${baseSeed}, runs=${runs}\n`);
    const { baseline, comparisons } = await runAllArmsCompared(baseSeed, runs);
    console.log(formatMetricsTable(baseline));
    console.log();
    console.log(formatComparisonTable(baseline, comparisons));

    const beaters = comparisons.filter((c) => c.beatsBaseline);
    if (beaters.length > 0) {
      console.log("\n⚠️  DEGENERATE ARM(S) BEAT BASELINE:");
      for (const b of beaters) {
        console.log(`  ${b.arm}: Δ = $${b.meanDelta.toFixed(0)}, CI = [$${b.ci95[0].toFixed(0)}, $${b.ci95[1].toFixed(0)}]`);
      }
      console.log("STOP: The metric is not measuring competence.");
    } else {
      console.log("\n✓ No degenerate arm beats rules-only.");
    }

    const outFile = path.join(outDir, `all-arms-seed${baseSeed}-runs${runs}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ baseline, comparisons }, null, 2));
    console.log(`\nResults written to ${outFile}`);
  } else {
    console.log(`Running eval: arm=${armName}, seed=${baseSeed}, runs=${runs}\n`);
    const result = await runMultiple(armName, baseSeed, runs);
    console.log(formatMetricsTable(result));

    const outFile = path.join(outDir, `${armName}-seed${baseSeed}-runs${runs}.json`);
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
    console.log(`\nResults written to ${outFile}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
