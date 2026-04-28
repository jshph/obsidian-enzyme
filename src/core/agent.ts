/**
 * The agent loop.
 *
 * Unified tool loop — all turns include tool definitions for KV cache
 * prefix stability. The model decides whether to search or synthesize:
 *
 *   1. Call model with tools (text suppressed — Qwen XML noise)
 *      - No tool calls → re-emit text → done
 *      - Tool calls → execute → inject synthesis directive → loop
 *   2. After tool results, ephemeral directive nudges synthesis
 *      - Model responds with text → done
 *      - Max 1 tool round, then forced text response (no tools)
 *
 * The ephemeral directive lists prior search queries and is removed
 * after the response so it doesn't pollute future prefixes.
 */

import type {
  AgentConfig,
  AgentEvent,
  AssistantMessage,
  ContentBlock,
  LLMMessage,
  Message,
  ToolCallContent,
  ToolDefinition,
  ToolResult,
  ToolResultMessage,
  UserMessage,
} from './types.js'
import { estimateMessageTokens, shouldCompact } from '../context/tokens.js'
import { compactMessages } from '../context/compact.js'
import { clearOldToolResults } from '../context/clearing.js'
import {
  isDebugEnabled, logCompact, logLLMRequest, logLLMResponse,
  logPrefetch, logPrefixCheck, logSystemPrompt, logToolCall,
} from './debug.js'

export type EventHandler = (event: AgentEvent) => void | Promise<void>

export class Agent {
  private messages: Message[] = []
  private config: AgentConfig
  private listeners: EventHandler[] = []
  private abortController: AbortController | null = null

  constructor(config: AgentConfig) {
    this.config = config
  }

  /** Subscribe to agent events. Returns an unsubscribe function. */
  on(handler: EventHandler): () => void {
    this.listeners.push(handler)
    return () => { this.listeners = this.listeners.filter(h => h !== handler) }
  }

  /** Read the conversation history. */
  getMessages(): readonly Message[] {
    return this.messages
  }

  /** Cancel the current run. */
  abort(): void {
    this.abortController?.abort()
  }

  /** Send a user message and run the agent loop until it completes. */
  async prompt(text: string): Promise<void> {
    // Clear old tool results BEFORE the new user message, so stubs are
    // baked into the prefix. This keeps the prefix stable during the
    // tool-call loop (KV cache hits on every turn within a prompt).
    this.messages = clearOldToolResults(
      this.messages,
      this.config.context.keepRecentToolResults,
    )

    this.messages.push({
      role: 'user',
      content: text,
      timestamp: Date.now(),
    } satisfies UserMessage)

    await this.emit({ type: 'agent_start' })
    await this.runPrefetch()
    await this.runLoop()
    await this.emit({ type: 'agent_end' })
    this.warmKVCache()
  }

  // ── Pre-fetch ────────────────────────────────────────────────────
  //
  // Runs before the first LLM call of each prompt(). Takes the last
  // few user messages, passes them to the prefetch function (typically
  // enzyme catalyze), and injects results as a context message.

  private async runPrefetch(): Promise<void> {
    if (!this.config.prefetch) return

    const recentUserMessages = this.messages
      .filter((m): m is UserMessage => m.role === 'user')
      .slice(-3)

    if (recentUserMessages.length === 0) return

    const source = 'enzyme catalyze'
    await this.emit({ type: 'prefetch_start', source })

    const queryText = recentUserMessages.map(m => m.content).join(' ').slice(0, 300)

    try {
      const result = await this.config.prefetch(recentUserMessages)
      await logPrefetch(queryText, result)
      if (result) {
        const lastUserIndex = this.messages.length - 1
        this.messages.splice(lastUserIndex, 0, {
          role: 'user',
          content: `[Vault context for this conversation]\n\n${result.content}`,
          timestamp: Date.now(),
        } satisfies UserMessage)
        await this.emit({ type: 'prefetch_end', source: result.source, found: true })
      } else {
        await this.emit({ type: 'prefetch_end', source, found: false })
      }
    } catch {
      await logPrefetch(queryText, null)
      await this.emit({ type: 'prefetch_end', source, found: false })
    }
  }

  // ── The loop ─────────────────────────────────────────────────────
  //
  // All turns use tools → same prefix → KV cache hits.
  // The model decides: call tools (needs context) or respond (has enough).
  //
  //   Turn 1: model sees user message, decides to search or respond
  //   Turn 2+: after tool results, ephemeral directive nudges synthesis
  //            but model CAN still call tools if it needs more context
  //   Max 3 tool rounds, then force text-only response
  //
  // Text streams live on all turns. The XML filter in callModel strips
  // <tool_call> tags that Qwen emits as text alongside structured calls.

