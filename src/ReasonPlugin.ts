import { Plugin, App, PluginManifest, Notice, ItemView } from 'obsidian'
import { ReasonSettings, DEFAULT_SETTINGS } from './settings/ReasonSettings'
import SettingsTab from './settings/SettingsTab'
import { CodeBlockRenderer } from './obsidian-reason-core/render'
import { Canvas, CanvasView } from './obsidian-reason-core/obsidian'
import {
  ReasonAgent,
  CanvasLoader,
  RegistrationManager,
  AIClient
} from './obsidian-reason-core/notebook'
import { SourceReasonNodeBuilder } from './reasonNode/SourceReasonNodeBuilder'
import { AggregatorReasonNodeBuilder } from './reasonNode/AggregatorReasonNodeBuilder'
import { DataviewApi, getAPI } from 'obsidian-dataview'
import { DataviewCandidateRetriever } from './source/retrieve/DataviewCandidateRetriever'

export class ReasonPlugin extends Plugin {
  settings: ReasonSettings
  registrationManager: RegistrationManager
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
    this.dataview = getAPI(this.app)
    this.registrationManager = new RegistrationManager(this.app)
    this.aiClient = new AIClient(this.registrationManager)
  }

  async validateLicense(): Promise<boolean> {
    return await this.registrationManager.validateLicense()
  }
  async openRegisterModal() {
    return await this.registrationManager.openRegisterModal()
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

  initAIClient() {
    this.aiClient.initAIClient(
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

    this.registrationManager.setLicense(this.settings.reasonLicenseKey)

    this.initAIClient()

    this.reasonAgent = new ReasonAgent(
      this.registrationManager,
      this.app,
      this.canvasLoader,
      this.aiClient,
      this.candidateRetriever,
      () => (() => this.settings.models[this.settings.selectedModel].model)(),
      this.sourceReasonNodeBuilder,
      this.aggregatorReasonNodeBuilder
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
