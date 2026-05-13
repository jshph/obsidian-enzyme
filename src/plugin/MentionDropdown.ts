/**
 * MentionSuggest — @ file mention autocomplete using Obsidian's
 * AbstractInputSuggest for native popover, keyboard nav, and styling.
 *
 * Triggers on `@` preceded by whitespace or at position 0.
 * Open files appear first, then vault files scored by fuzzy match.
 */

import { App, AbstractInputSuggest, TFile, MarkdownView, prepareFuzzySearch } from 'obsidian'

interface MentionItem {
  file: TFile
  isOpen: boolean
}

export class MentionSuggest extends AbstractInputSuggest<MentionItem> {
  private inputEl: HTMLDivElement
  private triggerStart = -1
  private onSelectFile: (file: TFile) => void

  constructor(app: App, inputEl: HTMLDivElement, onSelectFile: (file: TFile) => void) {
    super(app, inputEl)
    this.inputEl = inputEl
    this.onSelectFile = onSelectFile
  }

  getSuggestions(inputStr: string): MentionItem[] {
    const cursor = this.getCursorOffset()
    const trigger = this.findTrigger(inputStr, cursor)
    if (!trigger) return []

    this.triggerStart = trigger.start
    const query = trigger.query
    const openFiles = this.getOpenFiles()
    const openPaths = new Set(openFiles.map(f => f.path))
    const allFiles = this.app.vault.getFiles().filter(f => f.extension === 'md')

    // Score and filter
    const fuzzy = query ? prepareFuzzySearch(query) : null
    const now = Date.now()
    const scored: { item: MentionItem; score: number }[] = []

    for (const file of allFiles) {
      let score = 0
      if (fuzzy) {
        const nameResult = fuzzy(file.basename)
        const pathResult = fuzzy(file.path)
        if (!nameResult && !pathResult) continue
        score = Math.max(nameResult?.score ?? -Infinity, pathResult?.score ?? -Infinity)
      }
      // Recency boost: 0–50 points, decaying over 7 days
      const ageMs = now - file.stat.mtime
      const ageDays = ageMs / (1000 * 60 * 60 * 24)
      score += Math.max(0, 50 * (1 - ageDays / 7))
      // Open files boosted above everything
      if (openPaths.has(file.path)) score += 200

      scored.push({
        item: { file, isOpen: openPaths.has(file.path) },
        score,
      })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 10).map(s => s.item)
  }

  renderSuggestion(item: MentionItem, el: HTMLElement): void {
    const parts = item.file.path.split('/')
    if (parts.length > 1) {
      el.createSpan({
        cls: 'digest-mention-folder',
        text: parts.slice(0, -1).join('/') + '/',
      })
    }
    el.createSpan({ cls: 'digest-mention-name', text: item.file.basename })
    if (item.isOpen) {
      el.createSpan({ cls: 'digest-mention-badge', text: 'open' })
    }
  }

  selectSuggestion(item: MentionItem, _evt: MouseEvent | KeyboardEvent): void {
    const text = this.inputEl.textContent || ''
    const cursor = this.getCursorOffset()
    const before = text.slice(0, this.triggerStart)
    const after = text.slice(cursor)
    const needsSpace = before.length > 0 && after.length > 0 && !/\s$/.test(before) && !/^\s/.test(after)
    const replacement = needsSpace ? ' ' : ''
    this.inputEl.textContent = before + replacement + after
    this.onSelectFile(item.file)
    this.setCursorOffset(before.length + replacement.length)
    this.inputEl.dispatchEvent(new Event('input'))
    this.close()
    this.inputEl.focus()
  }

  // ── Cursor helpers for contenteditable ───────────────────────────

  private getCursorOffset(): number {
    const sel = activeWindow.getSelection()
    if (!sel || sel.rangeCount === 0) return 0
    const range = sel.getRangeAt(0)
    const preRange = activeDocument.createRange()
    preRange.selectNodeContents(this.inputEl)
    preRange.setEnd(range.startContainer, range.startOffset)
    return preRange.toString().length
  }

  private setCursorOffset(offset: number): void {
    const textNode = this.inputEl.firstChild
    if (!textNode) return
    const range = activeDocument.createRange()
    const pos = Math.min(offset, (textNode.textContent || '').length)
    range.setStart(textNode, pos)
    range.collapse(true)
    const sel = activeWindow.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  // ── Trigger Detection ───────────────────────────────────────────

  private findTrigger(text: string, cursorPos: number): { start: number; query: string } | null {
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (text[i] === '@') {
        if (i === 0 || /\s/.test(text[i - 1])) {
          const query = text.slice(i + 1, cursorPos)
          if (query.includes('\n')) return null
          return { start: i, query }
        }
        return null
      }
      if (/\s/.test(text[i])) return null
    }
    return null
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

  // ── Static helpers for mention parsing (used by DigestView) ─────

  static readonly MENTION_PATTERN = /(?:^|\s)@([^\r\n@]+?\.md)(?=\s|$)/g

  static getResolvedMentions(app: App, text: string): TFile[] {
    const pattern = new RegExp(MentionSuggest.MENTION_PATTERN.source, 'g')
    const files: TFile[] = []
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const file = app.vault.getAbstractFileByPath(match[1])
      if (file instanceof TFile) files.push(file)
    }
    return files
  }

  static stripMentions(text: string): string {
    const pattern = new RegExp(MentionSuggest.MENTION_PATTERN.source, 'g')
    return text.replace(pattern, (m, path) => {
      const basename = path.split('/').pop()?.replace(/\.md$/, '') || path
      return m.replace(`@${path}`, `@${basename}`)
    })
  }

  static cleanMentions(text: string): string {
    const pattern = /(?:^|\s)@[^\r\n@]+?\.md(?=\s|$)/g
    return text.replace(pattern, '').trim()
  }
}
