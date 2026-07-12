import { describe, expect, it } from 'vitest';
import {
  aggregateScenario,
  aggregateSuite,
  argsPartialMatch,
  scoreRun,
} from '../src/metrics/index.js';
import type { Scenario } from '../src/scenarios/schema.js';

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  id: 'test-scenario',
  prompt: 'do the thing',
  expected_tool: 'read_text_file',
  max_calls: 1,
  ...over,
});

const call = (name: string, args: Record<string, unknown> = {}) => ({
  name,
  args,
});

describe('argsPartialMatch', () => {
  it('matches when expected is a subset of actual', () => {
    expect(
      argsPartialMatch({ path: '/a.txt' }, { path: '/a.txt', head: 5 }),
    ).toBe(true);
  });

  it('fails on differing values', () => {
    expect(argsPartialMatch({ path: '/a.txt' }, { path: '/b.txt' })).toBe(
      false,
    );
  });

  it('fails on missing keys', () => {
    expect(argsPartialMatch({ path: '/a.txt' }, {})).toBe(false);
  });

  it('recurses into nested objects (partial at every level)', () => {
    expect(
      argsPartialMatch(
        { opts: { depth: 2 } },
        { opts: { depth: 2, follow: true } },
      ),
    ).toBe(true);
    expect(
      argsPartialMatch({ opts: { depth: 2 } }, { opts: { depth: 3 } }),
    ).toBe(false);
  });

  it('compares arrays exactly (order and length)', () => {
    expect(argsPartialMatch({ paths: ['/a', '/b'] }, { paths: ['/a', '/b'] })).toBe(true);
    expect(argsPartialMatch({ paths: ['/a', '/b'] }, { paths: ['/b', '/a'] })).toBe(false);
    expect(argsPartialMatch({ paths: ['/a'] }, { paths: ['/a', '/b'] })).toBe(false);
  });
});

describe('scoreRun', () => {
  it('scores a perfect run as hit + success', () => {
    const s = scenario({ expected_args: { path: '/a.txt' } });
    const score = scoreRun(s, {
      toolCalls: [call('read_text_file', { path: '/a.txt' })],
    });
    expect(score).toEqual({
      hit: true,
      argsCorrect: true,
      extraCalls: false,
      success: true,
    });
  });

  it('scores a wrong-tool run as a miss', () => {
    const score = scoreRun(scenario(), {
      toolCalls: [call('read_file', { path: '/a.txt' })],
    });
    expect(score.hit).toBe(false);
    expect(score.argsCorrect).toBeNull(); // args not gradable without a hit
    expect(score.success).toBe(false);
  });

  it('scores hit with wrong args as not successful', () => {
    const s = scenario({ expected_args: { path: '/a.txt' } });
    const score = scoreRun(s, {
      toolCalls: [call('read_text_file', { path: '/wrong.txt' })],
    });
    expect(score.hit).toBe(true);
    expect(score.argsCorrect).toBe(false);
    expect(score.success).toBe(false);
  });

  it('treats a hit with no expected_args as args-correct', () => {
    const score = scoreRun(scenario(), {
      toolCalls: [call('read_text_file')],
    });
    expect(score.argsCorrect).toBe(true);
    expect(score.success).toBe(true);
  });

  it('flags extra calls beyond max_calls and fails strict success', () => {
    const score = scoreRun(scenario(), {
      toolCalls: [call('list_directory'), call('read_text_file')],
    });
    expect(score.hit).toBe(true);
    expect(score.extraCalls).toBe(true);
    expect(score.success).toBe(false);
  });

  it('accepts any matching call when multiple calls are allowed', () => {
    const s = scenario({ max_calls: 2, expected_args: { path: '/a.txt' } });
    const score = scoreRun(s, {
      toolCalls: [
        call('read_text_file', { path: '/other.txt' }),
        call('read_text_file', { path: '/a.txt' }),
      ],
    });
    expect(score).toEqual({
      hit: true,
      argsCorrect: true,
      extraCalls: false,
      success: true,
    });
  });

  it('scores a run with zero tool calls as a miss', () => {
    const score = scoreRun(scenario(), { toolCalls: [] });
    expect(score).toEqual({
      hit: false,
      argsCorrect: null,
      extraCalls: false,
      success: false,
    });
  });
});

describe('aggregateScenario', () => {
  it('averages scores across N runs', () => {
    const s = scenario({ expected_args: { path: '/a.txt' } });
    const runs = [
      { toolCalls: [call('read_text_file', { path: '/a.txt' })] }, // success
      { toolCalls: [call('read_file', { path: '/a.txt' })] }, // miss
      { toolCalls: [call('read_text_file', { path: '/x.txt' })] }, // hit, bad args
      { toolCalls: [call('read_text_file', { path: '/a.txt' })] }, // success
    ];
    const agg = aggregateScenario(s, runs);

    expect(agg.scenarioId).toBe('test-scenario');
    expect(agg.n).toBe(4);
    expect(agg.hitRate).toBeCloseTo(3 / 4);
    expect(agg.argCorrectness).toBeCloseTo(2 / 3); // among the 3 hits
    expect(agg.extraCallRate).toBe(0);
    expect(agg.successRate).toBeCloseTo(2 / 4);
  });

  it('reports null arg correctness when there were no hits', () => {
    const agg = aggregateScenario(scenario(), [
      { toolCalls: [call('wrong_tool')] },
    ]);
    expect(agg.hitRate).toBe(0);
    expect(agg.argCorrectness).toBeNull();
  });
});

describe('aggregateSuite', () => {
  it('averages per-scenario aggregates, ignoring null arg correctness', () => {
    const a = aggregateScenario(scenario({ id: 'a' }), [
      { toolCalls: [call('read_text_file')] },
    ]);
    const b = aggregateScenario(scenario({ id: 'b' }), [
      { toolCalls: [call('nope')] },
    ]);
    const suite = aggregateSuite([a, b]);

    expect(suite.scenarioCount).toBe(2);
    expect(suite.hitRate).toBeCloseTo(0.5);
    expect(suite.successRate).toBeCloseTo(0.5);
    expect(suite.argCorrectness).toBeCloseTo(1); // only scenario a is gradable
  });
});
