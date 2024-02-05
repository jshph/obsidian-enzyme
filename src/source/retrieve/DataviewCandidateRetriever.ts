import { App, TFile } from 'obsidian'
import { FileRenderer, FileContents } from './FileRenderer'
import { ReasonSettings } from '../../settings/ReasonSettings'
import { ReasonNodeType } from '../..//types'
import { SourceReasonNodeSpec } from '../../reasonNode/SourceReasonNodeBuilder'
import { DataviewApi, getAPI } from 'obsidian-dataview'
import { CandidateRetriever } from '../..//notebook'

export class DataviewCandidateRetriever implements CandidateRetriever {
	fileRenderer: FileRenderer
	dataviewAPI: DataviewApi
	constructor(
		settings: ReasonSettings,
		public app: App
	) {
		this.fileRenderer = new FileRenderer(app, settings)
		this.dataviewAPI = getAPI(app)
	}

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

	async retrieve(parameters: {
		dql: string
		strategy: string
		evergreen?: string
	}): Promise<FileContents[]> {
		const dqlResults = await this.dataviewAPI.tryQuery(parameters.dql)
		const paths = dqlResults.values
		const realPaths = [...new Set(paths.map((path: any) => path.path))]
		const files = realPaths.map((path: string) =>
			this.app.metadataCache.getFirstLinkpathDest(path, '/')
		)
		const bodies: FileContents[] = await Promise.all(
			files.map((file: TFile) =>
				this.fileRenderer.prepareContents(
					file,
					parameters.strategy,
					parameters.evergreen
				)
			)
		)

		return bodies.flat()
	}

	async getNodeContents(nodeFile: any): Promise<any[]> {
		let fileContents: string
		if (typeof nodeFile === 'string') {
			nodeFile = this.app.vault.getAbstractFileByPath(nodeFile)
			fileContents = await this.app.vault.read(nodeFile)
		} else {
			fileContents = await this.app.vault.read(nodeFile)
		}

		const frontmatter = this.app.metadataCache.getFileCache(nodeFile)
			?.frontmatter as SourceReasonNodeSpec

		switch (frontmatter.role) {
			case ReasonNodeType[ReasonNodeType.Source]:
				const dql = fileContents.match(/```dataview\n?([\s\S]*?)\n?```/)[1]
				const dqlContents = await this.retrieve({
					dql,
					strategy: frontmatter.strategy,
					evergreen: frontmatter.evergreen
				})

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
