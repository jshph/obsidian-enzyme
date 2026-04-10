import { App, PluginSettingTab, Setting } from 'obsidian'
import type EnzymeDigestPlugin from './main'

export interface EnzymeDigestSettings {
	apiKey: string
	baseURL: string
	model: string
	vaultPath: string
	defaultPrompt: string
	defaultFreq: string
	highlightsPerQuery: number
	numQueries: number
	maxPerSource: number
}

export const DEFAULT_SETTINGS: EnzymeDigestSettings = {
	apiKey: '',
	baseURL: 'https://openrouter.ai/api/v1',
	model: 'google/gemini-2.0-flash-001',
	vaultPath: '',
	defaultPrompt: 'what threads connect my recent thinking?',
	defaultFreq: 'daily',
	highlightsPerQuery: 8,
	numQueries: 5,
	maxPerSource: 3,
}

export class EnzymeDigestSettingTab extends PluginSettingTab {
	plugin: EnzymeDigestPlugin

	constructor(app: App, plugin: EnzymeDigestPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const { containerEl } = this
		containerEl.empty()

		containerEl.createEl('h2', { text: 'Enzyme Digest' })
		containerEl.createEl('p', {
			text: 'Surfaces connections across your vault via Enzyme catalyze, rendered as a clickable digest.',
			cls: 'setting-item-description',
		})

		// --- LLM Configuration ---
		containerEl.createEl('h3', { text: 'LLM Configuration' })

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('API key for the LLM provider (e.g. OpenRouter, OpenAI)')
			.addText((text) => {
				text.inputEl.type = 'password'
				text.inputEl.style.width = '300px'
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Base URL')
			.setDesc('OpenAI-compatible API base URL')
			.addText((text) => {
				text.inputEl.style.width = '300px'
				text
					.setPlaceholder('https://openrouter.ai/api/v1')
					.setValue(this.plugin.settings.baseURL)
					.onChange(async (value) => {
						this.plugin.settings.baseURL = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Model identifier (e.g. google/gemini-2.0-flash-001, gpt-4o-mini)')
			.addText((text) => {
				text.inputEl.style.width = '300px'
				text
					.setPlaceholder('google/gemini-2.0-flash-001')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value
						await this.plugin.saveSettings()
					})
			})

		// --- Enzyme Configuration ---
		containerEl.createEl('h3', { text: 'Enzyme Configuration' })

		new Setting(containerEl)
			.setName('Vault path')
			.setDesc(
				'Path to the vault for enzyme catalyze (leave empty to use current vault)'
			)
			.addText((text) => {
				text.inputEl.style.width = '300px'
				text
					.setPlaceholder('/path/to/vault')
					.setValue(this.plugin.settings.vaultPath)
					.onChange(async (value) => {
						this.plugin.settings.vaultPath = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Queries per digest')
			.setDesc('Number of search queries the LLM generates from your prompt (1-10)')
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.numQueries)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.numQueries = value
						await this.plugin.saveSettings()
					})
			)

		new Setting(containerEl)
			.setName('Highlights per query')
			.setDesc('Number of enzyme results per query (1-20)')
			.addSlider((slider) =>
				slider
					.setLimits(1, 20, 1)
					.setValue(this.plugin.settings.highlightsPerQuery)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.highlightsPerQuery = value
						await this.plugin.saveSettings()
					})
			)

		new Setting(containerEl)
			.setName('Max highlights per source')
			.setDesc('Cap per source file to force diversity (1-10)')
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.maxPerSource)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxPerSource = value
						await this.plugin.saveSettings()
					})
			)

		// --- Defaults ---
		containerEl.createEl('h3', { text: 'Block Defaults' })

		new Setting(containerEl)
			.setName('Default prompt')
			.setDesc('Pre-filled prompt when inserting a new digest block')
			.addTextArea((text) => {
				text.inputEl.style.width = '300px'
				text.inputEl.rows = 3
				text
					.setPlaceholder('what threads connect my recent thinking?')
					.setValue(this.plugin.settings.defaultPrompt)
					.onChange(async (value) => {
						this.plugin.settings.defaultPrompt = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Default frequency')
			.setDesc('How often to auto-refresh (e.g. daily, weekly, manual)')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('manual', 'Manual')
					.addOption('daily', 'Daily')
					.addOption('weekly', 'Weekly')
					.setValue(this.plugin.settings.defaultFreq)
					.onChange(async (value) => {
						this.plugin.settings.defaultFreq = value
						await this.plugin.saveSettings()
					})
			)
	}
}
