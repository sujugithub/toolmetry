#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { Command } from 'commander';
import { loadSuite } from './scenarios/loader.js';
import { measureSuite, type MeasureResult } from './harness/runner.js';
import { McpTarget } from './harness/target.js';
import { FireworksClient } from './harness/fireworks.js';
import type { MessageCreator } from './harness/agent.js';
import { estimateCostUsd, formatUsd, registerPricing } from './harness/cost.js';
import { saveResult, type SavedResult } from './report/results.js';
import { diffReport } from './report/diff.js';
import {
  DEFAULT_REWRITER_MODEL,
  failingScenarios,
  proposeRewrites,
} from './optimizer/rewrite.js';
import { parseOverridesFile, startProxy } from './proxy/proxy.js';
import { optimizeLoop } from './optimizer/loop.js';

/** Model id decides the provider: accounts/... → Fireworks, else Anthropic. */
function makeClient(model: string): MessageCreator {
  if (model.startsWith('accounts/')) {
    const key = process.env['FIREWORKS_API_KEY'];
    if (!key) {
      throw new Error(
        `model "${model}" is a Fireworks id but FIREWORKS_API_KEY is not set`,
      );
    }
    return new FireworksClient(key);
  }
  return new Anthropic();
}

function warnIfUnpriced(model: string): void {
  if (estimateCostUsd(model, { inputTokens: 1, outputTokens: 1 }) === null) {
    console.warn(
      `⚠ no pricing data for "${model}" — cost estimates unavailable and the USD budget guard is INACTIVE for this run. Pass --price-in/--price-out (USD per MTok) to activate it.`,
    );
  }
}

/** Wire --price-in/--price-out into the pricing registry for a model. */
function applyCustomPricing(
  model: string,
  priceIn?: string,
  priceOut?: string,
): void {
  if (priceIn === undefined && priceOut === undefined) return;
  if (priceIn === undefined || priceOut === undefined) {
    throw new Error('--price-in and --price-out must be given together');
  }
  registerPricing(model, {
    input: Number(priceIn),
    output: Number(priceOut),
  });
}

const DEFAULT_AGENT_MODEL =
  process.env['HITRATE_AGENT_MODEL'] ?? 'claude-haiku-4-5';
const DEFAULT_JUDGE_MODEL =
  process.env['HITRATE_JUDGE_MODEL'] ?? DEFAULT_REWRITER_MODEL;
const DEFAULT_BUDGET_USD = process.env['HITRATE_BUDGET_USD'] ?? '5';

function pct(v: number | null): string {
  return v === null ? 'n/a' : `${(v * 100).toFixed(0)}%`;
}

function printSummary(result: MeasureResult): void {
  const rows = result.scenarios.map((s) => ({
    scenario: s.aggregate.scenarioId,
    'hit rate': pct(s.aggregate.hitRate),
    args: pct(s.aggregate.argCorrectness),
    'extra calls': pct(s.aggregate.extraCallRate),
    success: pct(s.aggregate.successRate),
  }));
  console.table(rows);
  const a = result.aggregate;
  console.log(
    `\n${result.suite} — ${result.scenarios.length} scenarios × ${result.runsPerScenario} runs on ${result.model}`,
  );
  console.log(
    `  hit rate ${pct(a.hitRate)} | arg correctness ${pct(a.argCorrectness)} | extra-call rate ${pct(a.extraCallRate)} | strict success ${pct(a.successRate)}`,
  );
  console.log(
    `  tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out — estimated cost ${formatUsd(result.estimatedCostUsd)}`,
  );
  if (result.aborted) console.error(`  ⚠ ABORTED: ${result.aborted}`);
}

const program = new Command();
program
  .enablePositionalOptions()
  .name('hitrate')
  .description(
    "Measure how well AI agents use your MCP server's tools — then fix the descriptions and prove it.",
  );

