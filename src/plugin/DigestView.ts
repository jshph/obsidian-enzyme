/**
 * DigestView — Claudian-style chat interface for Digest.
 *
 * Extends Obsidian's ItemView to provide a sidebar chat panel with:
 *   - Streaming message rendering with live markdown
 *   - Collapsible tool call sections with status indicators
 *   - Thinking dots animation
 *   - Auto-growing input textarea
 *   - Token usage tracking
 *
 * Differences from Claudian:
 *   - Single conversation (no tabs) — Digest is simpler by design
 *   - Enzyme prefetch context injection before each LLM call
 *   - Direct API calls via fetch (no CLI subprocess)
 *   - Built-in context compaction at 70% window usage
 */

import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Notice,
  FileSystemAdapter,
  setIcon,
  TFile,
  Menu,
} from 'obsidian'
import {
  Agent,
  createOpenAIProvider,
  createEnzymePrefetch,
} from '@jshph/digest'
import type { SystemPromptBlock, Tool, ToolResult } from '@jshph/digest'
import { createObsidianReadFileTool, createObsidianVaultSearchTool, createObsidianWriteFileTool } from './tools.js'
import { GraphHighlighter } from './GraphHighlighter.js'
import { MentionSuggest } from './MentionDropdown.js'
import { SelectionTracker } from './SelectionTracker.js'
import { VoiceSession } from './VoiceSession.js'
import { SpotifyClient } from './SpotifyClient.js'
import type DigestPlugin from './DigestPlugin.js'

export const VIEW_TYPE_DIGEST = 'digest-chat-view'
const DEFAULT_MAX_CONTEXT = 32768
const DEFAULT_MAX_TOKENS = 2048
const WRITING_SESSION_FOLDER = 'Enzyme Sessions'

export class DigestView extends ItemView {
  private plugin: DigestPlugin
  private agent: Agent | null = null
  private voiceSession: VoiceSession | null = null

  // DOM
  private messagesEl!: HTMLElement
  private inputEl!: HTMLDivElement
  private sendBtn!: HTMLElement
  private stopBtn!: HTMLElement
  private voiceBtn!: HTMLElement
  private statusEl!: HTMLElement

  // Streaming state
  private isProcessing = false
  private currentStreamingEl: HTMLElement | null = null
  private currentStreamingText = ''
  private renderTimer: ReturnType<typeof setTimeout> | null = null
  private sessionTokens = { input: 0, output: 0, cacheRead: 0 }
  private voiceStatus = ''
  private activeVoiceToolIds: string[] = []
  private writingSessionTimer: number | null = null
  private pendingSessionContext = ''

  // Context injection
  private mentionSuggest!: MentionSuggest
  private selectionTracker!: SelectionTracker
  private graphHighlighter!: GraphHighlighter
  private contextChipsEl!: HTMLElement
  private attachedFiles: TFile[] = []

  constructor(leaf: WorkspaceLeaf, plugin: DigestPlugin) {
    super(leaf)
    this.plugin = plugin
  }

  getViewType(): string {
    return VIEW_TYPE_DIGEST
  }

  getDisplayText(): string {
    return 'Digest'
  }

  getIcon(): string {
    return 'message-circle'
  }

  async onOpen(): Promise<void> {
    this.buildUI()
    this.graphHighlighter = new GraphHighlighter(this.app)
    this.initSelectionTracker()
    await this.initAgent()
  }

  async onClose(): Promise<void> {
    this.agent?.abort()
    this.voiceSession?.stop()
    if (this.writingSessionTimer) window.clearTimeout(this.writingSessionTimer)
    this.graphHighlighter?.clear()
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.mentionSuggest?.close()
    this.selectionTracker?.destroy()
  }

  // ── UI Construction ─────────────────────────────────────────────

