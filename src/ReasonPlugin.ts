import { Plugin, App, PluginManifest, Notice, ItemView } from 'obsidian'
import { ReasonSettings, DEFAULT_SETTINGS } from './settings/ReasonSettings'
import SettingsTab from './settings/SettingsTab'
import { CodeBlockRenderer } from './render'
import { Canvas, CanvasView } from './obsidian-internal'
import {
	ReasonAgent,
	CanvasLoader,
	AIClient,
	getSystemPrompts
} from './notebook'
import { SourceReasonNodeBuilder } from './reason-node/SourceReasonNodeBuilder'
import { AggregatorReasonNodeBuilder } from './reason-node/AggregatorReasonNodeBuilder'
import { DataviewApi, getAPI } from 'obsidian-dataview'
import { DataviewCandidateRetriever } from './source/retrieve/DataviewCandidateRetriever'

export class ReasonPlugin extends Plugin {
	settings: ReasonSettings
	reasonAgent: ReasonAgent
	noteRenderer: CodeBlockRenderer
	sourceReasonNodeBuilder: SourceReasonNodeBuilder
	aggregatorReasonNodeBuilder: AggregatorReasonNodeBuilder
	canvasLoader: CanvasLoader
	aiClient: AIClient
	dataview: DataviewApi
	candidateRetriever: DataviewCandidateRetriever

	constructor(app: App, pluginManifest: PluginManifest) {
		super(app, pluginManifest)
		this.settings = DEFAULT_SETTINGS
		this.dataview = getAPI(this.app)
		this.aiClient = new AIClient()
	}

	getActiveCanvas(): Canvas {
		this.app.workspace.setActiveLeaf(
			this.app.workspace.getLeavesOfType('canvas')[0],
			{ focus: true }
		)
		const maybeCanvasView = this.app.workspace.getActiveViewOfType(
			ItemView
		) as CanvasView | null

		if (!maybeCanvasView) {
			throw new Error('No canvas view found')
		}

		return maybeCanvasView['canvas']
	}

	async initAIClient() {
		await this.aiClient.initAIClient(
			this.settings.models[this.settings.selectedModel]
		)
	}

	getModel(): string {
		return this.settings.models[this.settings.selectedModel].model
	}

	async onload() {
		await this.loadSettings()

		this.canvasLoader = new CanvasLoader(this.app)

		this.sourceReasonNodeBuilder = new SourceReasonNodeBuilder()
		this.aggregatorReasonNodeBuilder = new AggregatorReasonNodeBuilder()

		this.candidateRetriever = new DataviewCandidateRetriever(
			this.settings,
			this.app
		)

		await this.initAIClient()

		const prompts = await getSystemPrompts()

		this.reasonAgent = new ReasonAgent(
			this.app,
			this.canvasLoader,
			this.aiClient,
			this.candidateRetriever,
			() => (() => this.settings.models[this.settings.selectedModel].model)(),
			() =>
				(() =>
					this.settings.models[this.settings.selectedModel].apiKey?.length >
					0)(),
			this.sourceReasonNodeBuilder,
			this.aggregatorReasonNodeBuilder,
			prompts
		)

		this.addSettingTab(new SettingsTab(this.app, this))

		this.noteRenderer = new CodeBlockRenderer(
			this.app,
			this.canvasLoader,
			this.reasonAgent,
			this.registerMarkdownCodeBlockProcessor.bind(this)
		)
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}
