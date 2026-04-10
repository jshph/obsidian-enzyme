import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type EnzymeDigestPlugin from './main'
import { enzymeInit, isVaultIndexed } from './enzyme'

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
	refreshIntervalDays: number
	lastRefreshTimestamp: number
}

export const DEFAULT_SETTINGS: EnzymeDigestSettings = {
	apiKey: '',
	baseURL: 'https://openrouter.ai/api/v1',
	model: 'google/gemini-3-flash-preview',
	vaultPath: '',
	defaultPrompt: 'what threads connect my recent thinking?',
	defaultFreq: 'daily',
	highlightsPerQuery: 8,
	numQueries: 5,
	maxPerSource: 3,
	refreshIntervalDays: 3,
	lastRefreshTimestamp: 0,
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

		containerEl.createEl('h2', { text: 'Enzyme' })
		containerEl.createEl('p', {
			text: 'Surfaces connections across your vault via Enzyme, rendered as a clickable digest that helps you revisit and build on older thinking.',
			cls: 'setting-item-description',
		})

		// --- Enzyme Vault Indexing ---
		this.renderEnzymeInitSection(containerEl)

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
			.setDesc('Model identifier (e.g. google/gemini-3-flash-preview, gpt-4o-mini)')
			.addText((text) => {
				text.inputEl.style.width = '300px'
				text
					.setPlaceholder('google/gemini-3-flash-preview')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value
						await this.plugin.saveSettings()
					})
			})

		// --- Enzyme Tuning ---
		containerEl.createEl('h3', { text: 'Retrieval Tuning' })

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
			.setDesc('Pre-filled prompt when inserting a new digest block (overridden by selected text)')
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
	}

	private renderEnzymeInitSection(containerEl: HTMLElement) {
		containerEl.createEl('h3', { text: 'Vault Indexing' })

		const vaultPath = this.plugin.getVaultPath()
		const indexed = isVaultIndexed(vaultPath)

		// Info block
		const infoEl = containerEl.createEl('div', { cls: 'enzyme-digest-init-info' })

		const aboutP = infoEl.createEl('p')
		aboutP.appendText('This plugin uses ')
		const enzymeLink = aboutP.createEl('a', {
			text: 'Enzyme',
			href: 'https://enzyme.garden',
		})
		enzymeLink.setAttr('target', '_blank')
		aboutP.appendText(' to understand the semantic structure of your vault. ')
		aboutP.appendText('It generates thematic catalysts and embeddings locally on your machine, enabling rich semantic search across your notes.')

		const privacyP = infoEl.createEl('p', { cls: 'setting-item-description' })
		privacyP.appendText('Privacy: Embeddings are computed entirely on-device using a local model (no data leaves your machine for this step). ')
		privacyP.appendText('Catalyst generation requires one API call to an LLM provider (configured above). ')
		const privacyLink = privacyP.createEl('a', {
			text: 'Learn more about how Enzyme works.',
			href: 'https://enzyme.garden',
		})
		privacyLink.setAttr('target', '_blank')

		if (indexed) {
			// Already initialized
			const statusEl = containerEl.createEl('div', { cls: 'enzyme-digest-init-status' })
			statusEl.createEl('span', {
				text: 'Vault is indexed.',
				cls: 'enzyme-digest-init-ok',
			})

			const lastRefresh = this.plugin.settings.lastRefreshTimestamp
			if (lastRefresh) {
				const date = new Date(lastRefresh)
				statusEl.createEl('span', {
					text: ` Last refreshed: ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
					cls: 'setting-item-description',
				})
			}

			new Setting(containerEl)
				.setName('Auto-refresh interval')
				.setDesc(
					'Enzyme will refresh its index when you open Obsidian if this many days have passed since the last refresh.'
				)
				.addDropdown((dropdown) =>
					dropdown
						.addOption('1', 'Every day')
						.addOption('3', 'Every 3 days')
						.addOption('7', 'Every week')
						.setValue(String(this.plugin.settings.refreshIntervalDays))
						.onChange(async (value) => {
							this.plugin.settings.refreshIntervalDays = parseInt(value)
							await this.plugin.saveSettings()
						})
				)

			new Setting(containerEl)
				.setName('Re-index vault')
				.setDesc('Run a fresh enzyme init (will re-generate catalysts and embeddings)')
				.addButton((btn) =>
					btn
						.setButtonText('Re-index now')
						.onClick(() => this.runEnzymeInit(containerEl))
				)
		} else {
			// Not initialized — show disclaimer and init button
			const disclaimerEl = containerEl.createEl('div', { cls: 'enzyme-digest-init-disclaimer' })
			disclaimerEl.createEl('p', {
				text: 'Your vault has not been indexed yet. Initializing will:',
			})
			const list = disclaimerEl.createEl('ul')
			list.createEl('li', { text: 'Scan all notes in your vault to build a semantic index' })
			list.createEl('li', { text: 'Generate embeddings locally on your machine (~15 seconds for 1,000 notes)' })
			list.createEl('li', { text: 'Generate thematic catalysts via one LLM API call (requires the API key above)' })
			list.createEl('li', { text: 'Create a .enzyme/ folder in your vault root with the index database' })
			disclaimerEl.createEl('p', {
				text: 'Once initialized, Enzyme will automatically refresh in the background every few days when you open Obsidian, keeping your index current as your vault grows.',
				cls: 'setting-item-description',
			})

			new Setting(containerEl)
				.setName('Initialize Enzyme')
				.setDesc(`Vault: ${vaultPath}`)
				.addButton((btn) =>
					btn
						.setButtonText('Initialize vault')
						.setCta()
						.onClick(() => this.runEnzymeInit(containerEl))
				)
		}
	}

	private async runEnzymeInit(containerEl: HTMLElement) {
		const vaultPath = this.plugin.getVaultPath()
		const notice = new Notice('Enzyme: initializing vault...', 0)

		try {
			await enzymeInit(vaultPath, (msg) => {
				notice.setMessage(`Enzyme: ${msg}`)
			})

			this.plugin.settings.lastRefreshTimestamp = Date.now()
			await this.plugin.saveSettings()

			notice.setMessage('Enzyme: vault initialized successfully!')
			setTimeout(() => notice.hide(), 4000)

			// Re-render settings to show updated state
			this.display()
		} catch (e: unknown) {
			notice.hide()
			const msg = e instanceof Error ? e.message : String(e)
			new Notice(`Enzyme init failed: ${msg}`, 8000)
		}
	}
}
