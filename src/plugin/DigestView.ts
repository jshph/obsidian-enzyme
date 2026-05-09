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
import type DigestPlugin from './DigestPlugin.js'

export const VIEW_TYPE_DIGEST = 'digest-chat-view'
const DEFAULT_MAX_CONTEXT = 32768
const DEFAULT_MAX_TOKENS = 2048

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
    this.showSystemMessage('Ask anything about your vault. Digest uses Enzyme for semantic search and context prefetch.')

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
        'data-placeholder': 'Ask about your vault... (@ to mention files)',
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

    const systemPrompt: SystemPromptBlock[] = [
      {
        text: [
          'When using VaultSearch results, cite the notes you rely on with their provided Obsidian links.',
          'When quoting evidence, render short excerpts as Markdown blockquotes immediately after the linked note.',
          'Use tight paraphrases only when a quote would be noisy or repetitive.',
          'Keep links attached to the relevant point, not collected at the end.',
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
          'Your posture is hospitality: make the user feel received by their own archive, not coached toward output.',
          'For voice mode, never cite sources by default.',
          'Do not read note links, paths, similarity scores, or evidence labels aloud.',
          'Use search results privately and answer as a short spoken noticing.',
          'Lead with what you found, then notice one small thing: a word choice, a return, a tension, a stopping point.',
          'If the result is conversational or tool-use history, restore the thread: name where they had gotten to, what was decided, or what was still open.',
          'Do not default to writing advice, fiction prompts, publishing ideas, exercises, or productivity framing unless the user explicitly asks for that.',
          'When VaultSearch returns several notes, choose the one to three most relevant notes for the point you are making.',
          'After VaultSearch, call RenderSources with only the selected note links you want visible beside your spoken answer.',
          'The interface renders those clickable sources separately, so keep spoken citations out unless the user asks.',
          petriOverview
            ? `The following are private recurring vault themes. They are not note titles. Use them to notice what seems alive, suggest useful directions, and decide when VaultSearch is useful:\n${petriOverview}`
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
      startupContext: petriOverview
        ? `Private recurring vault themes (${petriTopicCount} loaded):\n${petriOverview}`
        : undefined,
      tools: [
        ...(vaultSearchTool ? [vaultSearchTool] : []),
        this.createVoiceRenderSourcesTool(),
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

  private createVoiceRenderSourcesTool(): Tool {
    return {
      definition: {
        name: 'RenderSources',
        description:
          'Render selected Obsidian note links in the Digest UI as clickable sources. ' +
          'Use after VaultSearch, choosing only the notes that support your spoken response.',
        parameters: {
          sources: {
            type: 'string',
            description:
              'One to three Obsidian wiki links from VaultSearch, separated by newlines. ' +
              'Example: [[Folder/Note|Note]]',
          },
        },
        required: ['sources'],
      },
      execute: async args => {
        const rawSources = Array.isArray(args.sources)
          ? args.sources.join('\n')
          : typeof args.sources === 'string'
            ? args.sources
            : ''
        const rendered = this.renderVoiceSources(rawSources)
        return {
          content: rendered > 0 ? `Rendered ${rendered} source${rendered === 1 ? '' : 's'}.` : 'No valid source links provided.',
          isError: rendered === 0,
        }
      },
    }
  }

  private renderVoiceSources(content: string): number {
    const sources = this.extractVaultSearchSources(content)
    if (sources.length === 0) return 0

    const msg = this.messagesEl.createDiv({ cls: 'digest-message digest-assistant digest-voice-sources' })
    const bubble = msg.createDiv({ cls: 'digest-message-content' })
    const sourcePath = this.app.workspace.getActiveFile()?.path ?? ''
    const sourceList = sources.map(source => `- ${source}`).join('\n')

    MarkdownRenderer.render(this.app, `Sources\n${sourceList}`, bubble, sourcePath, this.plugin)
    this.scrollToBottom()
    return sources.length
  }

  private extractVaultSearchSources(content: string): string[] {
    const seen = new Set<string>()
    const sources: string[] = []
    const linkPattern = /\[\[[^\]]+\]\]/g
    let match: RegExpExecArray | null

    while ((match = linkPattern.exec(content)) !== null) {
      const link = match[0]
      if (seen.has(link)) continue
      seen.add(link)
      sources.push(link)
    }

    return sources
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
