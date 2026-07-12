import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ScenarioSuiteSchema, type ScenarioSuite } from './schema.js';

export class ScenarioValidationError extends Error {
  constructor(origin: string, details: string) {
    super(`Invalid scenario suite (${origin}):\n${details}`);
    this.name = 'ScenarioValidationError';
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length
        ? issue.path
            .map((p, i) =>
              typeof p === 'number'
                ? `[${p}]`
                : i === 0
                  ? String(p)
                  : `.${String(p)}`,
            )
            .join('')
        : '(root)';
      let hint = '';
      if (issue.code === 'unrecognized_keys') {
        hint = ` — unknown key(s): ${issue.keys.join(', ')}. Check for typos.`;
      }
      return `  - ${path}: ${issue.message}${hint}`;
    })
    .join('\n');
}

/** Parse and validate a YAML scenario suite. `origin` is used in error messages. */
export function parseSuite(source: string, origin = '<string>'): ScenarioSuite {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    throw new ScenarioValidationError(
      origin,
      `  - YAML syntax error: ${(err as Error).message}`,
    );
  }

  const result = ScenarioSuiteSchema.safeParse(raw);
  if (!result.success) {
    throw new ScenarioValidationError(origin, formatIssues(result.error));
  }
  return result.data;
}

/** Load and validate a single suite file from disk. */
export function loadSuite(filePath: string): ScenarioSuite {
  return parseSuite(readFileSync(filePath, 'utf8'), filePath);
}

/** Load every .yaml/.yml suite in a directory (non-recursive), sorted by filename. */
export function loadSuitesFromDir(dir: string): ScenarioSuite[] {
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  return files.map((f) => loadSuite(join(dir, f)));
}
