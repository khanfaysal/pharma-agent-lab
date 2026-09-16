/**
 * Run the evaluation suite from the CLI.
 *
 *   npm run eval -w @lab/api                          # retrieval only (free, no LLM)
 *   npm run eval -w @lab/api -- --agents              # + single vs multi end-to-end
 *   npm run eval -w @lab/api -- --agents --limit=5
 *   npm run eval -w @lab/api -- --agents --arch=single,multi,baseline-no-tools
 */
import process from 'node:process';
import type { Architecture } from '../agent/types.js';
import { pool } from '../db.js';
import { evaluateArchitectures, evaluateRetrieval } from '../eval/runner.js';

function flag(name: string): string | null {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq === -1 ? '' : hit.slice(eq + 1);
}

const pct = (v: number | null) => (v === null ? '   -  ' : `${(v * 100).toFixed(1)}%`.padStart(6));
const num = (v: number | null, digits = 0) => (v === null ? '  -' : v.toFixed(digits));

async function main() {
  const suite = flag('suite') || 'default';
  const persist = flag('persist') !== null;

  // ---------------------------------------------------------- retrieval
  console.log(`\nRETRIEVAL  (suite "${suite}", no LLM calls)\n`);
  const retrieval = await evaluateRetrieval({ suite, persist });

  console.log('  mode      cases  recall@k  prec@k     MRR    nDCG   latency');
  console.log('  ' + '-'.repeat(58));
  for (const r of retrieval.results) {
    console.log(
      `  ${r.mode.padEnd(9)} ${String(r.cases).padStart(5)}   `
      + `${pct(r.avgRecall)}  ${pct(r.avgPrecision)}  ${pct(r.avgMrr)}  ${pct(r.avgNdcg)}`
      + `  ${num(r.avgLatencyMs)}ms`,
    );
  }

  // Name the cases nothing retrieved -- an aggregate hides exactly the cases
  // worth looking at.
  const hybrid = retrieval.results.find((r) => r.mode === 'hybrid');
  const misses = hybrid?.perCase.filter((c) => c.recallAtK === 0) ?? [];
  if (misses.length) {
    console.log(`\n  ${misses.length} case(s) with zero recall under hybrid:`);
    for (const m of misses) {
      console.log(`    - "${m.question}"`);
      console.log(`      wanted ${JSON.stringify(m.relevant)}, got ${JSON.stringify(m.retrieved.slice(0, 4))}`);
    }
  }

  // ------------------------------------------------------------- agents
  if (flag('agents') !== null) {
    const archFlag = flag('arch');
    const architectures = (archFlag ? archFlag.split(',') : ['single', 'multi']) as Architecture[];
    const limitFlag = flag('limit');
    const limit = limitFlag ? Number(limitFlag) : undefined;

    console.log(`\n\nARCHITECTURES  (${architectures.join(', ')}${limit ? `, first ${limit} case(s)` : ''})`);
    console.log('  This spends real tokens.\n');

    const agents = await evaluateArchitectures({
      suite,
      architectures,
      limit,
      persist: flag('no-persist') === null,
    });

    console.log('  architecture          cases   route   answer  recall    nDCG   steps   latency      cost');
    console.log('  ' + '-'.repeat(92));
    for (const s of agents.summaries) {
      console.log(
        `  ${s.architecture.padEnd(20)} ${String(s.cases).padStart(5)}  `
        + `${pct(s.routeAccuracy)}  ${pct(s.answerAccuracy)}  ${pct(s.avgRecall)}  ${pct(s.avgNdcg)}`
        + `   ${num(s.avgSteps, 1).padStart(4)}  ${num(s.avgLatencyMs).padStart(6)}ms  `
        + `$${s.totalCostUsd.toFixed(5)}`
        + (s.degraded ? '   [DEGRADED: mock models]' : ''),
      );
    }

    for (const s of agents.summaries) {
      const wrong = s.perCase.filter((c) => c.routeCorrect === false);
      const unanswered = s.perCase.filter((c) => !c.answerMatched && c.answerMisses.length);
      if (wrong.length || unanswered.length) {
        console.log(`\n  ${s.architecture}:`);
        for (const c of wrong) {
          console.log(`    route  expected ${c.expectedRoute}, got ${c.actualRoute}  -- "${c.question}"`);
        }
        for (const c of unanswered) {
          console.log(`    answer missing ${JSON.stringify(c.answerMisses)}  -- "${c.question}"`);
        }
      }
    }
  } else {
    console.log('\n  (pass --agents to also run the end-to-end architecture comparison)');
  }

  console.log();
  await pool.end();
}

main().catch(async (err) => {
  console.error('\nEvaluation failed:', err instanceof Error ? err.message : err);
  await pool.end();
  process.exit(1);
});
