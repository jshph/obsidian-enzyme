import { App, TFile } from 'obsidian'
import { ContentRenderer, FileContents } from './ContentRenderer'
import { ReasonSettings } from '../../settings/ReasonSettings'
import { ReasonNodeType } from '../../types'
import {
	SourceReasonNodeSpec,
	isHighLevelStrategy
} from '../../reason-node/SourceReasonNodeBuilder'
import { DataviewApi, getAPI } from '../../obsidian-modules/dataview-handler'
import { CandidateRetriever } from './CandidateRetriever'
import { StrategyMetadata } from 'notebook/ReasonAgent'
import { SingleBacklinkerStrategyMetadata } from 'source/extract/SingleBacklinkerExtractor'

/**
 * The `DataviewCandidateRetriever` class manages the retrieval of candidate information from Dataview.
 * It provides methods to retrieve source information, file contents, and node contents.
 */
export class DataviewCandidateRetriever implements CandidateRetriever {
	contentRenderer: ContentRenderer
	dataviewAPI: DataviewApi
	constructor(
		settings: ReasonSettings,
		public app: App
	) {
		this.contentRenderer = new ContentRenderer(app, settings)
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
	 * Retrieves file contents.
	 * It ensures that duplicate paths are filtered out by creating a Set from the paths array.
	 * Each file is then processed to prepare its contents according to the specified strategy
	 * The resulting array of FileContents is flattened before being returned.
	 *
	 * @param parameters - An object containing the DQL query, strategy, and optional evergreen status
	 * @returns A Promise that resolves to an array of FileContents, each representing the contents of a file.
	 */
	async retrieve(parameters: StrategyMetadata): Promise<FileContents[]> {
		if (isHighLevelStrategy(parameters)) {
			return [await this.contentRenderer.prepareContents(parameters)]
		} else if (parameters.dql === undefined) {
			return []
		}

		const dql = parameters.dql

		const dqlResults = await this.dataviewAPI.tryQuery(dql)
		const paths = dqlResults.values
		const realPaths = [...new Set(paths.map((path: any) => path.path))]
		const files = realPaths.map((path: string) =>
			this.app.metadataCache.getFirstLinkpathDest(path, '/')
		)
		const bodies: FileContents[] = await Promise.all(
			files.map((file: TFile) =>
				this.contentRenderer.prepareFileContents(file, parameters)
			)
		)

		return bodies.flat()
	}

	/**
	 * Retrieves the contents of a node file based on its frontmatter role.
	 * If the role is 'source', it retrieves the contents of the DQL query.
	 * If the role is 'aggregator', it retrieves the guidance from the file.
	 * Otherwise, it retrieves the file contents as is.
	 *
	 * @param nodeFile - The node file to retrieve contents from.
	 * @returns A Promise that resolves to an array of objects containing the contents of the node file.
	 */
	async getNodeContents(nodeFileOrPath: string | TFile): Promise<any[]> {
		let fileContents: string
		let nodeFile: TFile
		if (typeof nodeFileOrPath === 'string') {
			const file = this.app.vault.getAbstractFileByPath(nodeFileOrPath)
			if (file instanceof TFile) {
				fileContents = await this.app.vault.read(nodeFile)
			} else {
				throw new Error(`File not found: ${nodeFile}`)
			}
		} else {
			fileContents = await this.app.vault.read(nodeFileOrPath)
		}

		const frontmatter = this.app.metadataCache.getFileCache(nodeFile)
			?.frontmatter as SourceReasonNodeSpec

		switch (frontmatter.role) {
			case ReasonNodeType[ReasonNodeType.Source]:
				const dqlContents = await this.retrieve(frontmatter.strategy)

				return dqlContents.map((contents) => {
					return {
						guidance: frontmatter?.guidance,
						source_material: contents.contents
					}
				})
			case ReasonNodeType[ReasonNodeType.Aggregator]:
				const guidance = fileContents.split('---').slice(2).join('---')
				return [{ guidance }]
			default:
				return [
					{
						contents: [fileContents]
					}
				]
		}
	}
}
