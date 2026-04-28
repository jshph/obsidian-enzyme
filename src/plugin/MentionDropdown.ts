/**
 * MentionDropdown — @ file mention autocomplete for the chat textarea.
 *
 * Custom dropdown (not EditorSuggest — that requires CodeMirror).
 * Triggers on `@` preceded by whitespace or at position 0.
 * Open files appear first, then vault files scored by fuzzy match + mtime.
 */

import { App, TFile, MarkdownView } from 'obsidian'

interface MentionItem {
  file: TFile
  label: string       // display name (basename without .md)
  path: string        // full vault path
  score: number
  isOpen: boolean
}

export class MentionDropdown {
  private app: App
  private inputEl: HTMLTextAreaElement
  private containerEl: HTMLElement
  private dropdownEl: HTMLElement
  private items: MentionItem[] = []
  private selectedIndex = 0
  private visible = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private triggerStart = -1  // position of '@' in textarea

  constructor(app: App, inputEl: HTMLTextAreaElement, containerEl: HTMLElement) {
    this.app = app
    this.inputEl = inputEl
    this.containerEl = containerEl

    this.dropdownEl = containerEl.createDiv({ cls: 'digest-mention-dropdown digest-hidden' })

    this.inputEl.addEventListener('input', this.onInput)
    this.inputEl.addEventListener('keydown', this.onKeydown)
    // Close on blur (with delay so click events on dropdown fire first)
    this.inputEl.addEventListener('blur', () => {
      setTimeout(() => this.hide(), 150)
    })
  }

  isActive(): boolean {
    return this.visible
  }

