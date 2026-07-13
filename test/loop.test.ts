import { describe, expect, it } from 'vitest';
import type { MeasureResult } from '../src/harness/runner.js';
import { optimizeLoop } from '../src/optimizer/loop.js';

function resultWithSuccess(successRate: number): MeasureResult {
  return {
    suite: 'demo',
    model: 'fake',
    runsPerScenario: 5,
    scenarios: [],
    aggregate: {
      scenarioCount: 1,
      hitRate: successRate,
      argCorrectness: 1,
      extraCallRate: 0,
      successRate,
    },
    usage: { inputTokens: 0, outputTokens: 0 },
    estimatedCostUsd: 0,
  };
}

describe('optimizeLoop', () => {
  it('keeps improving rounds and accumulates overrides on the best state', async () => {
    const successByRound = [0.7, 0.85, 0.9, 0.91];
    let round = 0;
    const out = await optimizeLoop({
      baseline: resultWithSuccess(0.5),
      rewrite: async (_cur, curOverrides) => ({
        [`tool_r${round + 1}`]: 'desc',
        ...(round === 0 ? {} : { carried: Object.keys(curOverrides).join(',') }),
      }),
      measure: async () => resultWithSuccess(successByRound[round++]!),
      maxRounds: 10,
      minDelta: 0.02,
    });

    // round 4 improved by only .01 < minDelta → converged, but still kept
    expect(out.stoppedBecause).toBe('converged');
    expect(out.rounds).toHaveLength(4);
    expect(out.rounds.every((r) => r.kept)).toBe(true);
    expect(out.best.result.aggregate.successRate).toBe(0.91);
    // overrides accumulated across rounds
    expect(Object.keys(out.best.overrides)).toContain('tool_r1');
    expect(Object.keys(out.best.overrides)).toContain('tool_r4');
  });

  it('discards a regressing round and stops', async () => {
    const successByRound = [0.8, 0.6];
    let round = 0;
    const out = await optimizeLoop({
      baseline: resultWithSuccess(0.7),
      rewrite: async () => ({ [`t${round}`]: 'd' }),
      measure: async () => resultWithSuccess(successByRound[round++]!),
      maxRounds: 5,
    });

    expect(out.stoppedBecause).toBe('regressed');
    expect(out.rounds).toHaveLength(2);
    expect(out.rounds[1]!.kept).toBe(false);
    // best is round 1, not the regressed round 2
    expect(out.best.result.aggregate.successRate).toBe(0.8);
    expect(Object.keys(out.best.overrides)).toEqual(['t0']);
  });

  it('stops immediately when everything already passes', async () => {
    const out = await optimizeLoop({
      baseline: resultWithSuccess(1),
      rewrite: async () => {
        throw new Error('should not be called');
      },
      measure: async () => {
        throw new Error('should not be called');
      },
    });
    expect(out.stoppedBecause).toBe('all-passing');
    expect(out.rounds).toHaveLength(0);
  });

  it('respects maxRounds', async () => {
    let round = 0;
    const out = await optimizeLoop({
      baseline: resultWithSuccess(0.1),
      rewrite: async () => ({ [`t${round}`]: 'd' }),
      measure: async () => resultWithSuccess(0.1 + ++round * 0.1),
      maxRounds: 2,
      minDelta: 0.02,
    });
    expect(out.stoppedBecause).toBe('max-rounds');
    expect(out.rounds).toHaveLength(2);
    expect(out.best.result.aggregate.successRate).toBeCloseTo(0.3, 10);
  });
});
