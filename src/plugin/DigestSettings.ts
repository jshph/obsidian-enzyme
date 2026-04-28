import { App, PluginSettingTab, Setting } from 'obsidian'
import type DigestPlugin from './DigestPlugin.js'

export interface DigestSettings {
  apiKey: string
  baseURL: string
  model: string
  maxContext: number
  maxTokens: number
}

export const DEFAULT_SETTINGS: DigestSettings = {
  apiKey: '',
  baseURL: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-3-flash-preview',
  maxContext: 32768,
  maxTokens: 2048,
}

export class DigestSettingsTab extends PluginSettingTab {
  plugin: DigestPlugin

  constructor(app: App, plugin: DigestPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
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

    new Setting(containerEl)
      .setName('Max context')
      .setDesc('Total context window size in tokens')
      .addText(text =>
        text
          .setPlaceholder('32768')
          .setValue(String(this.plugin.settings.maxContext))
          .onChange(async value => {
            const num = parseInt(value, 10)
            if (!isNaN(num) && num >= 1024) {
              this.plugin.settings.maxContext = num
              await this.plugin.saveSettings()
            }
          })
      )

    new Setting(containerEl)
      .setName('Max output tokens')
      .setDesc('Maximum tokens per response')
      .addText(text =>
        text
          .setPlaceholder('2048')
          .setValue(String(this.plugin.settings.maxTokens))
          .onChange(async value => {
            const num = parseInt(value, 10)
            if (!isNaN(num) && num >= 128) {
              this.plugin.settings.maxTokens = num
              await this.plugin.saveSettings()
            }
          })
      )
  }
}