  private async runLoop(): Promise<void> {
    this.abortController = new AbortController()
    const { signal } = this.abortController
    const maxToolRounds = 1
    let toolRound = 0

    await this.manageContext()

    while (!signal.aborted) {
      const hasToolResults = toolRound > 0

      // After tool execution, inject ephemeral synthesis directive
      // that lists what was already searched so the model can see
      // "I already have X, Y, Z" and avoid redundant searches.
      let injectedDirective = false
      if (hasToolResults) {
        const priorSearches = this.messages
          .filter((m): m is AssistantMessage => m.role === 'assistant')
          .flatMap(m => m.content)
          .filter((b): b is ToolCallContent => b.type === 'tool_call' && b.name === 'VaultSearch')
          .map(b => (b.arguments.query as string) || '')
          .filter(Boolean)
        const searchList = priorSearches.length > 0
          ? `\nAlready searched: ${priorSearches.map(q => `"${q}"`).join(', ')}.`
          : ''
        this.messages.push({
          role: 'user',
          content: `Respond using the search results already in the conversation. Quote key passages and connect ideas.${searchList}\nDo NOT call VaultSearch unless the user is asking about a topic with NO relevant results above.`,
          timestamp: Date.now(),
        } satisfies UserMessage)
        injectedDirective = true
      }

      // Stream text live on all turns. The XML filter in callModel
      // strips <tool_call> tags if Qwen emits them as text.
      await this.emit({ type: 'turn_start' })
      const isLastRound = toolRound >= maxToolRounds
      const response = await this.callModel(signal, {
        tools: !isLastRound,
      })

      // Remove ephemeral directive before modifying messages further
      if (injectedDirective) {
        // Find and remove the directive (it's the last user message
        // before the response, but response isn't pushed yet)
        for (let i = this.messages.length - 1; i >= 0; i--) {
          if (this.messages[i].role === 'user' &&
              (this.messages[i] as UserMessage).content.startsWith('Respond using the search results')) {
            this.messages.splice(i, 1)
            break
          }
        }
      }

      if (!response || signal.aborted) break

      const toolCalls = response.content.filter(
        (b): b is ToolCallContent => b.type === 'tool_call',
      )

      // No tool calls — model responded. Text already streamed live.
      if (toolCalls.length === 0) {
        this.messages.push(response)
        await this.emit({ type: 'turn_end', usage: response.usage })
        break
      }

      // Tool calls — execute in parallel
      this.messages.push(response)
      const results = await Promise.all(
        toolCalls.map(call =>
          signal.aborted
            ? Promise.resolve({ call, result: { content: 'Aborted', isError: true } })
            : this.executeTool(call, signal).then(result => ({ call, result }))
        ),
      )
      for (const { call, result } of results) {
        this.messages.push({
          role: 'tool_result',
          toolCallId: call.id,
          toolName: call.name,
          content: result.content,
          isError: result.isError,
          timestamp: Date.now(),
        } satisfies ToolResultMessage)
      }
      await this.emit({ type: 'turn_end', usage: response.usage })
      toolRound++
    }

    this.abortController = null
  }

  // ── Tool execution ───────────────────────────────────────────────

  private async executeTool(call: ToolCallContent, signal: AbortSignal): Promise<ToolResult> {
    await this.emit({ type: 'tool_call_start', id: call.id, name: call.name, args: call.arguments })

    const tool = this.config.tools.find(t => t.definition.name === call.name)
    let result: ToolResult

    if (!tool) {
      result = { content: `Unknown tool "${call.name}"`, isError: true }
    } else {
      try {
        result = await tool.execute(call.arguments, signal)
      } catch (err) {
        result = { content: err instanceof Error ? err.message : String(err), isError: true }
      }
    }

    await logToolCall(call.name, call.arguments, result.content, result.isError)
    await this.emit({ type: 'tool_call_end', id: call.id, name: call.name, result })
    return result
  }

  // ── Context management ───────────────────────────────────────────

  private async manageContext(): Promise<void> {
    if (shouldCompact(this.estimateTokens(), this.config.context)) {
      await this.emit({ type: 'compact_start' })
      const beforeCount = this.messages.length
      const { messages, summary } = await compactMessages(this.messages, this.config)
      this.messages = messages
      await logCompact(beforeCount, messages.length, summary.length)
      await this.emit({ type: 'compact_end', summary })
    }
  }

  private estimateTokens(): number {
    const est = this.config.provider.estimateTokens
    let tokens = 0
    for (const block of this.config.systemPrompt) tokens += est(block.text)
    for (const tool of this.config.tools) tokens += est(JSON.stringify(tool.definition))
    for (const msg of this.messages) tokens += estimateMessageTokens(msg, est)
    return tokens
  }

  // ── LLM call ─────────────────────────────────────────────────────

