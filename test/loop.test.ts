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

describe('optimizeLoop — B3.1 candidates + seed', () => {
  it('screens K candidates on failing scenarios and full-measures only the winner', async () => {
    // candidate quality: proposal "c2" screens best
    const screenScores: Record<string, number> = { c1: 0.4, c2: 0.9, c3: 0.6 };
    const measured: string[] = [];
    let call = 0;

    const out = await optimizeLoop({
      baseline: resultWithSuccess(0.5),
      candidates: 3,
      rewrite: async () => ({ [`c${++call}`]: 'desc' }),
      screen: async (overrides) => {
        const key = Object.keys(overrides).find((k) => k.startsWith('c'))!;
        return screenScores[key]!;
      },
      measure: async (overrides) => {
        measured.push(Object.keys(overrides).join(','));
        return resultWithSuccess(0.8);
      },
      maxRounds: 1,
    });

    // only the screening winner was fully measured
    expect(measured).toEqual(['c2']);
    expect(out.best.result.aggregate.successRate).toBe(0.8);
    expect(out.rounds[0]!.kept).toBe(true);
    expect(out.rounds[0]!.screened).toEqual([
      { overrides: ['c1'], score: 0.4 },
      { overrides: ['c2'], score: 0.9 },
      { overrides: ['c3'], score: 0.6 },
    ]);
  });

  it('keeps an improving seed as round 0 and builds on it', async () => {
    const seed = { seeded_tool: 'known-good description' };
    let rewriteSawSeed = false;

    const out = await optimizeLoop({
      baseline: resultWithSuccess(0.5),
      seed,
      rewrite: async (_cur, curOverrides) => {
        rewriteSawSeed = 'seeded_tool' in curOverrides;
        return { r1_tool: 'd' };
      },
      measure: async (overrides) =>
        resultWithSuccess('r1_tool' in overrides ? 0.9 : 0.7),
      maxRounds: 1,
    });

    expect(out.rounds[0]!.round).toBe(0); // seed round recorded
    expect(out.rounds[0]!.kept).toBe(true);
    expect(rewriteSawSeed).toBe(true);
    expect(out.best.result.aggregate.successRate).toBe(0.9);
    expect(Object.keys(out.best.overrides).sort()).toEqual(['r1_tool', 'seeded_tool']);
  });

  it('discards a seed that does not beat the baseline', async () => {
    const out = await optimizeLoop({
      baseline: resultWithSuccess(0.8),
      seed: { bad_tool: 'worse description' },
      rewrite: async () => ({ x: 'd' }),
      measure: async (overrides) =>
        resultWithSuccess('bad_tool' in overrides ? 0.6 : 0.85),
      maxRounds: 1,
    });

    expect(out.rounds[0]!.round).toBe(0);
    expect(out.rounds[0]!.kept).toBe(false);
    // round 1 built on EMPTY overrides, not the bad seed
    expect(Object.keys(out.best.overrides)).toEqual(['x']);
    expect(out.best.result.aggregate.successRate).toBe(0.85);
  });
});
