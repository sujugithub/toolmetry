#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  badRate,
  bold,
  cyan,
  dim,
  goodRate,
  green,
  red,
  yellow,
} from './report/ansi.js';
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
  // stream + finalMessage so large max_tokens (rewriter: 32k) doesn't trip the
  // SDK's 10-minute non-streaming guard
  const anthropic = new Anthropic();
  return {
    messages: {
      create: (params) => anthropic.messages.stream(params).finalMessage(),
    },
  };
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
  process.env['TOOLMETRY_AGENT_MODEL'] ?? 'claude-haiku-4-5';
const DEFAULT_JUDGE_MODEL =
  process.env['TOOLMETRY_JUDGE_MODEL'] ?? DEFAULT_REWRITER_MODEL;
const DEFAULT_BUDGET_USD = process.env['TOOLMETRY_BUDGET_USD'] ?? '5';

function pct(v: number | null): string {
  return v === null ? 'n/a' : `${(v * 100).toFixed(0)}%`;
}

function printSummary(result: MeasureResult): void {
  const header = ['scenario', 'hit rate', 'args', 'extra calls', 'success'];
  const idWidth = Math.max(
    header[0]!.length,
    ...result.scenarios.map((s) => s.aggregate.scenarioId.length),
  );
  console.log();
  console.log(
    `  ${bold(header[0]!.padEnd(idWidth))}  ${header.slice(1).map((h) => bold(h.padStart(13))).join('')}`,
  );
  for (const s of result.scenarios) {
    const a = s.aggregate;
    console.log(
      `  ${a.scenarioId.padEnd(idWidth)}  ` +
        goodRate(a.hitRate, pct(a.hitRate).padStart(13)) +
        goodRate(a.argCorrectness, pct(a.argCorrectness).padStart(13)) +
        badRate(a.extraCallRate, pct(a.extraCallRate).padStart(13)) +
        goodRate(a.successRate, pct(a.successRate).padStart(13)),
    );
  }
  const a = result.aggregate;
  console.log(
    `\n${bold(result.suite)} — ${result.scenarios.length} scenarios × ${result.runsPerScenario} runs on ${cyan(result.model)}`,
  );
  console.log(
    `  hit rate ${goodRate(a.hitRate, pct(a.hitRate))} | arg correctness ${goodRate(a.argCorrectness, pct(a.argCorrectness))} | extra-call rate ${badRate(a.extraCallRate, pct(a.extraCallRate))} | strict success ${bold(goodRate(a.successRate, pct(a.successRate)))}`,
  );
  console.log(
    dim(
      `  tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out — estimated cost ${formatUsd(result.estimatedCostUsd)}`,
    ),
  );
  if (result.aborted) console.error(red(`  ⚠ ABORTED: ${result.aborted}`));
}

function colorProgress(msg: string): string {
  if (msg.includes(': ok ')) return msg.replace(': ok ', `: ${green('ok')} `);
  if (msg.includes(': partial '))
    return msg.replace(': partial ', `: ${yellow('partial')} `);
  if (msg.includes(': miss ')) return msg.replace(': miss ', `: ${red('miss')} `);
  if (msg.includes(': ERROR ')) return msg.replace(': ERROR ', `: ${red('ERROR')} `);
  return msg;
}

/** Suite files for a path: a YAML file itself, or every suite in a directory. */
function suiteFilesFor(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  // scenarios/<name>/<name>.yaml layout first, then any *.yaml directly inside
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const inner = readdirSync(join(path, entry.name)).filter((f) =>
        /\.ya?ml$/.test(f),
      );
      files.push(...inner.map((f) => join(path, entry.name, f)));
    } else if (/\.ya?ml$/.test(entry.name)) {
      files.push(join(path, entry.name));
    }
  }
  if (!files.length) throw new Error(`no suite YAML files found under ${path}`);
  return files.sort();
}

/** --setup default: a setup-sandbox.sh sitting next to the suite YAML. */
function defaultSetupFor(suiteFile: string): string | undefined {
  const candidate = join(dirname(suiteFile), 'setup-sandbox.sh');
  return existsSync(candidate) ? `sh ${candidate}` : undefined;
}

const program = new Command();
program
  .enablePositionalOptions()
  .name('toolmetry')
  .description(
    "Measure how well AI agents use your MCP server's tools — then fix the descriptions and prove it.",
  )
  .addHelpText(
    'after',
    `
Examples:
  $ toolmetry measure ./scenarios                        measure every suite, N=5 each
  $ toolmetry measure scenarios/sqlite/sqlite.yaml -n 1  quick smoke run (not reportable)
  $ toolmetry optimize scenarios/sqlite/sqlite.yaml --rounds 2
                                                       baseline → rewrite → re-measure
  $ toolmetry report results/a.json results/b.json -o diff.md
  $ toolmetry proxy --overrides best.json -- npx -y @modelcontextprotocol/server-filesystem /data
                                                       serve rewritten descriptions live

  A setup-sandbox.sh next to a suite YAML is run automatically before every run.
  Models: Anthropic ids use ANTHROPIC_API_KEY; accounts/fireworks/... ids use FIREWORKS_API_KEY.`,
  );

