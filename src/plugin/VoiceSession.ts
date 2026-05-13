import { requestUrl } from 'obsidian'
import { OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession } from '@openai/agents/realtime'
import { tool } from '@openai/agents'
import type { SystemPromptBlock, Tool, ToolParameter } from '@jshph/digest'

export interface VoiceSessionConfig {
  apiKey: string
  model: string
  voice: string
  systemPrompt: SystemPromptBlock[]
  startupContext?: string
  tools: Tool[]
  onStatus?: (status: string) => void
  onTranscript?: (role: 'user' | 'assistant', text: string) => void
  onToolStart?: (name: string, args: string) => void
  onToolEnd?: (name: string, result: string) => void
  onError?: (error: string) => void
}

export class VoiceSession {
  private session: RealtimeSession | null = null
  private readonly config: VoiceSessionConfig
  private isSpeaking = false
  private awaitingPlayback = false

  constructor(config: VoiceSessionConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    if (this.session) return

    const instructions = buildVoiceInstructions(this.config.systemPrompt)
    const realtimeTools = this.config.tools.map(toRealtimeTool)
    const agent = new RealtimeAgent({
      name: 'Enzyme Voice',
      voice: this.config.voice,
      instructions,
      tools: realtimeTools,
    })

    const transport = new OpenAIRealtimeWebRTC()
    const session = new RealtimeSession(agent, {
      model: this.config.model,
      transport,
      config: {
        audio: {
          input: {
            transcription: { model: 'gpt-4o-mini-transcribe' },
          },
          output: {
            voice: this.config.voice,
          },
        },
      },
    })

    this.bindEvents(session)
    this.session = session
    this.config.onStatus?.('Creating voice session...')

    try {
      const initialConfig = await session.getInitialSessionConfig()
      const initialSessionPayload = transport.buildSessionPayload(initialConfig)
      console.info(
        `Enzyme voice realtime payload: instructions=${initialSessionPayload.instructions?.length || 0} chars, tools=${initialSessionPayload.tools?.length || 0}`,
      )
      const clientKey = await createRealtimeClientSecret(this.config, initialSessionPayload)
      this.config.onStatus?.('Connecting voice...')
      await session.connect({ apiKey: clientKey, model: this.config.model })
      if (this.config.startupContext?.trim()) {
        session.transport.sendEvent({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{
              type: 'input_text',
              text: `[Private vault context loaded for this voice session. Do not read this aloud. Use it to understand recurring themes in the user's vault, suggest useful directions, and route searches.]\n\n${this.config.startupContext}`,
            }],
          },
        })
      }
      this.config.onStatus?.('Listening...')
    } catch (err) {
      this.session = null
      const msg = formatRealtimeError(err)
      this.config.onError?.(msg)
      throw err
    }
  }

  stop(): void {
    if (!this.session) return
    this.isSpeaking = false
    this.awaitingPlayback = false
    this.session.close()
    this.session = null
    this.config.onStatus?.('Voice disconnected')
  }

  isActive(): boolean {
    return this.session !== null
  }

  isMuted(): boolean {
    return Boolean(this.session?.muted)
  }

  mute(muted: boolean): void {
    this.session?.mute(muted)
  }

  private bindEvents(session: RealtimeSession): void {
    session.on('agent_start', () => {
      this.isSpeaking = false
      this.awaitingPlayback = true
      this.config.onStatus?.('Thinking...')
    })
    session.on('agent_end', () => {
      if (!this.isSpeaking && !this.awaitingPlayback) this.config.onStatus?.('Listening...')
    })
    session.on('audio_start', () => {
      this.isSpeaking = true
      this.awaitingPlayback = false
      this.config.onStatus?.('Speaking...')
    })
    session.on('audio_interrupted', () => {
      this.isSpeaking = false
      this.awaitingPlayback = false
      this.config.onStatus?.('Interrupted')
    })
    session.on('transport_event', event => {
      if (event.type === 'output_audio_buffer.started') {
        this.isSpeaking = true
        this.awaitingPlayback = false
        this.config.onStatus?.('Speaking...')
      } else if (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared') {
        this.isSpeaking = false
        this.awaitingPlayback = false
        this.config.onStatus?.('Listening...')
      } else if (event.type === 'response.output_audio.delta' || event.type === 'response.output_audio_transcript.delta') {
        this.awaitingPlayback = true
      }
    })
    session.on('agent_tool_start', (_context, _agent, sdkTool, details) => {
      const call = details.toolCall as { arguments?: string } | undefined
      this.config.onToolStart?.(sdkTool.name, call?.arguments || '')
    })
    session.on('agent_tool_end', (_context, _agent, sdkTool, result) => {
      this.config.onToolEnd?.(sdkTool.name, result)
    })
    session.on('history_added', item => {
      if (item.type !== 'message' || item.role === 'system') return
      if (item.status !== 'completed') return
      const text = item.content
        .map(part => {
          if (part.type === 'input_text') return part.text
          if (part.type === 'input_audio') return part.transcript || ''
          if (part.type === 'output_text') return part.text
          if (part.type === 'output_audio') return part.transcript || ''
          return ''
        })
        .filter(Boolean)
        .join('\n')
        .trim()
      if (text.startsWith('[Private vault context loaded')) return
      if (text) this.config.onTranscript?.(item.role === 'assistant' ? 'assistant' : 'user', text)
    })
    session.on('error', error => {
      this.config.onError?.(formatRealtimeError(error.error))
    })
  }
}

