/**
 * Digest agent types.
 *
 * Read this file first. It defines every type in the system.
 * The architecture is: messages flow through an agent loop that
 * calls tools and manages context. A provider talks to the LLM.
 *
 * Concepts:
 *   Message        — what flows through the conversation
 *   Tool           — something the agent can do (search, read, write)
 *   SystemPrompt   — instruction blocks sent to the LLM, with cache hints
 *   Provider       — adapter between the agent and a specific LLM API
 *   AgentConfig    — wires it all together
 */

// ─── Messages ────────────────────────────────────────────────────────
//
// A conversation is a sequence of messages. The agent loop appends
// messages as the conversation progresses. Four roles:
//
//   user           — human input
//   assistant      — LLM response (may contain text, tool calls, thinking)
//   tool_result    — output from running a tool
//   system_compact — a summary that replaced older messages (see context/)

export interface UserMessage {
  role: 'user'
  content: string
  timestamp: number
}

export interface AssistantMessage {
  role: 'assistant'
  content: ContentBlock[]
  stopReason: 'end' | 'tool_use' | 'error' | 'max_tokens'
  timestamp: number
  usage?: TokenUsage
}

export interface ToolResultMessage {
  role: 'tool_result'
  toolCallId: string
  toolName: string
  content: string
  isError: boolean
  timestamp: number
}

export interface SystemCompactMessage {
  role: 'system_compact'
  summary: string
  timestamp: number
}

export type Message =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | SystemCompactMessage

// An assistant message is made of content blocks — text, tool calls,
// or chain-of-thought. Most responses are just text. When the model
// wants to use a tool, it emits a tool_call block. The agent loop
// executes it, appends the result, and asks the model to continue.

export interface TextContent {
  type: 'text'
  text: string
}

export interface ToolCallContent {
  type: 'tool_call'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ThinkingContent {
  type: 'thinking'
  text: string
}

export type ContentBlock = TextContent | ToolCallContent | ThinkingContent

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

// ─── Tools ───────────────────────────────────────────────────────────
//
// A tool has two parts:
//   definition  — name, description, and parameter schema (sent to the LLM)
//   execute     — a function that runs when the model calls the tool
//
// Tools are the primary extension point. To add a new capability,
// create a Tool and pass it in AgentConfig.tools.

export interface Tool {
  definition: ToolDefinition
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  required?: string[]
}

export interface ToolParameter {
  type: string
  description: string
  enum?: string[]
}

export interface ToolResult {
  content: string
  isError: boolean
}

// ─── System Prompt ───────────────────────────────────────────────────
//
// The system prompt is an ordered array of blocks rather than a single
// string. This enables prompt caching: blocks marked `cache: true` form
// a stable prefix that the LLM API can cache across turns.
//
// Layout:
//   [cached]   identity + tool guidance      ← never changes
//   [cached]   enzyme petri overview          ← stable for the session
//   [uncached] memory, date                   ← may change between turns
//
// The provider places a cache breakpoint after the last cached block.
// On turn 2+, everything before that breakpoint is read from KV cache
// instead of being re-processed — faster time-to-first-token and
// cheaper per-token cost.
//
// WATCH: Anthropic requires a minimum prefix size for caching to
// activate (1,024 tokens for Haiku, 2,048 for Sonnet/Opus). If the
// cached blocks + tool definitions don't reach that threshold, the
// breakpoint is ignored and every turn pays full input cost. Monitor
// cache_read_input_tokens in usage — if it's 0 on turn 2, the prefix
// is too short.

export interface SystemPromptBlock {
  text: string
  cache: boolean
}

// ─── Provider ────────────────────────────────────────────────────────
//
// The provider is the adapter between the agent loop and a specific
// LLM API (Anthropic, OpenAI-compatible local server, etc).
//
// The agent loop calls provider.stream() each turn. The provider
// translates SystemPromptBlock[] + messages + tools into whatever
// the underlying API expects, and yields a stream of events back.
//
// To support a new LLM backend, implement this interface.

export interface LLMProvider {
  stream: (
    systemPrompt: SystemPromptBlock[],
    messages: LLMMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ) => AsyncIterable<StreamEvent>

  estimateTokens: (text: string) => number

  /**
   * Fire-and-forget: send a minimal request (max_tokens=1) to warm
   * the backend's KV cache with this prefix. Optional — providers
   * that don't benefit (e.g. Anthropic with server-side caching)
   * can omit this.
   */
  warmup?: (
    systemPrompt: SystemPromptBlock[],
    messages: LLMMessage[],
  ) => void
}

// Messages as the LLM sees them (simplified from internal Message type).
// The agent loop converts Message[] → LLMMessage[] before each call.
export type LLMMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: ContentBlock[] }
  | { role: 'tool_result'; toolCallId: string; content: string; isError: boolean }

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'done'; message: AssistantMessage }
  | { type: 'error'; error: string }

// ─── Agent Config ────────────────────────────────────────────────────

export interface AgentConfig {
  systemPrompt: SystemPromptBlock[]
  tools: Tool[]
  provider: LLMProvider
  context: ContextConfig

  /**
   * Pre-fetch hook — runs before each LLM call. Receives the recent
   * messages (up to the last 3 user messages) and returns context
   * to inject alongside the user's prompt.
   *
   * Use this to automatically retrieve relevant content before the
   * model even sees the message. The model then reasons about the
   * pre-fetched context rather than deciding whether to search.
   *
   * Returns null if no relevant context was found.
   */
  prefetch?: (recentMessages: Message[]) => Promise<PrefetchResult | null>
}

export interface PrefetchResult {
  /** Context to inject (will appear before the user's message). */
  content: string
  /** Short label for event logging (e.g. "enzyme catalyze"). */
  source: string
}

export interface ContextConfig {
  /** Total context window size in tokens. */
  maxTokens: number

  /**
   * Compact when estimated usage exceeds this fraction of maxTokens.
   * At 0.70, a 32K window triggers compaction around 22,937 tokens.
   * Lower = more aggressive (keeps more headroom for the response).
   */
  compactThreshold: number

  /**
   * How many recent tool results to keep in full. Older results are
   * replaced with one-line stubs to free tokens. 2 is a good default.
   */
  keepRecentToolResults: number

  /** Override the default compaction prompt if needed. */
  compactPrompt?: string
}

// ─── Agent Events ────────────────────────────────────────────────────
//
// The agent emits events as it works. Subscribe via agent.on(handler).
// Use these to build a UI, log to disk, or integrate with other tools.

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_start' }
  | { type: 'turn_end'; usage?: TokenUsage }
  | { type: 'prefetch_start'; source: string }
  | { type: 'prefetch_end'; source: string; found: boolean }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_call_end'; id: string; name: string; result: ToolResult }
  | { type: 'compact_start' }
  | { type: 'compact_end'; summary: string }
  | { type: 'error'; error: string }