program
  .command('measure')
  .description('Run scenario suite(s) against their target MCP servers, N runs each')
  .argument('<suite>', 'suite YAML file, or a directory of suites (e.g. ./scenarios)')
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
    applyCustomPricing(opts.model, opts.priceIn, opts.priceOut);
    const runs = Number(opts.runs);
    if (runs < 5) {
      console.warn(
        yellow(
          `⚠ runs=${runs} is below the N=5 reporting floor — fine for smoke tests, do not record these numbers.`,
        ),
      );
    }
    const overrides = opts.overrides
      ? (JSON.parse(readFileSync(opts.overrides, 'utf8')) as Record<string, string>)
      : undefined;
    warnIfUnpriced(opts.model);

    const files = suiteFilesFor(suitePath);
    for (const file of files) {
      const suite = loadSuite(file);
      const setup = opts.setup ?? defaultSetupFor(file);
      if (files.length > 1) console.log(bold(`\n━━ ${suite.suite} (${file}) ━━`));
      if (!opts.setup && setup) console.log(dim(`  setup: ${setup}`));

      const result = await measureSuite(suite, {
        client: makeClient(opts.model),
        model: opts.model,
        runs,
        ...(setup ? { setupCommand: setup } : {}),
        budgetUsd: Number(opts.budget),
        ...(overrides ? { descriptionOverrides: overrides } : {}),
        maxIterations: Number(opts.maxIterations),
        onProgress: (m) => console.log(`  ${colorProgress(m)}`),
      });

      printSummary(result);
      console.log(`\nsaved: ${saveResult(result, opts.label)}`);
      if (result.aborted) process.exitCode = 2;
    }
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
  .option(
    '--candidates <k>',
    'rewrites sampled per round; screened on failing scenarios, only the winner is fully measured',
    '1',
  )
  .option(
    '--seed <file>',
    'known-good overrides JSON evaluated as round 0 (kept only if it beats the baseline)',
  )
  .action(async (suitePath: string, opts) => {
    const suite = loadSuite(suitePath);
    applyCustomPricing(opts.model, opts.priceIn, opts.priceOut);
    const runs = Number(opts.runs);
    const budgetUsd = Number(opts.budget);
    warnIfUnpriced(opts.model);
    warnIfUnpriced(opts.rewriter);
    const setup = opts.setup ?? defaultSetupFor(suitePath);
    if (!opts.setup && setup) console.log(dim(`setup: ${setup}`));
    const common = {
      client: makeClient(opts.model),
      model: opts.model as string,
      runs,
      ...(setup ? { setupCommand: setup } : {}),
      maxIterations: Number(opts.maxIterations),
      onProgress: (m: string) => console.log(`  ${colorProgress(m)}`),
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
    const candidates = Number(opts.candidates);
    const seed = opts.seed
      ? parseOverridesFile(readFileSync(opts.seed, 'utf8'))
      : undefined;
    if (seed) {
      console.log(
        `\nseeding round 0 with ${Object.keys(seed).length} override(s) from ${opts.seed}`,
      );
    }

    const out = await optimizeLoop({
      baseline,
      maxRounds: Number(opts.rounds),
      candidates,
      ...(seed ? { seed } : {}),
      screen: async (overrides, failingScenarioIds) => {
        const sub = {
          ...suite,
          scenarios: suite.scenarios.filter((s) =>
            failingScenarioIds.includes(s.id),
          ),
        };
        const r = await measureSuite(sub, {
          ...common,
          budgetUsd: Math.max(0, budgetUsd - spentUsd),
          descriptionOverrides: overrides,
          onProgress: () => {}, // screening is noisy; summarize below instead
        });
        spentUsd += r.estimatedCostUsd ?? 0;
        console.log(
          `  [screen] candidate {${Object.keys(overrides).length} overrides} on ${sub.scenarios.length} failing scenario(s): strict success ${(r.aggregate.successRate * 100).toFixed(0)}%`,
        );
        return r.aggregate.successRate;
      },
      rewrite: async (current, curOverrides) => {
        roundNum++;
        console.log(`\n[rewrite ${roundNum}] diagnosing failures with ${opts.rewriter}…`);
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
        const overridesFile = `results/${stamp}-${suite.suite}-overrides-rw${roundNum}.json`;
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
        console.log(`[measure] full suite with rewritten descriptions…`);
        const r = await measureSuite(suite, {
          ...common,
          budgetUsd: Math.max(0, budgetUsd - spentUsd),
          descriptionOverrides: overrides,
        });
        spentUsd += r.estimatedCostUsd ?? 0;
        printSummary(r);
        console.log(`saved: ${saveResult(r, `optimized-m${roundNum}`)}`);
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
    'Run an MCP server with rewritten tool descriptions — point your MCP config here instead of the target. Usage: toolmetry proxy --overrides o.json -- npx -y some-mcp-server args…',
  )
  .requiredOption(
    '--overrides <file>',
    'JSON: plain {tool: description} map, or the file saved by `toolmetry optimize`',
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
