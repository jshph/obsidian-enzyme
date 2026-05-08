declare module '@jshph/digest' {
  export interface ToolResult {
    content: string
    isError: boolean
  }

  export interface ToolParameter {
    type: string
    description: string
    enum?: string[]
  }

  export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, ToolParameter>
    required?: string[]
  }

  export interface Tool {
    definition: ToolDefinition
    execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>
  }

  export interface TokenUsage {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }

  export interface SystemPromptBlock {
    text: string
    cache: boolean
  }

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

  export interface Message {
    role: string
  }

  export interface PrefetchResult {
    content: string
    source: string
  }

  export interface LLMProvider {
    stream: (
      systemPrompt: SystemPromptBlock[],
      messages: unknown[],
      tools: ToolDefinition[],
      signal?: AbortSignal,
    ) => AsyncIterable<unknown>
    estimateTokens: (text: string) => number
    warmup?: (systemPrompt: SystemPromptBlock[], messages: unknown[]) => void
  }

  export interface AgentConfig {
    systemPrompt: SystemPromptBlock[]
    tools: Tool[]
    provider: LLMProvider
    context: {
      maxTokens: number
      compactThreshold: number
      keepRecentToolResults: number
      compactPrompt?: string
    }
    prefetch?: (recentMessages: Message[]) => Promise<PrefetchResult | null>
  }

  export class Agent {
    constructor(config: AgentConfig)
    on(handler: (event: AgentEvent) => void | Promise<void>): () => void
    abort(): void
    prompt(text: string): Promise<void>
  }

  export interface OpenAIProviderConfig {
    baseURL: string
    model: string
    maxTokens: number
    apiKey: string
  }

  export interface PromptConfig {
    vaultName: string
    enzymeOverview?: string
  }

  export function createOpenAIProvider(config: OpenAIProviderConfig): LLMProvider
  export function buildSystemPrompt(config: PromptConfig): SystemPromptBlock[]
  export function createVaultSearchTool(vaultPath: string): Tool
  export function createEnzymePrefetch(vaultPath: string): (recentMessages: Message[]) => Promise<PrefetchResult | null>
}
