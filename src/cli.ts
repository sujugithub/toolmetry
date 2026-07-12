#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { Command } from 'commander';
import { loadSuite } from './scenarios/loader.js';
import { measureSuite, type MeasureResult } from './harness/runner.js';
import { formatUsd } from './harness/cost.js';
import { saveResult } from './report/results.js';

const DEFAULT_AGENT_MODEL = 'claude-haiku-4-5';

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
  .option('-b, --budget <usd>', 'hard cost ceiling in USD', '5')
  .option(
    '--overrides <file>',
    'JSON file of {toolName: newDescription} applied in-memory (optimized run)',
  )
  .option('--label <label>', 'label for the saved result file', 'baseline')
  .option('--max-iterations <n>', 'agent loop iteration cap', '6')
  .action(async (suitePath: string, opts) => {
    const suite = loadSuite(suitePath);
    const runs = Number(opts.runs);
    if (runs < 5) {
      console.warn(
        `⚠ runs=${runs} is below the N=5 reporting floor — fine for smoke tests, do not record these numbers.`,
      );
    }
    const overrides = opts.overrides
      ? (JSON.parse(readFileSync(opts.overrides, 'utf8')) as Record<string, string>)
      : undefined;

    const result = await measureSuite(suite, {
      client: new Anthropic(),
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

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
