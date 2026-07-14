import { existsSync, readFileSync } from 'node:fs';

/** Parse .env-style text into a key/value map. Supports comments, blank
 * lines, `export ` prefixes, quoted values, and `=` inside values. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Load .env from the working directory into process.env. Existing
 * environment variables always win — .env only fills gaps. */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  const vars = parseDotEnv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