  /** Parse @mentions from text and resolve to TFile objects. */
  getResolvedMentions(text: string): TFile[] {
    const pattern = /(?:^|\s)@([\w/\-. ]+\.md)(?=\s|$)/g
    const files: TFile[] = []
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const file = this.app.vault.getAbstractFileByPath(match[1])
      if (file instanceof TFile) files.push(file)
    }
    return files
  }

  /** Strip @mentions from text for display. */
  stripMentions(text: string): string {
    return text.replace(/(?:^|\s)@([\w/\-. ]+\.md)(?=\s|$)/g, (m, path) => {
      const basename = path.split('/').pop()?.replace(/\.md$/, '') || path
      return m.replace(`@${path}`, `@${basename}`)
    })
  }

  destroy(): void {
    this.inputEl.removeEventListener('input', this.onInput)
    this.inputEl.removeEventListener('keydown', this.onKeydown)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.dropdownEl.remove()
  }

  // ── Event Handlers ──────────────────────────────────────────────

  private onInput = (): void => {
    const pos = this.inputEl.selectionStart
    const text = this.inputEl.value
    const trigger = this.findTrigger(text, pos)

    if (trigger === null) {
      this.hide()
      return
    }

    this.triggerStart = trigger.start
    const query = trigger.query

    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.search(query)
    }, 200)
  }

  private onKeydown = (e: KeyboardEvent): void => {
    if (!this.visible) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        e.stopPropagation()
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.items.length - 1)
        this.renderSelection()
        break
      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
        this.renderSelection()
        break
      case 'Enter':
      case 'Tab':
        if (this.items.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          this.selectItem(this.items[this.selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        this.hide()
        break
    }
  }

  // ── Trigger Detection ───────────────────────────────────────────

  /** Find @ trigger: must be preceded by whitespace or at pos 0. */
  private findTrigger(text: string, cursorPos: number): { start: number; query: string } | null {
    // Scan backward from cursor to find @
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (text[i] === '@') {
        // Check preceding char: must be whitespace or start of string
        if (i === 0 || /\s/.test(text[i - 1])) {
          const query = text.slice(i + 1, cursorPos)
          // Don't trigger if query contains newlines
          if (query.includes('\n')) return null
          return { start: i, query }
        }
        return null
      }
      // Stop scanning at whitespace (no @ found in this word)
      if (/\s/.test(text[i])) return null
    }
    return null
  }

  // ── Search ──────────────────────────────────────────────────────

  private search(query: string): void {
    const openFiles = this.getOpenFiles()
    const allFiles = this.app.vault.getFiles().filter(f => f.extension === 'md')
    const openPaths = new Set(openFiles.map(f => f.path))
    const queryLower = query.toLowerCase()

    const scored: MentionItem[] = []

    for (const file of allFiles) {
      const label = file.basename
      const matchScore = this.fuzzyScore(label, file.path, queryLower)
      if (query && matchScore <= 0) continue

      scored.push({
        file,
        label,
        path: file.path,
        score: matchScore + (openPaths.has(file.path) ? 1000 : 0),
        isOpen: openPaths.has(file.path),
      })
    }

    scored.sort((a, b) => b.score - a.score)
    this.items = scored.slice(0, 10)
    this.selectedIndex = 0
    this.render()
  }

  private fuzzyScore(name: string, path: string, query: string): number {
    if (!query) return 0
    const nameLower = name.toLowerCase()
    const pathLower = path.toLowerCase()

    // Exact prefix match on name
    if (nameLower.startsWith(query)) return 100
    // Contains in name
    if (nameLower.includes(query)) return 50
    // Contains in path
    if (pathLower.includes(query)) return 25
    // Character-by-character fuzzy on name
    let qi = 0
    for (let i = 0; i < nameLower.length && qi < query.length; i++) {
      if (nameLower[i] === query[qi]) qi++
    }
    if (qi === query.length) return 10
    return 0
  }

  private getOpenFiles(): TFile[] {
    const leaves = this.app.workspace.getLeavesOfType('markdown')
    const files: TFile[] = []
    for (const leaf of leaves) {
      const view = leaf.view
      if (view instanceof MarkdownView && view.file) {
        files.push(view.file)
      }
    }
    return files
  }

  // ── Rendering ───────────────────────────────────────────────────

  private render(): void {
    this.dropdownEl.empty()

    if (this.items.length === 0) {
      this.hide()
      return
    }

    // Group: open files first, then vault
    const openItems = this.items.filter(i => i.isOpen)
    const vaultItems = this.items.filter(i => !i.isOpen)

    if (openItems.length > 0) {
      this.dropdownEl.createDiv({ cls: 'digest-mention-divider', text: 'Open' })
      for (const item of openItems) this.renderItem(item)
    }

    if (vaultItems.length > 0) {
      if (openItems.length > 0) {
        this.dropdownEl.createDiv({ cls: 'digest-mention-divider', text: 'Vault' })
      }
      for (const item of vaultItems) this.renderItem(item)
    }

    this.show()
    this.renderSelection()
  }

  private renderItem(item: MentionItem): void {
    const idx = this.items.indexOf(item)
    const el = this.dropdownEl.createDiv({ cls: 'digest-mention-item' })
    el.dataset.index = String(idx)

    // Show folder path in muted text if file isn't at root
    const parts = item.path.split('/')
    if (parts.length > 1) {
      el.createSpan({
        cls: 'digest-mention-folder',
        text: parts.slice(0, -1).join('/') + '/',
      })
    }
    el.createSpan({ cls: 'digest-mention-name', text: item.label })

    el.addEventListener('mouseenter', () => {
      this.selectedIndex = idx
      this.renderSelection()
    })
    el.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.selectItem(item)
    })
  }

  private renderSelection(): void {
    const items = this.dropdownEl.querySelectorAll('.digest-mention-item')
    items.forEach((el, i) => {
      el.toggleClass('is-selected', i === this.selectedIndex)
    })
  }

  // ── Selection ───────────────────────────────────────────────────

  private selectItem(item: MentionItem): void {
    const text = this.inputEl.value
    const cursorPos = this.inputEl.selectionStart
    // Replace @query with @path/to/file.md
    const before = text.slice(0, this.triggerStart)
    const after = text.slice(cursorPos)
    const insertion = `@${item.path} `
    this.inputEl.value = before + insertion + after
    const newPos = before.length + insertion.length
    this.inputEl.setSelectionRange(newPos, newPos)
    this.inputEl.dispatchEvent(new Event('input'))
    this.hide()
    this.inputEl.focus()
  }

  // ── Show / Hide ─────────────────────────────────────────────────

  private show(): void {
    this.dropdownEl.removeClass('digest-hidden')
    this.visible = true
  }

  private hide(): void {
    this.dropdownEl.addClass('digest-hidden')
    this.visible = false
    this.items = []
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}
