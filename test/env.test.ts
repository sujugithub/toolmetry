import { describe, expect, it } from 'vitest';
import { parseDotEnv } from '../src/env.js';

describe('parseDotEnv', () => {
  it('parses KEY=VALUE lines', () => {
    expect(parseDotEnv('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });

  it('ignores comments, blank lines, and lines without =', () => {
    expect(parseDotEnv('# comment\n\nnot a pair\nA=1')).toEqual({ A: '1' });
  });

  it('strips surrounding quotes and trims whitespace', () => {
    expect(parseDotEnv('A="quoted"\nB=\'single\'\n C = padded ')).toEqual({
      A: 'quoted',
      B: 'single',
      C: 'padded',
    });
  });

  it('keeps = signs inside the value and supports export prefix', () => {
    expect(parseDotEnv('export KEY=sk-ant-a=b==')).toEqual({
      KEY: 'sk-ant-a=b==',
    });
  });

  it('returns empty object for empty input', () => {
    expect(parseDotEnv('')).toEqual({});
  });
});
