import { describe, expect, it } from 'vitest';
import type { MeasureResult } from '../src/harness/runner.js';
import { diffReport } from '../src/report/diff.js';

function fakeResult(hitRates: Record<string, number>): MeasureResult {
  const scenarios = Object.entries(hitRates).map(([id, hitRate]) => ({
    scenario: { id, prompt: 'p', expected_tool: 't', max_calls: 1 },
    aggregate: {
      scenarioId: id,
      n: 5,
      hitRate,
      argCorrectness: 1,
      extraCallRate: 0,
      successRate: hitRate,
      runs: [],
    },
    runs: [],
  }));
  const mean =
    scenarios.reduce((a, s) => a + s.aggregate.hitRate, 0) / scenarios.length;
  return {
    suite: 'demo',
    model: 'claude-haiku-4-5',
    runsPerScenario: 5,
    scenarios,
    aggregate: {
      scenarioCount: scenarios.length,
      hitRate: mean,
      argCorrectness: 1,
      extraCallRate: 0,
      successRate: mean,
    },
    usage: { inputTokens: 1000, outputTokens: 100 },
    estimatedCostUsd: 0.0015,
  };
}

describe('diffReport', () => {
  it('shows the headline hit-rate delta and per-scenario rows', () => {
    const baseline = fakeResult({ a: 0.2, b: 1 });
    const optimized = fakeResult({ a: 0.8, b: 1 });
    const md = diffReport(baseline, optimized, {
      read_file: 'DEPRECATED — use read_text_file.',
    });

    expect(md).toContain('60% → 90% (+30 pts)');
    expect(md).toContain('| a | 20% | 80% | **+60** |');
    expect(md).toContain('| b | 100% | 100% | ±0 |');
    expect(md).toContain('### read_file');
    expect(md).toContain('$0.0015');
  });

  it('marks scenarios missing from the optimized run', () => {
    const md = diffReport(fakeResult({ a: 1, b: 0 }), fakeResult({ a: 1 }));
    expect(md).toContain('| b | 0% | missing | n/a |');
  });
});
