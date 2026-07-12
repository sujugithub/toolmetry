import type { Scenario } from '../scenarios/schema.js';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** One agent run against one scenario: the tool calls the agent actually made. */
export interface RunRecord {
  toolCalls: ToolCall[];
}

export interface RunScore {
  /** expected_tool was called at least once */
  hit: boolean;
  /** some call to expected_tool matched expected_args; null when not gradable (no hit) */
  argsCorrect: boolean | null;
  /** total tool calls exceeded max_calls */
  extraCalls: boolean;
  /** strict: hit && argsCorrect && !extraCalls */
  success: boolean;
}

export interface ScenarioAggregate {
  scenarioId: string;
  n: number;
  hitRate: number;
  /** mean over runs that hit; null if no run hit */
  argCorrectness: number | null;
  extraCallRate: number;
  successRate: number;
  runs: RunScore[];
}

export interface SuiteAggregate {
  scenarioCount: number;
  hitRate: number;
  argCorrectness: number | null;
  extraCallRate: number;
  successRate: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function valuesMatch(expected: unknown, actual: unknown): boolean {
  if (isPlainObject(expected) && isPlainObject(actual)) {
    return argsPartialMatch(expected, actual);
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return (
      expected.length === actual.length &&
      expected.every((v, i) => valuesMatch(v, actual[i]))
    );
  }
  return Object.is(expected, actual);
}

/** True when every key in `expected` is present in `actual` with a matching value.
 * Objects match partially at every nesting level; arrays must match exactly. */
export function argsPartialMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => key in actual && valuesMatch(value, actual[key]),
  );
}

export function scoreRun(scenario: Scenario, run: RunRecord): RunScore {
  const matchingTool = run.toolCalls.filter(
    (c) => c.name === scenario.expected_tool,
  );
  const hit = matchingTool.length > 0;

  let argsCorrect: boolean | null = null;
  if (hit) {
    argsCorrect = scenario.expected_args
      ? matchingTool.some((c) => argsPartialMatch(scenario.expected_args!, c.args))
      : true;
  }

  const extraCalls = run.toolCalls.length > scenario.max_calls;
  const success = hit && argsCorrect === true && !extraCalls;

  return { hit, argsCorrect, extraCalls, success };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function aggregateScenario(
  scenario: Scenario,
  runs: RunRecord[],
): ScenarioAggregate {
  const scores = runs.map((r) => scoreRun(scenario, r));
  const hits = scores.filter((s) => s.hit);

  return {
    scenarioId: scenario.id,
    n: scores.length,
    hitRate: mean(scores.map((s) => (s.hit ? 1 : 0))),
    argCorrectness: hits.length
      ? mean(hits.map((s) => (s.argsCorrect ? 1 : 0)))
      : null,
    extraCallRate: mean(scores.map((s) => (s.extraCalls ? 1 : 0))),
    successRate: mean(scores.map((s) => (s.success ? 1 : 0))),
    runs: scores,
  };
}

export function aggregateSuite(
  scenarios: ScenarioAggregate[],
): SuiteAggregate {
  const gradable = scenarios.filter((s) => s.argCorrectness !== null);
  return {
    scenarioCount: scenarios.length,
    hitRate: mean(scenarios.map((s) => s.hitRate)),
    argCorrectness: gradable.length
      ? mean(gradable.map((s) => s.argCorrectness!))
      : null,
    extraCallRate: mean(scenarios.map((s) => s.extraCallRate)),
    successRate: mean(scenarios.map((s) => s.successRate)),
  };
}
