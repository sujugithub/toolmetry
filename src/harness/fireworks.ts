import type Anthropic from '@anthropic-ai/sdk';
import type { MessageCreator } from './agent.js';

/** Adapter: exposes the slice of the Anthropic client the harness uses, backed
 * by Fireworks.ai's OpenAI-compatible chat-completions API. Lets the agent
 * (and rewriter) run on open models when no Anthropic credit is available.
 * Model ids look like accounts/fireworks/models/<name>. */

const BASE_URL = 'https://api.fireworks.ai/inference/v1';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { content: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toOpenAiMessages(
  params: Anthropic.MessageCreateParamsNonStreaming,
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  if (typeof params.system === 'string') {
    out.push({ role: 'system', content: params.system });
  }

  for (const msg of params.messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const text = msg.content
        .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const toolCalls: OpenAiToolCall[] = msg.content
        .filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // user message with blocks: tool results become role:"tool" messages,
    // any text blocks stay a user message
    const toolResults = msg.content.filter(
      (b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result',
    );
    for (const r of toolResults) {
      const content =
        typeof r.content === 'string'
          ? r.content
          : (r.content ?? [])
              .filter((c) => c.type === 'text')
              .map((c) => (c as Anthropic.TextBlockParam).text)
              .join('\n');
      out.push({ role: 'tool', tool_call_id: r.tool_use_id, content });
    }
    const text = msg.content
      .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

function toAnthropicMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
  data: ChatCompletionResponse,
): Anthropic.Message {
  const choice = data.choices[0];
  if (!choice) throw new Error('Fireworks returned no choices');

  const content: Anthropic.ContentBlock[] = [];
  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content, citations: null });
  }
  for (const call of choice.message.tool_calls ?? []) {
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      input = { __unparseable_arguments: call.function.arguments };
    }
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input,
      caller: { type: 'direct' },
    });
  }

  const stopReason: Anthropic.StopReason =
    choice.finish_reason === 'tool_calls' || (choice.message.tool_calls?.length ?? 0) > 0
      ? 'tool_use'
      : choice.finish_reason === 'length'
        ? 'max_tokens'
        : 'end_turn';

  return {
    id: data.id,
    type: 'message',
    role: 'assistant',
    model: params.model,
    content,
    stop_reason: stopReason,
    stop_details: null,
    stop_sequence: null,
    container: null,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    } as Anthropic.Usage,
  };
}

export class FireworksClient implements MessageCreator {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl: string = BASE_URL,
  ) {}

  readonly messages = {
    create: async (
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message> => {
      const body: Record<string, unknown> = {
        model: params.model,
        max_tokens: params.max_tokens,
        messages: toOpenAiMessages(params),
      };
      if (params.tools?.length) {
        body['tools'] = params.tools.map((t) => {
          const tool = t as Anthropic.Tool;
          return {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description ?? '',
              parameters: tool.input_schema,
            },
          };
        });
      }
      if (params.tool_choice?.type === 'tool') {
        body['tool_choice'] = {
          type: 'function',
          function: { name: params.tool_choice.name },
        };
      }

      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`Fireworks API error ${res.status}: ${raw}`);
      }
      return toAnthropicMessage(params, JSON.parse(raw) as ChatCompletionResponse);
    },
  };
}
