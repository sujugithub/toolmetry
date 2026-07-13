/** Apply measured description overrides to a checked-out modelcontextprotocol/servers
 * tree (C5). Fails loudly if an expected upstream string is missing so we never
 * ship a partial or stale patch. Usage: npx tsx scripts/apply-overrides-upstream.mts <servers-repo-path> */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
if (!repo) throw new Error('usage: apply-overrides-upstream.mts <servers-repo-path>');

const memoryOverrides = (
  JSON.parse(
    readFileSync('results/2026-07-13T02-28-49-memory-optimized-r2.json', 'utf8'),
  ) as { result: { descriptionOverrides: Record<string, string> } }
).result.descriptionOverrides;

const gitOverrides = (
  JSON.parse(
    readFileSync('results/2026-07-13T02-35-32-git-optimized-r1.json', 'utf8'),
  ) as { result: { descriptionOverrides: Record<string, string> } }
).result.descriptionOverrides;

// schema-accuracy fix: GitShow.revision is required upstream, so the measured
// "Use without a revision parameter" phrasing would misdescribe the schema.
gitOverrides['git_show'] = gitOverrides['git_show']!.replace(
  'Use without a revision parameter to view the most recent commit (HEAD).',
  'Pass revision="HEAD" to view the most recent commit.',
);

/** old upstream description per tool (verified against main, 2026-07-13) */
const MEMORY_OLD: Record<string, string> = {
  create_entities: 'Create multiple new entities in the knowledge graph',
  create_relations:
    'Create multiple new relations between entities in the knowledge graph. Relations should be in active voice',
  read_graph: 'Read the entire knowledge graph',
  search_nodes: 'Search for nodes in the knowledge graph based on a query',
  open_nodes: 'Open specific nodes in the knowledge graph by their names',
  delete_observations: 'Delete specific observations from entities in the knowledge graph',
};

const GIT_OLD: Record<string, string> = {
  git_status: 'Shows the working tree status',
  git_diff_staged: 'Shows changes that are staged for commit',
  git_add: 'Adds file contents to the staging area',
  git_reset: 'Unstages all staged changes',
  git_log: 'Shows the commit logs',
  git_checkout: 'Switches branches',
  git_show: 'Shows the contents of a commit',
};

function apply(
  file: string,
  old: Record<string, string>,
  overrides: Record<string, string>,
  render: (s: string) => string,
): void {
  let src = readFileSync(file, 'utf8');
  for (const [tool, oldDesc] of Object.entries(old)) {
    const next = overrides[tool];
    if (!next) throw new Error(`no override measured for ${tool}`);
    const needle = render(oldDesc);
    if (!src.includes(needle)) {
      throw new Error(`upstream drift: ${file} does not contain ${needle}`);
    }
    src = src.replace(needle, render(next));
    console.log(`✓ ${tool}`);
  }
  writeFileSync(file, src);
}

console.log('memory (index.ts):');
apply(
  join(repo, 'src/memory/index.ts'),
  MEMORY_OLD,
  memoryOverrides,
  (s) => `description: ${JSON.stringify(s)}`,
);

console.log('git (server.py):');
apply(
  join(repo, 'src/git/src/mcp_server_git/server.py'),
  GIT_OLD,
  gitOverrides,
  (s) => `description=${JSON.stringify(s)}`,
);

console.log('done.');
