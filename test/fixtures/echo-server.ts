/** Minimal MCP server used to integration-test the harness without a real target. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo-fixture', version: '0.0.1' });

server.registerTool(
  'echo_upper',
  {
    description: 'Echo the input text in uppercase.',
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({
    content: [{ type: 'text', text: text.toUpperCase() }],
  }),
);

server.registerTool(
  'echo_lower',
  {
    description: 'Echo the input text in lowercase.',
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({
    content: [{ type: 'text', text: text.toLowerCase() }],
  }),
);

await server.connect(new StdioServerTransport());
