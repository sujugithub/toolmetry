import type { MeasureResult } from '../harness/runner.js';

export interface ScreenedCandidate {
  /** keys of the proposal (the newly rewritten tools) */
  overrides: string[];
  /** strict success on the screening subset (current failing scenarios) */
  score: number;
}

export interface RoundRecord {
  /** 0 = the --seed evaluation; 1.. = rewrite rounds */
  round: number;
  overrides: Record<string, string>;
  result: MeasureResult;
  /** strict-success delta vs the best previous round, in fraction (0.02 = 2 pts) */
  delta: number;
  kept: boolean;
  /** present when candidates > 1: every proposal and its screening score */
  screened?: ScreenedCandidate[];
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
  /** Re-measure the whole suite with the given overrides. */
  measure: (overrides: Record<string, string>) => Promise<MeasureResult>;
  maxRounds?: number;
  /** Stop when a round improves strict success by less than this (fraction). */
  minDelta?: number;
  /** B3.1: sample K independent rewrites per round and keep the measured best.
   * Requires `screen` when > 1. Default 1 (single-shot, original behavior). */
  candidates?: number;
  /** Cheap evaluation of an override set on ONLY the given failing scenarios;
   * returns strict success on that subset. Used to pick among candidates
   * before spending a full-suite measurement on the winner. */
  screen?: (
    overrides: Record<string, string>,
    failingScenarioIds: string[],
  ) => Promise<number>;
  /** B3.1: known-good overrides evaluated as round 0. Kept only if they beat
   * the baseline — a stale seed is discarded, not trusted. */
  seed?: Record<string, string>;
}

function failingIds(result: MeasureResult): string[] {
  return result.scenarios
    .filter((s) => s.aggregate.successRate < 1)
    .map((s) => s.aggregate.scenarioId);
}

/** Multi-round optimization: rewrite → re-measure → keep only improvements.
 * Rewrites always start from the BEST round so far, so a regression is
 * discarded rather than compounded. With candidates > 1, each round samples K
 * proposals, screens them on the currently-failing scenarios, and only the
 * screening winner gets a full-suite measurement (which still guards against
 * regressions on passing scenarios). Termination: all scenarios pass, a round
 * regresses, improvement < minDelta (converged), or maxRounds. */
export async function optimizeLoop(
  opts: OptimizeLoopOptions,
): Promise<OptimizeLoopResult> {
  const {
    baseline,
    rewrite,
    measure,
    maxRounds = 3,
    minDelta = 0.02,
    candidates = 1,
    screen,
    seed,
  } = opts;

  if (candidates > 1 && !screen) {
    throw new Error('candidates > 1 requires a screen function');
  }

  let best: { overrides: Record<string, string>; result: MeasureResult } = {
    overrides: {},
    result: baseline,
  };
  const rounds: RoundRecord[] = [];
  let stoppedBecause: OptimizeLoopResult['stoppedBecause'] = 'max-rounds';

  // round 0: evaluate the seed, keep only if it actually beats the baseline
  if (seed && Object.keys(seed).length) {
    const result = await measure(seed);
    const delta = result.aggregate.successRate - baseline.aggregate.successRate;
    const kept = delta > 0;
    rounds.push({ round: 0, overrides: seed, result, delta, kept });
    if (kept) best = { overrides: seed, result };
  }

  for (let round = 1; round <= maxRounds; round++) {
    if (best.result.aggregate.successRate >= 1) {
      stoppedBecause = 'all-passing';
      break;
    }

    // propose: 1 or K independent rewrites off the current best
    let proposed: Record<string, string>;
    let screened: ScreenedCandidate[] | undefined;
    if (candidates > 1) {
      const proposals = await Promise.all(
        Array.from({ length: candidates }, () =>
          rewrite(best.result, best.overrides),
        ),
      );
      const subset = failingIds(best.result);
      // screenings run SEQUENTIALLY: they execute real scenario runs against a
      // shared sandbox (setup scripts rm -rf the same path), so concurrent
      // screeners corrupt each other's fixtures
      const scores: number[] = [];
      for (const p of proposals) {
        scores.push(await screen!({ ...best.overrides, ...p }, subset));
      }
      screened = proposals.map((p, i) => ({
        overrides: Object.keys(p),
        score: scores[i]!,
      }));
      const bestIdx = scores.indexOf(Math.max(...scores));
      proposed = proposals[bestIdx]!;
    } else {
      proposed = await rewrite(best.result, best.overrides);
    }

    // rewrites accumulate on top of what the best round already used
    const overrides = { ...best.overrides, ...proposed };
    const result = await measure(overrides);
    const delta =
      result.aggregate.successRate - best.result.aggregate.successRate;
    const kept = delta > 0;

    rounds.push({
      round,
      overrides,
      result,
      delta,
      kept,
      ...(screened ? { screened } : {}),
    });

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
