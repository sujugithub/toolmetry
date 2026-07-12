import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { MessageCreator } from '../src/harness/agent.js';
import { measureSuite } from '../src/harness/runner.js';
import type { ScenarioSuite } from '../src/scenarios/schema.js';

const SUITE: ScenarioSuite = {
  suite: 'echo-fixture',
  server: { command: 'npx', args: ['tsx', 'test/fixtures/echo-server.ts'] },
  scenarios: [
    {
      id: 'upper',
      prompt: 'Uppercase "hi"',
      expected_tool: 'echo_upper',
      expected_args: { text: 'hi' },
      max_calls: 1,
    },
    {
      id: 'lower',
      prompt: 'Lowercase "HI"',
      expected_tool: 'echo_lower',
      max_calls: 1,
    },
  ],
};

function msg(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.StopReason,
  tokens = { input_tokens: 100, output_tokens: 20 },
): Anthropic.Message {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'fake-model',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: tokens as Anthropic.Usage,
  };
}

const toolTurn = (name: string, input: Record<string, unknown>) =>
  msg([{ type: 'tool_use', id: 'tu', name, input }], 'tool_use');
const textTurn = (text: string) =>
  msg([{ type: 'text', text, citations: null }], 'end_turn');

/** Every run: one correct tool call for 'upper', a WRONG tool for 'lower'. */
function scriptedClient(): MessageCreator {
  let call = 0;
  return {
    messages: {
      create: async (params) => {
        const promptText = String(
          (params.messages[0]!.content as string) ?? '',
        );
        call++;
        const isToolPhase = params.messages.length === 1;
        if (isToolPhase) {
          return promptText.startsWith('Uppercase')
            ? toolTurn('echo_upper', { text: 'hi' })
            : toolTurn('echo_upper', { text: 'HI' }); // wrong tool for 'lower'
        }
        return textTurn('done');
      },
    },
  };
}

describe('measureSuite (integration, fixture server + scripted model)', () => {
  it('runs N times per scenario, scores, aggregates, and estimates cost', async () => {
    const result = await measureSuite(SUITE, {
      client: scriptedClient(),
      model: 'claude-haiku-4-5',
      runs: 2,
    });

    expect(result.scenarios).toHaveLength(2);
    const [upper, lower] = result.scenarios;

    expect(upper!.aggregate.hitRate).toBe(1);
    expect(upper!.aggregate.successRate).toBe(1);
    expect(upper!.runs).toHaveLength(2);

    expect(lower!.aggregate.hitRate).toBe(0); // wrong tool every run
    expect(result.aggregate.hitRate).toBe(0.5);

    // 2 scenarios × 2 runs × 2 API calls × 120 tokens
    expect(result.usage).toEqual({ inputTokens: 800, outputTokens: 160 });
    expect(result.estimatedCostUsd).toBeCloseTo(
      800 / 1e6 + (160 * 5) / 1e6,
      10,
    );
    expect(result.aborted).toBeUndefined();
  }, 30_000);

  it('aborts on the budget guard and keeps partial results', async () => {
    const result = await measureSuite(SUITE, {
      client: scriptedClient(),
      model: 'claude-haiku-4-5',
      runs: 2,
      budgetUsd: 0.000001,
    });

    expect(result.aborted).toMatch(/budget guard tripped/);
    expect(result.scenarios.length).toBeGreaterThanOrEqual(1);
    expect(result.scenarios[0]!.runs).toHaveLength(1); // stopped after first run
  }, 30_000);
});
