import type { MeasureResult } from '../harness/runner.js';

export interface RoundRecord {
  round: number;
  overrides: Record<string, string>;
  result: MeasureResult;
  /** strict-success delta vs the best previous round, in fraction (0.02 = 2 pts) */
  delta: number;
  kept: boolean;
}

export interface OptimizeLoopResult {
  rounds: RoundRecord[];
  best: { overrides: Record<string, string>; result: MeasureResult };
  stoppedBecause: 'converged' | 'max-rounds' | 'all-passing' | 'regressed';
}

export interface OptimizeLoopOptions {
  baseline: MeasureResult;
  /** Propose overrides given the current best result and the overrides it used. */
  rewrite: (
    current: MeasureResult,
    currentOverrides: Record<string, string>,
  ) => Promise<Record<string, string>>;
  /** Re-measure the suite with the given overrides. */
  measure: (overrides: Record<string, string>) => Promise<MeasureResult>;
  maxRounds?: number;
  /** Stop when a round improves strict success by less than this (fraction). */
  minDelta?: number;
}

/** Multi-round optimization: rewrite → re-measure → keep only improvements.
 * Rewrites always start from the BEST round so far, so a regression is
 * discarded rather than compounded. Termination: all scenarios pass, a round
 * regresses, improvement < minDelta (converged), or maxRounds. */
export async function optimizeLoop(
  opts: OptimizeLoopOptions,
): Promise<OptimizeLoopResult> {
  const { baseline, rewrite, measure, maxRounds = 3, minDelta = 0.02 } = opts;

  let best: { overrides: Record<string, string>; result: MeasureResult } = {
    overrides: {},
    result: baseline,
  };
  const rounds: RoundRecord[] = [];
  let stoppedBecause: OptimizeLoopResult['stoppedBecause'] = 'max-rounds';

  for (let round = 1; round <= maxRounds; round++) {
    if (best.result.aggregate.successRate >= 1) {
      stoppedBecause = 'all-passing';
      break;
    }

    const proposed = await rewrite(best.result, best.overrides);
    // rewrites accumulate on top of what the best round already used
    const overrides = { ...best.overrides, ...proposed };
    const result = await measure(overrides);
    const delta =
      result.aggregate.successRate - best.result.aggregate.successRate;
    const kept = delta > 0;

    rounds.push({ round, overrides, result, delta, kept });

    if (kept) best = { overrides, result };

    if (delta < 0) {
      stoppedBecause = 'regressed';
      break;
    }
    if (delta < minDelta) {
      stoppedBecause = 'converged';
      break;
    }
  }

  if (
    stoppedBecause === 'max-rounds' &&
    best.result.aggregate.successRate >= 1
  ) {
    stoppedBecause = 'all-passing';
  }

  return { rounds, best, stoppedBecause };
}
