import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpTarget } from '../src/harness/target.js';
import type { ServerSpec } from '../src/scenarios/schema.js';

const FIXTURE_SPEC: ServerSpec = {
  command: 'npx',
  args: ['tsx', 'test/fixtures/echo-server.ts'],
};

describe('McpTarget (integration, fixture server)', () => {
  let target: McpTarget;

  beforeAll(async () => {
    target = await McpTarget.spawn(FIXTURE_SPEC);
  }, 30_000);

  afterAll(async () => {
    await target.close();
  });

  it('lists tools in Anthropic tool format', () => {
    const tools = target.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['echo_lower', 'echo_upper']);

    const upper = tools.find((t) => t.name === 'echo_upper')!;
    expect(upper.description).toBe('Echo the input text in uppercase.');
    expect(upper.input_schema).toMatchObject({ type: 'object' });
  });

  it('calls a tool and returns its text output', async () => {
    const result = await target.callTool('echo_upper', { text: 'hello' });
    expect(result.text).toBe('HELLO');
    expect(result.isError).toBe(false);
  });

  it('applies in-memory description overrides (optimizer hook)', async () => {
    const patched = await McpTarget.spawn(FIXTURE_SPEC, {
      descriptionOverrides: { echo_upper: 'Shout the input text.' },
    });
    try {
      const tools = patched.listTools();
      expect(tools.find((t) => t.name === 'echo_upper')!.description).toBe(
        'Shout the input text.',
      );
      // untouched tools keep the original description
      expect(tools.find((t) => t.name === 'echo_lower')!.description).toBe(
        'Echo the input text in lowercase.',
      );
    } finally {
      await patched.close();
    }
  }, 30_000);
});
