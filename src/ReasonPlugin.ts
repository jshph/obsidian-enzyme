import { Plugin, App, PluginManifest, Notice } from 'obsidian'
import { ReasonSettings, DEFAULT_SETTINGS } from './settings/ReasonSettings'
import SettingsTab from './settings/SettingsTab'
import { CodeBlockRenderer } from './render'
import { ReasonAgent, AIClient, getSystemPrompts } from './notebook'
import { DataviewApi, getAPI } from './obsidian-modules/dataview-handler'
import { DataviewCandidateRetriever } from './source/retrieve/DataviewCandidateRetriever'

export class ReasonPlugin extends Plugin {
	settings: ReasonSettings
	reasonAgent: ReasonAgent
	noteRenderer: CodeBlockRenderer
	aiClient: AIClient
	dataview: DataviewApi
	candidateRetriever: DataviewCandidateRetriever

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

		this.candidateRetriever = new DataviewCandidateRetriever(
			this.settings,
			this.app
		)

		await this.initAIClient()

		const prompts = await getSystemPrompts()

		this.reasonAgent = new ReasonAgent(
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
			this.reasonAgent,
			this.registerMarkdownCodeBlockProcessor.bind(this),
			this.candidateRetriever
		)
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}
