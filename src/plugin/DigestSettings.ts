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
  model: '',
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

    // Header with info tooltip
    const headerEl = containerEl.createDiv({ cls: 'digest-enzyme-header' })
    headerEl.createEl('h2', { text: 'Enzyme' })
    const infoIcon = headerEl.createSpan({ cls: 'digest-enzyme-info', attr: { 'aria-label': 'What is Enzyme?' } })
    infoIcon.setText('?')
    infoIcon.title = [
      'Enzyme is a local-first knowledge indexer for your vault.',
      '',
      'It reads your existing tags, links, and folder structure to build',
      'a semantic index with AI-generated "catalyst questions" for each',
      'concept. When you ask Digest a question, Enzyme finds relevant',
      'content in ~8ms — no cloud embeddings, no token cost for retrieval.',
      '',
      'Without Enzyme, Digest still works (ReadFile / WriteFile) but',
      'cannot search your vault semantically.',
      '',
      'Learn more: https://enzyme.garden',
    ].join('\n')

    const status = await mgr.getStatus()

    this.renderEnzymeStatus(containerEl, status)

    if (!status.installed) {
      const descFrag = document.createDocumentFragment()
      descFrag.appendText('Install the local Enzyme binary before signing in or indexing this vault. ')
      const link = descFrag.createEl('a', { text: 'What is Enzyme?', href: 'https://enzyme.garden' })
      link.setAttr('target', '_blank')

      new Setting(containerEl)
        .setName('Install Enzyme')
        .setDesc(descFrag)
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

    // Account
    const accountDesc = document.createDocumentFragment()
    const setAccountDesc = (message: string, href?: string) => {
      while (accountDesc.firstChild) accountDesc.removeChild(accountDesc.firstChild)
      accountDesc.appendText(message)
      if (href) {
        accountDesc.appendText(' ')
        const link = accountDesc.createEl('a', { text: 'Open sign-in page', href })
        link.setAttr('target', '_blank')
      }
    }
    setAccountDesc(
      status.loggedIn
        ? `Signed in${status.email ? ` as ${status.email}` : ''}. Enzyme can initialize and refresh this vault.`
        : 'Sign in to enzyme.garden before initializing or refreshing this vault.'
    )

    const accountSetting = new Setting(containerEl)
      .setName('Account')
      .setDesc(accountDesc)
      .addButton(btn => {
        btn.setButtonText(status.loggedIn ? 'Re-login' : 'Sign in')
        if (!status.loggedIn) btn.setCta()
        btn.onClick(async () => {
          btn.setDisabled(true).setButtonText('Waiting for browser...')
          try {
            await mgr.login(event => {
              if (event.event === 'device_authorization') {
                btn.setButtonText('Waiting for approval...')
                setAccountDesc(
                  event.opened_browser
                    ? 'Complete sign-in in the browser, then return to Obsidian.'
                    : 'Complete sign-in in your browser, then return to Obsidian.',
                  event.verification_uri,
                )
                accountSetting.setDesc(accountDesc)
              } else if (event.event === 'already_logged_in') {
                btn.setButtonText('Already signed in')
                setAccountDesc(`Already signed in${event.email ? ` as ${event.email}` : ''}.`)
                accountSetting.setDesc(accountDesc)
              }
            })
            new Notice('Signed in to enzyme.garden')
            this.display()
          } catch (err) {
            new Notice(`Sign-in failed: ${err instanceof Error ? err.message : err}`)
            btn.setDisabled(false).setButtonText(status.loggedIn ? 'Re-login' : 'Sign in')
          }
        })
      })

    if (status.loggedIn) {
      accountSetting.addButton(btn =>
        btn.setButtonText('Sign out').onClick(async () => {
          btn.setDisabled(true).setButtonText('Signing out...')
          try {
            await mgr.logout()
            new Notice('Signed out of enzyme.garden')
            this.display()
          } catch (err) {
            new Notice(`Sign-out failed: ${err instanceof Error ? err.message : err}`)
            btn.setDisabled(false).setButtonText('Sign out')
          }
        })
      )
    }

    if (!status.loggedIn) {
      new Setting(containerEl)
        .setName('Initialize vault')
        .setDesc('Sign in first. Initialization uses your Enzyme account for catalyst generation and credits.')
        .addButton(btn => btn.setButtonText('Initialize').setDisabled(true))
      return
    }

    if (!status.initialized) {
      new Setting(containerEl)
        .setName('Initialize vault')
        .setDesc('Scan this vault, select entities, and generate catalysts. Usually takes 1-3 minutes.')
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
    } else if (!status.loggedIn) {
      parts.push('Installed')
      parts.push('not signed in')
    } else if (!status.initialized) {
      parts.push('Signed in')
      parts.push('not initialized')
    } else {
      parts.push('Ready')
      if (status.documents !== undefined) parts.push(`${status.documents} docs`)
      if (status.entities !== undefined) parts.push(`${status.entities} entities`)
      if (status.catalysts !== undefined) parts.push(`${status.catalysts} catalysts`)
    }

    new Setting(containerEl)
      .setName('Status')
      .setDesc(parts.join(' · ') || 'Unknown')
  }
}
