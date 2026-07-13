import { describe, expect, it } from 'vitest';
import { estimateCostUsd, formatUsd } from '../src/harness/cost.js';

describe('estimateCostUsd', () => {
  it('prices haiku 4.5 at $1/MTok in, $5/MTok out', () => {
    expect(
      estimateCostUsd('claude-haiku-4-5', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(6);
  });

  it('prices a realistic small run', () => {
    // 2000 in + 100 out on haiku = 0.002 + 0.0005
    expect(
      estimateCostUsd('claude-haiku-4-5', { inputTokens: 2000, outputTokens: 100 }),
    ).toBeCloseTo(0.0025, 10);
  });

  it('matches date-suffixed model ids to their base pricing', () => {
    expect(
      estimateCostUsd('claude-haiku-4-5-20251001', {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(1);
  });

  it('returns null for unknown models instead of guessing', () => {
    expect(
      estimateCostUsd('gpt-99', { inputTokens: 1000, outputTokens: 1000 }),
    ).toBeNull();
  });
});

describe('formatUsd', () => {
  it('formats known and unknown costs', () => {
    expect(formatUsd(0.0025)).toBe('$0.0025');
    expect(formatUsd(1.5)).toBe('$1.5000');
    expect(formatUsd(null)).toBe('unknown (no pricing data)');
  });
});

describe('registerPricing', () => {
  it('activates estimates for otherwise-unpriced models', async () => {
    const { registerPricing, estimateCostUsd: est } = await import(
      '../src/harness/cost.js'
    );
    expect(est('accounts/fireworks/models/x', { inputTokens: 1e6, outputTokens: 0 })).toBeNull();
    registerPricing('accounts/fireworks/models/x', { input: 0.15, output: 0.6 });
    expect(
      est('accounts/fireworks/models/x', { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(0.75, 10);
  });
});
