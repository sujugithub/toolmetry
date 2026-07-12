import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Scenario, ScenarioSuite } from '../scenarios/schema.js';
import {
  aggregateScenario,
  aggregateSuite,
  scoreRun,
  type RunScore,
  type ScenarioAggregate,
  type SuiteAggregate,
  type ToolCall,
} from '../metrics/index.js';
import { runAgentOnce, type AgentUsage, type MessageCreator } from './agent.js';
import { estimateCostUsd } from './cost.js';
import { McpTarget } from './target.js';

const execAsync = promisify(exec);

export interface RunDetail {
  run: number;
  toolCalls: ToolCall[];
  score: RunScore;
  usage: AgentUsage;
  hitIterationLimit: boolean;
  error?: string;
}

export interface ScenarioResult {
  scenario: Scenario;
  aggregate: ScenarioAggregate;
  runs: RunDetail[];
}

export interface MeasureResult {
  suite: string;
  model: string;
  runsPerScenario: number;
  scenarios: ScenarioResult[];
  aggregate: SuiteAggregate;
  usage: AgentUsage;
  estimatedCostUsd: number | null;
  /** set when the budget guard aborted the batch before all runs completed */
  aborted?: string;
  descriptionOverrides?: Record<string, string>;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly spentUsd: number,
    public readonly budgetUsd: number,
  ) {
    super(
      `budget guard tripped: estimated $${spentUsd.toFixed(4)} spent of $${budgetUsd.toFixed(2)} budget`,
    );
    this.name = 'BudgetExceededError';
  }
}

export interface MeasureOptions {
  client: MessageCreator;
  model: string;
  /** Runs per scenario. The project floor is 5 for any number we report. */
  runs: number;
  /** Shell command executed before EVERY run (sandbox reset). */
  setupCommand?: string;
  /** Hard cost ceiling in USD; the batch aborts (partial results kept) when crossed. */
  budgetUsd?: number;
  descriptionOverrides?: Record<string, string>;
  maxIterations?: number;
  /** Progress callback, e.g. for CLI output. */
  onProgress?: (msg: string) => void;
}

/** Measure a whole suite: spawn the target server once, then run every scenario
 * N times through the agent loop, resetting the sandbox before each run. */
export async function measureSuite(
  suite: ScenarioSuite,
  opts: MeasureOptions,
): Promise<MeasureResult> {
  const {
    client,
    model,
    runs,
    setupCommand,
    budgetUsd = 5,
    descriptionOverrides,
    maxIterations,
    onProgress = () => {},
  } = opts;

  const target = await McpTarget.spawn(
    suite.server,
    descriptionOverrides ? { descriptionOverrides } : {},
  );
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  const scenarios: ScenarioResult[] = [];
  let aborted: string | undefined;

  try {
    outer: for (const scenario of suite.scenarios) {
      const details: RunDetail[] = [];
      for (let run = 1; run <= runs; run++) {
        if (setupCommand) await execAsync(setupCommand);

        try {
          const result = await runAgentOnce({
            client,
            model,
            target,
            prompt: scenario.prompt,
            ...(maxIterations !== undefined ? { maxIterations } : {}),
          });
          usage.inputTokens += result.usage.inputTokens;
          usage.outputTokens += result.usage.outputTokens;

          const score = scoreRun(scenario, { toolCalls: result.toolCalls });
          details.push({
            run,
            toolCalls: result.toolCalls,
            score,
            usage: result.usage,
            hitIterationLimit: result.hitIterationLimit,
          });
          onProgress(
            `${scenario.id} run ${run}/${runs}: ${score.success ? 'ok' : score.hit ? 'partial' : 'miss'} (${result.toolCalls.map((c) => c.name).join(', ') || 'no tool call'})`,
          );
        } catch (err) {
          // API/transport failure — record it, never fabricate a score
          const message = (err as Error).message;
          details.push({
            run,
            toolCalls: [],
            score: {
              hit: false,
              argsCorrect: null,
              extraCalls: false,
              success: false,
            },
            usage: { inputTokens: 0, outputTokens: 0 },
            hitIterationLimit: false,
            error: message,
          });
          onProgress(`${scenario.id} run ${run}/${runs}: ERROR ${message}`);
        }

        const spent = estimateCostUsd(model, usage);
        if (spent !== null && spent > budgetUsd) {
          aborted = new BudgetExceededError(spent, budgetUsd).message;
          if (details.length) {
            scenarios.push(finishScenario(scenario, details));
          }
          onProgress(aborted);
          break outer;
        }
      }
      scenarios.push(finishScenario(scenario, details));
    }
  } finally {
    await target.close();
  }

  return {
    suite: suite.suite,
    model,
    runsPerScenario: runs,
    scenarios,
    aggregate: aggregateSuite(scenarios.map((s) => s.aggregate)),
    usage,
    estimatedCostUsd: estimateCostUsd(model, usage),
    ...(aborted ? { aborted } : {}),
    ...(descriptionOverrides ? { descriptionOverrides } : {}),
  };
}

function finishScenario(scenario: Scenario, details: RunDetail[]): ScenarioResult {
  return {
    scenario,
    aggregate: aggregateScenario(
      scenario,
      details.map((d) => ({ toolCalls: d.toolCalls })),
    ),
    runs: details,
  };
}
