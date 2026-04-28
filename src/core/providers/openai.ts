/**
 * OpenAI-compatible provider for local models (LM Studio, Ollama, etc).
 *
 * Both LM Studio and Ollama expose an OpenAI-compatible /v1/chat/completions
 * endpoint. This provider uses that API with streaming and tool calling.
 *
 * Anthropic-style cache_control is NOT supported by these backends — the
 * system prompt blocks are concatenated into a single string. However,
 * llama-server supports server-side KV cache reuse via cache_prompt: true
 * in the request body, which reuses cached KV state for matching prefixes.
 *
 * Default endpoints:
 *   LM Studio: http://localhost:1234/v1
 *   Ollama:    http://localhost:11434/v1
 */

import type {
  AssistantMessage,
  ContentBlock,
  LLMMessage,
  LLMProvider,
  StreamEvent,
  SystemPromptBlock,
  ToolDefinition,
  TokenUsage,
} from '../types.js'
import { roughTokenEstimate } from '../../context/tokens.js'

export interface OpenAIProviderConfig {
  baseURL: string
  model: string
  apiKey?: string
  maxTokens?: number
}

export function createOpenAIProvider(config: OpenAIProviderConfig): LLMProvider {
  const { baseURL, model, apiKey, maxTokens = 2048 } = config

  return {
    stream: (systemPrompt, messages, tools, signal) =>
      streamOpenAI(baseURL, model, apiKey, maxTokens, systemPrompt, messages, tools, signal),
    estimateTokens: roughTokenEstimate,
    warmup: (systemPrompt, messages) =>
      warmupKVCache(baseURL, model, apiKey, systemPrompt, messages),
  }
}

async function* streamOpenAI(
  baseURL: string,
  model: string,
  apiKey: string | undefined,
  maxTokens: number,
  systemBlocks: SystemPromptBlock[],
  messages: LLMMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  let systemContent = systemBlocks.map(b => b.text).join('\n\n')

  // When no tools are provided (synthesis turn), suppress models that
  // hallucinate tool-call XML in their text output.
  if (tools.length === 0) {
    systemContent += '\n\nDo not emit tool calls, tool-call XML, or tool names. Respond in natural language only.'
  }

  const openaiMessages: any[] = [
    { role: 'system', content: systemContent },
    ...messages.map(toOpenAIFormat),
  ]

  const openaiTools = tools.length > 0
    ? tools.map(toOpenAITool)
    : undefined

  const body: any = {
    model,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    messages: openaiMessages,
    cache_prompt: true, // llama-server: reuse cached KV for matching prefix
  }
  if (openaiTools) {
    body.tools = openaiTools
  }

  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const errText = await response.text()
      yield { type: 'error', error: `${response.status}: ${errText}` }
      return
    }

    if (!response.body) {
      yield { type: 'error', error: 'No response body' }
      return
    }

    // Parse SSE stream
    const contentBlocks: ContentBlock[] = []
    let textAccumulator = ''
    const toolCalls = new Map<number, { id: string; name: string; args: string }>()
    let inputTokens = 0
    let outputTokens = 0
    let cachedTokens = 0
    let stopReason: 'end' | 'tool_use' | 'max_tokens' = 'end'

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (signal?.aborted) return

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        let chunk: any
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }

        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || 0
          outputTokens = chunk.usage.completion_tokens || 0
          cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0
        }

        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta
        if (!delta) continue

        // Text content
        if (delta.content) {
          textAccumulator += delta.content
          yield { type: 'text_delta', text: delta.content }
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCalls.has(idx)) {
              toolCalls.set(idx, {
                id: tc.id || `call_${idx}_${Date.now()}`,
                name: tc.function?.name || '',
                args: '',
              })
            }
            const entry = toolCalls.get(idx)!
            if (tc.function?.name) entry.name = tc.function.name
            if (tc.function?.arguments) entry.args += tc.function.arguments
          }
        }

        if (choice.finish_reason === 'tool_calls') {
          stopReason = 'tool_use'
        } else if (choice.finish_reason === 'length') {
          stopReason = 'max_tokens'
        }
      }
    }

    // Strip <tool_call> XML from text when structured tool calls were
    // also parsed. Qwen emits tool calls both as structured deltas AND
    // as XML in text content — the structured ones are canonical.
    if (toolCalls.size > 0 && textAccumulator) {
      textAccumulator = textAccumulator
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .replace(/<tool_call>[\s\S]*/g, '')  // unclosed trailing block
        .trim()
    }

    // Build content blocks
    if (textAccumulator) {
      contentBlocks.push({ type: 'text', text: textAccumulator })
    }
    for (const [, tc] of toolCalls) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.args || '{}') } catch { /* empty */ }
      contentBlocks.push({
        type: 'tool_call',
        id: tc.id,
        name: tc.name,
        arguments: args,
      })
      yield { type: 'tool_call', id: tc.id, name: tc.name, arguments: args }
      if (stopReason === 'end') stopReason = 'tool_use'
    }

    if (inputTokens === 0) {
      inputTokens = roughTokenEstimate(JSON.stringify(openaiMessages))
    }
    if (outputTokens === 0) {
      outputTokens = roughTokenEstimate(textAccumulator)
    }

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      ...(cachedTokens > 0 && { cacheReadTokens: cachedTokens }),
    }

    yield {
      type: 'done',
      message: {
        role: 'assistant',
        content: contentBlocks,
        stopReason,
        timestamp: Date.now(),
        usage,
      },
    }
  } catch (err) {
    if (signal?.aborted) return
    yield {
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function toOpenAIFormat(msg: LLMMessage): any {
  switch (msg.role) {
    case 'user':
      return { role: 'user', content: msg.content }
    case 'assistant': {
      const text = msg.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('')
      const tcs = msg.content
        .filter(b => b.type === 'tool_call')
        .map(b => {
          const tc = b as { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
          return {
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }
        })
      return {
        role: 'assistant',
        ...(text && { content: text }),
        ...(tcs.length > 0 && { tool_calls: tcs }),
      }
    }
    case 'tool_result':
      return {
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: msg.content,
      }
  }
}

/**
 * Fire-and-forget: send a max_tokens=1 request to warm the KV cache.
 */
function warmupKVCache(
  baseURL: string,
  model: string,
  apiKey: string | undefined,
  systemBlocks: SystemPromptBlock[],
  messages: LLMMessage[],
): void {
  const systemContent = systemBlocks.map(b => b.text).join('\n\n')
  const mapped = messages.map(toOpenAIFormat)
  // Ensure last message is user-role — some chat templates (Qwen)
  // reject conversations ending with assistant messages.
  if (mapped.length === 0 || mapped[mapped.length - 1].role !== 'user') {
    mapped.push({ role: 'user', content: '.' })
  }
  const openaiMessages: any[] = [
    { role: 'system', content: systemContent },
    ...mapped,
  ]

  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 1,
      stream: false,
      messages: openaiMessages,
      cache_prompt: true, // llama-server: cache this prefix in host RAM via --cram
    }),
  }).catch(() => {
    // Warmup failed — not critical
  })
}

function toOpenAITool(tool: ToolDefinition): any {
  const properties: Record<string, any> = {}
  for (const [name, param] of Object.entries(tool.parameters)) {
    properties[name] = {
      type: param.type,
      description: param.description,
      ...(param.enum && { enum: param.enum }),
    }
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties,
        required: tool.required || [],
      },
    },
  }
}