program
  .command('measure')
  .description('Run a scenario suite against its target MCP server, N runs each')
  .argument('<suite>', 'path to a scenario suite YAML file')
  .option('-n, --runs <n>', 'runs per scenario (report floor is 5)', '5')
  .option('-m, --model <id>', 'agent model', DEFAULT_AGENT_MODEL)
  .option('-s, --setup <cmd>', 'shell command run before every run (sandbox reset)')
  .option('-b, --budget <usd>', 'hard cost ceiling in USD', DEFAULT_BUDGET_USD)
  .option(
    '--overrides <file>',
    'JSON file of {toolName: newDescription} applied in-memory (optimized run)',
  )
  .option('--label <label>', 'label for the saved result file', 'baseline')
  .option('--max-iterations <n>', 'agent loop iteration cap', '6')
  .option('--price-in <usd>', 'USD per MTok input for unpriced models (activates budget guard)')
  .option('--price-out <usd>', 'USD per MTok output for unpriced models')
  .action(async (suitePath: string, opts) => {
    const suite = loadSuite(suitePath);
    applyCustomPricing(opts.model, opts.priceIn, opts.priceOut);
    const runs = Number(opts.runs);
    if (runs < 5) {
      console.warn(
        `⚠ runs=${runs} is below the N=5 reporting floor — fine for smoke tests, do not record these numbers.`,
      );
    }
    const overrides = opts.overrides
      ? (JSON.parse(readFileSync(opts.overrides, 'utf8')) as Record<string, string>)
      : undefined;

    warnIfUnpriced(opts.model);
    const result = await measureSuite(suite, {
      client: makeClient(opts.model),
      model: opts.model,
      runs,
      ...(opts.setup ? { setupCommand: opts.setup } : {}),
      budgetUsd: Number(opts.budget),
      ...(overrides ? { descriptionOverrides: overrides } : {}),
      maxIterations: Number(opts.maxIterations),
      onProgress: (m) => console.log(`  ${m}`),
    });

    printSummary(result);
    const file = saveResult(result, opts.label);
    console.log(`\nsaved: ${file}`);
    if (result.aborted) process.exitCode = 2;
  });

