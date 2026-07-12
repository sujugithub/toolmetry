import type Anthropic from '@anthropic-ai/sdk';
import type { MessageCreator, AgentUsage } from '../harness/agent.js';
import type { MeasureResult, ScenarioResult } from '../harness/runner.js';

export const DEFAULT_REWRITER_MODEL = 'claude-sonnet-5';

export interface RewriteProposal {
  diagnosis: string;
  /** toolName -> rewritten description (only tools the rewriter chose to change) */
  overrides: Record<string, string>;
  rationales: Record<string, string>;
  usage: AgentUsage;
}

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_rewrites',
  description:
    'Submit your diagnosis of why the agent misused the tools, plus rewritten descriptions.',
  input_schema: {
    type: 'object',
    properties: {
      diagnosis: {
        type: 'string',
        description:
          'Per failing scenario: which tool was called instead of the expected one, and what in the current descriptions caused the confusion.',
      },
      rewrites: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'exact tool name' },
            new_description: { type: 'string' },
            rationale: {
              type: 'string',
              description: 'one sentence: what failure this fixes',
            },
          },
          required: ['tool', 'new_description', 'rationale'],
        },
      },
    },
    required: ['diagnosis', 'rewrites'],
  },
};

export function failingScenarios(result: MeasureResult): ScenarioResult[] {
  return result.scenarios.filter((s) => s.aggregate.successRate < 1);
}

/** Render the evidence the rewriter sees: every failing scenario with what the
 * agent ACTUALLY called on each run, plus the full current tool list. */
export function buildRewritePrompt(
  baseline: MeasureResult,
  tools: Anthropic.Tool[],
): string {
  const failing = failingScenarios(baseline);

  const toolList = tools
    .map((t) => `### ${t.name}\n${t.description || '(no description)'}`)
    .join('\n\n');

  const failures = failing
    .map((s) => {
      const runs = s.runs
        .map((r) => {
          const calls = r.toolCalls.length
            ? r.toolCalls
                .map((c) => `${c.name}(${JSON.stringify(c.args)})`)
                .join(' → ')
            : '(no tool call)';
          const flags = [
            !r.score.hit && 'wrong tool',
            r.score.hit && r.score.argsCorrect === false && 'wrong args',
            r.score.extraCalls && 'extra calls',
            r.error && `error: ${r.error}`,
          ]
            .filter(Boolean)
            .join(', ');
          return `  - run ${r.run}: ${calls}${flags ? `  [${flags}]` : ''}`;
        })
        .join('\n');
      return [
        `## Scenario "${s.scenario.id}" (success ${Math.round(s.aggregate.successRate * 100)}% over ${s.aggregate.n} runs)`,
        `User prompt: ${s.scenario.prompt}`,
        `Expected tool: ${s.scenario.expected_tool}${
          s.scenario.expected_args
            ? ` with args ⊇ ${JSON.stringify(s.scenario.expected_args)}`
            : ''
        } (max ${s.scenario.max_calls} call${s.scenario.max_calls === 1 ? '' : 's'})`,
        `Actual behavior:`,
        runs,
      ].join('\n');
    })
    .join('\n\n');

  return `You are optimizing the tool descriptions of an MCP server. An agent (${baseline.model}) was measured against ${baseline.scenarios.length} scenarios, ${baseline.runsPerScenario} runs each. The failures below are caused ONLY by how the tool descriptions read — the agent sees nothing but tool names, descriptions, and schemas.

# Current tool descriptions

${toolList}

# Failing scenarios (evidence)

${failures}

# Your job

1. Diagnose each failure: which description made the wrong tool look right (or the right tool look wrong)?
2. Rewrite ONLY the descriptions that need it. Rules for good descriptions:
   - Narrow and unambiguous; precisely match actual functionality — never overpromise.
   - Disambiguate siblings explicitly: "Use X instead when …" for the tools the agent confused.
   - Lead with when to USE the tool; mention key parameters by name (e.g. head/tail) when they gate a use case.
   - Keep the tool's real behavior intact — you are rewording, not redesigning. Do not invent parameters.
   - Plain text only, roughly the same length as a good docstring (1–3 sentences, max ~80 words).
3. Do not touch tools whose scenarios all pass unless they are the source of the confusion.

Call propose_rewrites exactly once with your full answer.`;
}

export async function proposeRewrites(opts: {
  client: MessageCreator;
  model?: string;
  baseline: MeasureResult;
  tools: Anthropic.Tool[];
}): Promise<RewriteProposal> {
  const { client, model = DEFAULT_REWRITER_MODEL, baseline, tools } = opts;

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    tools: [PROPOSE_TOOL],
    tool_choice: { type: 'tool', name: 'propose_rewrites' },
    messages: [{ role: 'user', content: buildRewritePrompt(baseline, tools) }],
  });

  const call = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!call) {
    throw new Error(
      `rewriter returned no propose_rewrites call (stop_reason: ${response.stop_reason})`,
    );
  }

  const input = call.input as {
    diagnosis: string;
    rewrites: Array<{ tool: string; new_description: string; rationale: string }>;
  };

  const knownTools = new Set(tools.map((t) => t.name));
  const overrides: Record<string, string> = {};
  const rationales: Record<string, string> = {};
  for (const r of input.rewrites ?? []) {
    if (!knownTools.has(r.tool)) continue; // hallucinated tool name — drop it
    overrides[r.tool] = r.new_description;
    rationales[r.tool] = r.rationale;
  }

  return {
    diagnosis: input.diagnosis ?? '',
    overrides,
    rationales,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
