import type { AgentUsage } from './agent.js';

/** USD per million tokens. Source: platform.claude.com/docs/en/about-claude/pricing,
 * fetched 2026-07-13. Sonnet 5 is intro pricing (through 2026-08-31). */
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
};

/** Runtime-registered pricing (e.g. --price-in/--price-out for open models
 * whose rates we refuse to hardcode). Takes precedence over the built-ins. */
const CUSTOM_PRICING: Record<string, { input: number; output: number }> = {};

export function registerPricing(
  model: string,
  perMTok: { input: number; output: number },
): void {
  CUSTOM_PRICING[model] = perMTok;
}

function pricingFor(model: string): { input: number; output: number } | null {
  if (CUSTOM_PRICING[model]) return CUSTOM_PRICING[model];
  if (PRICING_PER_MTOK[model]) return PRICING_PER_MTOK[model];
  // date-suffixed ids (claude-haiku-4-5-20251001) share the base model's pricing
  const base = Object.keys(PRICING_PER_MTOK).find((id) =>
    model.startsWith(`${id}-`),
  );
  return base ? PRICING_PER_MTOK[base]! : null;
}

/** Estimated cost in USD, or null when the model's pricing is unknown —
 * never guess a price. */
export function estimateCostUsd(model: string, usage: AgentUsage): number | null {
  const pricing = pricingFor(model);
  if (!pricing) return null;
  return (
    (usage.inputTokens / 1_000_000) * pricing.input +
    (usage.outputTokens / 1_000_000) * pricing.output
  );
}

export function formatUsd(cost: number | null): string {
  return cost === null ? 'unknown (no pricing data)' : `$${cost.toFixed(4)}`;
}
