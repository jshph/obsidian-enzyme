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