function buildVoiceInstructions(systemPrompt: SystemPromptBlock[]): string {
  return [
    ...systemPrompt.map(block => block.text),
    'You are a voice companion for an Obsidian vault.',
    'Keep responses brief, conversational, and easy to hear aloud.',
    'Your posture is hospitable: return something the user left behind and hold it with care. Do not perform as a writing coach, productivity coach, or brainstorming assistant unless asked.',
    'Open with a grounded noticing, not an assignment. Prefer "you had been circling..." or "the last time this came up, you had landed on..." over "you should write..." or "you could turn this into...".',
    'Make space around the user’s material. Name one specific phrase, recurrence, decision, or unresolved question, then offer a concrete direction they can follow.',
    'Do not read citations, filenames, or Obsidian links aloud unless the user explicitly asks where something came from.',
    'Use VaultSearch when the user asks about their prior writing, ideas, themes, or memories.',
    'Be proactive by noticing what seems alive in the archive, not by inventing output projects.',
    'Prefer gentle exploration prompts over long summaries. Keep each turn short enough for conversation.',
    'When search results include note links or similarity scores, treat them as private grounding for yourself. Summarize the idea naturally, and use any available UI source-rendering tool when selected notes should be visible.',
    'Do not suggest fiction, essays, publishing, exercises, or content production unless the user asks for help making something.',
  ].join('\n\n')
}

function toRealtimeTool(localTool: Tool) {
  const properties: Record<string, ToolParameter> = {}
  for (const [name, param] of Object.entries(localTool.definition.parameters)) {
    properties[name] = {
      type: param.type,
      description: param.description,
      ...(param.enum && { enum: param.enum }),
    }
  }

  return tool({
    name: localTool.definition.name,
    description: localTool.definition.description,
    strict: false,
    parameters: {
      type: 'object',
      properties,
      required: localTool.definition.required || [],
      additionalProperties: true,
    },
    execute: async input => {
      const args = typeof input === 'object' && input !== null
        ? input as Record<string, unknown>
        : {}
      const result = await localTool.execute(args)
      if (result.isError) throw new Error(result.content)
      return result.content
    },
  })
}

async function createRealtimeClientSecret(
  config: VoiceSessionConfig,
  initialSessionPayload: Record<string, unknown>,
): Promise<string> {
  if (config.apiKey.startsWith('ek_')) return config.apiKey

  const response = await requestUrl({
    url: 'https://api.openai.com/v1/realtime/client_secrets',
    method: 'POST',
    contentType: 'application/json',
    throw: false,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      session: initialSessionPayload,
    }),
  })

  const bodyText = response.text
  let body: RealtimeClientSecretResponse | null = null
  try {
    body = bodyText ? parseRealtimeClientSecretResponse(JSON.parse(bodyText) as unknown) : null
  } catch {
    body = null
  }

  if (response.status < 200 || response.status >= 300) {
    const message = body?.error?.message || bodyText || `HTTP ${response.status}`
    throw new Error(`Realtime client secret failed (${response.status}): ${message}`)
  }

  const value = body?.value || body?.client_secret?.value || body?.secret?.value
  if (typeof value !== 'string' || !value) {
    throw new Error('Realtime client secret response did not include an ephemeral key.')
  }
  return value
}

function formatRealtimeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return String(error)

  const value = error as RealtimeErrorLike
  const nested = value.error
  if (typeof nested === 'string') return nested
  if (nested && typeof nested === 'object') {
    const nestedError = nested as RealtimeErrorLike
    if (typeof nestedError.message === 'string') return nestedError.message
    if (typeof nestedError.code === 'string' && typeof nestedError.type === 'string') {
      return `${nestedError.type}: ${nestedError.code}`
    }
  }
  if (typeof value.message === 'string') return value.message
  if (typeof value.type === 'string' && typeof value.code === 'string') {
    return `${value.type}: ${value.code}`
  }

  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(error)
  }
}

type RealtimeClientSecretResponse = {
  value?: string
  client_secret?: { value?: string }
  secret?: { value?: string }
  error?: { message?: string }
}

type RealtimeErrorLike = {
  error?: unknown
  message?: unknown
  type?: unknown
  code?: unknown
}

function parseRealtimeClientSecretResponse(value: unknown): RealtimeClientSecretResponse | null {
  return value && typeof value === 'object' ? value as RealtimeClientSecretResponse : null
}
