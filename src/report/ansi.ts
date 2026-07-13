/** Tiny ANSI helper — no dependency, honors NO_COLOR and non-TTY pipes. */
const enabled =
  process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;

const wrap =
  (open: number, close: number) =>
  (s: string): string =>
    enabled ? `[${open}m${s}[${close}m` : s;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);

/** Color a 0..1 rate where HIGH is good (hit rate, success). */
export function goodRate(v: number | null, rendered: string): string {
  if (v === null) return dim(rendered);
  if (v >= 0.9) return green(rendered);
  if (v >= 0.6) return yellow(rendered);
  return red(rendered);
}

/** Color a 0..1 rate where LOW is good (extra-call rate). */
export function badRate(v: number, rendered: string): string {
  if (v <= 0.05) return green(rendered);
  if (v <= 0.25) return yellow(rendered);
  return red(rendered);
}
