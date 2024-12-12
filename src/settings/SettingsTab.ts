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

	async display(): Promise<void> {
		const { containerEl } = this
		containerEl.empty()

		// API Keys section
		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('API Key for OpenAI models')
			.addText((text) => {
				text
					.setPlaceholder('OpenAI API Key')
					.setValue(this.plugin.settings.apiKeys.openai || '')
					.onChange(async (value) => {
						this.plugin.settings.apiKeys.openai = value
						await this.plugin.saveSettings()
						this.plugin.obsidianEnzymeAgent.aggregator.setOpenAIApiKey(value)
					})
				text.inputEl.type = 'password'
			})

		new Setting(containerEl)
			.setName('Anthropic API Key')
			.setDesc('API Key for Anthropic models')
			.addText((text) => {
				text
					.setPlaceholder('Anthropic API Key')
					.setValue(this.plugin.settings.apiKeys.anthropic || '')
					.onChange(async (value) => {
						this.plugin.settings.apiKeys.anthropic = value
						await this.plugin.saveSettings()
						this.plugin.obsidianEnzymeAgent.aggregator.setAnthropicApiKey(value)
					})
				text.inputEl.type = 'password'
			})

		new Setting(containerEl)
			.setName('File exclusion patterns')
			.setDesc(
				'Patterns to exclude from Dataview queries and synthesis - tags and paths. Separate patterns with newlines.'
			)
			.addTextArea((text) => {
				text
					.setPlaceholder('Exclusion patterns')
					.onChange(async (value) => {
						this.plugin.settings.exclusionPatterns = value.split('\n')
						this.plugin.saveSettings()
					})
					.setValue(
						this.plugin.settings.exclusionPatterns?.length > 0
							? this.plugin.settings.exclusionPatterns.join('\n')
							: ''
					).inputEl.style.width = DEFAULT_INPUT_WIDTH
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

		// Models section
		const modelsSection = containerEl.createEl('div', {
			cls: 'enzyme-models-section'
		})
		modelsSection.createEl('h3', { text: 'Models' })

		// Default models
		const defaultModels = [
			'gpt-4o-mini',
			'gpt-4o',
			'claude-3-haiku-20240307',
			'claude-3-opus-20240229',
			'claude-3-5-sonnet-20240620'
		]

		defaultModels.forEach((modelName) => {
			new Setting(modelsSection).setName(modelName).addToggle((toggle) => {
				toggle
					.setValue(
						this.plugin.settings.models.find((m) => m.model === modelName) !==
							undefined
					)
					.onChange(async (isEnabled) => {
						let updatedModels = [...this.plugin.settings.models]
						if (isEnabled) {
							// Add the model to the list of enabled models if not already present
							if (!updatedModels.some((m) => m.model === modelName)) {
								updatedModels.push({
									model: modelName // baseURL not necessary for default models
								})
							}
						} else {
							// Remove the model from the list of enabled models
							updatedModels = updatedModels.filter((m) => m.model !== modelName)
						}
						this.plugin.settings.models = updatedModels
						await this.plugin.saveSettings()
					})
			})
		})

		// Select model
		new Setting(modelsSection)
			.setName('Select model')
			.setDesc('Select the model to use')
			.addDropdown((dropdown) => {
				// Clear existing options
				dropdown.selectEl.empty()
				// Add all available models
				this.plugin.settings.models.forEach((model) => {
					dropdown.addOption(model.model, model.model)
				})
				dropdown
					.setValue(this.plugin.settings.selectedModel || 'gpt-4o-mini')
					.onChange(async (value) => {
						this.plugin.settings.selectedModel = value
						await this.plugin.saveSettings()
					})
			})

		// Custom models section
		const customModelsSection = containerEl.createEl('div', {
			cls: 'enzyme-custom-models-section'
		})
		customModelsSection.createEl('h3', { text: 'Custom Models (e.g. Ollama)' })

		// Existing custom models
		this.plugin.settings.models.forEach((model, index) => {
			if (model.baseURL) {
				this.createCustomModelSetting(customModelsSection, model, index)
			}
		})

		// Add custom model button
		new Setting(customModelsSection).addButton((button) => {
			button.setButtonText('Add Custom Model').onClick(() => {
				this.createCustomModelSetting(
					customModelsSection,
					{
						model: '',
						baseURL: ''
					},
					this.plugin.settings.models.length
				)
			})
		})
	}

	createCustomModelSetting(
		containerEl: HTMLElement,
		modelConfig: { model: string; baseURL?: string },
		index: number
	) {
		const div = containerEl.createDiv({ cls: 'enzyme-custom-model' })

		new Setting(div)
			.setName('Model name')
			.setDesc('Name of the model (e.g. llama2 for Ollama)')
			.addText((text) => {
				text
					.setPlaceholder('Model name')
					.setValue(modelConfig.model)
					.onChange(async (value) => {
						modelConfig.model = value
						this.plugin.settings.models[index] = modelConfig
						await this.plugin.saveSettings()
					})
				text.inputEl.style.width = DEFAULT_INPUT_WIDTH
			})

		new Setting(div)
			.setName('Base URL')
			.setDesc(
				'Base URL for the model provider (e.g. http://localhost:11434 for Ollama)'
			)
			.addText((text) => {
				text
					.setPlaceholder('Base URL')
					.setValue(modelConfig.baseURL || '')
					.onChange(async (value) => {
						modelConfig.baseURL = value
						this.plugin.settings.models[index] = modelConfig
						await this.plugin.saveSettings()
					})
				text.inputEl.style.width = DEFAULT_INPUT_WIDTH
			})

		new Setting(div).addButton((button) => {
			button
				.setButtonText('Remove')
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.models.splice(index, 1)
					await this.plugin.saveSettings()
					this.display() // Refresh the entire settings page
				})
		})

		div.createEl('hr')
	}
}

export default SettingsTab
