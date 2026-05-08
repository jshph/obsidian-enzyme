import { Plugin, WorkspaceLeaf, FileSystemAdapter } from 'obsidian'
import { DigestView, VIEW_TYPE_DIGEST } from './DigestView.js'
import { DigestSettingsTab, DEFAULT_SETTINGS } from './DigestSettings.js'
import { EnzymeManager } from './EnzymeManager.js'
import type { DigestSettings } from './DigestSettings.js'

export default class DigestPlugin extends Plugin {
  settings: DigestSettings = DEFAULT_SETTINGS
  enzymeManager: EnzymeManager | null = null
  private chatSettingsReloadTimer: ReturnType<typeof window.setTimeout> | null = null

  async onload() {
    await this.loadSettings()

    // Extend PATH so child_process can find enzyme in the same order EnzymeManager prefers.
    const home = process.env.HOME || ''
    const extra = [`${home}/.cargo/bin`, `${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin']
    const pathParts = (process.env.PATH || '').split(':').filter(Boolean)
    for (const p of extra) {
      if (p && !pathParts.includes(p)) {
        pathParts.push(p)
      }
    }
    process.env.PATH = pathParts.join(':')

    // Create EnzymeManager for the vault
    const adapter = this.app.vault.adapter
    if (adapter instanceof FileSystemAdapter) {
      this.enzymeManager = new EnzymeManager(adapter.getBasePath())
    }

    this.registerView(VIEW_TYPE_DIGEST, leaf => new DigestView(leaf, this))

    this.addRibbonIcon('message-circle', 'Open Digest', () => this.activateView())

    this.addCommand({
      id: 'open-digest',
      name: 'Open Digest',
      callback: () => this.activateView(),
    })

    this.addCommand({
      id: 'new-conversation',
      name: 'New conversation',
      callback: () => {
        const view = this.getView()
        if (view) view.clearConversation()
      },
    })

    this.addSettingTab(new DigestSettingsTab(this.app, this))
  }

  onunload() {
    if (this.chatSettingsReloadTimer) {
      window.clearTimeout(this.chatSettingsReloadTimer)
    }
    // Views are automatically cleaned up by Obsidian
  }

  async loadSettings() {
    const data = await this.loadData() as Partial<DigestSettings> & { enzymeAIProvider?: unknown } | null
    if (data) delete data.enzymeAIProvider
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data)
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  scheduleChatSettingsReload() {
    if (this.chatSettingsReloadTimer) {
      window.clearTimeout(this.chatSettingsReloadTimer)
    }
    this.chatSettingsReloadTimer = window.setTimeout(() => {
      this.chatSettingsReloadTimer = null
      const view = this.getView()
      if (view) void view.reloadAgentFromSettings()
    }, 400)
  }

  getView(): DigestView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DIGEST)
    if (leaves.length > 0) return leaves[0].view as DigestView
    return null
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DIGEST)
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0])
      return
    }
    const leaf = this.app.workspace.getRightLeaf(false)
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_DIGEST, active: true })
      this.app.workspace.revealLeaf(leaf)
    }
  }
}
