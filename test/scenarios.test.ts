import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSuite,
  parseSuite,
  ScenarioValidationError,
} from '../src/scenarios/loader.js';

const VALID_SUITE = `
suite: filesystem
description: Scenarios for the official filesystem MCP server
server:
  command: npx
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/sandbox"]
scenarios:
  - id: read-single-text-file
    prompt: Show me the contents of /tmp/sandbox/notes.txt
    expected_tool: read_text_file
    expected_args:
      path: /tmp/sandbox/notes.txt
  - id: list-dir
    prompt: What files are in /tmp/sandbox?
    expected_tool: list_directory
    max_calls: 2
`;

describe('parseSuite', () => {
  it('parses a valid suite and applies defaults', () => {
    const suite = parseSuite(VALID_SUITE, 'filesystem.yaml');

    expect(suite.suite).toBe('filesystem');
    expect(suite.server.command).toBe('npx');
    expect(suite.scenarios).toHaveLength(2);

    const first = suite.scenarios[0]!;
    expect(first.id).toBe('read-single-text-file');
    expect(first.expected_tool).toBe('read_text_file');
    expect(first.expected_args).toEqual({ path: '/tmp/sandbox/notes.txt' });
    expect(first.max_calls).toBe(1); // default

    expect(suite.scenarios[1]!.max_calls).toBe(2);
    expect(suite.scenarios[1]!.expected_args).toBeUndefined();
  });

  it('rejects a scenario missing a prompt, naming the field and origin', () => {
    const bad = `
suite: s
server: { command: npx }
scenarios:
  - id: no-prompt
    expected_tool: read_text_file
`;
    expect(() => parseSuite(bad, 'bad.yaml')).toThrowError(
      ScenarioValidationError,
    );
    try {
      parseSuite(bad, 'bad.yaml');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('bad.yaml');
      expect(msg).toContain('prompt');
      expect(msg).toContain('scenarios[0]');
    }
  });

  it('rejects an empty scenarios list', () => {
    const bad = `
suite: s
server: { command: npx }
scenarios: []
`;
    expect(() => parseSuite(bad, 'empty.yaml')).toThrowError(/at least one/i);
  });

  it('rejects duplicate scenario ids', () => {
    const bad = `
suite: s
server: { command: npx }
scenarios:
  - { id: dup, prompt: a, expected_tool: t }
  - { id: dup, prompt: b, expected_tool: t }
`;
    expect(() => parseSuite(bad, 'dup.yaml')).toThrowError(/duplicate.*dup/i);
  });

  it('rejects unknown keys to catch typos', () => {
    const bad = `
suite: s
server: { command: npx }
scenarios:
  - id: typo
    prompt: a
    expected_tools: read_text_file
`;
    expect(() => parseSuite(bad, 'typo.yaml')).toThrowError(
      /expected_tools/,
    );
  });

  it('rejects non-kebab-case scenario ids', () => {
    const bad = `
suite: s
server: { command: npx }
scenarios:
  - { id: "Bad Id!", prompt: a, expected_tool: t }
`;
    expect(() => parseSuite(bad, 'id.yaml')).toThrowError(/kebab-case/);
  });

  it('reports YAML syntax errors with the origin', () => {
    expect(() => parseSuite('suite: [unclosed', 'broken.yaml')).toThrowError(
      /broken\.yaml/,
    );
  });
});

describe('loadSuite', () => {
  it('loads a suite from a file on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hitrate-test-'));
    const file = join(dir, 'suite.yaml');
    writeFileSync(file, VALID_SUITE);

    const suite = loadSuite(file);
    expect(suite.suite).toBe('filesystem');
    expect(suite.scenarios).toHaveLength(2);
  });
});
