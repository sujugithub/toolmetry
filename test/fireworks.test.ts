import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { FireworksClient } from '../src/harness/fireworks.js';

type Fetch = typeof fetch;

function fakeFetch(response: unknown): {
  fetch: Fetch;
  calls: Array<{ url: string; body: Record<string, unknown> }>;
} {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const f = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(response), { status: 200 });
  }) as Fetch;
  return { fetch: f, calls };
}

const PARAMS: Anthropic.MessageCreateParamsNonStreaming = {
  model: 'accounts/fireworks/models/kimi-k2-instruct',
  max_tokens: 100,
  system: 'be brief',
  tools: [
    {
      name: 'echo_upper',
      description: 'Uppercase text.',
      input_schema: { type: 'object', properties: { text: { type: 'string' } } },
    },
  ],
  messages: [
    { role: 'user', content: 'shout hi' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'ok', citations: null },
        { type: 'tool_use', id: 'call_1', name: 'echo_upper', input: { text: 'hi' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'HI', is_error: false },
      ],
    },
  ],
};

describe('FireworksClient', () => {
  it('translates Anthropic params to OpenAI chat-completions format', async () => {
    const { fetch, calls } = fakeFetch({
      id: 'cmpl',
      choices: [{ message: { content: 'HI!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    });
    const client = new FireworksClient('fw-key', fetch);
    await client.messages.create(PARAMS);

    expect(calls).toHaveLength(1);
    const body = calls[0]!.body;
    expect(body['model']).toBe('accounts/fireworks/models/kimi-k2-instruct');
    expect(body['max_tokens']).toBe(100);
    const messages = body['messages'] as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: 'system', content: 'be brief' });
    expect(messages[1]).toEqual({ role: 'user', content: 'shout hi' });
    // assistant turn: text + tool_calls
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: 'ok',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'echo_upper', arguments: '{"text":"hi"}' },
        },
      ],
    });
    // tool_result → role:tool
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'HI',
    });
    const tools = body['tools'] as Array<Record<string, unknown>>;
    expect(tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'echo_upper',
        description: 'Uppercase text.',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
      },
    });
  });

  it('translates tool_calls responses back to Anthropic tool_use blocks', async () => {
    const { fetch } = fakeFetch({
      id: 'cmpl',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_9',
                type: 'function',
                function: { name: 'echo_upper', arguments: '{"text":"yo"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 10 },
    });
    const client = new FireworksClient('fw-key', fetch);
    const msg = await client.messages.create(PARAMS);

    expect(msg.stop_reason).toBe('tool_use');
    expect(msg.content).toEqual([
      {
        type: 'tool_use',
        id: 'call_9',
        name: 'echo_upper',
        input: { text: 'yo' },
        caller: { type: 'direct' },
      },
    ]);
    expect(msg.usage.input_tokens).toBe(30);
    expect(msg.usage.output_tokens).toBe(10);
  });

  it('supports forced tool_choice (used by the rewriter)', async () => {
    const { fetch, calls } = fakeFetch({
      id: 'cmpl',
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const client = new FireworksClient('fw-key', fetch);
    await client.messages.create({
      ...PARAMS,
      tool_choice: { type: 'tool', name: 'echo_upper' },
    });
    expect(calls[0]!.body['tool_choice']).toEqual({
      type: 'function',
      function: { name: 'echo_upper' },
    });
  });

  it('throws with the API error body on non-200', async () => {
    const f = (async () =>
      new Response('{"error":{"message":"invalid key"}}', { status: 401 })) as Fetch;
    const client = new FireworksClient('bad', f);
    await expect(client.messages.create(PARAMS)).rejects.toThrow(/401.*invalid key/s);
  });
});
