import { Plugin, App, PluginManifest, Notice, Modal } from 'obsidian'
import { AIClient, getSystemPrompts, Server } from 'enzyme-core'
import { EnzymeSettings, DEFAULT_SETTINGS } from './settings/EnzymeSettings'
import SettingsTab from './settings/SettingsTab'
import { CodeBlockRenderer } from './render/CodeBlockRenderer'
import { ObsidianEnzymeAgent } from './notebook/ObsidianEnzymeAgent'
import { DataviewApi, getAPI } from './obsidian-modules/dataview-handler'
import { DataviewCandidateRetriever } from './source/retrieve/DataviewCandidateRetriever'
import { EnzymeBlockConstructor } from './render/EnzymeBlockConstructor'
import { DataviewGraphLinker } from './render/DataviewGraphLinker'
import { ProxyServer } from './notebook/ProxyServer'
import { Editor } from 'obsidian'
import { renderRefinePopup } from './render/RefinePopup'

export class EnzymePlugin extends Plugin {
	settings: EnzymeSettings
	obsidianEnzymeAgent: ObsidianEnzymeAgent
	noteRenderer: CodeBlockRenderer
	aiClient: AIClient
	dataview: DataviewApi
	candidateRetriever: DataviewCandidateRetriever
	doCollapseEmbeds: boolean = false
	enzymeBlockConstructor: EnzymeBlockConstructor
	dataviewGraphLinker: DataviewGraphLinker
	reasonCodeBlockProcessor: any
	enzymeCodeBlockProcessor: any
	refinePopup: any

	constructor(app: App, pluginManifest: PluginManifest) {
		super(app, pluginManifest)
		this.settings = DEFAULT_SETTINGS
		this.dataview = getAPI(this.app)
		this.aiClient = new AIClient(
			(baseURL: string) => new ProxyServer(baseURL, `http://localhost:3123`)
		)
	}

	async initAIClient(selectedModel: string) {
		const provider = this.settings.models.find(
			(model) => model.model === selectedModel
		)?.provider
		// Check if API key is set for the selected model
		if (
			!selectedModel ||
			!this.settings.apiKeys[provider?.toLowerCase() ?? '']
		) {
			new Notice('No API key provided for selected model')
			return
		}

		await this.aiClient.initAIClient(
			this.settings.models.find((model) => model.model === selectedModel),
			this.settings.apiKeys[provider?.toLowerCase() ?? '']
		)
	}

	getModel(): string {
		return this.settings.models.find(
			(model) => model.model === this.settings.selectedModel
		)?.model
	}

	async onload() {
		await this.loadSettings()
		this.dataviewGraphLinker = new DataviewGraphLinker(
			this.app,
			this.dataview,
			this.settings
		)

		this.candidateRetriever = new DataviewCandidateRetriever(
			this.settings,
			this.app
		)

		await this.initAIClient(this.getModel())

		const prompts = await getSystemPrompts()

		this.enzymeBlockConstructor = new EnzymeBlockConstructor(
			this.app,
			this.settings
		)

		this.obsidianEnzymeAgent = new ObsidianEnzymeAgent(
			this.app,
			this.aiClient,
			this.enzymeBlockConstructor,
			this.candidateRetriever,
			() =>
				(() =>
					this.settings.models.find(
						(model) => model.model === this.settings.selectedModel
					).model)(),
			async () => {
				await this.loadSettings()
				const selectedModel = this.settings.models.find(
					(model) => model.model === this.settings.selectedModel
				)

				if (
					selectedModel?.baseURL &&
					selectedModel.baseURL.contains('localhost')
				) {
					return true
				} else {
					return (
						this.settings.apiKeys[selectedModel?.provider?.toLowerCase() ?? '']
							?.length > 0
					)
				}
			},
			prompts
		)

		this.addSettingTab(new SettingsTab(this.app, this))

		this.noteRenderer = new CodeBlockRenderer(
			this.app,
			this.obsidianEnzymeAgent,
			this.candidateRetriever,
			this.dataviewGraphLinker,
			async () => {
				await this.loadSettings()
				const modelLabels = this.settings.models
					.map((model) => model.model)
					.filter((model) => model !== undefined)
				return modelLabels
			},
			() => {
				return this.settings.selectedModel
			},
			(model: string) => {
				this.settings.selectedModel = model
				this.saveSettings()
			},
			this.initAIClient.bind(this),
			this.settings.exclusionPatterns
		)

		try {
			this.enzymeCodeBlockProcessor = this.registerMarkdownCodeBlockProcessor(
				'enzyme',
				this.noteRenderer.renderEnzyme.bind(this.noteRenderer)
			)

			this.reasonCodeBlockProcessor = this.registerMarkdownCodeBlockProcessor(
				'reason',
				this.noteRenderer.renderEnzyme.bind(this.noteRenderer)
			)
		} catch (e) {}

		this.refinePopup = renderRefinePopup(
			this.obsidianEnzymeAgent.refineDigest.bind(this.obsidianEnzymeAgent)
		)

		this.addCommand({
			id: 'build-enzyme-block-from-selection',
			name: 'Build an Enzyme block from selection',
			editorCallback: async (editor) => {
				this.noteRenderer.buildEnzymeBlockFromCurLine()
			}
		})

		this.addCommand({
			id: 'toggle-truncate-embeds',
			name: 'Truncate embed previews (across Obsidian)',
			editorCallback: async (editor) => {
				let newHeight
				if (this.doCollapseEmbeds) {
					this.doCollapseEmbeds = false
					newHeight = '100%'
				} else {
					this.doCollapseEmbeds = true
					newHeight = '20rem'
				}

				document.documentElement.style.setProperty(
					'--enzyme-embed-max-height',
					newHeight
				)
			}
		})

		this.addCommand({
			id: 'unlock-graph',
			name: 'Unlock graph',
			editorCallback: async (editor) => {
				this.dataviewGraphLinker.unlockGraph()
			}
		})

		this.addCommand({
			id: 'trim-highlighted-content',
			name: 'Trim digest output to highlighted content',
			editorCallback: (editor) => {
				this.noteRenderer.trimHighlightedContent(editor)
			}
		})

		this.addCommand({
			id: 'refine-digest',
			name: 'Refine selected digest',
			editorCallback: (editor: Editor) => {
				this.refinePopup.show(() => {
					const cursorPos = editor.getCursor('to')
					const cursorCoords = editor.posToOffset(cursorPos)
					const { left, top } = editor.cm.coordsAtPos(cursorCoords) || {
						left: 0,
						top: 0
					}
					return { left, top }
				})
				const cursorPos = editor.getCursor('from')
				this.refinePopup.setInsertPosition(cursorPos)
			}
		})
	}

	async loadSettings() {
		if (!this.settings) {
			this.settings = DEFAULT_SETTINGS
		}
		const loadedData = await this.loadData()
		for (const key in loadedData) {
			if (Object.prototype.hasOwnProperty.call(loadedData, key)) {
				this.settings[key] = loadedData[key]
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}
