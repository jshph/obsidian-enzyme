import { App, PluginSettingTab, Setting } from 'obsidian'
import { EnzymePlugin } from '../EnzymePlugin'
import { DEFAULT_SETTINGS } from './EnzymeSettings'

const DEFAULT_INPUT_WIDTH = '500px'

export class SettingsTab extends PluginSettingTab {
	constructor(
		public app: App,
		public plugin: EnzymePlugin
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
					.setValue(thisModelConfig.label).inputEl.style.width =
					DEFAULT_INPUT_WIDTH
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
					.setValue(thisModelConfig.model).inputEl.style.width =
					DEFAULT_INPUT_WIDTH
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
					.setValue(thisModelConfig.baseURL).inputEl.style.width =
					DEFAULT_INPUT_WIDTH
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
					.setValue(thisModelConfig.apiKey).inputEl.style.width =
					DEFAULT_INPUT_WIDTH
			}).settingEl.style.borderTop = 'none'

		new Setting(div).addButton((button) => {
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

		const loaderSettings = new Setting(containerEl).setName('Set model')

		loaderSettings.addDropdown((dropdown) => {
			this.plugin.settings.models.forEach((model, index) => {
				dropdown.addOption(index.toString(), model.label)
			})
			dropdown.setValue(this.plugin.settings.selectedModel)
			dropdown.onChange(async (value) => {
				this.plugin.settings.selectedModel =
					this.plugin.settings.models[parseInt(value)].label
				this.plugin.saveSettings()
				this.plugin.initAIClient()
			})
		})

		loaderSettings.addButton((button) => {
			button.setButtonText('Reload Settings').onClick(() => {
				this.display()
				this.plugin.loadSettings()
			}).buttonEl.style.marginLeft = '10px'
		})

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
			.setName('Exclude from Evergreen extraction strategy')
			.setDesc(
				'By default, when a [[link]] is mentioned in an Enzyme block, Enzyme will treat mentions of [[link]] as source material (as an evergreen). Add paths to this list to exclude from this strategy. For any files in this list, Enzyme will extract their full contents. Separate paths with newlines.'
			)
			.addTextArea((text) => {
				text
					.setPlaceholder('Folders')
					.onChange(async (value) => {
						if (value.trim().length > 0) {
							this.plugin.settings.basicExtractionFolders = value.split('\n')
						} else {
							this.plugin.settings.basicExtractionFolders = []
						}
						this.plugin.saveSettings()
					})
					.setValue(
						this.plugin.settings.basicExtractionFolders?.length > 0
							? this.plugin.settings.basicExtractionFolders.join('\n')
							: ''
					).inputEl.style.width = DEFAULT_INPUT_WIDTH
			})

		new Setting(containerEl)
			.setName('Trim contents')
			.setDesc(
				'Override for similar purposes as the previous setting, but rather than extract full contents, trim to the end of the file. Examples might be folders where files contain book highlights (long files).'
			)
			.addTextArea((text) => {
				text
					.setPlaceholder('Folders')
					.onChange(async (value) => {
						if (value.trim().length > 0) {
							this.plugin.settings.trimFolders = value.split('\n')
						} else {
							this.plugin.settings.trimFolders = []
						}
						this.plugin.saveSettings()
					})
					.setValue(
						this.plugin.settings.trimFolders?.length > 0
							? this.plugin.settings.trimFolders.join('\n')
							: ''
					).inputEl.style.width = DEFAULT_INPUT_WIDTH
			})

		new Setting(containerEl)
			.setName('Visualize sources in graph')
			.setDesc(
				'Enable visualization of Dataview sources in Graph view. This is a togglable setting because it overrides the default Obsidian Graph behavior (with this enabled, to reset the Graph state you can use the `Enzyme: Unlock graph` command). The best way to use this is to have Graph view opened in a separate pane.'
			)
			.addToggle((component) => {
				component
					.setValue(this.plugin.settings.visualizeSourceInGraph)
					.onChange(async (value) => {
						this.plugin.settings.visualizeSourceInGraph = value
						this.plugin.saveSettings()
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
