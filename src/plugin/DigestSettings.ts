import { App, PluginSettingTab, Setting, Notice } from 'obsidian'
import type DigestPlugin from './DigestPlugin.js'
import type { EnzymeStatus } from './EnzymeManager.js'

export interface DigestSettings {
  apiKey: string
  baseURL: string
  model: string
  enzymeApiKey: string
  enzymeBaseURL: string
  enzymeModel: string
  enzymeShowAdvanced: boolean
}

export const DEFAULT_SETTINGS: DigestSettings = {
  apiKey: '',
  baseURL: 'https://openrouter.ai/api/v1',
  model: '',
  enzymeApiKey: '',
  enzymeBaseURL: 'https://openrouter.ai/api/v1',
  enzymeModel: '',
  enzymeShowAdvanced: false,
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
    containerEl.addClass('digest-settings')

    new Setting(containerEl).setName('Chat Model').setHeading()

    new Setting(containerEl)
      .setName('Chat API key')
      .setDesc('Used only for Digest chat with your configured OpenAI-compatible model provider.')
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
      .setDesc('Chat completions endpoint for Digest chat.')
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
      .setDesc('Model identifier for Digest chat.')
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
    new Setting(containerEl)
      .setName('Enzyme')
      .setDesc('Local semantic index for vault search.')
      .setHeading()
      .addExtraButton(btn => {
        btn
          .setIcon('help')
          .setTooltip([
      'Enzyme is a local-first knowledge indexer for your vault.',
      '',
      'It reads your existing tags, links, and folder structure to build',
      'a semantic index with AI-generated "catalyst questions" for each',
      'concept. When you ask Digest a question, Enzyme finds relevant',
      'content in ~8ms — no cloud embeddings, no token cost for retrieval.',
      '',
      'Initialization and catalyst generation use AI. You can sign in',
      'and let Enzyme handle indexing credentials, or use your own',
      'provider from Advanced settings.',
      '',
      'Without Enzyme, Digest still works (ReadFile / WriteFile) but',
      'cannot search your vault semantically.',
      '',
      'Privacy: https://www.enzyme.garden/privacy',
          ].join('\n'))
      })

    const status = await mgr.getStatus()

    this.renderEnzymeStatus(containerEl, status)
    this.renderEnzymePrivacySetting(containerEl)

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
        ? `Signed in${status.email ? ` as ${status.email}` : ''}.`
        : 'Recommended. Optional if you use your own AI credentials.'
    )

    const accountSetting = new Setting(containerEl)
      .setName('Account')
      .setDesc(accountDesc)
      .addButton(btn => {
        btn.setButtonText(status.loggedIn ? 'Re-login' : 'Sign in')
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

    this.renderEnzymeAdvancedSetting(containerEl)

    if (!status.initialized) {
      const canRun = this.canRunEnzymeAI(status)
      new Setting(containerEl)
        .setName('Initialize vault')
        .setDesc('Scan this vault, select entities, and generate catalysts. Note excerpts are sent to the selected AI provider. Usually takes 1-3 minutes.')
        .addButton(btn =>
          btn.setButtonText('Initialize').setCta().setDisabled(!canRun).onClick(async () => {
            btn.setDisabled(true).setButtonText('Initializing...')
            try {
              const env = this.getEnzymeAIEnv(status)
              if (env === false) {
                new Notice('Sign in to Enzyme, or complete the advanced AI credentials.')
                btn.setDisabled(false).setButtonText('Initialize')
                return
              }
              await mgr.init(event => {
                btn.setButtonText(event.message || event.stage)
              }, env)
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
    const canRun = this.canRunEnzymeAI(status)
    new Setting(containerEl)
      .setName('Refresh index')
      .setDesc('Incrementally update the vault index')
      .addButton(btn =>
        btn.setButtonText('Refresh').setDisabled(!canRun).onClick(async () => {
          btn.setDisabled(true).setButtonText('Refreshing...')
          try {
            const env = this.getEnzymeAIEnv(status)
            if (env === false) {
              new Notice('Sign in to Enzyme, or complete the advanced AI credentials.')
              btn.setDisabled(false).setButtonText('Refresh')
              return
            }
            await mgr.refresh(true, env)
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

  private renderEnzymePrivacySetting(containerEl: HTMLElement): void {
    const desc = document.createDocumentFragment()
    desc.appendText('Search runs locally. Initialization uses AI to generate catalysts from note excerpts. ')
    const link = desc.createEl('a', { text: 'Privacy details', href: 'https://www.enzyme.garden/privacy' })
    link.setAttr('target', '_blank')

    new Setting(containerEl)
      .setName('Privacy')
      .setDesc(desc)
      .setClass('digest-settings-subtle')
  }

  private renderEnzymeAdvancedSetting(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Advanced')
      .setDesc('Optional AI credentials for Enzyme indexing when you are not signed in.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.enzymeShowAdvanced)
          .onChange(async value => {
            this.plugin.settings.enzymeShowAdvanced = value
            await this.plugin.saveSettings()
            this.display()
          })
      )
      .setClass('digest-settings-subtle')

    if (!this.plugin.settings.enzymeShowAdvanced) return

    const envDesc = document.createDocumentFragment()
    envDesc.appendText('Signed-in Enzyme accounts are used first. Otherwise, fill all three fields or launch Obsidian with matching process environment variables.')

    new Setting(containerEl)
      .setName('Own credentials')
      .setDesc(envDesc)
      .setClass('digest-settings-note')

    new Setting(containerEl)
      .setName('OPENAI_API_KEY')
      .setDesc('Used only for Enzyme indexing.')
      .addText(text =>
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.enzymeApiKey || '')
          .then(t => t.inputEl.type = 'password')
          .onChange(async value => {
            this.plugin.settings.enzymeApiKey = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('OPENAI_BASE_URL')
      .setDesc('OpenAI-compatible endpoint.')
      .addText(text =>
        text
          .setPlaceholder('https://api.openai.com/v1')
          .setValue(this.plugin.settings.enzymeBaseURL || '')
          .onChange(async value => {
            this.plugin.settings.enzymeBaseURL = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('OPENAI_MODEL')
      .setDesc('Model for catalyst generation.')
      .addText(text =>
        text
          .setPlaceholder('gpt-4.1-mini')
          .setValue(this.plugin.settings.enzymeModel || '')
          .onChange(async value => {
            this.plugin.settings.enzymeModel = value
            await this.plugin.saveSettings()
          })
      )
  }

  private canRunEnzymeAI(status: EnzymeStatus): boolean {
    return this.getEnzymeAIEnv(status) !== false
  }

  private getEnzymeAIEnv(status: EnzymeStatus): Record<string, string> | undefined | false {
    if (status.loggedIn) return undefined

    const { enzymeApiKey, enzymeBaseURL, enzymeModel } = this.plugin.settings
    if (!enzymeApiKey || !enzymeBaseURL || !enzymeModel) {
      const hasProcessEnv = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL && process.env.OPENAI_MODEL)
      return hasProcessEnv ? undefined : false
    }

    return {
      OPENAI_API_KEY: enzymeApiKey,
      OPENAI_BASE_URL: enzymeBaseURL,
      OPENAI_MODEL: enzymeModel,
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
