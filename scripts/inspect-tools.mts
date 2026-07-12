import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync } from 'node:fs';

const sandbox = process.argv[2] ?? '/tmp/hitrate-sandbox';
mkdirSync(sandbox, { recursive: true });

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', sandbox],
  stderr: 'ignore',
});
const client = new Client({ name: 'hitrate-inspect', version: '0.0.1' });
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
