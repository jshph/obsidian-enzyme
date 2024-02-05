import { TFile, CachedMetadata, App } from 'obsidian'
import { DataviewApi, getAPI } from 'obsidian-dataview'
import { ExtractorDelegator } from '../extract/ExtractorDelegator'
import { ReasonSettings } from '../../settings/ReasonSettings'
import { BlockRefSubstitution } from '../../types'

export type FileContents = {
	title: string
	contents: string
	substitutions: BlockRefSubstitution[]
}

/**
 * The `FileRenderer` class manages the rendering of file contents.
 * It provides methods to prepare the contents of a file for rendering, including metadata and content based on the specified strategy and evergreen status.
 */
export class FileRenderer {
	dataviewAPI: DataviewApi
	extractor: ExtractorDelegator

	constructor(
		public app: App,
		settings: ReasonSettings
	) {
		this.dataviewAPI = getAPI(app)
		this.extractor = new ExtractorDelegator(app, this.dataviewAPI, settings)
	}

	/**
	 * Prepares the contents of a file for rendering.
	 * This method extracts relevant data from the file, including metadata and content based on the specified strategy and evergreen status.
	 * It then formats this data into a structured object including the title, contents, and any block reference substitutions.
	 *
	 * @param file - The file to be processed.
	 * @param strategy - The extraction strategy to be used (optional).
	 * @param evergreen - The evergreen status to be considered (optional).
	 * @returns A Promise that resolves to a FileContents object containing the prepared data.
	 */
	async prepareContents(
		file: TFile,
		strategy?: string,
		evergreen?: string
	): Promise<FileContents> {
		// Should use this to ingest dataview lists as well. And rerender markdown.

		const metadata: CachedMetadata = this.app.metadataCache.getFileCache(file)

		let contentsData = await this.extractor.extract(
			file,
			metadata,
			strategy,
			evergreen
		)

		const renderedContentsData = contentsData.map((contents) => {
			let substitutions = contents.substitutions

			let mainMarkerDisplay = ''
			if (contents.contents.match(/%[a-zA-Z0-9]+%/g) === null) {
				const mainMarkerHash = Math.random().toString(16).substring(4, 8)
				mainMarkerDisplay = `\n* Main marker: %${mainMarkerHash}%`
				substitutions.push({
					template: `%${mainMarkerHash}%`,
					block_reference: `![[${file.name}]]`
				})
			}

			let contentsDisplay = `## File: ${file.name}
* Folder: ${file.path.substring(0, file.path.lastIndexOf('/'))}
* Last modified date: ${contents.last_modified_date}${mainMarkerDisplay}

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
