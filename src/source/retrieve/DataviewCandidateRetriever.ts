import { App, TFile } from 'obsidian'
import { FileContents, CandidateRetriever } from 'enzyme-core'
import { ObsidianContentRenderer } from './ObsidianContentRenderer'
import { EnzymeSettings } from '../../settings/EnzymeSettings'
import { DQLStrategy, isHighLevelStrategy } from '../extract/Strategy'
import { DataviewApi, getAPI } from '../../obsidian-modules/dataview-handler'
import { StrategyMetadata } from '../../notebook/ObsidianEnzymeAgent'

/**
 * The `DataviewCandidateRetriever` class manages the retrieval of candidate information from Dataview.
 * It provides methods to retrieve source information and file contents based on the provided DQL query.
 */
export class DataviewCandidateRetriever implements CandidateRetriever {
	obsidianContentRenderer: ObsidianContentRenderer
	dataviewAPI: DataviewApi
	constructor(
		public settings: EnzymeSettings,
		public app: App
	) {
		this.obsidianContentRenderer = new ObsidianContentRenderer(app, settings)

		this.dataviewAPI = getAPI(app)
	}

	/**
	 * Retrieves file contents based on the provided StrategyMetadata.
	 *
	 * @param parameters - StrategyMetadata containing DQL query, strategy, and optional evergreen status
	 * @returns Promise<FileContents[]> - Array of FileContents representing the contents of retrieved files
	 */
	async retrieve(parameters: StrategyMetadata): Promise<FileContents[]> {
		if (isHighLevelStrategy(parameters)) {
			return [await this.obsidianContentRenderer.prepareContents(parameters)]
		}

		if (!parameters.dql) {
			return []
		}

		if (parameters.evergreen) {
			return this.retrieveEvergreenContent(parameters)
		}

		return this.retrieveGeneralContent(parameters)
	}

	private async retrieveEvergreenContent(
		parameters: StrategyMetadata
	): Promise<FileContents[]> {
		if (this.isWikiLink(parameters.evergreen)) {
			return this.retrieveWikiLinkContent(parameters)
		}
		return this.retrieveTagContent(parameters)
	}

	private isWikiLink(evergreen: string): boolean {
		return evergreen.startsWith('[[') && evergreen.endsWith(']]')
	}

	private async retrieveWikiLinkContent(
		parameters: StrategyMetadata
	): Promise<FileContents[]> {
		const evergreen = parameters.evergreen.replace(/[\[\]]/g, '')
		const file = this.app.metadataCache.getFirstLinkpathDest(evergreen, '/')
		return [
			await this.obsidianContentRenderer.prepareFileContents(file, parameters)
		]
	}

	private async retrieveTagContent(
		parameters: StrategyMetadata
	): Promise<FileContents[]> {
		const sources = await this.dataviewAPI.tryQuery(parameters.dql)
		const files = sources.values.map((value: any) =>
			this.app.metadataCache.getFirstLinkpathDest(value.path, '/')
		)

		return Promise.all(
			files.map(async (file: TFile) =>
				this.obsidianContentRenderer.prepareFileContents(file, {
					strategy: DQLStrategy[DQLStrategy.SingleEvergreenReferrer],
					evergreen: parameters.evergreen
				})
			)
		)
	}

	private async retrieveGeneralContent(
		parameters: StrategyMetadata
	): Promise<FileContents[]> {
		const sources = await this.dataviewAPI.tryQuery(parameters.dql)
		const files = sources.values.map((value: any) =>
			this.app.metadataCache.getFirstLinkpathDest(value.path, '/')
		)

		return Promise.all(
			files.map(async (file: TFile) =>
				this.obsidianContentRenderer.prepareFileContents(file, {
					strategy: DQLStrategy[DQLStrategy.Basic]
				})
			)
		)
	}
}
