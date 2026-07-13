import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ServerSpec } from '../scenarios/schema.js';

/** Accept either a plain {tool: description} map or the file `hitrate optimize`
 * saves ({diagnosis, rationales, overrides}). */
export function parseOverridesFile(raw: string): Record<string, string> {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const map =
    typeof parsed['overrides'] === 'object' && parsed['overrides'] !== null
      ? (parsed['overrides'] as Record<string, unknown>)
      : parsed;
  for (const [k, v] of Object.entries(map)) {
    if (typeof v !== 'string') {
      throw new Error(`override for "${k}" must be a string description`);
    }
  }
  return map as Record<string, string>;
}

/** Stdio MCP server that spawns the real target and forwards everything,
 * rewriting tool descriptions in tools/list. This is how users ship optimized
 * descriptions without forking the target server: point their MCP config at
 * `hitrate proxy` instead of the server itself.
 *
 * Uses the low-level Server API deliberately: a proxy must pass through
 * arbitrary target inputSchemas verbatim, which the high-level registerTool
 * (Zod-shape-based) cannot express. */
export async function startProxy(
  spec: ServerSpec,
  overrides: Record<string, string>,
): Promise<void> {
  const targetTransport = new StdioClientTransport({
    command: spec.command,
    args: spec.args,
    env: { ...getDefaultEnvironment(), ...spec.env },
    stderr: 'inherit',
  });
  const target = new Client({ name: 'hitrate-proxy-client', version: '0.1.0' });
  await target.connect(targetTransport);

  const server = new Server(
    { name: 'hitrate-proxy', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const unknownOverrides = new Set(Object.keys(overrides));

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = await target.listTools();
    for (const t of tools) unknownOverrides.delete(t.name);
    if (unknownOverrides.size) {
      console.error(
        `hitrate-proxy: overrides for unknown tool(s) ignored: ${[...unknownOverrides].join(', ')}`,
      );
      unknownOverrides.clear();
    }
    return {
      tools: tools.map((t) =>
        overrides[t.name] ? { ...t, description: overrides[t.name] } : t,
      ),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    target.callTool(req.params),
  );

  await server.connect(new StdioServerTransport());
  console.error(
    `hitrate-proxy: forwarding to "${spec.command} ${spec.args.join(' ')}" with ${Object.keys(overrides).length} description override(s)`,
  );
}
