import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { MessageCreator } from '../src/harness/agent.js';
import type { MeasureResult } from '../src/harness/runner.js';
import {
  buildRewritePrompt,
  failingScenarios,
  proposeRewrites,
} from '../src/optimizer/rewrite.js';

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read the complete contents of a file as text. DEPRECATED.',
    input_schema: { type: 'object' },
  },
  {
    name: 'read_text_file',
    description: 'Read the complete contents of a file as text.',
    input_schema: { type: 'object' },
  },
];

const BASELINE: MeasureResult = {
  suite: 'demo',
  model: 'claude-haiku-4-5',
  runsPerScenario: 2,
  usage: { inputTokens: 0, outputTokens: 0 },
  estimatedCostUsd: 0,
  scenarios: [
    {
      scenario: {
        id: 'read-whole',
        prompt: 'Show me notes.txt',
        expected_tool: 'read_text_file',
        max_calls: 1,
      },
      aggregate: {
        scenarioId: 'read-whole',
        n: 2,
        hitRate: 0,
        argCorrectness: null,
        extraCallRate: 0,
        successRate: 0,
        runs: [],
      },
      runs: [
        {
          run: 1,
          toolCalls: [{ name: 'read_file', args: { path: 'notes.txt' } }],
          score: { hit: false, argsCorrect: null, extraCalls: false, success: false },
          usage: { inputTokens: 10, outputTokens: 5 },
          hitIterationLimit: false,
        },
        {
          run: 2,
          toolCalls: [{ name: 'read_file', args: { path: 'notes.txt' } }],
          score: { hit: false, argsCorrect: null, extraCalls: false, success: false },
          usage: { inputTokens: 10, outputTokens: 5 },
          hitIterationLimit: false,
        },
      ],
    },
    {
      scenario: {
        id: 'passing',
        prompt: 'irrelevant',
        expected_tool: 'read_text_file',
        max_calls: 1,
      },
      aggregate: {
        scenarioId: 'passing',
        n: 2,
        hitRate: 1,
        argCorrectness: 1,
        extraCallRate: 0,
        successRate: 1,
        runs: [],
      },
      runs: [],
    },
  ],
  aggregate: {
    scenarioCount: 2,
    hitRate: 0.5,
    argCorrectness: 1,
    extraCallRate: 0,
    successRate: 0.5,
  },
};

describe('failingScenarios', () => {
  it('selects only scenarios with successRate < 1', () => {
    expect(failingScenarios(BASELINE).map((s) => s.scenario.id)).toEqual([
      'read-whole',
    ]);
  });
});

describe('buildRewritePrompt', () => {
  it('includes evidence, expected tool, and all current descriptions', () => {
    const prompt = buildRewritePrompt(BASELINE, TOOLS);
    expect(prompt).toContain('read_file({"path":"notes.txt"})');
    expect(prompt).toContain('[wrong tool]');
    expect(prompt).toContain('Expected tool: read_text_file');
    expect(prompt).toContain('### read_file');
    expect(prompt).not.toContain('Scenario "passing"'); // passing scenarios excluded
  });
});

describe('proposeRewrites', () => {
  it('parses the forced tool call and drops hallucinated tool names', async () => {
    const client: MessageCreator = {
      messages: {
        create: async () => ({
          id: 'msg',
          type: 'message',
          role: 'assistant',
          model: 'fake',
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 500, output_tokens: 200 } as Anthropic.Usage,
          content: [
            {
              type: 'tool_use',
              id: 'tu',
              name: 'propose_rewrites',
              input: {
                diagnosis: 'read_file and read_text_file overlap.',
                rewrites: [
                  {
                    tool: 'read_file',
                    new_description: 'DEPRECATED — always use read_text_file.',
                    rationale: 'steer away from the deprecated alias',
                  },
                  {
                    tool: 'not_a_real_tool',
                    new_description: 'x',
                    rationale: 'hallucinated',
                  },
                ],
              },
            },
          ],
        }),
      },
    };

    const proposal = await proposeRewrites({
      client,
      baseline: BASELINE,
      tools: TOOLS,
    });

    expect(proposal.diagnosis).toContain('overlap');
    expect(Object.keys(proposal.overrides)).toEqual(['read_file']);
    expect(proposal.overrides['read_file']).toContain('DEPRECATED');
    expect(proposal.usage).toEqual({ inputTokens: 500, outputTokens: 200 });
  });
});
