import type { MeasureResult } from '../harness/runner.js';
import { formatUsd } from '../harness/cost.js';

function pct(v: number | null): string {
  return v === null ? 'n/a' : `${(v * 100).toFixed(0)}%`;
}

function delta(before: number | null, after: number | null): string {
  if (before === null || after === null) return 'n/a';
  const d = Math.round((after - before) * 100);
  return d > 0 ? `**+${d}**` : d < 0 ? `${d}` : '±0';
}

/** Markdown before/after report: per-scenario hit-rate diff + aggregate deltas.
 * The headline number is the hit-rate delta (the Sprint 1 kill question). */
export function diffReport(
  baseline: MeasureResult,
  optimized: MeasureResult,
  overrides?: Record<string, string>,
): string {
  const lines: string[] = [];
  const b = baseline.aggregate;
  const o = optimized.aggregate;
  const headline = Math.round((o.hitRate - b.hitRate) * 100);

  lines.push(`# ${baseline.suite}: baseline vs optimized`);
  lines.push('');
  lines.push(
    `**Hit rate ${pct(b.hitRate)} → ${pct(o.hitRate)} (${headline >= 0 ? '+' : ''}${headline} pts)** — ` +
      `${baseline.scenarios.length} scenarios × ${baseline.runsPerScenario} runs on ${baseline.model}.`,
  );
  lines.push('');
  lines.push('| metric | baseline | optimized | Δ (pts) |');
  lines.push('|---|---|---|---|');
  lines.push(`| hit rate | ${pct(b.hitRate)} | ${pct(o.hitRate)} | ${delta(b.hitRate, o.hitRate)} |`);
  lines.push(
    `| arg correctness | ${pct(b.argCorrectness)} | ${pct(o.argCorrectness)} | ${delta(b.argCorrectness, o.argCorrectness)} |`,
  );
  lines.push(
    `| extra-call rate | ${pct(b.extraCallRate)} | ${pct(o.extraCallRate)} | ${delta(b.extraCallRate, o.extraCallRate)} |`,
  );
  lines.push(
    `| strict success | ${pct(b.successRate)} | ${pct(o.successRate)} | ${delta(b.successRate, o.successRate)} |`,
  );
  lines.push('');

  lines.push('## Per scenario (hit rate)');
  lines.push('');
  lines.push('| scenario | baseline | optimized | Δ (pts) |');
  lines.push('|---|---|---|---|');
  const optById = new Map(
    optimized.scenarios.map((s) => [s.aggregate.scenarioId, s.aggregate]),
  );
  for (const s of baseline.scenarios) {
    const after = optById.get(s.aggregate.scenarioId);
    lines.push(
      `| ${s.aggregate.scenarioId} | ${pct(s.aggregate.hitRate)} | ${after ? pct(after.hitRate) : 'missing'} | ${after ? delta(s.aggregate.hitRate, after.hitRate) : 'n/a'} |`,
    );
  }
  lines.push('');

  if (overrides && Object.keys(overrides).length) {
    lines.push('## Rewritten descriptions');
    lines.push('');
    for (const [tool, desc] of Object.entries(overrides)) {
      lines.push(`### ${tool}`);
      lines.push('');
      lines.push(desc);
      lines.push('');
    }
  }

  const totalCost =
    baseline.estimatedCostUsd !== null && optimized.estimatedCostUsd !== null
      ? baseline.estimatedCostUsd + optimized.estimatedCostUsd
      : null;
  lines.push(
    `_Measurement cost: baseline ${formatUsd(baseline.estimatedCostUsd)} + optimized ${formatUsd(optimized.estimatedCostUsd)}${totalCost !== null ? ` = ${formatUsd(totalCost)}` : ''} (excl. rewriter call)._`,
  );
  lines.push('');
  return lines.join('\n');
}
