/**
 * SelectionTracker — watches the active editor for selected text.
 *
 * When text is selected, stores it with the source file path. The chat view
 * can read this to inject selection context into prompts.
 */

import { App, MarkdownView, EventRef } from 'obsidian'

export interface StoredSelection {
  text: string
  filePath: string
  lineCount: number
}

type SelectionChangeCallback = (selection: StoredSelection | null) => void

export class SelectionTracker {
  private app: App
  private current: StoredSelection | null = null
  private dismissed = false
  private listeners: SelectionChangeCallback[] = []
  private eventRefs: EventRef[] = []
  private readonly poll = (): void => this.readSelection()

  constructor(app: App) {
    this.app = app
    this.eventRefs.push(this.app.workspace.on('active-leaf-change', this.poll))
    this.eventRefs.push(this.app.workspace.on('file-open', this.poll))
    window.addEventListener('selectionchange', this.poll)
    window.addEventListener('keyup', this.poll)
    window.addEventListener('mouseup', this.poll)
    this.poll()
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
    for (const ref of this.eventRefs) this.app.workspace.offref(ref)
    this.eventRefs = []
    window.removeEventListener('selectionchange', this.poll)
    window.removeEventListener('keyup', this.poll)
    window.removeEventListener('mouseup', this.poll)
    this.listeners = []
  }

  private readSelection(): void {
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
