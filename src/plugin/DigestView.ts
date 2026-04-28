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
} from 'obsidian'
import {
  Agent,
  createOpenAIProvider,
  buildSystemPrompt,
  createVaultSearchTool,
  createEnzymePrefetch,
} from '@jshph/digest'
import type { ToolResult } from '@jshph/digest'
import { createObsidianReadFileTool, createObsidianWriteFileTool } from './tools.js'
import type DigestPlugin from './DigestPlugin.js'

export const VIEW_TYPE_DIGEST = 'digest-chat-view'

export class DigestView extends ItemView {
  private plugin: DigestPlugin
  private agent: Agent | null = null

  // DOM
  private messagesEl!: HTMLElement
  private inputEl!: HTMLTextAreaElement
  private sendBtn!: HTMLElement
  private stopBtn!: HTMLElement
  private statusEl!: HTMLElement

  // Streaming state
  private isProcessing = false
  private currentStreamingEl: HTMLElement | null = null
  private currentStreamingText = ''
  private renderTimer: ReturnType<typeof setTimeout> | null = null
  private sessionTokens = { input: 0, output: 0, cacheRead: 0 }

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
    await this.initAgent()
  }

  async onClose(): Promise<void> {
    this.agent?.abort()
    if (this.renderTimer) clearTimeout(this.renderTimer)
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

    // Welcome message
    this.showSystemMessage('Ask anything about your vault. Digest uses Enzyme for semantic search and context prefetch.')

    // Input area
    const inputArea = contentEl.createDiv({ cls: 'digest-input-area' })

    this.statusEl = inputArea.createDiv({ cls: 'digest-status' })
    this.updateStatus()

    const inputRow = inputArea.createDiv({ cls: 'digest-input-row' })

    this.inputEl = inputRow.createEl('textarea', {
      cls: 'digest-input',
      attr: { placeholder: 'Ask about your vault...', rows: '1' },
    })
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.sendMessage()
      }
    })
    this.inputEl.addEventListener('input', () => this.autoGrow())

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

  private autoGrow(): void {
    this.inputEl.style.height = 'auto'
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 150) + 'px'
  }

  // ── Agent Initialization ────────────────────────────────────────

  async initAgent(): Promise<void> {
    const settings = this.plugin.settings

    if (!settings.model) {
      this.showSystemMessage('Configure a model in Digest settings to get started.')
      return
    }

    const adapter = this.app.vault.adapter
    if (!(adapter instanceof FileSystemAdapter)) {
      this.showSystemMessage('Digest requires a local vault (not a sync-only vault).')
      return
    }
    const vaultPath = adapter.getBasePath()

    // Check enzyme availability
    const enzymeAvailable = await this.checkEnzyme()
    let enzymeOverview: string | undefined
    if (enzymeAvailable) {
      enzymeOverview = await this.getEnzymeOverview(vaultPath)
    }

    const systemPrompt = buildSystemPrompt({
      vaultName: this.app.vault.getName(),
      enzymeOverview,
    })

    const provider = createOpenAIProvider({
      baseURL: settings.baseURL || 'https://openrouter.ai/api/v1',
      model: settings.model,
      maxTokens: settings.maxTokens || 2048,
      apiKey: settings.apiKey,
    })

    const tools = [
      ...(enzymeAvailable ? [createVaultSearchTool(vaultPath)] : []),
      createObsidianReadFileTool(this.app),
      createObsidianWriteFileTool(this.app),
    ]

    this.agent = new Agent({
      systemPrompt,
      tools,
      provider,
      context: {
        maxTokens: settings.maxContext || 32768,
        compactThreshold: 0.70,
        keepRecentToolResults: 2,
      },
      ...(enzymeAvailable && { prefetch: createEnzymePrefetch(vaultPath) }),
    })

    this.subscribeToEvents()

    // Pre-warm KV cache
    if (provider.warmup) provider.warmup(systemPrompt, [])

    this.updateStatus()

    if (!enzymeAvailable) {
      this.showSystemMessage(
        'Enzyme not found. Install from enzyme.garden for semantic search. ' +
        'ReadFile and WriteFile still work without it.'
      )
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
          this.inputEl.disabled = true
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
    this.inputEl.disabled = false
    this.inputEl.focus()
    this.updateStatus()
  }

  // ── Message Sending ─────────────────────────────────────────────

  private async sendMessage(): Promise<void> {
    const text = this.inputEl.value.trim()
    if (!text || this.isProcessing) return

    if (!this.agent) {
      new Notice('Configure Digest settings first (API key and model)')
      return
    }

    this.inputEl.value = ''
    this.inputEl.style.height = 'auto'
    this.addUserMessage(text)

    try {
      await this.agent.prompt(text)
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

  // ── Tool Call Sections ──────────────────────────────────────────

  private addToolCallSection(id: string, name: string, args: Record<string, unknown>): void {
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
    this.isProcessing = false
    this.currentStreamingEl = null
    this.currentStreamingText = ''
    this.sessionTokens = { input: 0, output: 0, cacheRead: 0 }
    this.messagesEl.empty()
    this.finishProcessing()
    this.showSystemMessage('New conversation started.')
    this.initAgent()
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
    this.statusEl.setText(status)
  }

  // ── Enzyme Helpers ──────────────────────────────────────────────

  private async checkEnzyme(): Promise<boolean> {
    try {
      const { execFile } = require('child_process')
      const { promisify } = require('util')
      const exec = promisify(execFile)
      await exec('enzyme', ['--version'], { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  private async getEnzymeOverview(vaultPath: string): Promise<string | undefined> {
    try {
      const { execFile } = require('child_process')
      const { promisify } = require('util')
      const exec = promisify(execFile)
      const { stdout } = await exec(
        'enzyme',
        ['petri', '-p', vaultPath, '-n', '20'],
        { timeout: 15000 },
      )
      const petri = JSON.parse(stdout)
      const entities = (petri.entities || []).slice(0, 20)
      if (entities.length === 0) return undefined
      return entities.map((e: any) => {
        const cats = (e.catalysts || []).slice(0, 3).map((c: any) => c.text).join('; ')
        return `- ${e.name}: ${cats}`
      }).join('\n')
    } catch {
      return undefined
    }
  }

  private spawnEnzymeRefresh(): void {
    try {
      const adapter = this.app.vault.adapter
      if (!(adapter instanceof FileSystemAdapter)) return
      const vaultPath = adapter.getBasePath()
      const { spawn } = require('child_process')
      const child = spawn('enzyme', ['refresh', '--quiet', '-p', vaultPath], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          ...(this.plugin.settings.apiKey && { OPENAI_API_KEY: this.plugin.settings.apiKey }),
          ...(this.plugin.settings.baseURL && { OPENAI_BASE_URL: this.plugin.settings.baseURL }),
          ...(this.plugin.settings.model && { OPENAI_MODEL: this.plugin.settings.model }),
        },
      })
      child.unref()
    } catch {
      // Not critical
    }
  }

  // ── Utilities ───────────────────────────────────────────────────

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight
    })
  }
}
