import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpTarget } from '../src/harness/target.js';
import { parseOverridesFile } from '../src/proxy/proxy.js';

describe('parseOverridesFile', () => {
  it('accepts a plain map', () => {
    expect(parseOverridesFile('{"a":"desc"}')).toEqual({ a: 'desc' });
  });

  it('accepts the hitrate optimize output shape', () => {
    expect(
      parseOverridesFile(
        '{"diagnosis":"…","rationales":{"a":"r"},"overrides":{"a":"desc"}}',
      ),
    ).toEqual({ a: 'desc' });
  });

  it('rejects non-string descriptions', () => {
    expect(() => parseOverridesFile('{"a":1}')).toThrow(/must be a string/);
  });
});

describe('hitrate proxy (integration: proxy → echo fixture)', () => {
  let proxied: McpTarget;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hitrate-proxy-'));
    const overridesFile = join(dir, 'overrides.json');
    writeFileSync(
      overridesFile,
      JSON.stringify({ echo_upper: 'Shout the input text. (rewritten)' }),
    );
    // the proxy is itself an MCP server, so we can drive it with McpTarget
    proxied = await McpTarget.spawn({
      command: 'npx',
      args: [
        'tsx',
        'src/cli.ts',
        'proxy',
        '--overrides',
        overridesFile,
        '--',
        'npx',
        'tsx',
        'test/fixtures/echo-server.ts',
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await proxied.close();
  });

  it('rewrites overridden descriptions and passes others through', () => {
    const tools = proxied.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['echo_lower', 'echo_upper']);
    expect(tools.find((t) => t.name === 'echo_upper')!.description).toBe(
      'Shout the input text. (rewritten)',
    );
    expect(tools.find((t) => t.name === 'echo_lower')!.description).toBe(
      'Echo the input text in lowercase.',
    );
  });

  it('passes the input schema through verbatim', () => {
    const upper = proxied.listTools().find((t) => t.name === 'echo_upper')!;
    expect(upper.input_schema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
    });
  });

  it('forwards tool calls to the real server', async () => {
    const result = await proxied.callTool('echo_upper', { text: 'proxy works' });
    expect(result.text).toBe('PROXY WORKS');
    expect(result.isError).toBe(false);
  });
});
