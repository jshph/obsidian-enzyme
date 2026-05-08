import { App, PluginSettingTab, Setting, Notice } from 'obsidian'
import type DigestPlugin from './DigestPlugin.js'
import type { EnzymeStatus } from './EnzymeManager.js'

export interface DigestSettings {
  apiKey: string
  baseURL: string
  model: string
}

export const DEFAULT_SETTINGS: DigestSettings = {
  apiKey: '',
  baseURL: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-3-flash-preview',
}

export class DigestSettingsTab extends PluginSettingTab {
  plugin: DigestPlugin

  constructor(app: App, plugin: DigestPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  async display(): Promise<void> {
    const { containerEl } = this
    containerEl.empty()

    containerEl.createEl('h2', { text: 'Digest Settings' })

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('OpenAI-compatible API key (OpenRouter, OpenAI, etc.)')
      .addText(text =>
        text
          .setPlaceholder('sk-or-...')
          .setValue(this.plugin.settings.apiKey)
          .then(t => t.inputEl.type = 'password')
          .onChange(async value => {
            this.plugin.settings.apiKey = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Base URL')
      .setDesc('API endpoint (OpenRouter, local llama-server, etc.)')
      .addText(text =>
        text
          .setPlaceholder('https://openrouter.ai/api/v1')
          .setValue(this.plugin.settings.baseURL)
          .onChange(async value => {
            this.plugin.settings.baseURL = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Model identifier (e.g. google/gemini-3-flash-preview)')
      .addText(text =>
        text
          .setPlaceholder('google/gemini-3-flash-preview')
          .setValue(this.plugin.settings.model)
          .onChange(async value => {
            this.plugin.settings.model = value
            await this.plugin.saveSettings()
          })
      )

    // ── Enzyme Section ────────────────────────────────────────────
    await this.renderEnzymeSection(containerEl)
  }

  private async renderEnzymeSection(containerEl: HTMLElement): Promise<void> {
    const mgr = this.plugin.enzymeManager
    if (!mgr) return

    containerEl.createEl('h2', { text: 'Enzyme' })

    const status = await mgr.getStatus()
    this.renderEnzymeStatus(containerEl, status)

    if (!status.installed) {
      new Setting(containerEl)
        .setName('Install Enzyme')
        .setDesc('Download and install the enzyme binary (~52 MB)')
        .addButton(btn =>
          btn.setButtonText('Install').setCta().onClick(async () => {
            btn.setDisabled(true).setButtonText('Installing...')
            try {
              await mgr.install(msg => new Notice(msg))
              new Notice('Enzyme installed successfully')
              this.display()
            } catch (err) {
              new Notice(`Install failed: ${err instanceof Error ? err.message : err}`)
              btn.setDisabled(false).setButtonText('Install')
            }
          })
        )
      return
    }

    // Login
    new Setting(containerEl)
      .setName('Account')
      .setDesc(status.apiKey ? 'Logged in to enzyme.garden' : 'Sign in for catalyst generation')
      .addButton(btn =>
        btn.setButtonText(status.apiKey ? 'Re-login' : 'Login').onClick(async () => {
          btn.setDisabled(true).setButtonText('Waiting for browser...')
          try {
            await mgr.login()
            new Notice('Logged in to enzyme.garden')
            this.display()
          } catch (err) {
            new Notice(`Login failed: ${err instanceof Error ? err.message : err}`)
            btn.setDisabled(false).setButtonText('Login')
          }
        })
      )

    if (!status.initialized) {
      new Setting(containerEl)
        .setName('Initialize vault')
        .setDesc('Scan vault, extract entities, generate catalysts. Takes 1-3 minutes.')
        .addButton(btn =>
          btn.setButtonText('Initialize').setCta().onClick(async () => {
            btn.setDisabled(true).setButtonText('Initializing...')
            try {
              await mgr.init(event => {
                btn.setButtonText(event.message || event.stage)
              })
              new Notice('Vault initialized')
              this.display()
            } catch (err) {
              new Notice(`Init failed: ${err instanceof Error ? err.message : err}`)
              btn.setDisabled(false).setButtonText('Initialize')
            }
          })
        )
      return
    }

    // Refresh
    new Setting(containerEl)
      .setName('Refresh index')
      .setDesc('Incrementally update the vault index')
      .addButton(btn =>
        btn.setButtonText('Refresh').onClick(async () => {
          btn.setDisabled(true).setButtonText('Refreshing...')
          try {
            await mgr.refresh()
            new Notice('Index refreshed')
            this.display()
          } catch (err) {
            new Notice(`Refresh failed: ${err instanceof Error ? err.message : err}`)
            btn.setDisabled(false).setButtonText('Refresh')
          }
        })
      )

    // Entity list
    const config = mgr.readConfig()
    if (config) {
      new Setting(containerEl)
        .setName('Entities')
        .setDesc('Tags, links, and folders enzyme tracks. One per line. Changes take effect on next refresh.')
        .addTextArea(textarea =>
          textarea
            .setPlaceholder('#tag\n[[Link]]\nfolder:name')
            .setValue(config.entities.join('\n'))
            .onChange(async value => {
              const entities = value.split('\n').map(s => s.trim()).filter(Boolean)
              mgr.writeConfig({ entities })
            })
            .then(t => {
              t.inputEl.rows = 8
              t.inputEl.style.width = '100%'
              t.inputEl.style.fontFamily = 'var(--font-monospace)'
              t.inputEl.style.fontSize = '12px'
            })
        )
    }
  }

  private renderEnzymeStatus(containerEl: HTMLElement, status: EnzymeStatus): void {
    const parts: string[] = []
    if (!status.installed) {
      parts.push('Not installed')
    } else if (!status.initialized) {
      parts.push('Installed, not initialized')
    } else {
      if (status.documents !== undefined) parts.push(`${status.documents} docs`)
      if (status.entities !== undefined) parts.push(`${status.entities} entities`)
      if (status.catalysts !== undefined) parts.push(`${status.catalysts} catalysts`)
    }

    new Setting(containerEl)
      .setName('Status')
      .setDesc(parts.join(' · ') || 'Unknown')
  }
}
