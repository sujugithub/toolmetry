import type Anthropic from '@anthropic-ai/sdk';
import type { ToolCall } from '../metrics/index.js';
import type { McpTarget } from './target.js';

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRunResult {
  toolCalls: ToolCall[];
  finalText: string;
  usage: AgentUsage;
  hitIterationLimit: boolean;
}

/** Structural slice of the Anthropic client, so tests can inject a scripted fake. */
export type MessageCreator = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message>;
  };
};

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. Use the available tools to fulfill the ' +
  "user's request, then answer briefly.";

export interface RunAgentOptions {
  client: MessageCreator;
  model: string;
  target: McpTarget;
  prompt: string;
  maxIterations?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

/** One agent episode: send the scenario prompt with the target's tools, execute
 * every tool call against the target, loop until the model stops (or the
 * iteration cap trips). Records exactly what the model called. */
export async function runAgentOnce(opts: RunAgentOptions): Promise<AgentRunResult> {
  const {
    client,
    model,
    target,
    prompt,
    maxIterations = 6,
    maxTokens = 2048,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
  } = opts;

  const tools = target.listTools();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  const toolCalls: ToolCall[] = [];
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  let finalText = '';
  let hitIterationLimit = false;

  for (let iteration = 0; ; iteration++) {
    if (iteration >= maxIterations) {
      hitIterationLimit = true;
      break;
    }

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools,
      messages,
    });

    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    finalText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const args = use.input as Record<string, unknown>;
      toolCalls.push({ name: use.name, args });
      const result = await target.callTool(use.name, args);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: result.text,
        is_error: result.isError,
      });
    }
    // all results for one assistant turn go back in a single user message
    messages.push({ role: 'user', content: toolResults });
  }

  return { toolCalls, finalText, usage, hitIterationLimit };
}
