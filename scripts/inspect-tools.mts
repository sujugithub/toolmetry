/** Dump a target MCP server's tools (name, description, params) for scenario
 * design. Usage: npx tsx scripts/inspect-tools.mts <command> [args...] */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: npx tsx scripts/inspect-tools.mts <command> [args...]');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command,
  args,
  env: getDefaultEnvironment(),
  stderr: 'ignore',
});
const client = new Client({ name: 'toolmetry-inspect', version: '0.0.1' });
await client.connect(transport);

const { tools } = await client.listTools();
for (const t of tools) {
  console.log(`### ${t.name}`);
  console.log(t.description ?? '(no description)');
  console.log(
    'params:',
    Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).join(', '),
  );
  console.log();
}
await client.close();
