import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian'
import { ReasonPlugin } from '../ReasonPlugin'
import { DEFAULT_SETTINGS } from './ReasonSettings'

export class SettingsTab extends PluginSettingTab {
	constructor(
		public app: App,
		public plugin: ReasonPlugin
	) {
		super(app, plugin)
	}

	createModelSetting(
		containerEl: HTMLElement,
		thisModelConfig: {
			model: string
			baseURL: string
			apiKey: string
			label: string
		} = {
			label: '',
			model: '',
			baseURL: '',
			apiKey: ''
		}
	) {
		const div = containerEl.createDiv()
		var index = this.plugin.settings.models.indexOf(thisModelConfig)
		if (index === -1) {
			this.plugin.settings.models.push(thisModelConfig)
			index = this.plugin.settings.models.length - 1
		}

		const topSetting = new Setting(div)
			.setName('Label')
			.setDesc('Label for the model config')
			.addText((text) => {
				text
					.setPlaceholder('Label')
					.onChange(async (value) => {
						thisModelConfig.label = value
						this.plugin.settings.models[index] = thisModelConfig
						this.plugin.saveSettings()
					})
					.setValue(thisModelConfig.label).inputEl.style.width = '100%'
			})
		topSetting.settingEl.style.borderTop =
			'1px solid var(--background-modifier-border)'
		topSetting.settingEl.style.paddingTop = '12px'

		new Setting(div)
			.setName('Model name')
			.setDesc('Name of the model from the provider')
			.addText((text) => {
				text
					.setPlaceholder('Model name')
					.onChange(async (value) => {
						thisModelConfig.model = value
						this.plugin.settings.models[index] = thisModelConfig
						this.plugin.saveSettings()
					})
					.setValue(thisModelConfig.model).inputEl.style.width = '100%'
			}).settingEl.style.borderTop = 'none'

		new Setting(div)
			.setName('Base URL')
			.setDesc('Base URL for the model provider; OpenAI can be empty')
			.addText((text) => {
				text
					.setPlaceholder('Base URL')
					.onChange(async (value) => {
						thisModelConfig.baseURL = value
						this.plugin.settings.models[index] = thisModelConfig
						this.plugin.saveSettings()
					})
					.setValue(thisModelConfig.baseURL).inputEl.style.width = '100%'
			}).settingEl.style.borderTop = 'none'

		new Setting(div)
			.setName('API Key')
			.setDesc('API Key for a given model provider')
			.addText((text) => {
				text
					.setPlaceholder('API Key')
					.onChange(async (value) => {
						thisModelConfig.apiKey = value
						this.plugin.settings.models[index] = thisModelConfig
						this.plugin.saveSettings()
					})
					.setValue(thisModelConfig.apiKey).inputEl.style.width = '100%'
			}).settingEl.style.borderTop = 'none'

		new Setting(div)
			.addButton((button) => {
				if (this.plugin.settings.selectedModel === thisModelConfig.label) {
					button.setButtonText('Selected')
					button.setDisabled(true)
				} else {
					button.setButtonText('Select').onClick(() => {
						this.plugin.settings.selectedModel = thisModelConfig.label
						this.display()
						this.plugin.saveSettings()
					})
				}
			})
			.addButton((button) => {
				button.setButtonText('X').onClick(() => {
					div.remove()
					if (this.plugin.settings.selectedModel === thisModelConfig.label) {
						this.plugin.settings.selectedModel = DEFAULT_SETTINGS.selectedModel
					}
					this.plugin.settings.models.remove(thisModelConfig)
					this.plugin.saveSettings()
					this.display()
				})
			}).settingEl.style.borderTop = 'none'
	}

	async display(): Promise<void> {
		const { containerEl } = this
		containerEl.empty()

		const modelConfigsSetting = new Setting(containerEl).setName(
			'Model configs'
		)

		modelConfigsSetting.settingEl.style.display = 'block'
		modelConfigsSetting.infoEl.style.paddingBottom = '20px'

		modelConfigsSetting.controlEl.style.display = 'block'
		modelConfigsSetting.controlEl.style.textAlign = 'left'
		const modelConfigsContainer = modelConfigsSetting.controlEl.createDiv()

		Object.values(this.plugin.settings.models).forEach((value) => {
			this.createModelSetting(modelConfigsContainer, value)
		})

		modelConfigsSetting.addButton((button) => {
			button.setButtonText('Add model').onClick(() => {
				this.createModelSetting(modelConfigsContainer)
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
	}
}

export default SettingsTab