program
  .command('optimize')
  .description(
    'Measure baseline → diagnose failures → rewrite descriptions → re-measure → report',
  )
  .argument('<suite>', 'path to a scenario suite YAML file')
  .option('-n, --runs <n>', 'runs per scenario', '5')
  .option('-m, --model <id>', 'agent model', DEFAULT_AGENT_MODEL)
  .option('--rewriter <id>', 'rewriter/judge model', DEFAULT_JUDGE_MODEL)
  .option('-s, --setup <cmd>', 'shell command run before every run (sandbox reset)')
  .option('-b, --budget <usd>', 'hard cost ceiling in USD (whole loop)', DEFAULT_BUDGET_USD)
  .option('--baseline <file>', 'reuse a saved baseline result JSON instead of re-measuring')
  .option('--max-iterations <n>', 'agent loop iteration cap', '6')
  .option('--price-in <usd>', 'USD per MTok input for unpriced agent models (activates budget guard)')
  .option('--price-out <usd>', 'USD per MTok output for unpriced agent models')
  .option('--rounds <n>', 'max optimization rounds (rewrite → re-measure, keep improvements)', '1')
  .action(async (suitePath: string, opts) => {
    const suite = loadSuite(suitePath);
    applyCustomPricing(opts.model, opts.priceIn, opts.priceOut);
    const runs = Number(opts.runs);
    const budgetUsd = Number(opts.budget);
    warnIfUnpriced(opts.model);
    warnIfUnpriced(opts.rewriter);
    const common = {
      client: makeClient(opts.model),
      model: opts.model as string,
      runs,
      ...(opts.setup ? { setupCommand: opts.setup } : {}),
      maxIterations: Number(opts.maxIterations),
      onProgress: (m: string) => console.log(`  ${m}`),
    };

    // 1. baseline
    let baseline: MeasureResult;
    if (opts.baseline) {
      baseline = (JSON.parse(readFileSync(opts.baseline, 'utf8')) as SavedResult)
        .result;
      console.log(`using saved baseline: ${opts.baseline}`);
    } else {
      console.log('measuring baseline…');
      baseline = await measureSuite(suite, { ...common, budgetUsd });
      printSummary(baseline);
      console.log(`saved: ${saveResult(baseline, 'baseline')}`);
      if (baseline.aborted) {
        console.error('baseline aborted on budget — not optimizing partial data');
        process.exit(2);
      }
    }

    if (failingScenarios(baseline).length === 0) {
      console.log('nothing to optimize — every scenario already passes.');
      return;
    }

    // 2. multi-round: rewrite → re-measure → keep improvements (B3)
    const target = await McpTarget.spawn(suite.server);
    const tools = target.listTools();
    await target.close();
    mkdirSync('results', { recursive: true });

    // only count spend from THIS invocation against the budget
    let spentUsd = opts.baseline ? 0 : (baseline.estimatedCostUsd ?? 0);
    let roundNum = 0;

    const out = await optimizeLoop({
      baseline,
      maxRounds: Number(opts.rounds),
      rewrite: async (current, curOverrides) => {
        roundNum++;
        console.log(`\n[round ${roundNum}] diagnosing failures with ${opts.rewriter}…`);
        const effectiveTools = tools.map((t) =>
          curOverrides[t.name] ? { ...t, description: curOverrides[t.name]! } : t,
        );
        const proposal = await proposeRewrites({
          client: makeClient(opts.rewriter),
          model: opts.rewriter,
          baseline: current,
          tools: effectiveTools,
        });
        spentUsd += estimateCostUsd(opts.rewriter, proposal.usage) ?? 0;
        console.log(`\n${proposal.diagnosis}\n`);
        for (const [tool, desc] of Object.entries(proposal.overrides)) {
          console.log(`  ${tool}: ${proposal.rationales[tool]}`);
          console.log(`    → ${desc}\n`);
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const overridesFile = `results/${stamp}-${suite.suite}-overrides-r${roundNum}.json`;
        writeFileSync(
          overridesFile,
          JSON.stringify(
            {
              round: roundNum,
              diagnosis: proposal.diagnosis,
              rationales: proposal.rationales,
              overrides: proposal.overrides,
            },
            null,
            2,
          ),
        );
        console.log(`overrides saved: ${overridesFile}`);
        return proposal.overrides;
      },
      measure: async (overrides) => {
        console.log(`[round ${roundNum}] re-measuring with rewritten descriptions…`);
        const r = await measureSuite(suite, {
          ...common,
          budgetUsd: Math.max(0, budgetUsd - spentUsd),
          descriptionOverrides: overrides,
        });
        spentUsd += r.estimatedCostUsd ?? 0;
        printSummary(r);
        console.log(`saved: ${saveResult(r, `optimized-r${roundNum}`)}`);
        return r;
      },
    });

    // 3. report best vs baseline
    const md = diffReport(baseline, out.best.result, out.best.overrides);
    const reportFile = `results/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${suite.suite}-report.md`;
    writeFileSync(reportFile, md);
    console.log(`\nreport: ${reportFile} (stopped: ${out.stoppedBecause}, rounds: ${out.rounds.length})`);

    const b = baseline.aggregate;
    const o = out.best.result.aggregate;
    const fmt = (x: number) => (x * 100).toFixed(1);
    const pts = (d: number) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pts`;
    console.log(
      `\nSTRICT SUCCESS: ${fmt(b.successRate)}% → ${fmt(o.successRate)}% (${pts(o.successRate - b.successRate)})`,
    );
    console.log(
      `HIT RATE:       ${fmt(b.hitRate)}% → ${fmt(o.hitRate)}% (${pts(o.hitRate - b.hitRate)})`,
    );
    console.log(`estimated spend this invocation: ${formatUsd(spentUsd)}`);
  });

program
  .command('proxy')
  .description(
    'Run an MCP server with rewritten tool descriptions — point your MCP config here instead of the target. Usage: hitrate proxy --overrides o.json -- npx -y some-mcp-server args…',
  )
  .requiredOption(
    '--overrides <file>',
    'JSON: plain {tool: description} map, or the file saved by `hitrate optimize`',
  )
  .argument('<command>', 'target server command')
  .argument('[args...]', 'target server arguments')
  .passThroughOptions()
  .action(async (command: string, args: string[], opts) => {
    const overrides = parseOverridesFile(readFileSync(opts.overrides, 'utf8'));
    await startProxy({ command, args }, overrides);
    // keep the process alive; the transport closes us when the client goes away
  });

program
  .command('report')
  .description('Render a markdown diff report from two saved result files')
  .argument('<baseline>', 'baseline result JSON (from measure)')
  .argument('<optimized>', 'optimized result JSON (from measure --overrides)')
  .option('-o, --out <file>', 'write markdown here instead of stdout')
  .action((baselinePath: string, optimizedPath: string, opts) => {
    const baseline = (JSON.parse(readFileSync(baselinePath, 'utf8')) as SavedResult)
      .result;
    const optimized = (
      JSON.parse(readFileSync(optimizedPath, 'utf8')) as SavedResult
    ).result;
    const md = diffReport(baseline, optimized, optimized.descriptionOverrides);
    if (opts.out) {
      writeFileSync(opts.out, md);
      console.log(`wrote ${opts.out}`);
    } else {
      console.log(md);
    }
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
