import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { ServerSpec } from '../scenarios/schema.js';

export interface ToolCallResult {
  text: string;
  isError: boolean;
}

export interface McpTargetOptions {
  /** Optimizer hook: replace tool descriptions in-memory without touching the server. */
  descriptionOverrides?: Record<string, string>;
}

/** A target MCP server spawned over stdio, with its tools exposed in Anthropic format. */
export class McpTarget {
  private constructor(
    private readonly client: Client,
    private readonly tools: Anthropic.Tool[],
  ) {}

  static async spawn(
    spec: ServerSpec,
    opts: McpTargetOptions = {},
  ): Promise<McpTarget> {
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: { ...getDefaultEnvironment(), ...spec.env },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'hitrate', version: '0.1.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: opts.descriptionOverrides?.[t.name] ?? t.description ?? '',
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    return new McpTarget(client, anthropicTools);
  }

  listTools(): Anthropic.Tool[] {
    return this.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    try {
      const result = await this.client.callTool({ name, arguments: args });
      const content = (result.content ?? []) as Array<{
        type: string;
        text?: string;
      }>;
      const text = content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n');
      return { text, isError: result.isError === true };
    } catch (err) {
      // Protocol-level failure (unknown tool, invalid args rejected by the server SDK):
      // surface it to the agent as a tool error, same as a real client would.
      return { text: (err as Error).message, isError: true };
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
