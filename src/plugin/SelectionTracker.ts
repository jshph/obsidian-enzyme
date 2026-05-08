/**
 * SelectionTracker — polls the active editor for selected text.
 *
 * Runs a 250ms interval checking the active MarkdownView for selection.
 * When text is selected, stores it with the source file path. The chat
 * view can read this to inject selection context into prompts.
 */

import { App, MarkdownView } from 'obsidian'

export interface StoredSelection {
  text: string
  filePath: string
  lineCount: number
}

type SelectionChangeCallback = (selection: StoredSelection | null) => void

export class SelectionTracker {
  private app: App
  private interval: ReturnType<typeof setInterval>
  private current: StoredSelection | null = null
  private dismissed = false
  private listeners: SelectionChangeCallback[] = []

  constructor(app: App) {
    this.app = app
    this.interval = setInterval(() => this.poll(), 250)
  }

  getSelection(): StoredSelection | null {
    if (this.dismissed) return null
    return this.current
  }

  /** Dismiss current selection (user clicked x on chip). Resets on next new selection. */
  dismiss(): void {
    this.dismissed = true
    this.notify(null)
  }

  onChange(cb: SelectionChangeCallback): () => void {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(l => l !== cb) }
  }

  destroy(): void {
    clearInterval(this.interval)
    this.listeners = []
  }

  private poll(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (!view || !view.file) {
      this.update(null)
      return
    }

    const selection = view.editor.getSelection()
    if (!selection || selection.trim().length === 0) {
      this.update(null)
      return
    }

    const lineCount = selection.split('\n').length
    this.update({
      text: selection,
      filePath: view.file.path,
      lineCount,
    })
  }

  private update(sel: StoredSelection | null): void {
    const prevKey = this.current ? `${this.current.filePath}:${this.current.text}` : null
    const newKey = sel ? `${sel.filePath}:${sel.text}` : null

    if (prevKey !== newKey) {
      this.current = sel
      // Reset dismissed state when selection changes
      if (sel && this.dismissed) this.dismissed = false
      this.notify(this.dismissed ? null : sel)
    }
  }

  private notify(sel: StoredSelection | null): void {
    for (const cb of this.listeners) cb(sel)
  }
}
