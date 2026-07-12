import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MeasureResult } from '../harness/runner.js';

export interface SavedResult {
  savedAt: string;
  gitSha: string;
  label: string;
  result: MeasureResult;
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Persist a measurement under results/ — timestamped + git SHA, per DoD. */
export function saveResult(
  result: MeasureResult,
  label: string,
  dir = 'results',
): string {
  const savedAt = new Date().toISOString();
  const stamp = savedAt.replace(/[:.]/g, '-').slice(0, 19);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${stamp}-${result.suite}-${label}.json`);
  const payload: SavedResult = { savedAt, gitSha: gitSha(), label, result };
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}
