import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian'
import { ReasonPlugin } from '../ReasonPlugin'
import { DEFAULT_SETTINGS } from './ReasonSettings'

export class SettingsTab extends PluginSettingTab {
  constructor(public app: App, public plugin: ReasonPlugin) {
    super(app, plugin)
  }

  async display(): Promise<void> {
    const { containerEl } = this
    containerEl.empty()

    new Setting(containerEl)
      .setName('Model Config')
      .setDesc('Select the model configuration to use.')
      .addDropdown((dropdown) => {
        Object.entries(this.plugin.settings.models).forEach(([key, value]) => {
          dropdown
            .addOption(key, key)
            .setValue(
              this.plugin.settings.selectedModel ||
                DEFAULT_SETTINGS.selectedModel
            )
        })
        dropdown.onChange(async (value) => {
          this.plugin.settings.selectedModel = value
          await this.plugin.saveSettings()
          await this.plugin.initAIClient()
        })
      })

    new Setting(containerEl).setName('OpenAI API Key').addText((text) => {
      text
        .setPlaceholder('API Key')
        .setValue(
          this.plugin.settings.models['GPT-3.5 Turbo'].apiKey ||
            DEFAULT_SETTINGS.models['GPT-3.5 Turbo'].apiKey
        )
        .onChange(async (value) => {
          if (value === '') {
            return
          }
          this.plugin.settings.models['GPT-3.5 Turbo'].apiKey = value
          await this.plugin.saveSettings()
          await this.plugin.initAIClient()
        })
    })

    new Setting(containerEl)
      .setName('Debug output')
      .setDesc('Enable debug output in the console')
      .addToggle((component) => {
        component
          .setValue(this.plugin.settings.debug || DEFAULT_SETTINGS.debug)
          .onChange(async (value) => {
            this.plugin.settings.debug = value
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName('Local model')
      .setDesc('First, install and run Nitro: https://nitro.jan.ai/install')
      .addText((text) => {
        text
          .setPlaceholder('Local model path')
          .setValue(
            this.plugin.settings.localModelPath ||
              DEFAULT_SETTINGS.localModelPath
          )
          .onChange(async (value) => {
            this.plugin.settings.localModelPath = value
            await this.plugin.saveSettings()
            await this.plugin.initAIClient()
          })
      })
      .addButton((button) => {
        button.setButtonText('Load model with Nitro').onClick(async () => {
          await requestUrl({
            url: 'http://localhost:3928/inferences/llamacpp/loadModel',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              llama_model_path: this.plugin.settings.localModelPath,
              ctx_len: 32768,
              embedding: false,
              ngl: -1
            })
          })
        })
      })

    new Setting(containerEl)
      .setName('License Key')
      .setDesc(
        'Enter your license key to enable local model usage and unlimited template saves'
      )
      .addText((text) => {
        text
          .setPlaceholder('License Key')
          .setValue(this.plugin.settings.reasonLicenseKey)
          .onChange(async (value) => {
            this.plugin.settings.reasonLicenseKey = value
            this.plugin.registrationManager.setLicense(value)
            await this.plugin.saveSettings()
          })
      })
      .addButton((button) => {
        button.setButtonText('Activate').onClick(async () => {
          if (await this.plugin.activateLicense()) {
            new Notice('License key is valid!')
          } else {
            new Notice('License key is invalid!')
          }
        })
      })
  }
}

export default SettingsTab
