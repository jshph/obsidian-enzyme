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
	 * Retrieves the source information based on the provided DQL query.
	 * It queries the DQL and retrieves the paths from the results.
	 * It then retrieves the files based on the paths and returns an array of objects containing the file paths.
	 *
	 * @param dql - The DQL query to retrieve the source information.
	 * @returns A Promise that resolves to an array of objects containing the file paths.
	 */
	async getSourceInfo(dql: string[]): Promise<any[]> {
		// TODO doesn't work for tables
		const dqlResults = await this.dataviewAPI.tryQuery(dql)
		const paths = dqlResults.values
		const realPaths = paths.map((path: any) => path.path)
		const files = realPaths.map((path: string) =>
			this.app.metadataCache.getFirstLinkpathDest(path, '/')
		)
		return files.map((file: TFile) => {
			return {
				path: file.path
			}
		})
	}

	/**
	 * Retrieves file contents using the StrategyMetadata, i.e. utilizing the DQL query.
	 * If the strategy references an evergreen / a specific note, it's usually best to retrieve
	 * the note contents in addition to following the strategy to retrieve any mentions of that note
	 * (i.e. with SingleBacklinkerExtractor).
	 *
	 * Each file is then processed to prepare its contents according to the specified strategy
	 * The resulting array of FileContents is flattened before being returned.
	 *
	 * @param parameters - An object containing the DQL query, strategy, and optional evergreen status
	 * @returns A Promise that resolves to an array of FileContents, each representing the contents of a file.
	 */
	async retrieve(parameters: StrategyMetadata): Promise<FileContents[]> {
		if (isHighLevelStrategy(parameters)) {
			return [await this.obsidianContentRenderer.prepareContents(parameters)]
		} else if (parameters.dql === undefined) {
			return []
		}

		if (parameters.evergreen) {
			// Need to handle both links and tags

			if (
				parameters.evergreen.startsWith('[[') &&
				parameters.evergreen.endsWith(']]')
			) {
				// In case evergreen is a link, retrieve the file contents

				// Clean up evergreen as link
				const evergreen = parameters.evergreen
					.replaceAll('[', '')
					.replaceAll(']', '')

				const file = this.app.metadataCache.getFirstLinkpathDest(evergreen, '/')
				return [
					await this.obsidianContentRenderer.prepareFileContents(
						file,
						parameters
					)
				]
			} else {
				// In case evergreen is a tag

				// Execute the DQL query for the tag
				const sources = await this.dataviewAPI.tryQuery(parameters.dql)
				const files = sources.values.map((value: any) => {
					return this.app.metadataCache.getFirstLinkpathDest(value.path, '/')
				})

				return Promise.all(
					files.map(async (file: TFile) => {
						return await this.obsidianContentRenderer.prepareFileContents(
							file,
							{
								strategy: DQLStrategy[DQLStrategy.SingleEvergreenReferrer],
								evergreen: parameters.evergreen
							}
						)
					})
				)
			}
		} else {
			// Might also be a folder, etc, in which case we execute the DQL query directly

			const sources = await this.dataviewAPI.tryQuery(parameters.dql)
			const files = sources.values.map((value: any) => {
				return this.app.metadataCache.getFirstLinkpathDest(value.path, '/')
			})

			return Promise.all(
				files.map(async (file: TFile) => {
					return await this.obsidianContentRenderer.prepareFileContents(file, {
						strategy: DQLStrategy[DQLStrategy.Basic]
					})
				})
			)
		}
	}
}
