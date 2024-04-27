import { TFile, CachedMetadata, App } from 'obsidian'
import { DataviewApi, getAPI } from '../../obsidian-modules/dataview-handler'
import { ExtractorDelegator } from '../extract/ExtractorDelegator'
import { EnzymeSettings } from '../../settings/EnzymeSettings'
import { BlockRefSubstitution } from '../../types'
import { FileContents as ExtractorFileContents } from 'source/extract/BaseExtractor'
import { StrategyMetadata } from 'notebook/EnzymeAgent'

export type FileContents = {
	title: string
	contents: string
	substitutions: BlockRefSubstitution[]
}

/**
 * ContentRenderer is responsible for preparing and rendering the contents of files.
 * It utilizes the Dataview API for data retrieval and an ExtractorDelegator for content extraction.
 * It may extract the contents of specified files or files determined by a specified strategy
 */
export class ContentRenderer {
	dataviewAPI: DataviewApi
	extractor: ExtractorDelegator

	constructor(
		public app: App,
		settings: EnzymeSettings
	) {
		this.dataviewAPI = getAPI(app)
		this.extractor = new ExtractorDelegator(app, this.dataviewAPI, settings)
	}

	/**
	 * Higher-level extraction method where a specified strategy determines the files to be processed, then prepares and renders their contents.
	 * @param strategy - The extraction strategy to be used
	 * @returns A Promise that resolves to a FileContents object containing the prepared data
	 */
	async prepareContents(strategy?: StrategyMetadata): Promise<FileContents> {
		let contentsData = await this.extractor.extract(null, null, strategy)
		let renderedContentsData = this.renderFileContents(contentsData)
		return {
			title: 'Contents surrounding the top most recent tags and links',
			contents: renderedContentsData
				.map((contents) => contents.contents)
				.join('\n\n'),
			substitutions: renderedContentsData.flatMap(
				(contents) => contents.substitutions
			)
		}
	}

	renderFileContents(
		contentsData: ExtractorFileContents[],
		sourcePreamble?: string
	): FileContents[] {
		return contentsData.map((contents) => {
			let substitutions = contents.substitutions

			let mainMarkerDisplay = ''
			if (contents.contents.match(/%[a-zA-Z0-9]+%/g) === null) {
				const mainMarkerHash = Math.random().toString(16).substring(4, 8)
				mainMarkerDisplay = `\n* Main marker: %${mainMarkerHash}%`
				substitutions.push({
					template: `%${mainMarkerHash}%`,
					block_reference: `![[${contents.file}]]`
				})
			}

			let tags = contents.tags ? contents.tags.join(', ') : ''

			const path = this.app.metadataCache.getFirstLinkpathDest(
				contents.file,
				'/'
			).path

			let contentsDisplay = `## File: ${contents.file}
* Folder: ${path.substring(0, path.lastIndexOf('/'))}
* Last modified date: ${contents.last_modified_date}${mainMarkerDisplay}${tags ? `\n* Tags: ${tags}` : ''}${sourcePreamble ? `\n* Notes about this content: ${sourcePreamble}` : ''}

### Contents:
\`\`\`
${contents.contents}
\`\`\`
---
`
			return {
				title: contents.file,
				contents: contentsDisplay,
				substitutions: substitutions
			}
		})
	}

	/**
	 * Prepares the contents of a file for rendering.
	 * This method extracts relevant data from the file, including metadata and content based on the specified strategy and evergreen status.
	 * It then formats this data into a structured object including the title, contents, and any block reference substitutions.
	 *
	 * @param file - The file to be processed.
	 * @param strategy - The extraction strategy metadata to be used.
	 * @returns A Promise that resolves to a FileContents object containing the prepared data.
	 */
	async prepareFileContents(
		file?: TFile,
		strategy?: StrategyMetadata
	): Promise<FileContents> {
		// Should use this to ingest dataview lists as well. And rerender markdown.

		const metadata: CachedMetadata = this.app.metadataCache.getFileCache(file)

		let contentsData = await this.extractor.extract(file, metadata, strategy)

		const renderedContentsData = this.renderFileContents(
			contentsData,
			strategy.sourcePreamble
		)

		return {
			title: file.name,
			contents: renderedContentsData
				.map((contents) => contents.contents)
				.join('\n\n'),
			substitutions: renderedContentsData.flatMap(
				(contents) => contents.substitutions
			)
		}
	}
}
