import { Plugin, App, PluginManifest, Notice } from 'obsidian'
import { EnzymeSettings, DEFAULT_SETTINGS } from './settings/EnzymeSettings'
import SettingsTab from './settings/SettingsTab'
import { CodeBlockRenderer } from './render'
import { EnzymeAgent, AIClient, getSystemPrompts } from './notebook'
import { DataviewApi, getAPI } from './obsidian-modules/dataview-handler'
import { DataviewCandidateRetriever } from './source/retrieve/DataviewCandidateRetriever'
import { Suggester } from 'Suggester'

export class EnzymePlugin extends Plugin {
	settings: EnzymeSettings
	enzymeAgent: EnzymeAgent
	noteRenderer: CodeBlockRenderer
	aiClient: AIClient
	dataview: DataviewApi
	candidateRetriever: DataviewCandidateRetriever
	doCollapseEmbeds: boolean = false
	suggester: Suggester

	constructor(app: App, pluginManifest: PluginManifest) {
		super(app, pluginManifest)
		this.settings = DEFAULT_SETTINGS
		this.dataview = getAPI(this.app)
		this.aiClient = new AIClient()
	}

	async initAIClient() {
		// Check if API key is set for the selected model
		const selectedModel = this.settings.models.find(
			(model) => model.label === this.settings.selectedModel
		)

		if (!selectedModel.apiKey) {
			new Notice('No API key provided for selected model')
			return
		}

		await this.aiClient.initAIClient(
			this.settings.models.find(
				(model) => model.label === this.settings.selectedModel
			)
		)
	}

	getModel(): string {
		return this.settings.models.find(
			(model) => model.label === this.settings.selectedModel
		).model
	}

	async onload() {
		await this.loadSettings()
		this.suggester = new Suggester(this.app, this.settings.evergreenFolders)

		this.candidateRetriever = new DataviewCandidateRetriever(
			this.settings,
			this.app
		)

		await this.initAIClient()

		const prompts = await getSystemPrompts()

		this.enzymeAgent = new EnzymeAgent(
			this.app,
			this.aiClient,
			this.candidateRetriever,
			() =>
				(() =>
					this.settings.models.find(
						(model) => model.label === this.settings.selectedModel
					).model)(),
			() =>
				(() => {
					const selectedModel = this.settings.models.find(
						(model) => model.label === this.settings.selectedModel
					)

					if (
						selectedModel.baseURL &&
						selectedModel.baseURL.contains('localhost')
					) {
						return true
					} else {
						return selectedModel.apiKey?.length > 0
					}
				})(),
			prompts
		)

		this.addSettingTab(new SettingsTab(this.app, this))

		this.noteRenderer = new CodeBlockRenderer(
			this.app,
			this.enzymeAgent,
			this.registerMarkdownCodeBlockProcessor.bind(this),
			this.candidateRetriever
		)

		this.addCommand({
			id: 'template-backlinks',
			name: 'Insert template to digest evergreen mentions',
			editorCallback: async (editor) => {
				this.suggester.open()
			}
		})

		this.addCommand({
			id: 'toggle-hide-embeds',
			name: 'Toggle collapsed embeds in digest output',
			editorCallback: async (editor) => {
				let newHeight
				if (this.doCollapseEmbeds) {
					this.doCollapseEmbeds = false
					new Notice('Embeds will be shown in digest output')
					newHeight = '20rem'
				} else {
					this.doCollapseEmbeds = true
					new Notice('Embeds will be hidden in digest output')
					newHeight = '0.5rem'
				}

				document.documentElement.style.setProperty(
					'--enzyme-embed-max-height',
					newHeight
				)
			}
		})
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}
