/**
 * Debug logger — writes structured JSONL to a file for prompt tuning.
 *
 * Enable with DIGEST_DEBUG=1. Writes to .digest/debug.jsonl in the
 * working directory (or DIGEST_DEBUG_FILE to override path).
 *
 * Each line is a JSON object with a type and timestamp. Types:
 *   system_prompt   — the full system prompt blocks sent to the LLM
 *   prefetch        — what the prefetch returned (or null)
 *   llm_request     — messages + tools sent to the model (token estimate)
 *   llm_response    — assistant message with usage
 *   tool_call       — tool name, arguments, result, isError
 *   compact         — summary text, messages before/after count
 */

import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type {
  AgentEvent,
  LLMMessage,
  Message,
  PrefetchResult,
  SystemPromptBlock,
  ToolDefinition,
  TokenUsage,
} from './types.js'

let logPath: string | null = null
let enabled = false

export async function initDebugLog(path?: string): Promise<void> {
  if (!process.env.DIGEST_DEBUG && !path) return
  logPath = path || process.env.DIGEST_DEBUG_FILE || 'debug.jsonl'
  enabled = true
  // Test write immediately so we catch permission issues at startup
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(logPath, JSON.stringify({ type: 'init', _ts: Date.now() }) + '\n')
}

export function isDebugEnabled(): boolean {
  return enabled
}

async function write(entry: Record<string, any>): Promise<void> {
  if (!enabled || !logPath) return
  try {
    await mkdir(dirname(logPath), { recursive: true })
    await appendFile(logPath, JSON.stringify({ ...entry, _ts: Date.now() }) + '\n')
  } catch { /* don't crash on log failure */ }
}

export async function logSystemPrompt(blocks: SystemPromptBlock[]): Promise<void> {
  const cachedBlocks = blocks.filter(b => b.cache)
  const totalChars = blocks.reduce((s, b) => s + b.text.length, 0)
  const cachedChars = cachedBlocks.reduce((s, b) => s + b.text.length, 0)
  await write({
    type: 'system_prompt',
    blockCount: blocks.length,
    cachedBlocks: cachedBlocks.length,
    totalChars,
    cachedChars,
    estTokens: Math.ceil(totalChars / 3.5),
    estCachedTokens: Math.ceil(cachedChars / 3.5),
    blocks: blocks.map(b => ({
      cache: b.cache,
      chars: b.text.length,
      preview: b.text.slice(0, 200),
    })),
  })
}

export async function logPrefetch(
  query: string,
  result: PrefetchResult | null,
): Promise<void> {
  await write({
    type: 'prefetch',
    query: query.slice(0, 300),
    found: result !== null,
    contentChars: result?.content.length ?? 0,
    preview: result?.content.slice(0, 300) ?? null,
  })
}

export async function logLLMRequest(
  messages: LLMMessage[],
  tools: ToolDefinition[],
  estimatedTokens: number,
): Promise<void> {
  await write({
    type: 'llm_request',
    messageCount: messages.length,
    toolCount: tools.length,
    estimatedTokens,
    messages: messages.map(m => ({
      role: m.role,
      chars: m.role === 'user' ? (m as any).content.length
        : m.role === 'tool_result' ? (m as any).content.length
        : JSON.stringify((m as any).content).length,
      preview: m.role === 'user' ? (m as any).content.slice(0, 150)
        : m.role === 'tool_result' ? `[${(m as any).toolCallId}] ${(m as any).content.slice(0, 100)}`
        : '[assistant]',
    })),
  })
}

export async function logLLMResponse(usage: TokenUsage | undefined, stopReason: string): Promise<void> {
  await write({
    type: 'llm_response',
    stopReason,
    usage: usage ?? null,
    cacheHitRate: usage && (usage.cacheReadTokens || 0) > 0
      ? ((usage.cacheReadTokens! / (usage.inputTokens + usage.cacheReadTokens! + (usage.cacheWriteTokens || 0))) * 100).toFixed(1) + '%'
      : '0%',
  })
}

export async function logToolCall(
  name: string,
  args: Record<string, unknown>,
  result: string,
  isError: boolean,
): Promise<void> {
  await write({
    type: 'tool_call',
    name,
    args,
    isError,
    resultChars: result.length,
    resultPreview: result.slice(0, 200),
  })
}

export async function logCompact(
  messagesBefore: number,
  messagesAfter: number,
  summaryChars: number,
): Promise<void> {
  await write({
    type: 'compact',
    messagesBefore,
    messagesAfter,
    summaryChars,
  })
}

export async function logPrefixCheck(
  matches: boolean,
  prevLen: number,
  currLen: number,
  divergence: { position: number; prevSnippet: string; currSnippet: string } | null,
): Promise<void> {
  await write({
    type: 'prefix_check',
    kvCacheHit: matches,
    prevLen,
    currLen,
    ...(divergence && {
      divergePosition: divergence.position,
      prevSnippet: divergence.prevSnippet,
      currSnippet: divergence.currSnippet,
    }),
  })
}
