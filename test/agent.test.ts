import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runAgentOnce, type MessageCreator } from '../src/harness/agent.js';
import { McpTarget } from '../src/harness/target.js';
import type { ServerSpec } from '../src/scenarios/schema.js';

const FIXTURE_SPEC: ServerSpec = {
  command: 'npx',
  args: ['tsx', 'test/fixtures/echo-server.ts'],
};

function fakeMessage(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.StopReason,
  usage: Partial<Anthropic.Usage> = {},
): Anthropic.Message {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'fake-model',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      ...usage,
    } as Anthropic.Usage,
  };
}

/** Scripted stand-in for the Anthropic client: returns canned responses in order
 * and records every request it receives. */
function scriptedClient(responses: Anthropic.Message[]): {
  client: MessageCreator;
  requests: Anthropic.MessageCreateParamsNonStreaming[];
} {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  return {
    requests,
    client: {
      messages: {
        create: async (params) => {
          requests.push(params);
          if (i >= responses.length) {
            throw new Error('scripted client ran out of responses');
          }
          return responses[i++]!;
        },
      },
    },
  };
}

describe('runAgentOnce', () => {
  let target: McpTarget;

  beforeAll(async () => {
    target = await McpTarget.spawn(FIXTURE_SPEC);
  }, 30_000);

  afterAll(async () => {
    await target.close();
  });

  it('captures tool calls, executes them against the target, and loops to completion', async () => {
    const { client, requests } = scriptedClient([
      fakeMessage(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'echo_upper',
            input: { text: 'hi' },
          },
        ],
        'tool_use',
      ),
      fakeMessage([{ type: 'text', text: 'Done: HI', citations: null }], 'end_turn'),
    ]);

    const result = await runAgentOnce({
      client,
      model: 'fake-model',
      target,
      prompt: 'Uppercase "hi" for me',
    });

    expect(result.toolCalls).toEqual([
      { name: 'echo_upper', args: { text: 'hi' } },
    ]);
    expect(result.finalText).toBe('Done: HI');
    // both API round trips accounted for
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 40 });

    // second request must carry the tool_result with the REAL server output
    expect(requests).toHaveLength(2);
    const secondTurn = requests[1]!.messages;
    const toolResultMsg = secondTurn[secondTurn.length - 1]!;
    expect(toolResultMsg.role).toBe('user');
    expect(toolResultMsg.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'tu_1',
        content: 'HI',
        is_error: false,
      },
    ]);
    // tools from the target are passed through on every request
    expect(requests[0]!.tools?.map((t) => t.name).sort()).toEqual([
      'echo_lower',
      'echo_upper',
    ]);
  });

  it('stops after maxIterations even if the model keeps calling tools', async () => {
    const toolTurn = () =>
      fakeMessage(
        [
          {
            type: 'tool_use',
            id: 'tu_x',
            name: 'echo_lower',
            input: { text: 'LOOP' },
          },
        ],
        'tool_use',
      );
    const { client } = scriptedClient([toolTurn(), toolTurn(), toolTurn()]);

    const result = await runAgentOnce({
      client,
      model: 'fake-model',
      target,
      prompt: 'loop forever',
      maxIterations: 2,
    });

    expect(result.toolCalls).toHaveLength(2);
    expect(result.hitIterationLimit).toBe(true);
  });
});