  private lastSerializedPrefix: string | null = null

  private async callModel(signal: AbortSignal, opts: { tools: boolean }): Promise<AssistantMessage | null> {
    const llmMessages = this.toLLMMessages()
    const toolDefs = opts.tools
      ? this.config.tools.map(t => t.definition)
      : []

    this.checkPrefixStability(llmMessages)

    await logSystemPrompt(this.config.systemPrompt)
    await logLLMRequest(llmMessages, toolDefs, this.estimateTokens())

    const stream = this.config.provider.stream(
      this.config.systemPrompt,
      llmMessages,
      toolDefs,
      signal,
    )

    // Buffer for filtering <tool_call> XML from streamed text.
    // Qwen emits tool-call XML as text alongside structured tool calls.
    let textBuf = ''

    for await (const event of stream) {
      if (signal.aborted) return null
      switch (event.type) {
        case 'text_delta':
          textBuf += event.text
          // Hold buffer if it might be start of <tool_call>
          if (textBuf.includes('<tool_call>')) {
            // Emit everything before the tag
            const idx = textBuf.indexOf('<tool_call>')
            if (idx > 0) {
              await this.emit({ type: 'text_delta', text: textBuf.slice(0, idx) })
            }
            // Discard from <tool_call> onward (rest will be discarded too)
            textBuf = ''
          } else if (!textBuf.endsWith('<') && !/<[a-z]*$/.test(textBuf)) {
            // Safe to flush — not in the middle of a potential tag
            await this.emit({ type: 'text_delta', text: textBuf })
            textBuf = ''
          }
          break
        case 'thinking_delta':
          await this.emit({ type: 'thinking_delta', text: event.text })
          break
        case 'done':
          // Flush remaining buffer (if it wasn't a tool_call tag)
          if (textBuf && !textBuf.includes('<tool_call')) {
            await this.emit({ type: 'text_delta', text: textBuf })
          }
          await logLLMResponse(event.message.usage, event.message.stopReason)
          return event.message
        case 'error':
          await this.emit({ type: 'error', error: event.error })
          return null
      }
    }

    return null
  }

  private toLLMMessages(): LLMMessage[] {
    return this.convertToLLM(this.messages)
  }

  private convertToLLM(messages: Message[]): LLMMessage[] {
    return messages.flatMap((msg): LLMMessage[] => {
      switch (msg.role) {
        case 'user':
          return [{ role: 'user', content: msg.content }]
        case 'assistant':
          return [{ role: 'assistant', content: msg.content }]
        case 'tool_result':
          return [{ role: 'tool_result', toolCallId: msg.toolCallId, content: msg.content, isError: msg.isError }]
        case 'system_compact':
          return [{ role: 'user', content: `[Previous conversation summary]\n\n${msg.summary}\n\n[Continuing from where we left off]` }]
      }
    })
  }

  private checkPrefixStability(llmMessages: LLMMessage[]): void {
    if (!isDebugEnabled()) return

    const systemSerialized = this.config.systemPrompt.map(b => b.text).join('\n\n')
    const msgsSerialized = llmMessages.map(m => {
      if (m.role === 'user') return `user:${m.content}`
      if (m.role === 'tool_result') return `tool:${m.toolCallId}:${m.content}`
      if (m.role === 'assistant') return `assistant:${JSON.stringify(m.content)}`
      return ''
    }).join('\n')
    const fullSerialized = systemSerialized + '\n' + msgsSerialized

    if (this.lastSerializedPrefix !== null) {
      const prev = this.lastSerializedPrefix
      const curr = fullSerialized
      const minLen = Math.min(prev.length, curr.length)
      let divergeAt = -1
      for (let i = 0; i < minLen; i++) {
        if (prev[i] !== curr[i]) {
          divergeAt = i
          break
        }
      }

      if (divergeAt === -1 && prev.length <= curr.length) {
        logPrefixCheck(true, prev.length, curr.length, null)
      } else {
        logPrefixCheck(false, prev.length, curr.length, {
          position: divergeAt,
          prevSnippet: prev.slice(Math.max(0, divergeAt - 20), divergeAt + 20),
          currSnippet: curr.slice(Math.max(0, divergeAt - 20), divergeAt + 20),
        })
      }
    }

    this.lastSerializedPrefix = fullSerialized
  }

  private warmKVCache(): void {
    if (!this.config.provider.warmup) return

    const stubbedMessages = clearOldToolResults(
      this.messages,
      this.config.context.keepRecentToolResults,
    )
    const llmMessages = this.convertToLLM(stubbedMessages)
    this.config.provider.warmup(this.config.systemPrompt, llmMessages)
  }

  private async emit(event: AgentEvent): Promise<void> {
    for (const handler of this.listeners) await handler(event)
  }
}