  private buildUI(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('digest-container')

    // Header
    const header = contentEl.createDiv({ cls: 'digest-header' })
    const titleRow = header.createDiv({ cls: 'digest-title-row' })
    titleRow.createSpan({ cls: 'digest-title', text: 'Digest' })

    const actions = titleRow.createDiv({ cls: 'digest-actions' })

    const newBtn = actions.createEl('button', {
      cls: 'digest-action-btn clickable-icon',
      attr: { 'aria-label': 'New conversation' },
    })
    setIcon(newBtn, 'plus')
    newBtn.addEventListener('click', () => this.clearConversation())

    this.voiceBtn = actions.createEl('button', {
      cls: 'digest-action-btn clickable-icon',
      attr: { 'aria-label': 'Start voice' },
    })
    setIcon(this.voiceBtn, 'mic')
    this.voiceBtn.addEventListener('click', () => this.toggleVoice())

    // Messages area
    this.messagesEl = contentEl.createDiv({ cls: 'digest-messages' })

    // Handle internal link clicks — MarkdownRenderer creates the elements
    // but custom ItemViews don't wire up click navigation automatically.
    this.messagesEl.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const link = target.closest('a.internal-link') as HTMLAnchorElement | null
      if (link) {
        e.preventDefault()
        const href = link.getAttr('data-href')
        if (href) {
          this.app.workspace.openLinkText(href, '', 'tab')
        }
      }
    })
    this.messagesEl.addEventListener('contextmenu', (e: MouseEvent) => {
      this.showMessageContextMenu(e)
    })

    // Welcome message
    this.showSystemMessage('Use Digest to turn vault themes into writing sessions. Enzyme keeps the Petri dish in view.')

    // Input area
    const inputArea = contentEl.createDiv({ cls: 'digest-input-area' })

    this.contextChipsEl = inputArea.createDiv({ cls: 'digest-context-chips digest-hidden' })
    this.statusEl = inputArea.createDiv({ cls: 'digest-status' })
    this.updateStatus()

    const inputRow = inputArea.createDiv({ cls: 'digest-input-row' })

    this.inputEl = inputRow.createDiv({
      cls: 'digest-input',
      attr: {
        contenteditable: 'true',
        'data-placeholder': 'Ask for a writing session, draft, or vault thread... (@ to mention files)',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    })
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.sendMessage()
      } else if (e.key === 'Backspace' && this.getInputText() === '' && this.attachedFiles.length > 0) {
        e.preventDefault()
        this.attachedFiles.pop()
        this.renderContextChips()
      }
    })

    this.mentionSuggest = new MentionSuggest(this.app, this.inputEl, file => this.attachFile(file))

    const btnGroup = inputRow.createDiv({ cls: 'digest-btn-group' })

    this.sendBtn = btnGroup.createEl('button', {
      cls: 'digest-send-btn clickable-icon',
      attr: { 'aria-label': 'Send' },
    })
    setIcon(this.sendBtn, 'arrow-up')
    this.sendBtn.addEventListener('click', () => this.sendMessage())

    this.stopBtn = btnGroup.createEl('button', {
      cls: 'digest-stop-btn clickable-icon digest-hidden',
      attr: { 'aria-label': 'Stop' },
    })
    setIcon(this.stopBtn, 'square')
    this.stopBtn.addEventListener('click', () => {
      this.agent?.abort()
      this.finishProcessing()
    })
  }

  private getInputText(): string {
    return (this.inputEl.textContent || '').trim()
  }

  private clearInput(): void {
    this.inputEl.textContent = ''
  }

  private setInputDisabled(disabled: boolean): void {
    this.inputEl.contentEditable = disabled ? 'false' : 'true'
    this.inputEl.toggleClass('digest-input-disabled', disabled)
  }

  private initSelectionTracker(): void {
    this.selectionTracker = new SelectionTracker(this.app)
    this.selectionTracker.onChange(() => this.renderContextChips())
  }

  private attachFile(file: TFile): void {
    if (!this.attachedFiles.some(attached => attached.path === file.path)) {
      this.attachedFiles.push(file)
      this.renderContextChips()
    }
  }

  private renderContextChips(): void {
    this.contextChipsEl.empty()

    const selection = this.selectionTracker?.getSelection()
    if (!selection && this.attachedFiles.length === 0) {
      this.contextChipsEl.addClass('digest-hidden')
      return
    }

    this.contextChipsEl.removeClass('digest-hidden')

    if (selection) {
      const chip = this.contextChipsEl.createDiv({ cls: 'digest-context-chip' })
      const basename = selection.filePath.split('/').pop()?.replace(/\.md$/, '') || selection.filePath
      chip.createSpan({
        cls: 'digest-context-chip-label',
        text: `${selection.lineCount} line${selection.lineCount > 1 ? 's' : ''} from "${basename}"`,
      })
      const dismiss = chip.createEl('button', {
        cls: 'digest-context-chip-dismiss',
        text: '\u00d7',
        attr: { 'aria-label': 'Remove selected text context' },
      })
      dismiss.addEventListener('click', () => {
        this.selectionTracker.dismiss()
        this.renderContextChips()
      })
    }

    for (const file of this.attachedFiles) {
      const chip = this.contextChipsEl.createDiv({ cls: 'digest-context-chip' })
      chip.createSpan({
        cls: 'digest-context-chip-label',
        text: `@${file.basename}`,
        attr: { title: file.path },
      })
      const dismiss = chip.createEl('button', {
        cls: 'digest-context-chip-dismiss',
        text: '\u00d7',
        attr: { 'aria-label': `Remove ${file.basename}` },
      })
      dismiss.addEventListener('click', () => {
        this.attachedFiles = this.attachedFiles.filter(attached => attached.path !== file.path)
        this.renderContextChips()
        this.inputEl.focus()
      })
    }
  }

  // ── Agent Initialization ────────────────────────────────────────

  async initAgent(showSetupMessages = true): Promise<void> {
    const settings = this.plugin.settings
    const model = settings.model.trim()

    if (!model) {
      this.agent = null
      this.updateStatus()
      if (showSetupMessages) {
        this.showSystemMessage('Configure a model in Digest settings to get started.')
      }
      return
    }

    const adapter = this.app.vault.adapter
    if (!(adapter instanceof FileSystemAdapter)) {
      this.showSystemMessage('Digest requires a local vault (not a sync-only vault).')
      return
    }
    const vaultPath = adapter.getBasePath()

    // Check enzyme via manager
    const mgr = this.plugin.enzymeManager
    const enzymeInstalled = mgr ? await mgr.isInstalled() : false
    const enzymeInitialized = mgr ? mgr.isInitialized() : false
    const enzymeAvailable = enzymeInstalled && enzymeInitialized
    const petriOverview = enzymeAvailable && mgr
      ? await mgr.getPetriOverview(20)
      : undefined

    const systemPrompt: SystemPromptBlock[] = [
      {
        text: [
          'You are a writing and thinking agent for an Obsidian vault, not a generic assistant.',
          'Assume the vault is where the user does their best thinking; help them create, extend, and refine writing there.',
          'Use Enzyme and the Petri dish to notice recent or recurring ideas, especially Linny Veal-related themes if they appear in the vault context.',
          'Prefer concrete writing exercises, outlines, questions, and draftable paragraphs over open-ended conversation.',
          'When a timed writing exercise would help, use StartWritingSession and save enough handoff context for the next return.',
          'When starting a writing session, usually include a paste-ready music_generation_prompt for an AI music generator. Make it richly aesthetic and specific to the writing prompt, not a generic mood prompt.',
          buildMusicTasteInstruction(),
          'When using VaultSearch results, cite the notes you rely on with their provided Obsidian links.',
          'When quoting evidence, render short excerpts as Markdown blockquotes immediately after the linked note.',
          'Use tight paraphrases only when a quote would be noisy or repetitive.',
          'Keep links attached to the relevant point, not collected at the end.',
          petriOverview
            ? `Private recurring vault themes from Enzyme Petri. Use as taste and direction, not as a list to recite:\n${petriOverview}`
            : '',
        ].join(' '),
        cache: true,
      },
    ]

    const provider = createOpenAIProvider({
      baseURL: settings.baseURL || 'https://openrouter.ai/api/v1',
      model,
      maxTokens: DEFAULT_MAX_TOKENS,
      apiKey: settings.apiKey,
    })

    const vaultSearchTool = enzymeAvailable ? createObsidianVaultSearchTool(vaultPath) : null
    if (vaultSearchTool) {
      delete vaultSearchTool.definition.parameters.limit
    }

    const tools = [
      ...(vaultSearchTool ? [vaultSearchTool] : []),
      createObsidianReadFileTool(this.app),
      createObsidianWriteFileTool(this.app),
      this.createSpotifyMusicTool(),
      this.createWritingSessionTool(petriOverview),
    ]

    this.agent = new Agent({
      systemPrompt,
      tools,
      provider,
      context: {
        maxTokens: DEFAULT_MAX_CONTEXT,
        compactThreshold: 0.70,
        keepRecentToolResults: 2,
      },
      ...(enzymeAvailable && { prefetch: createEnzymePrefetch(vaultPath) }),
    })

    this.subscribeToEvents()

    // Pre-warm KV cache
    if (provider.warmup) provider.warmup(systemPrompt, [])

    this.updateStatus()

    if (showSetupMessages && !enzymeInstalled) {
      this.showSystemMessage(
        'Enzyme not found. Install from Settings \u2192 Digest for semantic search. ' +
        'ReadFile and WriteFile still work without it.'
      )
    } else if (showSetupMessages && !enzymeInitialized) {
      this.showEnzymeInitBanner()
    }
  }

  private async toggleVoice(): Promise<void> {
    if (this.voiceSession?.isActive()) {
      this.voiceSession.stop()
      this.voiceSession = null
      this.voiceStatus = ''
      this.updateVoiceButton(false)
      this.updateStatus()
      return
    }

    const settings = this.plugin.settings
    const apiKey = settings.realtimeApiKey.trim()
    if (!apiKey) {
      new Notice('Add an OpenAI Realtime API key in Digest settings to use voice.')
      return
    }

    const adapter = this.app.vault.adapter
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice('Digest voice requires a local vault.')
      return
    }

    const mgr = this.plugin.enzymeManager
    const enzymeAvailable = Boolean(mgr && await mgr.isInstalled() && mgr.isInitialized())
    const vaultSearchTool = enzymeAvailable
      ? createObsidianVaultSearchTool(adapter.getBasePath())
      : null
    const petriOverview = enzymeAvailable && mgr
      ? await mgr.getPetriOverview(20)
      : undefined
    const latestSessionContext = await this.loadRecentWritingSessionContext()
    const petriTopicCount = petriOverview
      ? petriOverview.split('\n').filter(line => line.trim().startsWith('- ')).length
      : 0
    if (vaultSearchTool) {
      delete vaultSearchTool.definition.parameters.limit
    }

    const systemPrompt: SystemPromptBlock[] = [
      {
        text: [
          'You can use Enzyme VaultSearch to ground the conversation in the user\'s vault.',
          'For voice mode, never cite sources by default.',
          'Do not read note links, paths, similarity scores, or evidence labels aloud.',
          'Use search results privately and answer as a short spoken thought.',
          'Your purpose is to create space for the user to write in Obsidian. Do not keep a generic voice conversation running when a writing exercise would be better.',
          'When the user is ready to explore an idea, compose a focused writing session with StartWritingSession, choose a useful music query when Spotify is connected, and then let the session timer take over.',
          'When starting a writing session, usually include a detailed music_generation_prompt for an AI music generator so the saved note can be copied into a music tool later.',
          buildMusicTasteInstruction(),
          petriOverview
            ? `The following are private recurring vault themes. They are not note titles. Use them to notice what seems alive, suggest useful directions, and decide when VaultSearch is useful:\n${petriOverview}`
            : '',
          latestSessionContext
            ? `The latest saved writing-session handoff is private continuity context:\n${latestSessionContext}`
            : '',
          this.pendingSessionContext
            ? `The just-ended writing session left this private handoff context:\n${this.pendingSessionContext}`
            : '',
        ].join(' '),
        cache: true,
      },
    ]

    this.voiceSession = new VoiceSession({
      apiKey,
      model: settings.realtimeModel.trim() || 'gpt-realtime-2',
      voice: settings.realtimeVoice.trim() || 'marin',
      systemPrompt,
      startupContext: [
        petriOverview ? `Private recurring vault themes (${petriTopicCount} loaded):\n${petriOverview}` : '',
        latestSessionContext ? `Latest writing-session handoff:\n${latestSessionContext}` : '',
        this.pendingSessionContext ? `Just-ended writing-session handoff:\n${this.pendingSessionContext}` : '',
      ].filter(Boolean).join('\n\n') || undefined,
      tools: [
        ...(vaultSearchTool ? [vaultSearchTool] : []),
        this.createSpotifyMusicTool(),
        this.createWritingSessionTool(petriOverview),
      ],
      onStatus: status => {
        this.voiceStatus = status
        this.updateStatus()
      },
      onTranscript: (role, text) => {
        if (role === 'user') this.addUserMessage(text)
        else this.addAssistantMessage(text)
      },
      onToolStart: (name, rawArgs) => {
        const args = parseToolArgs(rawArgs)
        const id = this.addToolCallSection(`voice_${Date.now()}_${Math.random().toString(36).slice(2)}`, name, args)
        this.activeVoiceToolIds.push(id)
      },
      onToolEnd: (name, result) => {
        const id = this.activeVoiceToolIds.shift()
        if (id) {
          this.updateToolCallSection(id, name, { content: result, isError: false })
          if (name === 'VaultSearch') {
            const sourcePath = this.app.workspace.getActiveFile()?.path ?? ''
            this.graphHighlighter.highlightVaultSearchResultLinks(result, sourcePath)
          }
        }
      },
      onError: error => {
        this.showError(error)
        this.voiceStatus = ''
        this.updateVoiceButton(false)
        this.updateStatus()
      },
    })

    try {
      await this.voiceSession.start()
      this.updateVoiceButton(true)
      this.showSystemMessage('Voice started.')
    } catch {
      this.voiceSession = null
      this.updateVoiceButton(false)
      this.voiceStatus = ''
      this.updateStatus()
    }
  }

  private updateVoiceButton(active: boolean): void {
    if (!this.voiceBtn) return
    this.voiceBtn.empty()
    this.voiceBtn.setAttr('aria-label', active ? 'Stop voice' : 'Start voice')
    setIcon(this.voiceBtn, active ? 'mic-off' : 'mic')
    this.voiceBtn.toggleClass('digest-voice-active', active)
  }

  private createSpotifyMusicTool(): Tool {
    return {
      definition: {
        name: 'PlayWritingMusic',
        description: [
          'Search Spotify and start one specific track for a writing session.',
          'Use this only after forming a tasteful music choice from the vault themes and writing prompt.',
          'The query should usually include an artist and track title, or at least a distinctive artist/album.',
          'Do not send generic mood or utility searches like "ambient writing music", "focus music", "lofi", "instrumental", or "calm piano".',
        ].join(' '),
        parameters: {
          query: {
            type: 'string',
            description: 'Specific Spotify query, preferably "artist track" or "artist album". Avoid generic mood/genre searches.',
          },
        },
        required: ['query'],
      },
      execute: async args => {
        const query = String(args.query || '').trim()
        if (!query) return { content: 'Missing Spotify search query.', isError: true }
        const spotify = new SpotifyClient(this.plugin.settings, () => this.plugin.saveSettings())
        if (!spotify.isConnected()) {
          return { content: 'Spotify is not connected. Connect it in Digest settings first.', isError: true }
        }

        try {
          const track = await spotify.searchAndPlay(query)
          return {
            content: `Playing "${track.name}" by ${track.artists.join(', ')} for query "${query}".`,
            isError: false,
          }
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          }
        }
      },
    }
  }

  private createWritingSessionTool(petriOverview?: string): Tool {
    return {
      definition: {
        name: 'StartWritingSession',
        description: [
          'Create a timed Obsidian writing exercise, save its prompt and handoff context as a markdown note,',
          'optionally start Spotify music, include a detailed AI music generation prompt, disconnect voice to avoid empty token use, and re-trigger voice when the timer ends.',
        ].join(' '),
        parameters: {
          title: {
            type: 'string',
            description: 'Short title for the writing exercise.',
          },
          prompt: {
            type: 'string',
            description: 'The concrete writing prompt the user should write into Obsidian.',
          },
          music_generation_prompt: {
            type: 'string',
            description: [
              'Optional detailed prompt for an AI music generator.',
              'Write this as a paste-ready music generation prompt that evokes the writing prompt aesthetically.',
              'Include instrumentation, genre lineage, tempo/energy, texture, room/production feel, emotional contour, and what to avoid.',
            ].join(' '),
          },
          duration_minutes: {
            type: 'number',
            description: 'Timer length in minutes. Use the user preference unless they ask for another length.',
          },
          spotify_query: {
            type: 'string',
            description: 'Optional specific Spotify query to start at the beginning. Prefer artist plus track; avoid generic mood searches.',
          },
          ending_spotify_query: {
            type: 'string',
            description: 'Optional specific Spotify query to play when the timer ends. Prefer artist plus track; avoid generic mood searches.',
          },
          handoff_context: {
            type: 'string',
            description: 'Private continuity context the agent should load when it returns after the timer.',
          },
        },
        required: ['title', 'prompt'],
      },
      execute: async args => {
        const title = String(args.title || 'Writing session').trim()
        const prompt = String(args.prompt || '').trim()
        if (!prompt) return { content: 'A writing prompt is required.', isError: true }

        const defaultMinutes = this.plugin.settings.writingSessionMinutes || 25
        const requestedMinutes = Number(args.duration_minutes || defaultMinutes)
        const durationMinutes = Number.isFinite(requestedMinutes)
          ? Math.max(1, Math.min(180, Math.round(requestedMinutes)))
          : defaultMinutes
        const spotifyQuery = String(args.spotify_query || '').trim()
        const endingSpotifyQuery = String(args.ending_spotify_query || '').trim()
        const musicGenerationPrompt = String(args.music_generation_prompt || '').trim()
        const handoffContext = String(args.handoff_context || '').trim()

        try {
          let startedTrack = ''
          const spotify = new SpotifyClient(this.plugin.settings, () => this.plugin.saveSettings())
          if (spotifyQuery && spotify.isConnected()) {
            const track = await spotify.searchAndPlay(spotifyQuery)
            startedTrack = `"${track.name}" by ${track.artists.join(', ')}`
          }

          const notePath = await this.saveWritingSessionNote({
            title,
            prompt,
            durationMinutes,
            spotifyQuery,
            endingSpotifyQuery,
            musicGenerationPrompt,
            handoffContext,
          })

          this.pendingSessionContext = [
            `Session: ${title}`,
            `Prompt: ${prompt}`,
            handoffContext ? `Handoff: ${handoffContext}` : '',
            `Saved note: ${notePath}`,
          ].filter(Boolean).join('\n')

          this.armWritingSessionTimer(durationMinutes, title, endingSpotifyQuery)

          window.setTimeout(() => {
            this.voiceSession?.stop()
            this.voiceSession = null
            this.voiceStatus = ''
            this.updateVoiceButton(false)
            this.updateStatus()
          }, 1200)

          return {
            content: [
              `Started a ${durationMinutes}-minute writing session: ${title}.`,
              `Saved context to ${notePath}.`,
              startedTrack ? `Music: ${startedTrack}.` : '',
              'Voice will disconnect now and return when the timer ends.',
            ].filter(Boolean).join('\n'),
            isError: false,
          }
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          }
        }
      },
    }
  }

  // ── Agent Event Handling ────────────────────────────────────────

  private subscribeToEvents(): void {
    if (!this.agent) return

    this.agent.on(event => {
      switch (event.type) {
        case 'agent_start':
          this.isProcessing = true
          this.sendBtn.addClass('digest-hidden')
          this.stopBtn.removeClass('digest-hidden')
          this.setInputDisabled(true)
          this.showThinkingIndicator()
          break

        case 'text_delta':
          this.hideThinkingIndicator()
          this.appendStreamingText(event.text)
          break

        case 'tool_call_start':
          this.hideThinkingIndicator()
          // Finalize any pending streaming text so tool calls appear below it
          this.finalizeStreaming()
          this.addToolCallSection(event.id, event.name, event.args)
          break

        case 'tool_call_end':
          this.updateToolCallSection(event.id, event.name, event.result)
          if (event.name === 'VaultSearch' && !event.result.isError) {
            const sourcePath = this.app.workspace.getActiveFile()?.path ?? ''
            this.graphHighlighter.highlightVaultSearchResultLinks(event.result.content, sourcePath)
          }
          // Show thinking while waiting for synthesis turn
          this.showThinkingIndicator()
          break

        case 'turn_end':
          if (event.usage) {
            this.sessionTokens.input += event.usage.inputTokens
            this.sessionTokens.output += event.usage.outputTokens
            this.sessionTokens.cacheRead += event.usage.cacheReadTokens || 0
          }
          this.updateStatus()
          break

        case 'agent_end':
          this.hideThinkingIndicator()
          this.finalizeStreaming()
          this.finishProcessing()
          this.spawnEnzymeRefresh()
          break

        case 'error':
          this.hideThinkingIndicator()
          this.finalizeStreaming()
          this.showError(event.error)
          this.finishProcessing()
          break
      }
    })
  }

  private finishProcessing(): void {
    this.isProcessing = false
    this.sendBtn.removeClass('digest-hidden')
    this.stopBtn.addClass('digest-hidden')
    this.setInputDisabled(false)
    this.inputEl.focus()
    this.updateStatus()
  }

  // ── Message Sending ─────────────────────────────────────────────

  private async sendMessage(): Promise<void> {
    const text = this.getInputText()
    if ((!text && this.attachedFiles.length === 0) || this.isProcessing) return

    if (!this.agent) {
      new Notice('Configure a model in Digest settings first')
      return
    }

    this.graphHighlighter.clear()

    const attachedFiles = [...this.attachedFiles]
    this.clearInput()
    this.attachedFiles = []
    this.renderContextChips()

    const attachedNames = attachedFiles.map(file => `@${file.basename}`).join(', ')
    const displayText = attachedNames
      ? [text, `Attached: ${attachedNames}`].filter(Boolean).join('\n\n')
      : text
    this.addUserMessage(displayText)

    // Build context-augmented prompt
    const contextParts: string[] = []

    // Selection context
    const selection = this.selectionTracker?.getSelection()
    if (selection) {
      const selText = selection.text.length > 2000
        ? selection.text.slice(0, 2000) + '\n[Truncated]'
        : selection.text
      const basename = selection.filePath.split('/').pop()?.replace(/\.md$/, '') || selection.filePath
      contextParts.push(`[Selected text from "${basename}" (${selection.filePath})]\n${selText}`)
    }

    let prompt = text
    if (attachedFiles.length > 0) {
      const fileSections: string[] = []
      let totalChars = 0
      const MAX_PER_FILE = 4000
      const MAX_TOTAL = 12000

      for (const file of attachedFiles) {
        if (totalChars >= MAX_TOTAL) break
        try {
          let content = await this.app.vault.read(file)
          if (content.length > MAX_PER_FILE) {
            content = content.slice(0, MAX_PER_FILE) + `\n\n[Truncated — ${content.length} chars total]`
          }
          fileSections.push(`## ${file.path}\n${content}`)
          totalChars += content.length
        } catch { /* skip unreadable files */ }
      }

      if (fileSections.length > 0) {
        prompt = `[Attached files]\n\n${fileSections.join('\n\n')}\n\n[User message]\n${text || '(No message provided)'}`
      }
    }

    // Prepend context if we have any
    if (contextParts.length > 0) {
      prompt = contextParts.join('\n\n') + '\n\n' + prompt
    }

    try {
      await this.agent.prompt(prompt)
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err))
      this.finishProcessing()
    }
  }

  // ── Message Rendering ───────────────────────────────────────────

  private addUserMessage(text: string): void {
    const msg = this.messagesEl.createDiv({ cls: 'digest-message digest-user' })
    const bubble = msg.createDiv({ cls: 'digest-message-content' })
    bubble.setText(text)
    this.scrollToBottom()
  }

  private addAssistantMessage(text: string): void {
    const msg = this.messagesEl.createDiv({ cls: 'digest-message digest-assistant' })
    const bubble = msg.createDiv({ cls: 'digest-message-content' })
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? ''
    MarkdownRenderer.render(this.app, text, bubble, sourcePath, this.plugin)
    this.scrollToBottom()
  }

  private appendStreamingText(text: string): void {
    if (!this.currentStreamingEl) {
      const msg = this.messagesEl.createDiv({ cls: 'digest-message digest-assistant' })
      this.currentStreamingEl = msg.createDiv({ cls: 'digest-message-content' })
      this.currentStreamingText = ''
    }

    this.currentStreamingText += text
    this.scheduleRender()
  }

  /**
   * Debounced markdown render during streaming.
   * Re-renders at most every 100ms to avoid DOM thrashing while still
   * giving live markdown preview (headings, bold, links, code blocks).
   */
  private scheduleRender(): void {
    if (this.renderTimer) return
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null
      this.renderCurrentMarkdown()
    }, 100)
  }

  private renderCurrentMarkdown(): void {
    if (!this.currentStreamingEl || !this.currentStreamingText) return
    const el = this.currentStreamingEl
    const text = this.currentStreamingText
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? ''

    el.empty()
    MarkdownRenderer.render(this.app, text, el, sourcePath, this.plugin)
    this.scrollToBottom()
  }

  private finalizeStreaming(): void {
    // Clear any pending debounced render
    if (this.renderTimer) {
      clearTimeout(this.renderTimer)
      this.renderTimer = null
    }

    if (!this.currentStreamingEl || !this.currentStreamingText) {
      this.currentStreamingEl = null
      this.currentStreamingText = ''
      return
    }

    // Final render with complete text
    this.renderCurrentMarkdown()

    this.currentStreamingEl = null
    this.currentStreamingText = ''
  }

  private showMessageContextMenu(e: MouseEvent): void {
    const target = e.target as HTMLElement
    const block = target.closest('.digest-message-content, .digest-tool-body') as HTMLElement | null
    if (!block) return

    const text = (block.innerText || block.textContent || '').trim()
    if (!text) return

    e.preventDefault()
    const menu = new Menu()
    menu.addItem(item => {
      item
        .setTitle('Copy')
        .setIcon('copy')
        .onClick(() => {
          this.copyText(text)
        })
    })
    menu.showAtMouseEvent(e)
  }

  private async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      try {
        const { clipboard } = require('electron')
        clipboard.writeText(text)
      } catch {
        console.error('Failed to copy Digest block text:', err)
      }
    }
  }

  // ── Tool Call Sections ──────────────────────────────────────────

  private addToolCallSection(id: string, name: string, args: Record<string, unknown>): string {
    const section = this.messagesEl.createDiv({
      cls: 'digest-tool-call',
      attr: { 'data-tool-id': id },
    })

    const header = section.createDiv({ cls: 'digest-tool-header' })

    const statusIcon = header.createSpan({ cls: 'digest-tool-status' })
    setIcon(statusIcon, 'loader-2')
    statusIcon.addClass('digest-spinning')

    header.createSpan({ cls: 'digest-tool-name', text: name })

    const query = (args.query as string) || (args.path as string) || ''
    if (query) {
      header.createSpan({
        cls: 'digest-tool-query',
        text: query.length > 60 ? query.slice(0, 60) + '...' : query,
      })
    }

    this.scrollToBottom()
    return id
  }

  private updateToolCallSection(id: string, name: string, result: ToolResult): void {
    const section = this.messagesEl.querySelector(
      `[data-tool-id="${id}"]`
    ) as HTMLElement | null
    if (!section) return

    const statusIcon = section.querySelector('.digest-tool-status') as HTMLElement | null
    if (statusIcon) {
      statusIcon.empty()
      statusIcon.removeClass('digest-spinning')
      if (result.isError) {
        setIcon(statusIcon, 'x-circle')
        statusIcon.addClass('digest-tool-error')
      } else {
        setIcon(statusIcon, 'check-circle')
        statusIcon.addClass('digest-tool-success')
      }
    }

    // Add token count to header
    const header = section.querySelector('.digest-tool-header') as HTMLElement | null
    if (header && !result.isError) {
      const tokens = Math.ceil(result.content.length / 3.5)
      header.createSpan({ cls: 'digest-tool-tokens', text: `${tokens} tok` })
    }

    // Add collapsible body
    const body = section.createDiv({ cls: 'digest-tool-body digest-collapsed' })
    const preview = result.content.slice(0, 300).replace(/\n/g, ' ')
    body.setText(result.isError
      ? result.content
      : `${preview}${result.content.length > 300 ? '...' : ''}`)

    // Toggle body on header click
    const clickHeader = section.querySelector('.digest-tool-header')
    if (clickHeader) {
      clickHeader.addEventListener('click', () => {
        body.toggleClass('digest-collapsed', !body.hasClass('digest-collapsed'))
      })
    }
  }

  // ── Thinking Indicator ──────────────────────────────────────────

  private showThinkingIndicator(): void {
    if (this.messagesEl.querySelector('.digest-thinking')) return
    const indicator = this.messagesEl.createDiv({ cls: 'digest-thinking' })
    for (let i = 0; i < 3; i++) {
      indicator.createSpan({ cls: 'digest-dot' })
    }
    this.scrollToBottom()
  }

  private hideThinkingIndicator(): void {
    this.messagesEl.querySelector('.digest-thinking')?.remove()
  }

  // ── System / Error Messages ─────────────────────────────────────

  private showSystemMessage(text: string): void {
    const msg = this.messagesEl.createDiv({ cls: 'digest-message digest-system' })
    msg.createDiv({ cls: 'digest-message-content', text })
  }

  private showError(text: string): void {
    const msg = this.messagesEl.createDiv({ cls: 'digest-message digest-error' })
    msg.createDiv({ cls: 'digest-message-content', text: `Error: ${text}` })
    this.scrollToBottom()
  }

  // ── Conversation Management ─────────────────────────────────────

  clearConversation(): void {
    this.agent?.abort()
    this.voiceSession?.stop()
    if (this.writingSessionTimer) {
      window.clearTimeout(this.writingSessionTimer)
      this.writingSessionTimer = null
    }
    this.voiceSession = null
    this.isProcessing = false
    this.currentStreamingEl = null
    this.currentStreamingText = ''
    this.sessionTokens = { input: 0, output: 0, cacheRead: 0 }
    this.voiceStatus = ''
    this.activeVoiceToolIds = []
    this.updateVoiceButton(false)
    this.graphHighlighter.clear()
    this.messagesEl.empty()
    this.finishProcessing()
    this.showSystemMessage('New conversation started.')
    this.initAgent()
  }

  async reloadAgentFromSettings(): Promise<void> {
    if (this.isProcessing) return
    this.agent?.abort()
    this.agent = null
    await this.initAgent(false)
  }

  private armWritingSessionTimer(durationMinutes: number, title: string, endingSpotifyQuery: string): void {
    if (this.writingSessionTimer) window.clearTimeout(this.writingSessionTimer)
    this.showSystemMessage(`Writing session started: ${title} (${durationMinutes} min). Voice will return when the timer ends.`)
    this.writingSessionTimer = window.setTimeout(() => {
      this.writingSessionTimer = null
      void this.finishWritingSession(title, endingSpotifyQuery)
    }, durationMinutes * 60_000)
  }

  private async finishWritingSession(title: string, endingSpotifyQuery: string): Promise<void> {
    if (endingSpotifyQuery) {
      const spotify = new SpotifyClient(this.plugin.settings, () => this.plugin.saveSettings())
      if (spotify.isConnected()) {
        try {
          await spotify.searchAndPlay(endingSpotifyQuery)
        } catch (err) {
          console.warn(`Failed to play writing-session ending music: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    new Notice(`Writing session complete: ${title}`)
    this.showSystemMessage(`Writing session complete: ${title}. Voice is reconnecting with the saved handoff context.`)

    if (!this.voiceSession?.isActive() && this.plugin.settings.realtimeApiKey.trim()) {
      await this.toggleVoice()
    }
  }

  private async saveWritingSessionNote(input: {
    title: string
    prompt: string
    durationMinutes: number
    spotifyQuery: string
    endingSpotifyQuery: string
    musicGenerationPrompt: string
    handoffContext: string
  }): Promise<string> {
    if (!this.app.vault.getAbstractFileByPath(WRITING_SESSION_FOLDER)) {
      await this.app.vault.createFolder(WRITING_SESSION_FOLDER)
    }

    const now = new Date()
    const stamp = formatSessionTimestamp(now)
    const filename = `${stamp} ${sanitizeFilename(input.title)}.md`
    let path = `${WRITING_SESSION_FOLDER}/${filename}`
    let suffix = 2
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${WRITING_SESSION_FOLDER}/${filename.replace(/\.md$/i, `-${suffix}.md`)}`
      suffix += 1
    }
    const contentParts = [
      '---',
      `created: ${now.toISOString()}`,
      `duration_minutes: ${input.durationMinutes}`,
      input.spotifyQuery ? `spotify_query: ${JSON.stringify(input.spotifyQuery)}` : '',
      input.endingSpotifyQuery ? `ending_spotify_query: ${JSON.stringify(input.endingSpotifyQuery)}` : '',
      '---',
      '',
      `# ${input.title}`,
      '',
      '## Prompt',
      input.prompt,
      '',
      input.musicGenerationPrompt ? '## AI Music Prompt' : '',
      input.musicGenerationPrompt ? input.musicGenerationPrompt : '',
      input.musicGenerationPrompt ? '' : '',
      '## Handoff Context',
      input.handoffContext || 'No handoff context supplied.',
      '',
      '## Writing',
      '',
    ]
    const content = contentParts
      .filter((line, index) => line !== '' || contentParts[index - 1] !== '')
      .join('\n')

    await this.app.vault.create(path, content)
    return path
  }

  private async loadRecentWritingSessionContext(): Promise<string> {
    const sessions = this.app.vault.getMarkdownFiles()
      .filter(file => file.path.startsWith(`${WRITING_SESSION_FOLDER}/`))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
    const latest = sessions[0]
    if (!latest) return ''

    try {
      const content = await this.app.vault.cachedRead(latest)
      return content.slice(0, 2500)
    } catch {
      return ''
    }
  }

  // ── Status Bar ──────────────────────────────────────────────────

  private updateStatus(): void {
    if (!this.statusEl) return
    const settings = this.plugin.settings
    const model = settings.model || 'no model'
    const total = this.sessionTokens.input + this.sessionTokens.output
    const cached = this.sessionTokens.cacheRead
    let status = model
    if (total > 0) {
      status += ` \u00b7 ${total} tokens`
      if (cached > 0) status += ` (${cached} cached)`
    }
    if (this.voiceStatus) status += ` \u00b7 ${this.voiceStatus}`
    this.statusEl.setText(status)
  }

  // ── Enzyme Helpers ──────────────────────────────────────────────

  private async spawnEnzymeRefresh(): Promise<void> {
    const mgr = this.plugin.enzymeManager
    if (!mgr) return
    if (!mgr.isInitialized() || !(await mgr.isInstalled())) return

    const settings = this.plugin.settings
    if (mgr.isLoggedIn()) {
      mgr.spawnBackgroundRefresh()
      return
    }

    if (settings.enzymeApiKey && settings.enzymeBaseURL && settings.enzymeModel) {
      mgr.spawnBackgroundRefresh({
        OPENAI_API_KEY: settings.enzymeApiKey,
        OPENAI_BASE_URL: settings.enzymeBaseURL,
        OPENAI_MODEL: settings.enzymeModel,
      })
      return
    }

    if (process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL && process.env.OPENAI_MODEL) {
      mgr.spawnBackgroundRefresh()
    }
  }

  private showEnzymeInitBanner(): void {
    const banner = this.messagesEl.createDiv({ cls: 'digest-enzyme-banner' })
    const mgr = this.plugin.enzymeManager
    const loggedIn = mgr?.isLoggedIn() ?? false
    banner.createSpan({
      text: loggedIn
        ? 'Enzyme is not initialized for this vault.'
        : 'Sign in to Enzyme from Digest settings before initializing this vault.',
    })
    const btn = banner.createEl('button', {
      cls: 'digest-enzyme-init-btn',
      text: loggedIn ? 'Initialize' : 'Open settings',
    })
    btn.addEventListener('click', async () => {
      const mgr = this.plugin.enzymeManager
      if (!mgr) return
      if (!mgr.isLoggedIn()) {
        const setting = (this.app as any).setting
        setting?.open?.()
        setting?.openTabById?.(this.plugin.manifest.id)
        return
      }
      btn.disabled = true
      btn.setText('Initializing...')
      try {
        await mgr.init(event => {
          btn.setText(event.message || event.stage || 'Initializing...')
        })
        banner.remove()
        new Notice('Vault initialized')
        this.clearConversation()
      } catch (err) {
        btn.disabled = false
        btn.setText('Initialize')
        new Notice(`Init failed: ${err instanceof Error ? err.message : err}`)
      }
    })
  }

  // ── Utilities ───────────────────────────────────────────────────

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight
    })
  }
}

function parseToolArgs(rawArgs: string): Record<string, unknown> {
  if (!rawArgs) return {}
  try {
    const parsed = JSON.parse(rawArgs)
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return { query: rawArgs }
  }
}

function buildMusicTasteInstruction(): string {
  return [
    'Music selection is part of your taste, not a generic productivity feature.',
    'Pick a concrete recording that creates a useful intellectual weather for the session.',
    'Prefer specific artists/tracks/albums with texture: minimalism, ECM, ambient, kosmische, dub techno, spiritual jazz, post-rock, field recordings, or quiet electronic music can work when apt.',
    'Examples of query specificity: "Brian Eno An Ending Ascent", "Nils Frahm Says", "Alice Coltrane Journey in Satchidananda", "Stars of the Lid Requiem for Dying Mothers", "Hiroshi Yoshimura Green".',
    'Avoid generic searches like "focus music", "ambient writing music", "lofi beats", "calm piano", "deep work playlist", or "instrumental study music".',
    'If you cannot make a tasteful specific choice, skip music rather than choosing filler.',
  ].join(' ')
}

function formatSessionTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('-')
}

function sanitizeFilename(value: string): string {
  const clean = value
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return (clean || 'Writing session').slice(0, 80)
}
